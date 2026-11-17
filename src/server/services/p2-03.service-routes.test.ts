import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import test from 'node:test';
import { parseServerConfig, type ServerConfig } from '../config/env.ts';
import { generateUuidV7 } from '../db/uuid.ts';
import { apiErrorHandler, apiNotFoundHandler } from '../http/middleware.ts';
import { createAuthMiddlewareSuite } from '../middleware/auth.ts';
import type {
  AuthRepository,
  SessionWithContextRecord,
} from '../repositories/auth.repository.ts';
import type {
  ClassRecord,
  ClassRepository,
} from '../repositories/class.repository.ts';
import type {
  CsvImportJobRecord,
  CsvImportRepository,
} from '../repositories/csv-import.repository.ts';
import type {
  MembershipRepository,
  OrganizationMembershipRecord,
  SafeUserRecord,
} from '../repositories/membership.repository.ts';
import type {
  OrganizationRecord,
  OrgRepository,
} from '../repositories/org.repository.ts';
import { createAdminUsersRouter } from '../routes/admin-users.routes.ts';
import { createClassesRouters } from '../routes/classes.routes.ts';
import { createAdminOrganizationsRouter } from '../routes/organizations.routes.ts';
import {
  CSRF_TOKEN_HEADER,
  CUSTOM_REQUEST_HEADER,
  createAuthenticatedCsrfMiddleware,
  deriveSessionCsrfToken,
} from '../security/csrf.ts';
import { verifyPassword } from '../security/password-hash.ts';
import { ScryptConcurrencyLimiter } from '../security/scrypt-limiter.ts';
import { generateSessionToken, hashSessionToken } from '../security/session.ts';
import { recordAuditEvent } from './audit.service.ts';
type AuditEventInput = Parameters<typeof recordAuditEvent>[0];
import { createClassService } from './class.service.ts';
import { createCsvImportService, parseCsvDocument } from './csv-import.service.ts';
import { createMembershipService } from './membership.service.ts';
import { createOrgService } from './org.service.ts';

interface InMemoryP203Store {
  organizations: Map<string, OrganizationRecord>;
  users: Map<string, SafeUserRecord & { passwordHash: string }>;
  memberships: Map<string, OrganizationMembershipRecord>;
  classes: Map<string, ClassRecord>;
  classTeachers: Array<{
    id: string;
    organizationId: string;
    classId: string;
    teacherMembershipId: string;
    assignedByUserId: string;
    createdAt: Date;
  }>;
  classEnrollments: Array<{
    id: string;
    organizationId: string;
    classId: string;
    studentMembershipId: string;
    status: string;
    enrolledAt: Date;
    endedAt: Date | null;
    updatedByUserId: string | null;
  }>;
  csvImportJobs: Map<string, CsvImportJobRecord>;
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
  audits: AuditEventInput[];
}

function createEmptyStore(): InMemoryP203Store {
  return {
    organizations: new Map(),
    users: new Map(),
    memberships: new Map(),
    classes: new Map(),
    classTeachers: [],
    classEnrollments: [],
    csvImportJobs: new Map(),
    sessions: new Map(),
    audits: [],
  };
}

function makeFakeRepos(store: InMemoryP203Store) {
  const orgRepo: OrgRepository = {
    async withTransaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      return fn({} as never);
    },
    async listOrganizations(params) {
      let items = Array.from(store.organizations.values());
      if (params.status) {
        items = items.filter((o) => o.status === params.status);
      }
      if (params.search && params.search.trim().length > 0) {
        const needle = params.search.trim().toLowerCase();
        items = items.filter(
          (o) =>
            o.code.toLowerCase().includes(needle) ||
            o.name.toLowerCase().includes(needle)
        );
      }
      const total = items.length;
      const offset = (params.page - 1) * params.limit;
      return {
        items: items.slice(offset, offset + params.limit).map((o) => ({ ...o })),
        total,
      };
    },
    async findOrganizationById(id) {
      const o = store.organizations.get(id);
      return o ? { ...o } : null;
    },
    async findOrganizationByCode(code) {
      for (const o of store.organizations.values()) {
        if (o.code === code) return { ...o };
      }
      return null;
    },
    async createOrganization(params) {
      const rec: OrganizationRecord = {
        id: params.id,
        code: params.code,
        name: params.name,
        status: params.status,
        createdAt: params.now,
        updatedAt: params.now,
      };
      store.organizations.set(rec.id, rec);
      return { ...rec };
    },
    async updateOrganization(params) {
      const existing = store.organizations.get(params.id);
      if (!existing) return null;
      const updated: OrganizationRecord = {
        ...existing,
        code: params.code ?? existing.code,
        name: params.name ?? existing.name,
        status: params.status ?? existing.status,
        updatedAt: params.now,
      };
      store.organizations.set(updated.id, updated);
      return { ...updated };
    },
  };

  const membershipRepo: MembershipRepository = {
    async withTransaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      return fn({} as never);
    },
    async listUsers(params) {
      let items = Array.from(store.users.values());
      if (params.status) items = items.filter((u) => u.status === params.status);
      if (params.platformRole) {
        items = items.filter((u) => u.platformRole === params.platformRole);
      }
      if (params.search && params.search.trim().length > 0) {
        const needle = params.search.trim().toLowerCase();
        items = items.filter(
          (u) =>
            u.displayName.toLowerCase().includes(needle) ||
            (u.email?.toLowerCase().includes(needle) ?? false) ||
            (u.platformUsername?.toLowerCase().includes(needle) ?? false)
        );
      }
      const total = items.length;
      const offset = (params.page - 1) * params.limit;
      return {
        items: items.slice(offset, offset + params.limit).map(({ passwordHash: _p, ...safe }) => ({
          ...safe,
        })),
        total,
      };
    },
    async findUserById(userId) {
      const u = store.users.get(userId);
      if (!u) return null;
      const { passwordHash: _p, ...safe } = u;
      return { ...safe };
    },
    async findUserByEmail(email) {
      for (const u of store.users.values()) {
        if (u.email?.toLowerCase() === email.toLowerCase()) {
          const { passwordHash: _p, ...safe } = u;
          return { ...safe };
        }
      }
      return null;
    },
    async findUserByPlatformUsername(username) {
      for (const u of store.users.values()) {
        if (u.platformUsername === username) {
          const { passwordHash: _p, ...safe } = u;
          return { ...safe };
        }
      }
      return null;
    },
    async createUser(params) {
      const rec = {
        id: params.id,
        email: params.email,
        platformUsername: params.platformUsername,
        platformRole: params.platformRole,
        displayName: params.displayName,
        passwordHash: params.passwordHash,
        status: params.status,
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: null,
        createdAt: params.now,
        updatedAt: params.now,
      };
      store.users.set(rec.id, rec);
      const { passwordHash: _p, ...safe } = rec;
      return { ...safe };
    },
    async updateUser(params) {
      const existing = store.users.get(params.id);
      if (!existing) return null;
      const updated = {
        ...existing,
        displayName: params.displayName ?? existing.displayName,
        email: params.email !== undefined ? params.email : existing.email,
        status: params.status ?? existing.status,
        failedLoginAttempts: params.resetLockout ? 0 : existing.failedLoginAttempts,
        lockedUntil: params.resetLockout ? null : existing.lockedUntil,
        updatedAt: params.now,
      };
      store.users.set(updated.id, updated);
      const { passwordHash: _p, ...safe } = updated;
      return { ...safe };
    },
    async listOrganizationMemberships(params) {
      let rows = Array.from(store.memberships.values()).filter(
        (m) => m.organizationId === params.organizationId
      );
      if (params.role) rows = rows.filter((m) => m.role === params.role);
      if (params.status) rows = rows.filter((m) => m.status === params.status);
      const joined = rows
        .map((m) => {
          const u = store.users.get(m.userId)!;
          return {
            membership: { ...m },
            user: {
              id: u.id,
              email: u.email,
              platformUsername: u.platformUsername,
              displayName: u.displayName,
              status: u.status,
            },
          };
        })
        .filter((row) => {
          if (!params.search || params.search.trim().length === 0) return true;
          const needle = params.search.trim().toLowerCase();
          return (
            (row.membership.orgUsername?.toLowerCase().includes(needle) ?? false) ||
            row.user.displayName.toLowerCase().includes(needle) ||
            (row.user.email?.toLowerCase().includes(needle) ?? false)
          );
        });
      const total = joined.length;
      const offset = (params.page - 1) * params.limit;
      return { items: joined.slice(offset, offset + params.limit), total };
    },
    async findMembershipById(organizationId, membershipId) {
      const m = store.memberships.get(membershipId);
      if (!m || m.organizationId !== organizationId) return null;
      const u = store.users.get(m.userId)!;
      return {
        membership: { ...m },
        user: {
          id: u.id,
          email: u.email,
          platformUsername: u.platformUsername,
          displayName: u.displayName,
          status: u.status,
        },
      };
    },
    async findMembershipByOrgAndUser(organizationId, userId) {
      for (const m of store.memberships.values()) {
        if (m.organizationId === organizationId && m.userId === userId) return { ...m };
      }
      return null;
    },
    async findMembershipByOrgAndUsername(organizationId, orgUsername) {
      for (const m of store.memberships.values()) {
        if (m.organizationId === organizationId && m.orgUsername === orgUsername) {
          return { ...m };
        }
      }
      return null;
    },
    async findMembershipsByUserId(userId) {
      return Array.from(store.memberships.values())
        .filter((m) => m.userId === userId)
        .map((m) => ({ ...m }));
    },
    async createMembership(params) {
      const rec: OrganizationMembershipRecord = {
        id: params.id,
        organizationId: params.organizationId,
        userId: params.userId,
        role: params.role,
        orgUsername: params.orgUsername,
        status: params.status,
        createdByUserId: params.createdByUserId,
        createdAt: params.now,
        updatedAt: params.now,
      };
      store.memberships.set(rec.id, rec);
      return { ...rec };
    },
    async updateMembership(params) {
      const existing = store.memberships.get(params.membershipId);
      if (!existing || existing.organizationId !== params.organizationId) return null;
      const updated: OrganizationMembershipRecord = {
        ...existing,
        orgUsername:
          params.orgUsername !== undefined ? params.orgUsername : existing.orgUsername,
        status: params.status ?? existing.status,
        updatedAt: params.now,
      };
      store.memberships.set(updated.id, updated);
      return { ...updated };
    },
    async revokeSessionsForUser(userId, reason, revokedAt) {
      let count = 0;
      for (const s of store.sessions.values()) {
        if (s.userId === userId && s.revokedAt === null) {
          s.revokedAt = revokedAt;
          s.revokedReason = reason;
          count += 1;
        }
      }
      return count;
    },
    async revokeSessionsForUserInOrg(organizationId, userId, reason, revokedAt) {
      let count = 0;
      for (const s of store.sessions.values()) {
        if (
          s.userId === userId &&
          s.activeOrganizationId === organizationId &&
          s.revokedAt === null
        ) {
          s.revokedAt = revokedAt;
          s.revokedReason = reason;
          count += 1;
        }
      }
      return count;
    },
    async findOrganizationById(organizationId) {
      const o = store.organizations.get(organizationId);
      return o ? { id: o.id, code: o.code, name: o.name, status: o.status } : null;
    },
    async findClassInOrg(organizationId, classId) {
      const c = store.classes.get(classId);
      if (!c || c.organizationId !== organizationId) return null;
      return {
        id: c.id,
        organizationId: c.organizationId,
        name: c.name,
        status: c.status,
      };
    },
    async isTeacherAssignedToClass(organizationId, classId, teacherMembershipId) {
      return store.classTeachers.some(
        (ct) =>
          ct.organizationId === organizationId &&
          ct.classId === classId &&
          ct.teacherMembershipId === teacherMembershipId
      );
    },
    async createClassEnrollment(params) {
      store.classEnrollments.push({
        id: params.id,
        organizationId: params.organizationId,
        classId: params.classId,
        studentMembershipId: params.studentMembershipId,
        status: 'active',
        enrolledAt: params.enrolledAt,
        endedAt: null,
        updatedByUserId: params.updatedByUserId,
      });
    },
  };

  const classRepo: ClassRepository = {
    async withTransaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      return fn({} as never);
    },
    async findOrganizationById(organizationId) {
      return membershipRepo.findOrganizationById(organizationId);
    },
    async listClassesInOrg(params) {
      let items = Array.from(store.classes.values()).filter(
        (c) => c.organizationId === params.organizationId
      );
      if (params.status) items = items.filter((c) => c.status === params.status);
      if (params.search && params.search.trim().length > 0) {
        const needle = params.search.trim().toLowerCase();
        items = items.filter((c) => c.name.toLowerCase().includes(needle));
      }
      const total = items.length;
      const offset = (params.page - 1) * params.limit;
      return { items: items.slice(offset, offset + params.limit), total };
    },
    async findClassByIdInOrg(organizationId, classId) {
      const c = store.classes.get(classId);
      if (!c || c.organizationId !== organizationId) return null;
      return { ...c };
    },
    async createClass(params) {
      const rec: ClassRecord = {
        id: params.id,
        organizationId: params.organizationId,
        name: params.name,
        academicYear: params.academicYear,
        status: params.status,
        createdByUserId: params.createdByUserId,
        createdAt: params.now,
        updatedAt: params.now,
      };
      store.classes.set(rec.id, rec);
      return { ...rec };
    },
    async updateClass(params) {
      const existing = store.classes.get(params.classId);
      if (!existing || existing.organizationId !== params.organizationId) return null;
      const updated: ClassRecord = {
        ...existing,
        name: params.name ?? existing.name,
        academicYear:
          params.academicYear !== undefined
            ? params.academicYear
            : existing.academicYear,
        status: params.status ?? existing.status,
        updatedAt: params.now,
      };
      store.classes.set(updated.id, updated);
      return { ...updated };
    },
    async findMembershipsInOrgByIds(organizationId, membershipIds) {
      return membershipIds
        .map((id) => store.memberships.get(id))
        .filter((m): m is OrganizationMembershipRecord =>
          Boolean(m && m.organizationId === organizationId)
        )
        .map((m) => {
          const u = store.users.get(m.userId)!;
          return {
            id: m.id,
            organizationId: m.organizationId,
            userId: m.userId,
            role: m.role,
            status: m.status,
            userStatus: u.status,
            displayName: u.displayName,
            email: u.email,
            orgUsername: m.orgUsername,
          };
        });
    },
    async listClassTeachers(organizationId, classId) {
      return store.classTeachers
        .filter(
          (ct) => ct.organizationId === organizationId && ct.classId === classId
        )
        .map((ct) => {
          const m = store.memberships.get(ct.teacherMembershipId)!;
          const u = store.users.get(m.userId)!;
          return {
            assignmentId: ct.id,
            teacherMembershipId: ct.teacherMembershipId,
            userId: u.id,
            displayName: u.displayName,
            email: u.email,
            membershipStatus: m.status,
            assignedAt: ct.createdAt,
          };
        });
    },
    async insertClassTeachers(rows) {
      store.classTeachers.push(...rows);
    },
    async deleteClassTeachersByMembershipIds(
      organizationId,
      classId,
      teacherMembershipIds
    ) {
      const toRemove = new Set(teacherMembershipIds);
      store.classTeachers = store.classTeachers.filter(
        (ct) =>
          !(
            ct.organizationId === organizationId &&
            ct.classId === classId &&
            toRemove.has(ct.teacherMembershipId)
          )
      );
    },
    async listActiveClassStudents(organizationId, classId) {
      return store.classEnrollments
        .filter(
          (e) =>
            e.organizationId === organizationId &&
            e.classId === classId &&
            e.status === 'active'
        )
        .map((e) => {
          const m = store.memberships.get(e.studentMembershipId)!;
          const u = store.users.get(m.userId)!;
          return {
            enrollmentId: e.id,
            studentMembershipId: e.studentMembershipId,
            userId: u.id,
            orgUsername: m.orgUsername,
            displayName: u.displayName,
            enrollmentStatus: e.status,
            membershipStatus: m.status,
            userStatus: u.status,
            enrolledAt: e.enrolledAt,
          };
        });
    },
    async insertClassEnrollments(rows) {
      for (const r of rows) {
        const duplicateActive = store.classEnrollments.some(
          (e) =>
            e.organizationId === r.organizationId &&
            e.classId === r.classId &&
            e.studentMembershipId === r.studentMembershipId &&
            e.status === 'active'
        );
        if (duplicateActive) {
          throw new Error('uq_class_enrollments_active_pair violated');
        }
        store.classEnrollments.push({
          id: r.id,
          organizationId: r.organizationId,
          classId: r.classId,
          studentMembershipId: r.studentMembershipId,
          status: 'active',
          enrolledAt: r.enrolledAt,
          endedAt: null,
          updatedByUserId: r.updatedByUserId,
        });
      }
    },
    async endActiveEnrollments(params) {
      const idSet = new Set(params.studentMembershipIds);
      for (const e of store.classEnrollments) {
        if (
          e.organizationId === params.organizationId &&
          e.classId === params.classId &&
          e.status === 'active' &&
          idSet.has(e.studentMembershipId)
        ) {
          e.status = params.endStatus;
          e.endedAt = params.endedAt;
          e.updatedByUserId = params.updatedByUserId;
        }
      }
    },
    async listAssignedClassesForTeacher(params) {
      const assignedIds = new Set(
        store.classTeachers
          .filter(
            (ct) =>
              ct.organizationId === params.organizationId &&
              ct.teacherMembershipId === params.teacherMembershipId
          )
          .map((ct) => ct.classId)
      );
      let items = Array.from(store.classes.values()).filter(
        (c) => c.organizationId === params.organizationId && assignedIds.has(c.id)
      );
      if (params.status) items = items.filter((c) => c.status === params.status);
      const total = items.length;
      const offset = (params.page - 1) * params.limit;
      return { items: items.slice(offset, offset + params.limit), total };
    },
    async isTeacherAssignedToClassInOrg(
      organizationId,
      classId,
      teacherMembershipId
    ) {
      return membershipRepo.isTeacherAssignedToClass(
        organizationId,
        classId,
        teacherMembershipId
      );
    },
  };

  const csvRepo: CsvImportRepository = {
    async withTransaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      return fn({} as never);
    },
    async findOrganizationById(organizationId) {
      return membershipRepo.findOrganizationById(organizationId);
    },
    async findClassInOrg(organizationId, classId) {
      return membershipRepo.findClassInOrg(organizationId, classId);
    },
    async isTeacherAssignedToClass(organizationId, classId, teacherMembershipId) {
      return membershipRepo.isTeacherAssignedToClass(
        organizationId,
        classId,
        teacherMembershipId
      );
    },
    async findExistingOrgUsernames(organizationId, usernames) {
      const set = new Set<string>();
      const target = new Set(usernames);
      for (const m of store.memberships.values()) {
        if (
          m.organizationId === organizationId &&
          m.orgUsername &&
          target.has(m.orgUsername)
        ) {
          set.add(m.orgUsername);
        }
      }
      return set;
    },
    async findExistingEmails(emails) {
      const set = new Set<string>();
      const target = new Set(emails.map((e) => e.toLowerCase()));
      for (const u of store.users.values()) {
        if (u.email && target.has(u.email.toLowerCase())) {
          set.add(u.email.toLowerCase());
        }
      }
      return set;
    },
    async createImportJob(params) {
      const rec: CsvImportJobRecord = { ...params };
      store.csvImportJobs.set(rec.id, rec);
      return { ...rec };
    },
    async updateImportJob(params) {
      const existing = store.csvImportJobs.get(params.id);
      if (!existing || existing.organizationId !== params.organizationId) return;
      store.csvImportJobs.set(params.id, {
        ...existing,
        status: params.status,
        totalRows: params.totalRows,
        succeededRows: params.succeededRows,
        failedRows: params.failedRows,
        errorSummaryJson: params.errorSummaryJson,
        completedAt: params.completedAt,
      });
    },
    async findImportJobById(organizationId, jobId) {
      const job = store.csvImportJobs.get(jobId);
      if (!job || job.organizationId !== organizationId) return null;
      return { ...job };
    },
    async listImportJobsInOrg(params) {
      const items = Array.from(store.csvImportJobs.values()).filter(
        (j) => j.organizationId === params.organizationId
      );
      const offset = (params.page - 1) * params.limit;
      return { items: items.slice(offset, offset + params.limit), total: items.length };
    },
    async createImportedStudent(params) {
      store.users.set(params.userId, {
        id: params.userId,
        email: params.email,
        platformUsername: null,
        platformRole: null,
        displayName: params.displayName,
        passwordHash: params.passwordHash,
        status: 'active',
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: null,
        createdAt: params.now,
        updatedAt: params.now,
      });
      store.memberships.set(params.membershipId, {
        id: params.membershipId,
        organizationId: params.organizationId,
        userId: params.userId,
        role: 'student',
        orgUsername: params.orgUsername,
        status: 'active',
        createdByUserId: params.createdByUserId,
        createdAt: params.now,
        updatedAt: params.now,
      });
      if (params.targetClassId && params.enrollmentId) {
        store.classEnrollments.push({
          id: params.enrollmentId,
          organizationId: params.organizationId,
          classId: params.targetClassId,
          studentMembershipId: params.membershipId,
          status: 'active',
          enrolledAt: params.now,
          endedAt: null,
          updatedByUserId: params.createdByUserId,
        });
      }
    },
  };

  return { orgRepo, membershipRepo, classRepo, csvRepo };
}

function makeFakeAuthRepo(store: InMemoryP203Store): AuthRepository {
  const unsupported = async () => {
    throw new Error('Unused in P2-03 middleware test');
  };
  return {
    withTransaction: async (fn) => fn({} as never),
    findUserCredentialByEmail: unsupported,
    findUserCredentialByPlatformUsername: unsupported,
    findUserCredentialById: unsupported,
    findStudentLoginRecord: unsupported,
    findMembershipsForUser: async () => [],
    recordFailedLoginAttempt: unsupported,
    recordSuccessfulLoginState: unsupported,
    createSession: unsupported,
    findSessionWithContextByTokenHash: async (
      tokenHash: string
    ): Promise<SessionWithContextRecord | null> => {
      for (const s of store.sessions.values()) {
        if (s.tokenHash !== tokenHash) continue;
        const u = store.users.get(s.userId);
        if (!u) return null;
        const org = s.activeOrganizationId
          ? store.organizations.get(s.activeOrganizationId) ?? null
          : null;
        const membership =
          s.activeOrganizationId !== null
            ? Array.from(store.memberships.values()).find(
                (m) =>
                  m.organizationId === s.activeOrganizationId &&
                  m.userId === u.id
              ) ?? null
            : null;
        return {
          session: { ...s },
          user: { ...u },
          activeOrganization: org
            ? { id: org.id, code: org.code, name: org.name, status: org.status }
            : null,
          activeMembership: membership
            ? {
                id: membership.id,
                organizationId: membership.organizationId,
                role: membership.role,
                orgUsername: membership.orgUsername,
                status: membership.status,
              }
            : null,
        };
      }
      return null;
    },
    touchSessionActivity: async (sessionId, lastActivityAt, idleExpiresAt) => {
      const s = store.sessions.get(sessionId);
      if (s) {
        s.lastActivityAt = lastActivityAt;
        s.idleExpiresAt = idleExpiresAt;
      }
    },
    rotateSession: unsupported,
    revokeSessionById: async (sessionId, reason, revokedAt) => {
      const s = store.sessions.get(sessionId);
      if (s) {
        s.revokedAt = revokedAt;
        s.revokedReason = reason;
      }
    },
    revokeOtherActiveSessionsForUser: async () => 0,
    updateUserPasswordHash: unsupported,
  };
}

function getTestConfig(): ServerConfig {
  return parseServerConfig({
    NODE_ENV: 'test',
    AUTH_CSRF_SECRET: 'test_csrf_secret_for_p2_03_unit_and_route_tests_567890',
    TRUSTED_ORIGINS: 'http://127.0.0.1:3000',
    CSV_MAX_BYTES: '524288',
    CSV_MAX_ROWS: '500',
  });
}

function issueTestSession(
  store: InMemoryP203Store,
  config: ServerConfig,
  now: Date,
  params: {
    userId: string;
    sessionScope: 'platform_admin' | 'teacher' | 'student';
    activeOrganizationId: string | null;
  }
) {
  const rawToken = generateSessionToken();
  const tokenHash = hashSessionToken(rawToken);
  const sessionId = generateUuidV7();
  store.sessions.set(sessionId, {
    id: sessionId,
    tokenHash,
    userId: params.userId,
    sessionScope: params.sessionScope,
    activeOrganizationId: params.activeOrganizationId,
    idleExpiresAt: new Date(now.getTime() + 3600_000),
    absoluteExpiresAt: new Date(now.getTime() + 86400_000),
    lastActivityAt: now,
    revokedAt: null,
    revokedReason: null,
  });
  const csrfToken = deriveSessionCsrfToken(
    rawToken,
    sessionId,
    config.auth.csrfSecret
  );
  const cookieHeader = `${config.cookie.name}=${rawToken}`;
  return { sessionId, rawToken, csrfToken, cookieHeader };
}

test('Organizations service: uppercase normalization, uniqueness conflict, suspend update, search', async () => {
  const store = createEmptyStore();
  const { orgRepo } = makeFakeRepos(store);
  const now = new Date('2026-11-16T08:00:00Z');
  const orgService = createOrgService({
    repo: orgRepo,
    now: () => now,
    auditFn: async (input) => {
      store.audits.push(input);
    },
  });

  const actor = { actorUserId: generateUuidV7(), ipPrefix: '127.0.0' };
  const created = await orgService.createOrganization(
    { code: '  school_alpha  ', name: 'Trường Tiểu học Alpha' },
    actor
  );
  assert.equal(created.code, 'SCHOOL_ALPHA');
  assert.equal(created.status, 'active');

  await assert.rejects(
    () =>
      orgService.createOrganization(
        { code: 'SCHOOL_ALPHA', name: 'Duplicate School' },
        actor
      ),
    (err: { httpStatus?: number; code?: string }) =>
      err.httpStatus === 409 && err.code === 'ORGANIZATION_CODE_EXISTS'
  );

  const updated = await orgService.updateOrganization(
    created.id,
    { status: 'suspended' },
    actor
  );
  assert.equal(updated.status, 'suspended');

  const list = await orgService.listOrganizations({
    page: 1,
    limit: 10,
    search: 'alpha',
  });
  assert.equal(list.total, 1);
  assert.equal(list.items[0].status, 'suspended');
  assert.equal(store.audits.length, 2);
});

test('Membership service: teacher multi-org, email-less student, deferred cross-org transfer blocked, disable revokes sessions', async () => {
  const store = createEmptyStore();
  const { orgRepo, membershipRepo } = makeFakeRepos(store);
  const now = new Date('2026-11-16T08:00:00Z');
  const limiter = new ScryptConcurrencyLimiter({ maxConcurrent: 4, maxQueue: 20 });

  const orgService = createOrgService({
    repo: orgRepo,
    now: () => now,
    auditFn: async (input) => {
      store.audits.push(input);
    },
  });
  const membershipService = createMembershipService({
    repo: membershipRepo,
    scryptLimiter: limiter,
    getConfig: getTestConfig,
    now: () => now,
    auditFn: async (input) => {
      store.audits.push(input);
    },
  });

  const adminId = generateUuidV7();
  const org1 = await orgService.createOrganization(
    { code: 'SCH1', name: 'School 1' },
    { actorUserId: adminId, ipPrefix: null }
  );
  const org2 = await orgService.createOrganization(
    { code: 'SCH2', name: 'School 2' },
    { actorUserId: adminId, ipPrefix: null }
  );

  // Admin creates teacher in org1
  const teacherCreated = await membershipService.provisionAccount(
    {
      role: 'teacher',
      organizationId: org1.id,
      displayName: 'Cô Mai',
      email: 'Mai@School1.edu.vn',
      password: 'TeacherStrongPassword!123',
    },
    { actorUserId: adminId, actorRole: 'platform_admin', ipPrefix: null }
  );
  assert.equal(teacherCreated.user.email, 'mai@school1.edu.vn');
  assert.equal(teacherCreated.membership.role, 'teacher');

  // Verify scrypt hash was actually produced and verifies
  const rawTeacher = store.users.get(teacherCreated.user.id)!;
  assert.equal(
    await verifyPassword('TeacherStrongPassword!123', rawTeacher.passwordHash),
    true
  );

  // Teacher can hold a second membership in org2
  const teacherOrg2 = await membershipService.createOrganizationMembership(
    {
      organizationId: org2.id,
      userId: teacherCreated.user.id,
      role: 'teacher',
    },
    { actorUserId: adminId, actorRole: 'platform_admin', ipPrefix: null }
  );
  assert.equal(teacherOrg2.organizationId, org2.id);

  // Admin creates email-less student in org1
  const studentCreated = await membershipService.provisionAccount(
    {
      role: 'student',
      organizationId: org1.id,
      displayName: 'Bé An',
      orgUsername: 'an.nguyen',
      password: 'StudentPin!99',
    },
    { actorUserId: adminId, actorRole: 'platform_admin', ipPrefix: null }
  );
  assert.equal(studentCreated.user.email, null);
  assert.equal(studentCreated.membership.orgUsername, 'an.nguyen');

  // Same orgUsername in DIFFERENT org (org2) is valid for a different student
  const studentOrg2 = await membershipService.provisionAccount(
    {
      role: 'student',
      organizationId: org2.id,
      displayName: 'Bé An Trường 2',
      orgUsername: 'an.nguyen',
      password: 'StudentPin!88',
    },
    { actorUserId: adminId, actorRole: 'platform_admin', ipPrefix: null }
  );
  assert.equal(studentOrg2.membership.orgUsername, 'an.nguyen');

  // Cross-org student transfer or second membership is blocked (PO deferred)
  await assert.rejects(
    () =>
      membershipService.createOrganizationMembership(
        {
          organizationId: org2.id,
          userId: studentCreated.user.id,
          role: 'student',
          orgUsername: 'an.moved',
        },
        { actorUserId: adminId, actorRole: 'platform_admin', ipPrefix: null }
      ),
    (err: { httpStatus?: number; code?: string }) =>
      err.httpStatus === 409 && err.code === 'STUDENT_TRANSFER_POLICY_DEFERRED'
  );

  await assert.rejects(
    () =>
      membershipService.updateOrganizationMembership(
        org1.id,
        studentCreated.membership.id,
        { status: 'transferred' },
        { actorUserId: adminId, actorRole: 'platform_admin', ipPrefix: null }
      ),
    (err: { httpStatus?: number; code?: string }) =>
      err.httpStatus === 409 && err.code === 'STUDENT_TRANSFER_POLICY_DEFERRED'
  );

  // Disabling user revokes active sessions immediately
  store.sessions.set('s1', {
    id: 's1',
    tokenHash: 'h1',
    userId: studentCreated.user.id,
    sessionScope: 'student',
    activeOrganizationId: org1.id,
    idleExpiresAt: new Date(now.getTime() + 10000),
    absoluteExpiresAt: new Date(now.getTime() + 10000),
    lastActivityAt: now,
    revokedAt: null,
    revokedReason: null,
  });

  const disabled = await membershipService.updateUser(
    studentCreated.user.id,
    { status: 'disabled' },
    { actorUserId: adminId, actorRole: 'platform_admin', ipPrefix: null }
  );
  assert.equal(disabled.status, 'disabled');
  assert.equal(store.sessions.get('s1')?.revokedReason, 'account_disabled');
});

test('Class service: teacher assignment validation, enrollment history & re-enrollment preservation', async () => {
  const store = createEmptyStore();
  const { orgRepo, membershipRepo, classRepo } = makeFakeRepos(store);
  const now = new Date('2026-11-16T08:00:00Z');
  const limiter = new ScryptConcurrencyLimiter({ maxConcurrent: 4, maxQueue: 20 });

  const orgService = createOrgService({ repo: orgRepo, now: () => now, auditFn: async () => {} });
  const membershipService = createMembershipService({
    repo: membershipRepo,
    scryptLimiter: limiter,
    getConfig: getTestConfig,
    now: () => now,
    auditFn: async () => {},
  });
  const classService = createClassService({
    repo: classRepo,
    now: () => now,
    auditFn: async (input) => {
      store.audits.push(input);
    },
  });

  const adminId = generateUuidV7();
  const actor = { actorUserId: adminId, actorRole: 'platform_admin' as const, ipPrefix: null };
  const org = await orgService.createOrganization({ code: 'CLS_ORG', name: 'Class Org' }, actor);
  const teacher = await membershipService.provisionAccount(
    {
      role: 'teacher',
      organizationId: org.id,
      displayName: 'Thầy Nam',
      email: 'nam@cls.edu.vn',
      password: 'Password!1234',
    },
    actor
  );
  const student = await membershipService.provisionAccount(
    {
      role: 'student',
      organizationId: org.id,
      displayName: 'Bé Bình',
      orgUsername: 'binh.le',
      password: 'Password!1234',
    },
    actor
  );

  const cls = await classService.createClass(
    org.id,
    { name: 'Lớp 3A', academicYear: '2026-2027' },
    actor
  );

  // Reject student membership being assigned as class teacher
  await assert.rejects(
    () => classService.setClassTeachers(org.id, cls.id, [student.membership.id], actor),
    (err: { httpStatus?: number; code?: string }) =>
      err.httpStatus === 409 && err.code === 'INVALID_TEACHER_ROLE'
  );

  const assigned = await classService.setClassTeachers(
    org.id,
    cls.id,
    [teacher.membership.id],
    actor
  );
  assert.equal(assigned.teachers.length, 1);

  // Enroll student -> transfer_out -> re-enroll: history row preserved, 1 active row exists
  await classService.updateClassStudents(
    org.id,
    cls.id,
    { mode: 'enroll', studentMembershipIds: [student.membership.id] },
    actor
  );
  await assert.rejects(
    () =>
      classService.updateClassStudents(
        org.id,
        cls.id,
        { mode: 'enroll', studentMembershipIds: [student.membership.id] },
        actor
      ),
    (err: { httpStatus?: number; code?: string }) =>
      err.httpStatus === 409 && err.code === 'STUDENT_ALREADY_ENROLLED'
  );

  await classService.updateClassStudents(
    org.id,
    cls.id,
    { mode: 'remove', studentMembershipIds: [student.membership.id], removedStatus: 'transferred_out' },
    actor
  );
  await classService.updateClassStudents(
    org.id,
    cls.id,
    { mode: 'enroll', studentMembershipIds: [student.membership.id] },
    actor
  );

  assert.equal(store.classEnrollments.length, 2);
  assert.equal(store.classEnrollments[0].status, 'transferred_out');
  assert.equal(store.classEnrollments[1].status, 'active');
});

test('CSV parser and service: RFC-4180 parsing, preview validation, partial commit, zero plaintext leakage', async () => {
  const parsed = parseCsvDocument(
    '\uFEFForg_username,display_name,email,initial_password\r\n"hs.01","Nguyễn ""Bé"" An",,Secret#1\r\n\r\nhs.02,"Trần, Bình",binh@example.com,"Pass,With,Comma"'
  );
  assert.deepEqual(parsed.headers, [
    'org_username',
    'display_name',
    'email',
    'initial_password',
  ]);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].fields[1], 'Nguyễn "Bé" An');
  assert.equal(parsed.rows[1].fields[1], 'Trần, Bình');
  assert.equal(parsed.rows[1].fields[3], 'Pass,With,Comma');

  const store = createEmptyStore();
  const { orgRepo, membershipRepo, classRepo, csvRepo } = makeFakeRepos(store);
  const now = new Date('2026-11-16T08:00:00Z');
  const limiter = new ScryptConcurrencyLimiter({ maxConcurrent: 4, maxQueue: 20 });

  const orgService = createOrgService({ repo: orgRepo, now: () => now, auditFn: async () => {} });
  const membershipService = createMembershipService({
    repo: membershipRepo,
    scryptLimiter: limiter,
    getConfig: getTestConfig,
    now: () => now,
    auditFn: async () => {},
  });
  const classService = createClassService({ repo: classRepo, now: () => now, auditFn: async () => {} });
  const csvService = createCsvImportService({
    repo: csvRepo,
    scryptLimiter: limiter,
    getConfig: getTestConfig,
    now: () => now,
    auditFn: async (input) => {
      store.audits.push(input);
    },
  });

  const adminId = generateUuidV7();
  const actor = { actorUserId: adminId, actorRole: 'platform_admin' as const, ipPrefix: null };
  const org = await orgService.createOrganization({ code: 'CSV_SCH', name: 'CSV School' }, actor);
  const cls = await classService.createClass(org.id, { name: 'Lớp 1A' }, actor);

  await membershipService.provisionAccount(
    {
      role: 'student',
      organizationId: org.id,
      displayName: 'Existing Student',
      orgUsername: 'existing.hs',
      password: 'ExistingPassword1!',
    },
    actor
  );

  const csvBody = [
    'org_username,display_name,email,initial_password',
    'new.hs1,"Lê Minh",minh@student.local,SuperSecretCsvPass1!',
    'new.hs2,"Phạm Hoa",,', // missing initial_password -> flagged in preview, rejected per-row on commit
    'existing.hs,"Trùng DB",,SuperSecretCsvPass2!',
    'bad@user,"Sai Format",,SuperSecretCsvPass3!',
    'new.hs1,"Trùng File",,SuperSecretCsvPass4!',
  ].join('\r\n');

  const preview = await csvService.processStudentCsvImport(
    {
      organizationId: org.id,
      targetClassId: cls.id,
      sourceFilename: '../../students.csv',
      csvContent: csvBody,
      mode: 'preview',
    },
    {
      actorUserId: adminId,
      actorRole: 'platform_admin',
      teacherMembershipId: null,
      ipPrefix: null,
    }
  );
  assert.equal(preview.job.status, 'validated');
  assert.equal(preview.job.sourceFilename, 'students.csv');
  assert.equal(preview.job.totalRows, 5);
  assert.equal(preview.job.succeededRows, 2); // new.hs1 + new.hs2 valid syntax/uniqueness
  assert.equal(preview.job.failedRows, 3);
  assert.equal(
    preview.credentialProvisioningPolicy,
    'DEFERRED_TO_PO_MISSING_DISTRIBUTION_AND_PIN_POLICY'
  );

  const commit = await csvService.processStudentCsvImport(
    {
      organizationId: org.id,
      targetClassId: cls.id,
      sourceFilename: 'students.csv',
      csvContent: csvBody,
      mode: 'commit',
    },
    {
      actorUserId: adminId,
      actorRole: 'platform_admin',
      teacherMembershipId: null,
      ipPrefix: null,
    }
  );

  assert.equal(commit.job.status, 'completed');
  assert.equal(commit.job.succeededRows, 1);
  assert.equal(commit.job.failedRows, 4);

  // Verify NO plaintext passwords or CSV content leaked into job record or audit logs
  const serializedJobs = JSON.stringify(Array.from(store.csvImportJobs.values()));
  const serializedAudits = JSON.stringify(store.audits);
  assert.equal(serializedJobs.includes('SuperSecretCsvPass'), false);
  assert.equal(serializedAudits.includes('SuperSecretCsvPass'), false);
  assert.equal(serializedJobs.includes('minh@student.local'), false);

  // Verify enrolled in class
  const roster = await classRepo.listActiveClassStudents(org.id, cls.id);
  assert.equal(roster.length, 1);
  assert.equal(roster[0].orgUsername, 'new.hs1');
});

test('HTTP routes end-to-end: RBAC, CSRF, cross-org probes (403), teacher class scoping', async () => {
  const store = createEmptyStore();
  const { orgRepo, membershipRepo, classRepo, csvRepo } = makeFakeRepos(store);
  const authRepo = makeFakeAuthRepo(store);
  const config = getTestConfig();
  const now = new Date('2026-11-16T08:00:00Z');
  const limiter = new ScryptConcurrencyLimiter({ maxConcurrent: 4, maxQueue: 20 });

  const orgService = createOrgService({
    repo: orgRepo,
    now: () => now,
    auditFn: async (input) => {
      store.audits.push(input);
    },
  });
  const membershipService = createMembershipService({
    repo: membershipRepo,
    scryptLimiter: limiter,
    getConfig: () => config,
    now: () => now,
    auditFn: async (input) => {
      store.audits.push(input);
    },
  });
  const classService = createClassService({
    repo: classRepo,
    now: () => now,
    auditFn: async (input) => {
      store.audits.push(input);
    },
  });
  const csvImportService = createCsvImportService({
    repo: csvRepo,
    scryptLimiter: limiter,
    getConfig: () => config,
    now: () => now,
    auditFn: async (input) => {
      store.audits.push(input);
    },
  });

  const fakeAuditExecutor = {
    insert: () => ({
      values: async (row: AuditEventInput) => {
        store.audits.push(row);
      },
    }),
  } as never;
  const authMiddlewares = createAuthMiddlewareSuite({
    repo: authRepo,
    getConfig: () => config,
    now: () => now,
    auditExecutor: fakeAuditExecutor,
  });
  const authenticatedCsrf = createAuthenticatedCsrfMiddleware({
    config,
    auditExecutor: fakeAuditExecutor,
  });

  const app = express();
  app.use('/api', express.json());
  const { adminClassesRouter, teacherClassesRouter } = createClassesRouters({
    classService,
    membershipService,
    csvImportService,
    authMiddlewares,
    authenticatedCsrf,
  });
  app.use('/api/v1/admin/organizations/:orgId/classes', adminClassesRouter);
  app.use(
    '/api/v1/admin',
    createAdminUsersRouter({
      membershipService,
      csvImportService,
      authMiddlewares,
      authenticatedCsrf,
    })
  );
  app.use(
    '/api/v1/admin/organizations',
    createAdminOrganizationsRouter({
      orgService,
      authMiddlewares,
      authenticatedCsrf,
    })
  );
  app.use('/api/v1/classes', teacherClassesRouter);
  app.use('/api', apiNotFoundHandler);
  app.use('/api', apiErrorHandler);

  // Seed platform_admin directly into store
  const adminId = generateUuidV7();
  store.users.set(adminId, {
    id: adminId,
    email: 'admin@mimora.local',
    platformUsername: 'sysadmin',
    platformRole: 'platform_admin',
    displayName: 'Platform Admin',
    passwordHash: 'unused',
    status: 'active',
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
  });

  const adminSession = issueTestSession(store, config, now, {
    userId: adminId,
    sessionScope: 'platform_admin',
    activeOrganizationId: null,
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // 1. Unauthenticated request returns 401
    const unauthRes = await fetch(`${baseUrl}/api/v1/admin/organizations`);
    assert.equal(unauthRes.status, 401);

    // 2. Mutation without CSRF fails 403
    const noCsrfRes = await fetch(`${baseUrl}/api/v1/admin/organizations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: adminSession.cookieHeader,
      },
      body: JSON.stringify({ code: 'ORG_A', name: 'Org A' }),
    });
    assert.equal(noCsrfRes.status, 403);

    // 3. Admin creates Org A and Org B
    const adminPostHeaders = {
      'content-type': 'application/json',
      origin: 'http://127.0.0.1:3000',
      cookie: adminSession.cookieHeader,
      [CUSTOM_REQUEST_HEADER]: '1',
      [CSRF_TOKEN_HEADER]: adminSession.csrfToken,
    };

    const orgARes = await fetch(`${baseUrl}/api/v1/admin/organizations`, {
      method: 'POST',
      headers: adminPostHeaders,
      body: JSON.stringify({ code: 'org_a', name: 'Trường A' }),
    });
    assert.equal(orgARes.status, 201);
    const orgAJson = (await orgARes.json()) as { organization: { id: string; code: string } };
    assert.equal(orgAJson.organization.code, 'ORG_A');

    const orgBRes = await fetch(`${baseUrl}/api/v1/admin/organizations`, {
      method: 'POST',
      headers: adminPostHeaders,
      body: JSON.stringify({ code: 'org_b', name: 'Trường B' }),
    });
    assert.equal(orgBRes.status, 201);
    const orgBJson = (await orgBRes.json()) as { organization: { id: string } };

    // 4. Admin creates Teacher T1 in Org A, Assigned Class C1 (Org A), Unassigned Class C2 (Org A), Cross-Org Class C3 (Org B)
    const t1Res = await fetch(`${baseUrl}/api/v1/admin/users`, {
      method: 'POST',
      headers: adminPostHeaders,
      body: JSON.stringify({
        role: 'teacher',
        organizationId: orgAJson.organization.id,
        displayName: 'Giáo viên A1',
        email: 'gv1@orga.vn',
        password: 'TeacherPassword!1',
      }),
    });
    assert.equal(t1Res.status, 201);
    const t1Json = (await t1Res.json()) as {
      user: { id: string };
      membership: { id: string };
    };

    const c1Res = await fetch(
      `${baseUrl}/api/v1/admin/organizations/${orgAJson.organization.id}/classes`,
      {
        method: 'POST',
        headers: adminPostHeaders,
        body: JSON.stringify({ name: 'Lớp 4A', academicYear: '2026-2027' }),
      }
    );
    assert.equal(c1Res.status, 201);
    const c1Json = (await c1Res.json()) as { class: { id: string } };

    const c2Res = await fetch(
      `${baseUrl}/api/v1/admin/organizations/${orgAJson.organization.id}/classes`,
      {
        method: 'POST',
        headers: adminPostHeaders,
        body: JSON.stringify({ name: 'Lớp 4B' }),
      }
    );
    const c2Json = (await c2Res.json()) as { class: { id: string } };

    const c3Res = await fetch(
      `${baseUrl}/api/v1/admin/organizations/${orgBJson.organization.id}/classes`,
      {
        method: 'POST',
        headers: adminPostHeaders,
        body: JSON.stringify({ name: 'Lớp 4C (Org B)' }),
      }
    );
    const c3Json = (await c3Res.json()) as { class: { id: string } };

    // Assign T1 to C1 only
    const assignRes = await fetch(
      `${baseUrl}/api/v1/admin/organizations/${orgAJson.organization.id}/classes/${c1Json.class.id}/teachers`,
      {
        method: 'PUT',
        headers: adminPostHeaders,
        body: JSON.stringify({ teacherMembershipIds: [t1Json.membership.id] }),
      }
    );
    assert.equal(assignRes.status, 200);

    // Issue teacher session in Org A
    const teacherSession = issueTestSession(store, config, now, {
      userId: t1Json.user.id,
      sessionScope: 'teacher',
      activeOrganizationId: orgAJson.organization.id,
    });
    const teacherHeaders = {
      'content-type': 'application/json',
      origin: 'http://127.0.0.1:3000',
      cookie: teacherSession.cookieHeader,
      [CUSTOM_REQUEST_HEADER]: '1',
      [CSRF_TOKEN_HEADER]: teacherSession.csrfToken,
    };

    // Teacher blocked from /api/v1/admin/* -> 403
    const teacherAdminProbe = await fetch(`${baseUrl}/api/v1/admin/organizations`, {
      headers: { cookie: teacherSession.cookieHeader },
    });
    assert.equal(teacherAdminProbe.status, 403);

    // Teacher lists assigned classes -> only C1
    const myClassesRes = await fetch(`${baseUrl}/api/v1/classes`, {
      headers: { cookie: teacherSession.cookieHeader },
    });
    assert.equal(myClassesRes.status, 200);
    const myClassesJson = (await myClassesRes.json()) as {
      items: Array<{ id: string }>;
      total: number;
    };
    assert.equal(myClassesJson.total, 1);
    assert.equal(myClassesJson.items[0].id, c1Json.class.id);

    // Teacher provisions email-less student into assigned C1 -> 201
    const teacherProvisionRes = await fetch(
      `${baseUrl}/api/v1/classes/${c1Json.class.id}/students`,
      {
        method: 'POST',
        headers: teacherHeaders,
        body: JSON.stringify({
          displayName: 'Học sinh Lớp 4A',
          orgUsername: 'hs.4a.01',
          password: 'StudentPass!1',
        }),
      }
    );
    assert.equal(teacherProvisionRes.status, 201);
    const sJson = (await teacherProvisionRes.json()) as { user: { id: string } };

    // Teacher views C1 roster -> 200 with 1 student
    const c1RosterRes = await fetch(
      `${baseUrl}/api/v1/classes/${c1Json.class.id}/students`,
      { headers: { cookie: teacherSession.cookieHeader } }
    );
    assert.equal(c1RosterRes.status, 200);
    const c1RosterJson = (await c1RosterRes.json()) as {
      students: Array<{ orgUsername: string }>;
    };
    assert.equal(c1RosterJson.students.length, 1);
    assert.equal(c1RosterJson.students[0].orgUsername, 'hs.4a.01');

    // Teacher probes unassigned C2 & cross-org C3 -> 403 (never 200)
    const c2Probe = await fetch(
      `${baseUrl}/api/v1/classes/${c2Json.class.id}/students`,
      { headers: { cookie: teacherSession.cookieHeader } }
    );
    assert.equal(c2Probe.status, 403);

    const c3Probe = await fetch(
      `${baseUrl}/api/v1/classes/${c3Json.class.id}/students`,
      { headers: { cookie: teacherSession.cookieHeader } }
    );
    assert.equal(c3Probe.status, 403);

    const c3CsvProbe = await fetch(
      `${baseUrl}/api/v1/classes/${c3Json.class.id}/csv-imports`,
      {
        method: 'POST',
        headers: teacherHeaders,
        body: JSON.stringify({
          sourceFilename: 'hack.csv',
          csvContent: 'org_username,display_name\nhs.x,Hacker',
          mode: 'preview',
        }),
      }
    );
    assert.equal(c3CsvProbe.status, 403);

    // Student cannot access teacher or admin routes -> 403
    const studentSession = issueTestSession(store, config, now, {
      userId: sJson.user.id,
      sessionScope: 'student',
      activeOrganizationId: orgAJson.organization.id,
    });
    const studentClassesProbe = await fetch(`${baseUrl}/api/v1/classes`, {
      headers: { cookie: studentSession.cookieHeader },
    });
    assert.equal(studentClassesProbe.status, 403);

    // Verify cross-tenant audit event was recorded for C3 probe
    assert.equal(
      store.audits.some((a) => a.eventType === 'security.cross_tenant_attempt_blocked'),
      true
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
