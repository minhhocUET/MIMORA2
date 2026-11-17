import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import test from 'node:test';
import { parseServerConfig, type ServerConfig } from '../config/env.ts';
import { generateUuidV7 } from '../db/uuid.ts';
import { AppError } from '../http/errors.ts';
import { apiErrorHandler, apiNotFoundHandler } from '../http/middleware.ts';
import { createAuthMiddlewareSuite } from '../middleware/auth.ts';
import type {
  AssignmentClassRecord,
  AssignmentListSummaryRecord,
  AssignmentProgressReadRecord,
  AssignmentRecord,
  AssignmentRepository,
  AssignmentTargetStudentRecord,
  EligibleStudentInClassRecord,
  PinnedAssignmentItemRecord,
} from '../repositories/assignment.repository.ts';
import type {
  AuthRepository,
  SessionWithContextRecord,
} from '../repositories/auth.repository.ts';
import { createAssignmentsRouters } from '../routes/assignments.routes.ts';
import {
  CSRF_TOKEN_HEADER,
  CUSTOM_REQUEST_HEADER,
  createAuthenticatedCsrfMiddleware,
  deriveSessionCsrfToken,
} from '../security/csrf.ts';
import { generateSessionToken, hashSessionToken } from '../security/session.ts';
import { AUDIT_EVENT_TYPES } from '../db/schema/_shared.ts';
import { recordAuditEvent } from './audit.service.ts';
import { createAssignmentService } from './assignment.service.ts';

type AuditEventInput = Parameters<typeof recordAuditEvent>[0];

interface InMemoryP205Store {
  organizations: Map<
    string,
    { id: string; code: string; name: string; status: 'active' | 'suspended' }
  >;
  users: Map<
    string,
    {
      id: string;
      email: string | null;
      platformUsername: string | null;
      platformRole: string | null;
      displayName: string;
      status: string;
    }
  >;
  memberships: Map<
    string,
    {
      id: string;
      organizationId: string;
      userId: string;
      role: 'teacher' | 'student';
      orgUsername: string | null;
      status: 'active' | 'disabled';
    }
  >;
  sessions: Map<
    string,
    {
      id: string;
      tokenHash: string;
      userId: string;
      sessionScope: 'platform_admin' | 'teacher' | 'student';
      activeOrganizationId: string | null;
      idleExpiresAt: Date;
      absoluteExpiresAt: Date;
      lastActivityAt: Date;
      revokedAt: Date | null;
      revokedReason: string | null;
    }
  >;
  classes: Map<
    string,
    {
      id: string;
      organizationId: string;
      name: string;
      academicYear: string | null;
      status: 'active' | 'archived';
    }
  >;
  classTeachers: Array<{
    organizationId: string;
    classId: string;
    teacherMembershipId: string;
  }>;
  classEnrollments: Array<{
    organizationId: string;
    classId: string;
    studentMembershipId: string;
    status: 'active' | 'transferred_out' | 'archived';
  }>;
  contentItems: Map<
    string,
    {
      id: string;
      slug: string;
      contentType: string;
      currentPublishedVersionId: string | null;
      isArchived: boolean;
    }
  >;
  contentVersions: Map<
    string,
    {
      id: string;
      contentItemId: string;
      versionNumber: number;
      status: string;
      title: string;
      summary: string | null;
      locale: string;
      payloadJson: Record<string, unknown>;
      metadataJson: Record<string, unknown> | null;
      publishedAt: Date | null;
    }
  >;
  assignments: Map<string, AssignmentRecord>;
  assignmentItems: Array<{
    id: string;
    organizationId: string;
    assignmentId: string;
    contentVersionId: string;
    sortOrder: number;
    createdAt: Date;
  }>;
  assignmentTargets: Array<{
    id: string;
    organizationId: string;
    assignmentId: string;
    studentMembershipId: string;
    assignedAt: Date;
  }>;
  activityAttempts: Array<{
    id: string;
    organizationId: string;
    assignmentId: string;
    assignmentTargetId: string;
  }>;
  assignmentProgress: Array<{
    id: string;
    organizationId: string;
    assignmentTargetId: string;
    studentMembershipId: string;
    status: string;
    totalItems: number;
    completedItems: number;
    attemptCount: number;
    lastActivityAt: Date | null;
    completedAt: Date | null;
  }>;
  audits: AuditEventInput[];
  txQueue: Promise<unknown>;
}

function createEmptyP205Store(): InMemoryP205Store {
  return {
    organizations: new Map(),
    users: new Map(),
    memberships: new Map(),
    sessions: new Map(),
    classes: new Map(),
    classTeachers: [],
    classEnrollments: [],
    contentItems: new Map(),
    contentVersions: new Map(),
    assignments: new Map(),
    assignmentItems: [],
    assignmentTargets: [],
    activityAttempts: [],
    assignmentProgress: [],
    audits: [],
    txQueue: Promise.resolve(),
  };
}

function makeFakeAssignmentRepo(store: InMemoryP205Store): AssignmentRepository {
  return {
    withTransaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      const next = store.txQueue.then(async () => {
        const snapshot = {
          assignments: new Map(
            Array.from(store.assignments.entries()).map(([k, v]) => [
              k,
              {
                ...v,
                dueAt: v.dueAt ? new Date(v.dueAt) : null,
                createdAt: new Date(v.createdAt),
                updatedAt: new Date(v.updatedAt),
              },
            ])
          ),
          assignmentItems: store.assignmentItems.map((i) => ({
            ...i,
            createdAt: new Date(i.createdAt),
          })),
          assignmentTargets: store.assignmentTargets.map((t) => ({
            ...t,
            assignedAt: new Date(t.assignedAt),
          })),
          auditsLen: store.audits.length,
        };

        try {
          return await fn({} as never);
        } catch (err) {
          store.assignments = snapshot.assignments;
          store.assignmentItems = snapshot.assignmentItems;
          store.assignmentTargets = snapshot.assignmentTargets;
          store.audits.length = snapshot.auditsLen;
          throw err;
        }
      });
      store.txQueue = next.catch(() => undefined);
      return next;
    },

    async findClassByIdInOrg(
      organizationId: string,
      classId: string
    ): Promise<AssignmentClassRecord | null> {
      const c = store.classes.get(classId);
      if (!c || c.organizationId !== organizationId) {
        return null;
      }
      return { ...c };
    },

    async isTeacherAssignedToClassInOrg(
      organizationId: string,
      classId: string,
      teacherMembershipId: string
    ): Promise<boolean> {
      return store.classTeachers.some(
        (ct) =>
          ct.organizationId === organizationId &&
          ct.classId === classId &&
          ct.teacherMembershipId === teacherMembershipId
      );
    },

    async findEligibleStudentsInClass(
      organizationId: string,
      classId: string,
      studentMembershipIds: string[]
    ): Promise<EligibleStudentInClassRecord[]> {
      const wanted = new Set(studentMembershipIds);
      const out: EligibleStudentInClassRecord[] = [];
      for (const e of store.classEnrollments) {
        if (
          e.organizationId !== organizationId ||
          e.classId !== classId ||
          e.status !== 'active' ||
          !wanted.has(e.studentMembershipId)
        ) {
          continue;
        }
        const m = store.memberships.get(e.studentMembershipId);
        if (!m || m.organizationId !== organizationId) {
          continue;
        }
        const u = store.users.get(m.userId);
        if (!u) {
          continue;
        }
        out.push({
          membershipId: m.id,
          userId: u.id,
          organizationId: m.organizationId,
          classId: e.classId,
          role: m.role,
          membershipStatus: m.status,
          userStatus: u.status,
          enrollmentStatus: e.status,
          displayName: u.displayName,
          orgUsername: m.orgUsername,
        });
      }
      return out;
    },

    async findContentVersionsForPinning(versionIds: string[]) {
      const wanted = new Set(versionIds);
      const out = [];
      for (const v of store.contentVersions.values()) {
        if (!wanted.has(v.id)) {
          continue;
        }
        const item = store.contentItems.get(v.contentItemId);
        if (!item) {
          continue;
        }
        out.push({
          versionId: v.id,
          contentItemId: item.id,
          slug: item.slug,
          contentType: item.contentType,
          versionNumber: v.versionNumber,
          status: v.status,
          isArchived: item.isArchived,
          title: v.title,
          summary: v.summary,
          locale: v.locale,
        });
      }
      return out;
    },

    async createAssignmentWithItemsAndTargets(params) {
      store.assignments.set(params.assignment.id, {
        ...params.assignment,
        dueAt: params.assignment.dueAt ? new Date(params.assignment.dueAt) : null,
        createdAt: new Date(params.assignment.createdAt),
        updatedAt: new Date(params.assignment.updatedAt),
      });
      for (const item of params.items) {
        store.assignmentItems.push({ ...item, createdAt: new Date(item.createdAt) });
      }
      for (const target of params.targets) {
        store.assignmentTargets.push({
          ...target,
          assignedAt: new Date(target.assignedAt),
        });
      }
    },

    async listAssignmentsForTeacherClasses(params) {
      const teacherClasses = new Set(
        store.classTeachers
          .filter(
            (ct) =>
              ct.organizationId === params.organizationId &&
              ct.teacherMembershipId === params.teacherMembershipId
          )
          .map((ct) => ct.classId)
      );

      const matched = Array.from(store.assignments.values())
        .filter((a) => {
          if (a.organizationId !== params.organizationId) return false;
          if (!teacherClasses.has(a.classId)) return false;
          if (params.classId && a.classId !== params.classId) return false;
          if (params.status && a.status !== params.status) return false;
          return true;
        })
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      const offset = (params.page - 1) * params.limit;
      const paged = matched.slice(offset, offset + params.limit);

      const items: AssignmentListSummaryRecord[] = paged.map((a) => {
        const cls = store.classes.get(a.classId)!;
        return {
          assignment: {
            ...a,
            dueAt: a.dueAt ? new Date(a.dueAt) : null,
            createdAt: new Date(a.createdAt),
            updatedAt: new Date(a.updatedAt),
          },
          className: cls.name,
          itemCount: store.assignmentItems.filter(
            (i) => i.organizationId === a.organizationId && i.assignmentId === a.id
          ).length,
          targetCount: store.assignmentTargets.filter(
            (t) => t.organizationId === a.organizationId && t.assignmentId === a.id
          ).length,
        };
      });

      return { items, total: matched.length };
    },

    async findAssignmentByIdInOrg(organizationId, assignmentId) {
      const a = store.assignments.get(assignmentId);
      if (!a || a.organizationId !== organizationId) {
        return null;
      }
      const cls = store.classes.get(a.classId)!;
      return {
        ...a,
        dueAt: a.dueAt ? new Date(a.dueAt) : null,
        createdAt: new Date(a.createdAt),
        updatedAt: new Date(a.updatedAt),
        className: cls.name,
      };
    },

    async findAssignmentByIdInOrgForUpdate(organizationId, assignmentId) {
      const a = store.assignments.get(assignmentId);
      if (!a || a.organizationId !== organizationId) {
        return null;
      }
      return {
        ...a,
        dueAt: a.dueAt ? new Date(a.dueAt) : null,
        createdAt: new Date(a.createdAt),
        updatedAt: new Date(a.updatedAt),
      };
    },

    async listAssignmentItemsWithPinnedContent(
      organizationId: string,
      assignmentId: string
    ): Promise<PinnedAssignmentItemRecord[]> {
      return store.assignmentItems
        .filter(
          (ai) => ai.organizationId === organizationId && ai.assignmentId === assignmentId
        )
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((ai) => {
          const v = store.contentVersions.get(ai.contentVersionId)!;
          const item = store.contentItems.get(v.contentItemId)!;
          return {
            id: ai.id,
            organizationId: ai.organizationId,
            assignmentId: ai.assignmentId,
            contentVersionId: ai.contentVersionId,
            sortOrder: ai.sortOrder,
            createdAt: new Date(ai.createdAt),
            contentItemId: item.id,
            slug: item.slug,
            contentType: item.contentType,
            versionNumber: v.versionNumber,
            versionStatus: v.status,
            title: v.title,
            summary: v.summary,
            locale: v.locale,
            payloadJson: structuredClone(v.payloadJson),
            metadataJson: v.metadataJson ? structuredClone(v.metadataJson) : null,
            publishedAt: v.publishedAt ? new Date(v.publishedAt) : null,
          };
        });
    },

    async listAssignmentTargetsWithStudents(
      organizationId: string,
      assignmentId: string
    ): Promise<AssignmentTargetStudentRecord[]> {
      return store.assignmentTargets
        .filter(
          (at) => at.organizationId === organizationId && at.assignmentId === assignmentId
        )
        .sort((a, b) => a.assignedAt.getTime() - b.assignedAt.getTime())
        .map((at) => {
          const m = store.memberships.get(at.studentMembershipId)!;
          const u = store.users.get(m.userId)!;
          return {
            targetId: at.id,
            organizationId: at.organizationId,
            assignmentId: at.assignmentId,
            studentMembershipId: at.studentMembershipId,
            assignedAt: new Date(at.assignedAt),
            displayName: u.displayName,
            orgUsername: m.orgUsername,
            membershipStatus: m.status,
          };
        });
    },

    async updateAssignmentFields(params) {
      const existing = store.assignments.get(params.assignmentId);
      if (!existing || existing.organizationId !== params.organizationId) {
        return null;
      }
      const next: AssignmentRecord = {
        ...existing,
        title: params.title ?? existing.title,
        homePracticeInstructions:
          params.homePracticeInstructions !== undefined
            ? params.homePracticeInstructions
            : existing.homePracticeInstructions,
        dueAt: params.dueAt !== undefined ? params.dueAt : existing.dueAt,
        status: params.status ?? existing.status,
        updatedAt: new Date(params.now),
      };
      store.assignments.set(existing.id, next);
      return { ...next };
    },

    async findTargetIdsWithActivity(organizationId, assignmentId, targetIds) {
      const wanted = new Set(targetIds);
      const hit = new Set<string>();
      for (const att of store.activityAttempts) {
        if (
          att.organizationId === organizationId &&
          att.assignmentId === assignmentId &&
          wanted.has(att.assignmentTargetId)
        ) {
          hit.add(att.assignmentTargetId);
        }
      }
      for (const p of store.assignmentProgress) {
        if (
          p.organizationId === organizationId &&
          wanted.has(p.assignmentTargetId)
        ) {
          hit.add(p.assignmentTargetId);
        }
      }
      return Array.from(hit);
    },

    async syncAssignmentTargets(params) {
      const deleteSet = new Set(params.deleteTargetIds);
      store.assignmentTargets = store.assignmentTargets.filter(
        (t) =>
          !(
            t.organizationId === params.organizationId &&
            t.assignmentId === params.assignmentId &&
            deleteSet.has(t.id)
          )
      );
      for (const ins of params.inserts) {
        store.assignmentTargets.push({
          ...ins,
          assignedAt: new Date(ins.assignedAt),
        });
      }
      const existing = store.assignments.get(params.assignmentId);
      if (existing) {
        existing.updatedAt = new Date(params.now);
      }
    },

    async listAssignmentProgressSummary(
      organizationId: string,
      assignmentId: string,
      itemCount: number
    ): Promise<AssignmentProgressReadRecord[]> {
      return store.assignmentTargets
        .filter(
          (at) => at.organizationId === organizationId && at.assignmentId === assignmentId
        )
        .sort((a, b) => a.assignedAt.getTime() - b.assignedAt.getTime())
        .map((at) => {
          const m = store.memberships.get(at.studentMembershipId)!;
          const u = store.users.get(m.userId)!;
          const prog = store.assignmentProgress.find(
            (p) =>
              p.organizationId === organizationId && p.assignmentTargetId === at.id
          );
          return {
            assignmentTargetId: at.id,
            studentMembershipId: at.studentMembershipId,
            displayName: u.displayName,
            orgUsername: m.orgUsername,
            hasProgressRecord: prog !== undefined,
            status: prog?.status ?? 'not_started',
            totalItems: prog?.totalItems ?? itemCount,
            completedItems: prog?.completedItems ?? 0,
            attemptCount: prog?.attemptCount ?? 0,
            lastActivityAt: prog?.lastActivityAt ? new Date(prog.lastActivityAt) : null,
            completedAt: prog?.completedAt ? new Date(prog.completedAt) : null,
          };
        });
    },

    async listAssignmentsForStudent(params) {
      const allowedStatuses = params.status
        ? [params.status]
        : ['active', 'closed'];

      const rows = store.assignmentTargets
        .filter(
          (at) =>
            at.organizationId === params.organizationId &&
            at.studentMembershipId === params.studentMembershipId
        )
        .map((at) => {
          const a = store.assignments.get(at.assignmentId);
          return a ? { at, a } : null;
        })
        .filter(
          (pair): pair is { at: (typeof store.assignmentTargets)[number]; a: AssignmentRecord } =>
            pair !== null &&
            pair.a.organizationId === params.organizationId &&
            allowedStatuses.includes(pair.a.status)
        )
        .sort((x, y) => y.at.assignedAt.getTime() - x.at.assignedAt.getTime());

      const offset = (params.page - 1) * params.limit;
      const paged = rows.slice(offset, offset + params.limit);

      return {
        items: paged.map(({ at, a }) => {
          const cls = store.classes.get(a.classId)!;
          const itemCount = store.assignmentItems.filter(
            (ai) => ai.organizationId === a.organizationId && ai.assignmentId === a.id
          ).length;
          const prog = store.assignmentProgress.find(
            (p) =>
              p.organizationId === a.organizationId &&
              p.assignmentTargetId === at.id &&
              p.studentMembershipId === params.studentMembershipId
          );
          return {
            assignment: { ...a },
            className: cls.name,
            targetId: at.id,
            assignedAt: new Date(at.assignedAt),
            itemCount,
            progress: {
              hasProgressRecord: prog !== undefined,
              status: prog?.status ?? 'not_started',
              totalItems: prog?.totalItems ?? itemCount,
              completedItems: prog?.completedItems ?? 0,
              attemptCount: prog?.attemptCount ?? 0,
              lastActivityAt: prog?.lastActivityAt ? new Date(prog.lastActivityAt) : null,
              completedAt: prog?.completedAt ? new Date(prog.completedAt) : null,
            },
          };
        }),
        total: rows.length,
      };
    },

    async findAssignmentForStudentById(params) {
      const at = store.assignmentTargets.find(
        (t) =>
          t.organizationId === params.organizationId &&
          t.assignmentId === params.assignmentId &&
          t.studentMembershipId === params.studentMembershipId
      );
      if (!at) return null;
      const a = store.assignments.get(at.assignmentId);
      if (
        !a ||
        a.organizationId !== params.organizationId ||
        (a.status !== 'active' && a.status !== 'closed')
      ) {
        return null;
      }
      const cls = store.classes.get(a.classId)!;
      const prog = store.assignmentProgress.find(
        (p) =>
          p.organizationId === params.organizationId &&
          p.assignmentTargetId === at.id &&
          p.studentMembershipId === params.studentMembershipId
      );
      return {
        assignment: { ...a },
        className: cls.name,
        targetId: at.id,
        assignedAt: new Date(at.assignedAt),
        progress: prog
          ? {
              hasProgressRecord: true,
              status: prog.status,
              totalItems: prog.totalItems,
              completedItems: prog.completedItems,
              attemptCount: prog.attemptCount,
              lastActivityAt: prog.lastActivityAt ? new Date(prog.lastActivityAt) : null,
              completedAt: prog.completedAt ? new Date(prog.completedAt) : null,
            }
          : null,
      };
    },
  };
}

function makeFakeAuthRepo(store: InMemoryP205Store): AuthRepository {
  return {
    withTransaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      return fn({} as never);
    },
    async findUserCredentialByEmail() {
      return null;
    },
    async findUserCredentialByPlatformUsername() {
      return null;
    },
    async findUserCredentialById() {
      return null;
    },
    async findStudentLoginRecord() {
      return null;
    },
    async findMembershipsForUser(userId: string) {
      return Array.from(store.memberships.values())
        .filter((m) => m.userId === userId)
        .map((m) => {
          const org = store.organizations.get(m.organizationId)!;
          return {
            membershipId: m.id,
            organizationId: m.organizationId,
            organizationCode: org.code,
            organizationName: org.name,
            organizationStatus: org.status,
            role: m.role,
            membershipStatus: m.status,
            orgUsername: m.orgUsername,
          };
        });
    },
    async createSession() {},
    async findSessionWithContextByTokenHash(tokenHash) {
      const s = Array.from(store.sessions.values()).find(
        (x) => x.tokenHash === tokenHash
      );
      if (!s) return null;
      const u = store.users.get(s.userId);
      if (!u) return null;

      let activeOrganization: SessionWithContextRecord['activeOrganization'] = null;
      let activeMembership: SessionWithContextRecord['activeMembership'] = null;
      if (s.activeOrganizationId) {
        const org = store.organizations.get(s.activeOrganizationId);
        if (org) {
          activeOrganization = { ...org };
        }
        const m = Array.from(store.memberships.values()).find(
          (x) => x.userId === u.id && x.organizationId === s.activeOrganizationId
        );
        if (m) {
          activeMembership = {
            id: m.id,
            organizationId: m.organizationId,
            role: m.role,
            orgUsername: m.orgUsername,
            status: m.status,
          };
        }
      }

      return {
        session: { ...s },
        user: {
          id: u.id,
          email: u.email,
          platformUsername: u.platformUsername,
          platformRole: u.platformRole,
          displayName: u.displayName,
          status: u.status,
          lockedUntil: null,
        },
        activeOrganization,
        activeMembership,
      };
    },
    async touchSessionActivity() {},
    async rotateSession() {
      return true;
    },
    async revokeSessionById() {},
    async revokeOtherActiveSessionsForUser() {
      return 0;
    },
    async recordFailedLoginAttempt() {
      return { lockedNow: false, failedAttempts: 0, lockedUntil: null };
    },
    async recordSuccessfulLoginState() {},
    async updateUserPasswordHash() {},
  };
}

function makeTestConfig(): ServerConfig {
  return parseServerConfig({
    NODE_ENV: 'test',
    AUTH_CSRF_SECRET: 'p2_05_http_csrf_secret_0123456789abcdef',
  });
}

function seedFixture(store: InMemoryP205Store) {
  const now = new Date('2026-11-17T08:00:00.000Z');
  const org1Id = generateUuidV7();
  const org2Id = generateUuidV7();
  store.organizations.set(org1Id, {
    id: org1Id,
    code: 'TRUONG_A',
    name: 'Trường Tiểu học Hoa Mai',
    status: 'active',
  });
  store.organizations.set(org2Id, {
    id: org2Id,
    code: 'TRUONG_B',
    name: 'Trường Tiểu học Bình Minh',
    status: 'active',
  });

  const adminUserId = generateUuidV7();
  const t1UserId = generateUuidV7();
  const t2UserId = generateUuidV7();
  const tUnassignedUserId = generateUuidV7();
  const tOrg2UserId = generateUuidV7();
  const s1UserId = generateUuidV7();
  const s2UserId = generateUuidV7();
  const s3UserId = generateUuidV7();
  const sTransferredUserId = generateUuidV7();
  const sOrg2UserId = generateUuidV7();

  store.users.set(adminUserId, {
    id: adminUserId,
    email: 'admin@mimora.local',
    platformUsername: 'admin1',
    platformRole: 'platform_admin',
    displayName: 'Platform Admin',
    status: 'active',
  });
  store.users.set(t1UserId, {
    id: t1UserId,
    email: 't1@hoa-mai.edu.vn',
    platformUsername: null,
    platformRole: null,
    displayName: 'Cô Lan',
    status: 'active',
  });
  store.users.set(t2UserId, {
    id: t2UserId,
    email: 't2@hoa-mai.edu.vn',
    platformUsername: null,
    platformRole: null,
    displayName: 'Thầy Minh (Đồng phụ trách)',
    status: 'active',
  });
  store.users.set(tUnassignedUserId, {
    id: tUnassignedUserId,
    email: 't3@hoa-mai.edu.vn',
    platformUsername: null,
    platformRole: null,
    displayName: 'Cô Hương (Chưa phân công)',
    status: 'active',
  });
  store.users.set(tOrg2UserId, {
    id: tOrg2UserId,
    email: 't@binh-minh.edu.vn',
    platformUsername: null,
    platformRole: null,
    displayName: 'Thầy Nam Org 2',
    status: 'active',
  });
  store.users.set(s1UserId, {
    id: s1UserId,
    email: null,
    platformUsername: null,
    platformRole: null,
    displayName: 'Bé An',
    status: 'active',
  });
  store.users.set(s2UserId, {
    id: s2UserId,
    email: null,
    platformUsername: null,
    platformRole: null,
    displayName: 'Bé Bình',
    status: 'active',
  });
  store.users.set(s3UserId, {
    id: s3UserId,
    email: null,
    platformUsername: null,
    platformRole: null,
    displayName: 'Bé Chi',
    status: 'active',
  });
  store.users.set(sTransferredUserId, {
    id: sTransferredUserId,
    email: null,
    platformUsername: null,
    platformRole: null,
    displayName: 'Bé Dũng (Đã chuyển lớp)',
    status: 'active',
  });
  store.users.set(sOrg2UserId, {
    id: sOrg2UserId,
    email: null,
    platformUsername: null,
    platformRole: null,
    displayName: 'Bé Em Org 2',
    status: 'active',
  });

  const t1MemId = generateUuidV7();
  const t2MemId = generateUuidV7();
  const tUnassignedMemId = generateUuidV7();
  const tOrg2MemId = generateUuidV7();
  const s1MemId = generateUuidV7();
  const s2MemId = generateUuidV7();
  const s3MemId = generateUuidV7();
  const sTransferredMemId = generateUuidV7();
  const sOrg2MemId = generateUuidV7();

  store.memberships.set(t1MemId, {
    id: t1MemId,
    organizationId: org1Id,
    userId: t1UserId,
    role: 'teacher',
    orgUsername: null,
    status: 'active',
  });
  store.memberships.set(t2MemId, {
    id: t2MemId,
    organizationId: org1Id,
    userId: t2UserId,
    role: 'teacher',
    orgUsername: null,
    status: 'active',
  });
  store.memberships.set(tUnassignedMemId, {
    id: tUnassignedMemId,
    organizationId: org1Id,
    userId: tUnassignedUserId,
    role: 'teacher',
    orgUsername: null,
    status: 'active',
  });
  store.memberships.set(tOrg2MemId, {
    id: tOrg2MemId,
    organizationId: org2Id,
    userId: tOrg2UserId,
    role: 'teacher',
    orgUsername: null,
    status: 'active',
  });
  store.memberships.set(s1MemId, {
    id: s1MemId,
    organizationId: org1Id,
    userId: s1UserId,
    role: 'student',
    orgUsername: 'an01',
    status: 'active',
  });
  store.memberships.set(s2MemId, {
    id: s2MemId,
    organizationId: org1Id,
    userId: s2UserId,
    role: 'student',
    orgUsername: 'binh02',
    status: 'active',
  });
  store.memberships.set(s3MemId, {
    id: s3MemId,
    organizationId: org1Id,
    userId: s3UserId,
    role: 'student',
    orgUsername: 'chi03',
    status: 'active',
  });
  store.memberships.set(sTransferredMemId, {
    id: sTransferredMemId,
    organizationId: org1Id,
    userId: sTransferredUserId,
    role: 'student',
    orgUsername: 'dung04',
    status: 'active',
  });
  store.memberships.set(sOrg2MemId, {
    id: sOrg2MemId,
    organizationId: org2Id,
    userId: sOrg2UserId,
    role: 'student',
    orgUsername: 'em_org2',
    status: 'active',
  });

  const class1Id = generateUuidV7();
  const class1ArchivedId = generateUuidV7();
  const class2Org2Id = generateUuidV7();
  store.classes.set(class1Id, {
    id: class1Id,
    organizationId: org1Id,
    name: 'Lớp 1A - Hòa Nhập',
    academicYear: '2026-2027',
    status: 'active',
  });
  store.classes.set(class1ArchivedId, {
    id: class1ArchivedId,
    organizationId: org1Id,
    name: 'Lớp Cũ Đã Lưu Trữ',
    academicYear: '2025-2026',
    status: 'archived',
  });
  store.classes.set(class2Org2Id, {
    id: class2Org2Id,
    organizationId: org2Id,
    name: 'Lớp 2B - Trường B',
    academicYear: '2026-2027',
    status: 'active',
  });

  store.classTeachers.push(
    { organizationId: org1Id, classId: class1Id, teacherMembershipId: t1MemId },
    { organizationId: org1Id, classId: class1Id, teacherMembershipId: t2MemId },
    {
      organizationId: org1Id,
      classId: class1ArchivedId,
      teacherMembershipId: t1MemId,
    },
    { organizationId: org2Id, classId: class2Org2Id, teacherMembershipId: tOrg2MemId }
  );

  store.classEnrollments.push(
    {
      organizationId: org1Id,
      classId: class1Id,
      studentMembershipId: s1MemId,
      status: 'active',
    },
    {
      organizationId: org1Id,
      classId: class1Id,
      studentMembershipId: s2MemId,
      status: 'active',
    },
    {
      organizationId: org1Id,
      classId: class1Id,
      studentMembershipId: s3MemId,
      status: 'active',
    },
    {
      organizationId: org1Id,
      classId: class1Id,
      studentMembershipId: sTransferredMemId,
      status: 'transferred_out',
    },
    {
      organizationId: org2Id,
      classId: class2Org2Id,
      studentMembershipId: sOrg2MemId,
      status: 'active',
    }
  );

  // Content library items & versions
  const emotionItemId = generateUuidV7();
  const emotionV1Id = generateUuidV7();
  const emotionV2DraftId = generateUuidV7();
  const commItemId = generateUuidV7();
  const commV1Id = generateUuidV7();
  const archivedItemId = generateUuidV7();
  const archivedV1Id = generateUuidV7();

  store.contentItems.set(emotionItemId, {
    id: emotionItemId,
    slug: 'cam-xuc-vui',
    contentType: 'emotion_card',
    currentPublishedVersionId: emotionV1Id,
    isArchived: false,
  });
  store.contentVersions.set(emotionV1Id, {
    id: emotionV1Id,
    contentItemId: emotionItemId,
    versionNumber: 1,
    status: 'published',
    title: 'Thẻ cảm xúc Vui v1',
    summary: 'Phiên bản đầu tiên đã xuất bản',
    locale: 'vi',
    payloadJson: {
      displayTitle: 'Vui vẻ cùng bạn',
      childText: 'Hôm nay mình mỉm cười thật nhẹ nhàng.',
      emotionKey: 'happy',
      emotionLabel: 'Vui vẻ',
      accessibleDescription: 'Hình vẽ bạn nhỏ cười hiền hòa.',
      readAloud: {
        text: 'Hôm nay mình mỉm cười thật nhẹ nhàng.',
        speechRateHint: 'slow',
      },
      aacSupport: {
        symbolLabel: 'Vui vẻ',
        coreVocabulary: ['con', 'vui'],
      },
    },
    metadataJson: { ageBand: '6-8', selThemes: ['self_awareness'] },
    publishedAt: now,
  });
  store.contentVersions.set(emotionV2DraftId, {
    id: emotionV2DraftId,
    contentItemId: emotionItemId,
    versionNumber: 2,
    status: 'draft',
    title: 'Thẻ cảm xúc Vui v2 (Nháp)',
    summary: 'Chưa xuất bản',
    locale: 'vi',
    payloadJson: {
      displayTitle: 'Vui vẻ v2 nháp',
      childText: 'Bản nháp mới chưa duyệt.',
      emotionKey: 'happy',
      emotionLabel: 'Vui vẻ',
      accessibleDescription: 'Bản nháp.',
    },
    metadataJson: null,
    publishedAt: null,
  });

  store.contentItems.set(commItemId, {
    id: commItemId,
    slug: 'giao-tiep-xin-cho-luot',
    contentType: 'communication_card',
    currentPublishedVersionId: commV1Id,
    isArchived: false,
  });
  store.contentVersions.set(commV1Id, {
    id: commV1Id,
    contentItemId: commItemId,
    versionNumber: 1,
    status: 'published',
    title: 'Thẻ giao tiếp Chờ đến lượt v1',
    summary: 'Hỗ trợ AAC xin chờ lượt chơi',
    locale: 'vi-VN',
    payloadJson: {
      displayTitle: 'Mình cùng chờ đến lượt',
      communicationIntent: 'turn_taking',
      phrase: 'Mình chờ một chút nhé.',
      accessibleDescription: 'Biểu tượng hai bàn tay luân phiên nhau.',
      aacSupport: {
        symbolRef: '/assets/aac/wait-turn.svg',
        symbolLabel: 'Chờ lượt',
        coreVocabulary: ['chờ', 'lượt'],
      },
    },
    metadataJson: { ageBand: '6-8' },
    publishedAt: now,
  });

  store.contentItems.set(archivedItemId, {
    id: archivedItemId,
    slug: 'noi-dung-da-luu-tru',
    contentType: 'action_card',
    currentPublishedVersionId: archivedV1Id,
    isArchived: true,
  });
  store.contentVersions.set(archivedV1Id, {
    id: archivedV1Id,
    contentItemId: archivedItemId,
    versionNumber: 1,
    status: 'published',
    title: 'Thẻ đã lưu trữ',
    summary: null,
    locale: 'vi',
    payloadJson: {
      displayTitle: 'Thẻ cũ',
      actionPhrase: 'Thở chậm.',
      accessibleDescription: 'Đã lưu trữ.',
    },
    metadataJson: null,
    publishedAt: now,
  });

  return {
    now,
    org1Id,
    org2Id,
    adminUserId,
    t1UserId,
    t2UserId,
    tUnassignedUserId,
    tOrg2UserId,
    s1UserId,
    s2UserId,
    s3UserId,
    sTransferredUserId,
    sOrg2UserId,
    t1MemId,
    t2MemId,
    tUnassignedMemId,
    tOrg2MemId,
    s1MemId,
    s2MemId,
    s3MemId,
    sTransferredMemId,
    sOrg2MemId,
    class1Id,
    class1ArchivedId,
    class2Org2Id,
    emotionItemId,
    emotionV1Id,
    emotionV2DraftId,
    commItemId,
    commV1Id,
    archivedItemId,
    archivedV1Id,
  };
}

function issueSession(
  store: InMemoryP205Store,
  config: ServerConfig,
  params: {
    userId: string;
    sessionScope: 'platform_admin' | 'teacher' | 'student';
    activeOrganizationId: string | null;
  }
) {
  const rawToken = generateSessionToken();
  const tokenHash = hashSessionToken(rawToken);
  const sessionId = generateUuidV7();
  const now = new Date();
  store.sessions.set(tokenHash, {
    id: sessionId,
    tokenHash,
    userId: params.userId,
    sessionScope: params.sessionScope,
    activeOrganizationId: params.activeOrganizationId,
    idleExpiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    absoluteExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    lastActivityAt: now,
    revokedAt: null,
    revokedReason: null,
  });

  return {
    cookie: `${config.cookie.name}=${rawToken}`,
    csrfToken: deriveSessionCsrfToken(
      rawToken,
      sessionId,
      config.auth.csrfSecret
    ),
  };
}

async function startTestApp(store: InMemoryP205Store, config: ServerConfig) {
  const repo = makeFakeAssignmentRepo(store);
  const authRepo = makeFakeAuthRepo(store);
  const assignmentService = createAssignmentService({
    repo,
    auditFn: async (evt) => {
      assert.ok(
        (AUDIT_EVENT_TYPES as readonly string[]).includes(evt.eventType),
        `Unexpected audit event type: ${evt.eventType}`
      );
      store.audits.push(evt);
    },
  });
  const authMiddlewares = createAuthMiddlewareSuite({
    repo: authRepo,
    getConfig: () => config,
  });
  const authenticatedCsrf = createAuthenticatedCsrfMiddleware({
    config,
  });

  const { teacherAssignmentsRouter, studentAssignmentsRouter } =
    createAssignmentsRouters({
      assignmentService,
      authMiddlewares,
      authenticatedCsrf,
    });

  const app = express();
  app.use('/api', express.json());
  app.use('/api/v1/assignments', teacherAssignmentsRouter);
  app.use('/api/v1/student/assignments', studentAssignmentsRouter);
  app.use('/api', apiNotFoundHandler);
  app.use('/api', apiErrorHandler);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;
  if (!config.auth.trustedOrigins.includes(baseUrl)) {
    config.auth.trustedOrigins.push(baseUrl);
  }
  return {
    baseUrl,
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      );
    },
  };
}

async function requestJson(
  url: string,
  options?: {
    method?: string;
    cookie?: string;
    csrf?: string;
    origin?: string;
    body?: unknown;
  }
) {
  const headers: Record<string, string> = {};
  if (options?.cookie) {
    headers.cookie = options.cookie;
  }
  if (options?.csrf) {
    headers[CSRF_TOKEN_HEADER] = options.csrf;
    headers[CUSTOM_REQUEST_HEADER] = '1';
  }
  if (options?.origin) {
    headers.origin = options.origin;
  }
  if (options?.body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  const res = await fetch(url, {
    method: options?.method ?? 'GET',
    headers,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, headers: res.headers, data };
}

test('P2-05 service: assignment creation, published-version pinning across v2 republication, and target validation', async () => {
  const store = createEmptyP205Store();
  const fx = seedFixture(store);
  const repo = makeFakeAssignmentRepo(store);
  const service = createAssignmentService({
    repo,
    now: () => new Date('2026-11-17T09:00:00.000Z'),
    auditFn: async (evt) => {
      store.audits.push(evt);
    },
  });

  const t1Actor = {
    actorUserId: fx.t1UserId,
    organizationId: fx.org1Id,
    teacherMembershipId: fx.t1MemId,
    ipPrefix: '127.0.0',
  };

  // Reject unpublished draft version
  await assert.rejects(
    () =>
      service.createAssignment(
        {
          classId: fx.class1Id,
          title: 'Bài tập nháp không hợp lệ',
          items: [{ contentVersionId: fx.emotionV2DraftId, sortOrder: 0 }],
          targetStudentMembershipIds: [fx.s1MemId],
        },
        t1Actor
      ),
    (err: unknown) =>
      err instanceof AppError &&
      err.httpStatus === 409 &&
      err.code === 'CONTENT_VERSION_NOT_PUBLISHED'
  );

  // Reject archived content item even if version row says published
  await assert.rejects(
    () =>
      service.createAssignment(
        {
          classId: fx.class1Id,
          title: 'Bài tập dùng nội dung đã lưu trữ',
          items: [{ contentVersionId: fx.archivedV1Id, sortOrder: 0 }],
          targetStudentMembershipIds: [fx.s1MemId],
        },
        t1Actor
      ),
    (err: unknown) =>
      err instanceof AppError &&
      err.httpStatus === 409 &&
      err.code === 'CONTENT_VERSION_NOT_PUBLISHED'
  );

  // Reject unsafe text in title / homePracticeInstructions
  await assert.rejects(
    () =>
      service.createAssignment(
        {
          classId: fx.class1Id,
          title: 'Bài tập bình thường',
          homePracticeInstructions: 'Nếu sai sẽ bị xếp hạng leaderboard.',
          items: [{ contentVersionId: fx.emotionV1Id, sortOrder: 0 }],
          targetStudentMembershipIds: [fx.s1MemId],
        },
        t1Actor
      ),
    (err: unknown) => err instanceof AppError && err.httpStatus === 422
  );

  // Reject duplicate targets & duplicate content versions / sort orders
  await assert.rejects(
    () =>
      service.createAssignment(
        {
          classId: fx.class1Id,
          title: 'Bài tập trùng học sinh',
          items: [{ contentVersionId: fx.emotionV1Id, sortOrder: 0 }],
          targetStudentMembershipIds: [fx.s1MemId, fx.s1MemId],
        },
        t1Actor
      ),
    (err: unknown) => err instanceof AppError && err.httpStatus === 422
  );

  await assert.rejects(
    () =>
      service.createAssignment(
        {
          classId: fx.class1Id,
          title: 'Bài tập trùng thứ tự',
          items: [
            { contentVersionId: fx.emotionV1Id, sortOrder: 1 },
            { contentVersionId: fx.commV1Id, sortOrder: 1 },
          ],
          targetStudentMembershipIds: [fx.s1MemId],
        },
        t1Actor
      ),
    (err: unknown) => err instanceof AppError && err.httpStatus === 422
  );

  // Reject transferred-out student & cross-org student
  await assert.rejects(
    () =>
      service.createAssignment(
        {
          classId: fx.class1Id,
          title: 'Bài tập học sinh đã chuyển lớp',
          items: [{ contentVersionId: fx.emotionV1Id, sortOrder: 0 }],
          targetStudentMembershipIds: [fx.sTransferredMemId],
        },
        t1Actor
      ),
    (err: unknown) =>
      err instanceof AppError &&
      err.httpStatus === 409 &&
      err.code === 'TARGET_STUDENT_INELIGIBLE'
  );

  await assert.rejects(
    () =>
      service.createAssignment(
        {
          classId: fx.class1Id,
          title: 'Bài tập chéo tổ chức',
          items: [{ contentVersionId: fx.emotionV1Id, sortOrder: 0 }],
          targetStudentMembershipIds: [fx.sOrg2MemId],
        },
        t1Actor
      ),
    (err: unknown) =>
      err instanceof AppError &&
      err.httpStatus === 409 &&
      err.code === 'TARGET_STUDENT_INELIGIBLE'
  );

  // Valid assignment creation with 2 ordered items + home practice + dueAt
  const created = await service.createAssignment(
    {
      classId: fx.class1Id,
      title: 'Thực hành gọi tên cảm xúc tuần 1',
      homePracticeInstructions:
        'Ba mẹ cùng con đọc chậm từng thẻ 5 phút trước khi đi ngủ, không ép trả lời.',
      dueAt: '2026-11-30T10:00:00.000Z',
      items: [
        { contentVersionId: fx.commV1Id, sortOrder: 2 },
        {
          contentVersionId: fx.emotionV1Id,
          sortOrder: 1,
          expectedContentItemId: fx.emotionItemId,
        },
      ],
      targetStudentMembershipIds: [fx.s1MemId, fx.s2MemId],
    },
    t1Actor
  );

  assert.equal(created.assignment.canEdit, true);
  assert.equal(created.assignment.status, 'active');
  assert.equal(created.assignment.homePractice.hasInstructions, true);
  assert.equal(created.items.length, 2);
  assert.equal(created.items[0].contentVersionId, fx.emotionV1Id);
  assert.equal(created.items[0].sortOrder, 1);
  assert.equal(created.items[1].contentVersionId, fx.commV1Id);
  assert.equal(created.items[1].sortOrder, 2);
  assert.equal(created.targets.length, 2);

  // Ensure audit does NOT store full homePracticeInstructions text
  const createdAudit = store.audits.find((a) => a.eventType === 'assignment.created');
  assert.ok(createdAudit);
  assert.equal(createdAudit.metadata?.hasHomePractice, true);
  assert.equal(
    JSON.stringify(createdAudit.metadata).includes('trước khi đi ngủ'),
    false
  );

  // Ensure P2-05 did NOT insert activity_attempts or assignment_progress
  assert.equal(store.activityAttempts.length, 0);
  assert.equal(store.assignmentProgress.length, 0);

  // Now simulate Content Library publishing v2 and superseding v1
  const v1 = store.contentVersions.get(fx.emotionV1Id)!;
  v1.status = 'superseded';
  const v2 = store.contentVersions.get(fx.emotionV2DraftId)!;
  v2.status = 'published';
  v2.publishedAt = new Date('2026-11-17T10:00:00.000Z');
  store.contentItems.get(fx.emotionItemId)!.currentPublishedVersionId = v2.id;

  // Student 1 STILL sees exact pinned v1 content (NOT v2!)
  const studentDetail = await service.getStudentAssignmentDetail(
    created.assignment.id,
    {
      actorUserId: fx.s1UserId,
      organizationId: fx.org1Id,
      studentMembershipId: fx.s1MemId,
      ipPrefix: '127.0.0',
    }
  );
  assert.equal(studentDetail.items[0].contentVersionId, fx.emotionV1Id);
  assert.equal(studentDetail.items[0].versionNumber, 1);
  assert.equal(studentDetail.items[0].title, 'Thẻ cảm xúc Vui v1');
  assert.ok(studentDetail.items[0].payloadJson.readAloud);
  assert.ok(studentDetail.items[0].payloadJson.aacSupport);
  assert.equal(studentDetail.homePractice.instructions, created.assignment.homePracticeInstructions);
  assert.deepEqual(studentDetail.homePractice.printableGuide.activityTitles, [
    'Thẻ cảm xúc Vui v1',
    'Thẻ giao tiếp Chờ đến lượt v1',
  ]);
  // Verify NO peer targets or internal approval/creator fields leaked
  const serializedStudent = JSON.stringify(studentDetail);
  assert.equal(serializedStudent.includes(fx.s2MemId), false);
  assert.equal(serializedStudent.includes('Bé Bình'), false);
  assert.equal(serializedStudent.includes('approvals'), false);
  assert.equal(serializedStudent.includes('decisionNote'), false);
  assert.equal(serializedStudent.includes('createdByTeacherMembershipId'), false);
});

test('P2-05 HTTP routes: RBAC, creator-only vs co-teacher read, target activity guard, overdue/closed behavior, CSRF & 405', async () => {
  const store = createEmptyP205Store();
  const fx = seedFixture(store);
  const config = makeTestConfig();

  // Pre-seed past-due & draft assignments directly into store for edge checks cleanly
  const pastDueAssignmentId = generateUuidV7();
  const draftAssignmentId = generateUuidV7();
  const createdAt = new Date('2026-11-10T08:00:00.000Z');
  store.assignments.set(draftAssignmentId, {
    id: draftAssignmentId,
    organizationId: fx.org1Id,
    classId: fx.class1Id,
    createdByTeacherMembershipId: fx.t1MemId,
    title: 'Bài nháp chưa giao',
    homePracticeInstructions: null,
    dueAt: null,
    status: 'draft',
    createdAt,
    updatedAt: createdAt,
  });
  store.assignmentItems.push({
    id: generateUuidV7(),
    organizationId: fx.org1Id,
    assignmentId: draftAssignmentId,
    contentVersionId: fx.emotionV1Id,
    sortOrder: 0,
    createdAt,
  });
  store.assignmentTargets.push({
    id: generateUuidV7(),
    organizationId: fx.org1Id,
    assignmentId: draftAssignmentId,
    studentMembershipId: fx.s1MemId,
    assignedAt: createdAt,
  });

  store.assignments.set(pastDueAssignmentId, {
    id: pastDueAssignmentId,
    organizationId: fx.org1Id,
    classId: fx.class1Id,
    createdByTeacherMembershipId: fx.t1MemId,
    title: 'Bài quá hạn vẫn mở cho con',
    homePracticeInstructions: 'Thực hành nhẹ nhàng khi có thời gian.',
    dueAt: new Date('2020-01-01T00:00:00.000Z'),
    status: 'active',
    createdAt,
    updatedAt: createdAt,
  });
  store.assignmentItems.push({
    id: generateUuidV7(),
    organizationId: fx.org1Id,
    assignmentId: pastDueAssignmentId,
    contentVersionId: fx.commV1Id,
    sortOrder: 0,
    createdAt,
  });
  store.assignmentTargets.push({
    id: generateUuidV7(),
    organizationId: fx.org1Id,
    assignmentId: pastDueAssignmentId,
    studentMembershipId: fx.s1MemId,
    assignedAt: createdAt,
  });

  const adminSess = issueSession(store, config, {
    userId: fx.adminUserId,
    sessionScope: 'platform_admin',
    activeOrganizationId: null,
  });
  const t1Sess = issueSession(store, config, {
    userId: fx.t1UserId,
    sessionScope: 'teacher',
    activeOrganizationId: fx.org1Id,
  });
  const t2Sess = issueSession(store, config, {
    userId: fx.t2UserId,
    sessionScope: 'teacher',
    activeOrganizationId: fx.org1Id,
  });
  const tUnassignedSess = issueSession(store, config, {
    userId: fx.tUnassignedUserId,
    sessionScope: 'teacher',
    activeOrganizationId: fx.org1Id,
  });
  const tOrg2Sess = issueSession(store, config, {
    userId: fx.tOrg2UserId,
    sessionScope: 'teacher',
    activeOrganizationId: fx.org2Id,
  });
  const s1Sess = issueSession(store, config, {
    userId: fx.s1UserId,
    sessionScope: 'student',
    activeOrganizationId: fx.org1Id,
  });
  const s2Sess = issueSession(store, config, {
    userId: fx.s2UserId,
    sessionScope: 'student',
    activeOrganizationId: fx.org1Id,
  });
  const sOrg2Sess = issueSession(store, config, {
    userId: fx.sOrg2UserId,
    sessionScope: 'student',
    activeOrganizationId: fx.org2Id,
  });

  const server = await startTestApp(store, config);
  try {
    // 1. Unauthenticated & Role checks & 405
    const unauthTeacher = await requestJson(`${server.baseUrl}/api/v1/assignments`);
    assert.equal(unauthTeacher.status, 401);

    const unauthStudent = await requestJson(
      `${server.baseUrl}/api/v1/student/assignments`
    );
    assert.equal(unauthStudent.status, 401);

    const adminDenied = await requestJson(`${server.baseUrl}/api/v1/assignments`, {
      cookie: adminSess.cookie,
    });
    assert.equal(adminDenied.status, 403);

    const studentOnTeacherDenied = await requestJson(
      `${server.baseUrl}/api/v1/assignments`,
      { cookie: s1Sess.cookie }
    );
    assert.equal(studentOnTeacherDenied.status, 403);

    const teacherOnStudentDenied = await requestJson(
      `${server.baseUrl}/api/v1/student/assignments`,
      { cookie: t1Sess.cookie }
    );
    assert.equal(teacherOnStudentDenied.status, 403);

    // 405 Method Not Allowed + Allow header
    const putCollection = await requestJson(`${server.baseUrl}/api/v1/assignments`, {
      method: 'PUT',
      cookie: t1Sess.cookie,
      csrf: t1Sess.csrfToken,
      origin: server.baseUrl,
    });
    assert.equal(putCollection.status, 405);
    assert.equal(putCollection.headers.get('allow'), 'GET, POST');

    const postStudent = await requestJson(
      `${server.baseUrl}/api/v1/student/assignments`,
      {
        method: 'POST',
        cookie: s1Sess.cookie,
        csrf: s1Sess.csrfToken,
        origin: server.baseUrl,
      }
    );
    assert.equal(postStudent.status, 405);
    assert.equal(postStudent.headers.get('allow'), 'GET');

    // Missing CSRF -> 403
    const noCsrfCreate = await requestJson(`${server.baseUrl}/api/v1/assignments`, {
      method: 'POST',
      cookie: t1Sess.cookie,
      origin: server.baseUrl,
      body: {
        classId: fx.class1Id,
        title: 'No CSRF',
        items: [{ contentVersionId: fx.emotionV1Id, sortOrder: 0 }],
        targetStudentMembershipIds: [fx.s1MemId],
      },
    });
    assert.equal(noCsrfCreate.status, 403);

    // 2. Teacher 1 creates assignment targeting Student 1 only
    const createRes = await requestJson(`${server.baseUrl}/api/v1/assignments`, {
      method: 'POST',
      cookie: t1Sess.cookie,
      csrf: t1Sess.csrfToken,
      origin: server.baseUrl,
      body: {
        classId: fx.class1Id,
        title: 'Bài tập HTTP P2-05',
        homePracticeInstructions: 'Cùng con trò chuyện 5 phút.',
        items: [{ contentVersionId: fx.emotionV1Id, sortOrder: 0 }],
        targetStudentMembershipIds: [fx.s1MemId],
      },
    });
    assert.equal(createRes.status, 201);
    const createdId = (createRes.data.assignment as { id: string }).id;

    // 3. Co-teacher (t2) CAN read list, detail (`canEdit: false`), and progress (`200`)
    const coTeacherList = await requestJson(
      `${server.baseUrl}/api/v1/assignments?classId=${fx.class1Id}`,
      { cookie: t2Sess.cookie }
    );
    assert.equal(coTeacherList.status, 200);
    assert.equal((coTeacherList.data.items as unknown[]).length, 3);

    const coTeacherDetail = await requestJson(
      `${server.baseUrl}/api/v1/assignments/${createdId}`,
      { cookie: t2Sess.cookie }
    );
    assert.equal(coTeacherDetail.status, 200);
    assert.equal((coTeacherDetail.data.assignment as { canEdit: boolean }).canEdit, false);

    const coTeacherProgress = await requestJson(
      `${server.baseUrl}/api/v1/assignments/${createdId}/progress`,
      { cookie: t2Sess.cookie }
    );
    assert.equal(coTeacherProgress.status, 200);
    assert.equal(coTeacherProgress.data.totalItems, 1);
    assert.equal((coTeacherProgress.data.targets as Array<{ status: string }>)[0].status, 'not_started');

    // Co-teacher CANNOT mutate, update targets, or close (403 + security audit persisted!)
    const coTeacherPatch = await requestJson(
      `${server.baseUrl}/api/v1/assignments/${createdId}`,
      {
        method: 'PATCH',
        cookie: t2Sess.cookie,
        csrf: t2Sess.csrfToken,
        origin: server.baseUrl,
        body: { title: 'Co-teacher edit attempt' },
      }
    );
    assert.equal(coTeacherPatch.status, 403);

    const coTeacherTargets = await requestJson(
      `${server.baseUrl}/api/v1/assignments/${createdId}/targets`,
      {
        method: 'PUT',
        cookie: t2Sess.cookie,
        csrf: t2Sess.csrfToken,
        origin: server.baseUrl,
        body: { targetStudentMembershipIds: [fx.s1MemId, fx.s2MemId] },
      }
    );
    assert.equal(coTeacherTargets.status, 403);

    const coTeacherClose = await requestJson(
      `${server.baseUrl}/api/v1/assignments/${createdId}/close`,
      {
        method: 'POST',
        cookie: t2Sess.cookie,
        csrf: t2Sess.csrfToken,
        origin: server.baseUrl,
      }
    );
    assert.equal(coTeacherClose.status, 403);
    assert.ok(
      store.audits.some(
        (a) =>
          a.eventType === 'security.unauthorized_access_denied' &&
          a.metadata?.action === 'update_assignment_non_creator_blocked'
      )
    );

    // 4. Unassigned teacher in same org -> 403 on create, list(?classId), detail, progress
    const unassignedCreate = await requestJson(`${server.baseUrl}/api/v1/assignments`, {
      method: 'POST',
      cookie: tUnassignedSess.cookie,
      csrf: tUnassignedSess.csrfToken,
      origin: server.baseUrl,
      body: {
        classId: fx.class1Id,
        title: 'Unauthorized class assignment',
        items: [{ contentVersionId: fx.emotionV1Id, sortOrder: 0 }],
        targetStudentMembershipIds: [fx.s1MemId],
      },
    });
    assert.equal(unassignedCreate.status, 403);

    const unassignedDetail = await requestJson(
      `${server.baseUrl}/api/v1/assignments/${createdId}`,
      { cookie: tUnassignedSess.cookie }
    );
    assert.equal(unassignedDetail.status, 403);

    // 5. Cross-tenant Teacher in Org 2 CANNOT create on Org 1 class or read Org 1 assignment
    const org2CreateOnOrg1 = await requestJson(`${server.baseUrl}/api/v1/assignments`, {
      method: 'POST',
      cookie: tOrg2Sess.cookie,
      csrf: tOrg2Sess.csrfToken,
      origin: server.baseUrl,
      body: {
        classId: fx.class1Id,
        title: 'Cross org attempt',
        items: [{ contentVersionId: fx.emotionV1Id, sortOrder: 0 }],
        targetStudentMembershipIds: [fx.s1MemId],
      },
    });
    assert.equal(org2CreateOnOrg1.status, 403);
    assert.ok(
      store.audits.some((a) => a.eventType === 'security.cross_tenant_attempt_blocked')
    );

    const org2ReadOrg1 = await requestJson(
      `${server.baseUrl}/api/v1/assignments/${createdId}`,
      { cookie: tOrg2Sess.cookie }
    );
    assert.equal(org2ReadOrg1.status, 404);

    // 6. Creator updates assignment & updates targets cleanly
    const patchRes = await requestJson(
      `${server.baseUrl}/api/v1/assignments/${createdId}`,
      {
        method: 'PATCH',
        cookie: t1Sess.cookie,
        csrf: t1Sess.csrfToken,
        origin: server.baseUrl,
        body: {
          title: 'Bài tập HTTP P2-05 (Đã cập nhật)',
          homePracticeInstructions: 'Nhắc con hít thở nhẹ trước khi bắt đầu.',
        },
      }
    );
    assert.equal(patchRes.status, 200);
    assert.equal(
      (patchRes.data.assignment as { title: string }).title,
      'Bài tập HTTP P2-05 (Đã cập nhật)'
    );

    const addTargetRes = await requestJson(
      `${server.baseUrl}/api/v1/assignments/${createdId}/targets`,
      {
        method: 'PUT',
        cookie: t1Sess.cookie,
        csrf: t1Sess.csrfToken,
        origin: server.baseUrl,
        body: { targetStudentMembershipIds: [fx.s1MemId, fx.s2MemId] },
      }
    );
    assert.equal(addTargetRes.status, 200);
    assert.equal((addTargetRes.data.targets as unknown[]).length, 2);

    // Seed synthetic activity on s1's target, then verify removing s1 is blocked with 409 TARGET_HAS_ACTIVITY
    const s1Target = store.assignmentTargets.find(
      (t) => t.assignmentId === createdId && t.studentMembershipId === fx.s1MemId
    )!;
    store.activityAttempts.push({
      id: generateUuidV7(),
      organizationId: fx.org1Id,
      assignmentId: createdId,
      assignmentTargetId: s1Target.id,
    });

    const removeActiveTarget = await requestJson(
      `${server.baseUrl}/api/v1/assignments/${createdId}/targets`,
      {
        method: 'PUT',
        cookie: t1Sess.cookie,
        csrf: t1Sess.csrfToken,
        origin: server.baseUrl,
        body: { targetStudentMembershipIds: [fx.s2MemId] },
      }
    );
    assert.equal(removeActiveTarget.status, 409);
    assert.equal(removeActiveTarget.data.code, 'TARGET_HAS_ACTIVITY');

    // Removing s2 (no activity) succeeds!
    const removeIdleTarget = await requestJson(
      `${server.baseUrl}/api/v1/assignments/${createdId}/targets`,
      {
        method: 'PUT',
        cookie: t1Sess.cookie,
        csrf: t1Sess.csrfToken,
        origin: server.baseUrl,
        body: { targetStudentMembershipIds: [fx.s1MemId] },
      }
    );
    assert.equal(removeIdleTarget.status, 200);
    assert.equal((removeIdleTarget.data.targets as unknown[]).length, 1);

    // 7. Student access: Student 1 sees created & past-due assignments, NOT draft!
    const s1List = await requestJson(`${server.baseUrl}/api/v1/student/assignments`, {
      cookie: s1Sess.cookie,
    });
    assert.equal(s1List.status, 200);
    const s1Items = s1List.data.items as Array<{
      id: string;
      isPastDue: boolean;
      status: string;
      isReadOnly: boolean;
    }>;
    assert.equal(s1Items.length, 2);
    assert.equal(s1Items.some((x) => x.id === draftAssignmentId), false);
    const pastDueItem = s1Items.find((x) => x.id === pastDueAssignmentId)!;
    assert.equal(pastDueItem.isPastDue, true);

    // Past-due assignment detail STILL accessible without block or penalty
    const s1PastDueDetail = await requestJson(
      `${server.baseUrl}/api/v1/student/assignments/${pastDueAssignmentId}`,
      { cookie: s1Sess.cookie }
    );
    assert.equal(s1PastDueDetail.status, 200);

    // Draft assignment detail blocked for targeted student (404)
    const s1DraftDetail = await requestJson(
      `${server.baseUrl}/api/v1/student/assignments/${draftAssignmentId}`,
      { cookie: s1Sess.cookie }
    );
    assert.equal(s1DraftDetail.status, 404);

    // Untargeted student s2 & cross-org student sOrg2 CANNOT see s1's assignments (404 & empty list)
    const s2DetailDenied = await requestJson(
      `${server.baseUrl}/api/v1/student/assignments/${createdId}`,
      { cookie: s2Sess.cookie }
    );
    assert.equal(s2DetailDenied.status, 404);

    const sOrg2List = await requestJson(
      `${server.baseUrl}/api/v1/student/assignments`,
      { cookie: sOrg2Sess.cookie }
    );
    assert.equal(sOrg2List.status, 200);
    assert.equal((sOrg2List.data.items as unknown[]).length, 0);

    // 8. Creator closes assignment -> mutations rejected (409), Student still reads as closed read-only
    const closeRes = await requestJson(
      `${server.baseUrl}/api/v1/assignments/${createdId}/close`,
      {
        method: 'POST',
        cookie: t1Sess.cookie,
        csrf: t1Sess.csrfToken,
        origin: server.baseUrl,
      }
    );
    assert.equal(closeRes.status, 200);
    assert.equal((closeRes.data.assignment as { status: string }).status, 'closed');

    const editAfterClose = await requestJson(
      `${server.baseUrl}/api/v1/assignments/${createdId}`,
      {
        method: 'PATCH',
        cookie: t1Sess.cookie,
        csrf: t1Sess.csrfToken,
        origin: server.baseUrl,
        body: { title: 'Edit closed' },
      }
    );
    assert.equal(editAfterClose.status, 409);
    assert.equal(editAfterClose.data.code, 'ASSIGNMENT_CLOSED');

    const doubleClose = await requestJson(
      `${server.baseUrl}/api/v1/assignments/${createdId}/close`,
      {
        method: 'POST',
        cookie: t1Sess.cookie,
        csrf: t1Sess.csrfToken,
        origin: server.baseUrl,
      }
    );
    assert.equal(doubleClose.status, 409);

    // Targeted Student still sees closed assignment in read-only mode
    const s1ClosedDetail = await requestJson(
      `${server.baseUrl}/api/v1/student/assignments/${createdId}`,
      { cookie: s1Sess.cookie }
    );
    assert.equal(s1ClosedDetail.status, 200);
    const closedDto = s1ClosedDetail.data.assignment as {
      status: string;
      isReadOnly: boolean;
    };
    assert.equal(closedDto.status, 'closed');
    assert.equal(closedDto.isReadOnly, true);

    const s1ClosedFilter = await requestJson(
      `${server.baseUrl}/api/v1/student/assignments?status=closed`,
      { cookie: s1Sess.cookie }
    );
    assert.equal(s1ClosedFilter.status, 200);
    assert.equal((s1ClosedFilter.data.items as unknown[]).length, 1);
  } finally {
    await server.close();
  }
});
