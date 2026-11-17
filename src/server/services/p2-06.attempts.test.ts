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
  AssignmentRecord,
  AssignmentRepository,
} from '../repositories/assignment.repository.ts';
import type {
  ActivityAttemptRecord,
  ActivityAttemptTurnRecord,
  AssignmentProgressRecord,
  AttemptRepository,
  AttemptStatus,
  ProgressStatus,
} from '../repositories/attempt.repository.ts';
import type {
  AuthRepository,
  SessionWithContextRecord,
} from '../repositories/auth.repository.ts';
import { createAssignmentsRouters } from '../routes/assignments.routes.ts';
import { createAttemptsRouters } from '../routes/attempts.routes.ts';
import {
  CSRF_TOKEN_HEADER,
  CUSTOM_REQUEST_HEADER,
  createAuthenticatedCsrfMiddleware,
  deriveSessionCsrfToken,
} from '../security/csrf.ts';
import { generateSessionToken, hashSessionToken } from '../security/session.ts';
import { recordAuditEvent } from './audit.service.ts';
import { createAssignmentService } from './assignment.service.ts';
import { createAttemptService } from './attempt.service.ts';

type AuditEventInput = Parameters<typeof recordAuditEvent>[0];

interface InMemoryP206Store {
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
  activityAttempts: Map<string, ActivityAttemptRecord>;
  activityAttemptTurns: Map<string, ActivityAttemptTurnRecord>;
  assignmentProgress: Map<string, AssignmentProgressRecord>;
  audits: AuditEventInput[];
}

function createFakeStore(): InMemoryP206Store {
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
    activityAttempts: new Map(),
    activityAttemptTurns: new Map(),
    assignmentProgress: new Map(),
    audits: [],
  };
}

function createFakeAttemptRepo(store: InMemoryP206Store): AttemptRepository {
  const withTx: AttemptRepository['withTransaction'] = async (fn) => {
    return fn({} as never);
  };

  return {
    withTransaction: withTx,

    async findAndLockTargetAndItemForStudent(params) {
      const target = store.assignmentTargets.find(
        (t) =>
          t.organizationId === params.organizationId &&
          t.studentMembershipId === params.studentMembershipId &&
          t.id === params.targetId
      );
      if (!target) {
        return null;
      }

      const assignment = store.assignments.get(target.assignmentId);
      if (!assignment || assignment.organizationId !== params.organizationId) {
        return null;
      }

      const items = store.assignmentItems.filter(
        (i) =>
          i.organizationId === params.organizationId &&
          i.assignmentId === assignment.id
      );
      const item = items.find((i) => i.id === params.itemId);
      if (!item) {
        return null;
      }

      const version = store.contentVersions.get(item.contentVersionId);
      if (!version) {
        return null;
      }
      const contentItem = store.contentItems.get(version.contentItemId);
      if (!contentItem) {
        return null;
      }

      return {
        target,
        assignment: {
          id: assignment.id,
          organizationId: assignment.organizationId,
          classId: assignment.classId,
          title: assignment.title,
          status: assignment.status,
          dueAt: assignment.dueAt,
          homePracticeInstructions: assignment.homePracticeInstructions,
        },
        item,
        contentVersion: {
          id: version.id,
          contentItemId: contentItem.id,
          contentType: contentItem.contentType,
          versionNumber: version.versionNumber,
          title: version.title,
          summary: version.summary,
          locale: version.locale,
        },
        totalItemsInAssignment: items.length,
      };
    },

    async findAttemptByStartIdempotencyKey(params) {
      for (const a of store.activityAttempts.values()) {
        if (
          a.organizationId === params.organizationId &&
          a.studentMembershipId === params.studentMembershipId &&
          a.assignmentTargetId === params.assignmentTargetId &&
          a.assignmentItemId === params.assignmentItemId &&
          a.startIdempotencyKey === params.startIdempotencyKey
        ) {
          return a;
        }
      }
      return null;
    },

    async findInProgressAttemptForItem(params) {
      for (const a of store.activityAttempts.values()) {
        if (
          a.organizationId === params.organizationId &&
          a.studentMembershipId === params.studentMembershipId &&
          a.assignmentTargetId === params.assignmentTargetId &&
          a.assignmentItemId === params.assignmentItemId &&
          a.status === 'in_progress'
        ) {
          return a;
        }
      }
      return null;
    },

    async findAttemptAggregateStatsForItem(params) {
      let totalCount = 0;
      let maxAttemptNumber = 0;
      for (const a of store.activityAttempts.values()) {
        if (
          a.organizationId === params.organizationId &&
          a.studentMembershipId === params.studentMembershipId &&
          a.assignmentTargetId === params.assignmentTargetId &&
          a.assignmentItemId === params.assignmentItemId
        ) {
          totalCount += 1;
          if (a.attemptNumber > maxAttemptNumber) {
            maxAttemptNumber = a.attemptNumber;
          }
        }
      }
      return { totalCount, maxAttemptNumber };
    },

    async insertActivityAttempt(row) {
      for (const existing of store.activityAttempts.values()) {
        if (
          existing.assignmentTargetId === row.assignmentTargetId &&
          existing.assignmentItemId === row.assignmentItemId &&
          existing.attemptNumber === row.attemptNumber
        ) {
          throw Object.assign(new Error('Duplicate attempt number'), {
            code: 'ER_DUP_ENTRY',
            errno: 1062,
          });
        }
        if (
          (row.status ?? 'in_progress') === 'in_progress' &&
          existing.assignmentTargetId === row.assignmentTargetId &&
          existing.assignmentItemId === row.assignmentItemId &&
          existing.status === 'in_progress'
        ) {
          throw Object.assign(new Error('Duplicate in_progress attempt'), {
            code: 'ER_DUP_ENTRY',
            errno: 1062,
          });
        }
      }
      const created: ActivityAttemptRecord = {
        id: row.id,
        organizationId: row.organizationId,
        assignmentId: row.assignmentId,
        assignmentTargetId: row.assignmentTargetId,
        assignmentItemId: row.assignmentItemId,
        studentMembershipId: row.studentMembershipId,
        contentVersionId: row.contentVersionId,
        attemptNumber: row.attemptNumber,
        startIdempotencyKey: row.startIdempotencyKey ?? null,
        status: row.status ?? 'in_progress',
        startedAt: row.startedAt,
        lastInteractedAt: row.lastInteractedAt,
        completedAt: row.completedAt ?? null,
        durationSeconds: row.durationSeconds ?? 0,
        usedAacSupport: row.usedAacSupport ?? false,
        usedReadAloud: row.usedReadAloud ?? false,
        aacTapCount: row.aacTapCount ?? 0,
        readAloudCount: row.readAloudCount ?? 0,
        responseSummaryJson: row.responseSummaryJson ?? null,
        inProgressTargetGuard:
          (row.status ?? 'in_progress') === 'in_progress'
            ? row.assignmentTargetId
            : null,
        inProgressItemGuard:
          (row.status ?? 'in_progress') === 'in_progress'
            ? row.assignmentItemId
            : null,
      };
      store.activityAttempts.set(created.id, created);
      return created;
    },

    async listTurnsForAttempt(params) {
      return Array.from(store.activityAttemptTurns.values())
        .filter(
          (t) =>
            t.organizationId === params.organizationId &&
            t.attemptId === params.attemptId
        )
        .sort(
          (a, b) =>
            a.turnIndex - b.turnIndex ||
            a.respondedAt.getTime() - b.respondedAt.getTime() ||
            a.id.localeCompare(b.id)
        );
    },

    async findTurnByAttemptAndIndex(params) {
      for (const t of store.activityAttemptTurns.values()) {
        if (
          t.organizationId === params.organizationId &&
          t.attemptId === params.attemptId &&
          t.turnIndex === params.turnIndex
        ) {
          return t;
        }
      }
      return null;
    },

    async insertTurnAndUpdateAttempt(params) {
      for (const existing of store.activityAttemptTurns.values()) {
        if (
          existing.attemptId === params.turn.attemptId &&
          existing.turnIndex === params.turn.turnIndex
        ) {
          throw Object.assign(new Error('Duplicate turn index'), {
            code: 'ER_DUP_ENTRY',
            errno: 1062,
          });
        }
      }

      const turn: ActivityAttemptTurnRecord = {
        id: params.turn.id,
        organizationId: params.turn.organizationId,
        attemptId: params.turn.attemptId,
        turnIndex: params.turn.turnIndex,
        stepKey: params.turn.stepKey,
        selectedChoiceKey: params.turn.selectedChoiceKey ?? null,
        selectedEmotionKey: params.turn.selectedEmotionKey ?? null,
        usedAac: params.turn.usedAac ?? false,
        usedReadAloud: params.turn.usedReadAloud ?? false,
        responsePayloadJson: params.turn.responsePayloadJson ?? null,
        respondedAt: params.turn.respondedAt,
      };
      store.activityAttemptTurns.set(turn.id, turn);

      const attempt = store.activityAttempts.get(params.attemptUpdate.attemptId)!;
      const updated: ActivityAttemptRecord = {
        ...attempt,
        lastInteractedAt: params.attemptUpdate.lastInteractedAt,
        durationSeconds: params.attemptUpdate.durationSeconds,
        usedAacSupport: params.attemptUpdate.usedAacSupport,
        usedReadAloud: params.attemptUpdate.usedReadAloud,
        aacTapCount: params.attemptUpdate.aacTapCount,
        readAloudCount: params.attemptUpdate.readAloudCount,
      };
      store.activityAttempts.set(updated.id, updated);
      return { turn, attempt: updated };
    },

    async findAttemptRefForStudent(params) {
      const a = store.activityAttempts.get(params.attemptId);
      if (
        !a ||
        a.organizationId !== params.organizationId ||
        a.studentMembershipId !== params.studentMembershipId
      ) {
        return null;
      }
      return {
        id: a.id,
        assignmentTargetId: a.assignmentTargetId,
        assignmentId: a.assignmentId,
        assignmentItemId: a.assignmentItemId,
      };
    },

    async lockTargetAndLoadStudentAttempt(params) {
      const target = store.assignmentTargets.find(
        (t) =>
          t.organizationId === params.organizationId &&
          t.studentMembershipId === params.studentMembershipId &&
          t.id === params.targetId
      );
      if (!target) {
        return null;
      }
      const attempt = store.activityAttempts.get(params.attemptId);
      if (
        !attempt ||
        attempt.organizationId !== params.organizationId ||
        attempt.studentMembershipId !== params.studentMembershipId ||
        attempt.assignmentTargetId !== target.id
      ) {
        return null;
      }
      const assignment = store.assignments.get(attempt.assignmentId);
      if (!assignment) {
        return null;
      }
      const items = store.assignmentItems.filter(
        (i) =>
          i.organizationId === attempt.organizationId &&
          i.assignmentId === attempt.assignmentId
      );
      const item = items.find((i) => i.id === attempt.assignmentItemId);
      if (!item) {
        return null;
      }
      const version = store.contentVersions.get(item.contentVersionId)!;
      const contentItem = store.contentItems.get(version.contentItemId)!;

      return {
        attempt,
        assignment: {
          id: assignment.id,
          organizationId: assignment.organizationId,
          classId: assignment.classId,
          title: assignment.title,
          status: assignment.status,
          dueAt: assignment.dueAt,
        },
        item: {
          id: item.id,
          sortOrder: item.sortOrder,
          contentVersionId: item.contentVersionId,
        },
        contentVersion: {
          id: version.id,
          contentItemId: contentItem.id,
          contentType: contentItem.contentType,
          versionNumber: version.versionNumber,
          title: version.title,
          summary: version.summary,
          locale: version.locale,
        },
        totalItemsInAssignment: items.length,
      };
    },

    async loadStudentAttemptReadOnly(params) {
      const attempt = store.activityAttempts.get(params.attemptId);
      if (
        !attempt ||
        attempt.organizationId !== params.organizationId ||
        attempt.studentMembershipId !== params.studentMembershipId
      ) {
        return null;
      }
      return this.lockTargetAndLoadStudentAttempt(
        {
          organizationId: params.organizationId,
          studentMembershipId: params.studentMembershipId,
          targetId: attempt.assignmentTargetId,
          attemptId: attempt.id,
        },
        {} as never
      );
    },

    async updateAttemptStatus(params) {
      const existing = store.activityAttempts.get(params.attemptId)!;
      const updated: ActivityAttemptRecord = {
        ...existing,
        status: params.status,
        completedAt: params.completedAt,
        lastInteractedAt: params.lastInteractedAt,
        durationSeconds: params.durationSeconds,
        usedAacSupport: params.usedAacSupport,
        usedReadAloud: params.usedReadAloud,
        aacTapCount: params.aacTapCount,
        readAloudCount: params.readAloudCount,
        responseSummaryJson:
          params.responseSummaryJson !== undefined
            ? params.responseSummaryJson
            : existing.responseSummaryJson,
        inProgressTargetGuard: null,
        inProgressItemGuard: null,
      };
      store.activityAttempts.set(updated.id, updated);
      return updated;
    },

    async findAssignmentProgressByTarget(params) {
      for (const p of store.assignmentProgress.values()) {
        if (
          p.organizationId === params.organizationId &&
          p.assignmentTargetId === params.assignmentTargetId &&
          p.studentMembershipId === params.studentMembershipId
        ) {
          return p;
        }
      }
      return null;
    },

    async recomputeAndUpsertAssignmentProgress(params) {
      const targetAttempts = Array.from(store.activityAttempts.values()).filter(
        (a) =>
          a.organizationId === params.organizationId &&
          a.assignmentTargetId === params.assignmentTargetId &&
          a.studentMembershipId === params.studentMembershipId
      );

      let existingProgress: AssignmentProgressRecord | null = null;
      for (const p of store.assignmentProgress.values()) {
        if (
          p.organizationId === params.organizationId &&
          p.assignmentTargetId === params.assignmentTargetId
        ) {
          existingProgress = p;
          break;
        }
      }

      const completedItemsSet = new Set<string>();
      let latestInProgress: ActivityAttemptRecord | null = null;
      let latestCompleted: ActivityAttemptRecord | null = null;
      let maxActivity: Date | null = null;

      for (const a of targetAttempts) {
        if (!maxActivity || a.lastInteractedAt > maxActivity) {
          maxActivity = a.lastInteractedAt;
        }
        if (a.status === 'in_progress') {
          if (
            !latestInProgress ||
            a.lastInteractedAt > latestInProgress.lastInteractedAt ||
            (a.lastInteractedAt.getTime() ===
              latestInProgress.lastInteractedAt.getTime() &&
              a.id > latestInProgress.id)
          ) {
            latestInProgress = a;
          }
        } else if (a.status === 'completed') {
          completedItemsSet.add(a.assignmentItemId);
          const aDone = a.completedAt ?? a.lastInteractedAt;
          const prevDone = latestCompleted
            ? (latestCompleted.completedAt ?? latestCompleted.lastInteractedAt)
            : null;
          if (
            !latestCompleted ||
            !prevDone ||
            aDone > prevDone ||
            (aDone.getTime() === prevDone.getTime() && a.id > latestCompleted.id)
          ) {
            latestCompleted = a;
          }
        }
      }

      const attemptCount = targetAttempts.length;
      const completedItems = completedItemsSet.size;
      const activeAttemptId = latestInProgress ? latestInProgress.id : null;
      const latestCompletedAttemptId = latestCompleted
        ? latestCompleted.id
        : null;

      let status: ProgressStatus = 'not_started';
      if (params.totalItems > 0 && completedItems >= params.totalItems) {
        status = 'completed';
      } else if (
        activeAttemptId !== null ||
        completedItems > 0 ||
        attemptCount > 0
      ) {
        status = 'in_progress';
      }

      const completedAt =
        status === 'completed'
          ? (existingProgress?.completedAt ??
            latestCompleted?.completedAt ??
            params.now)
          : null;

      const row: AssignmentProgressRecord = {
        id: existingProgress?.id ?? generateUuidV7(),
        organizationId: params.organizationId,
        assignmentTargetId: params.assignmentTargetId,
        studentMembershipId: params.studentMembershipId,
        activeAttemptId,
        latestCompletedAttemptId,
        totalItems: params.totalItems,
        completedItems,
        attemptCount,
        status,
        lastActivityAt:
          maxActivity ??
          existingProgress?.lastActivityAt ??
          params.fallbackActivityAt,
        completedAt,
        updatedAt: params.now,
      };
      store.assignmentProgress.set(row.id, row);
      return row;
    },

    async findTeacherAssignmentAccess(params) {
      const a = store.assignments.get(params.assignmentId);
      if (!a || a.organizationId !== params.organizationId) {
        return null;
      }
      const cls = store.classes.get(a.classId);
      if (!cls) {
        return null;
      }
      const assigned = store.classTeachers.some(
        (ct) =>
          ct.organizationId === params.organizationId &&
          ct.classId === a.classId &&
          ct.teacherMembershipId === params.teacherMembershipId
      );
      return {
        assignment: {
          id: a.id,
          organizationId: a.organizationId,
          classId: a.classId,
          className: cls.name,
          createdByTeacherMembershipId: a.createdByTeacherMembershipId,
          title: a.title,
          status: a.status,
          dueAt: a.dueAt,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
        },
        isTeacherAssigned: assigned,
      };
    },

    async listAttemptsForTeacherAssignment(params) {
      const filtered = Array.from(store.activityAttempts.values())
        .filter((a) => {
          if (
            a.organizationId !== params.organizationId ||
            a.assignmentId !== params.assignmentId
          ) {
            return false;
          }
          if (
            params.studentMembershipId &&
            a.studentMembershipId !== params.studentMembershipId
          ) {
            return false;
          }
          if (
            params.assignmentItemId &&
            a.assignmentItemId !== params.assignmentItemId
          ) {
            return false;
          }
          if (params.status && a.status !== params.status) {
            return false;
          }
          return true;
        })
        .sort(
          (a, b) =>
            b.lastInteractedAt.getTime() - a.lastInteractedAt.getTime() ||
            b.id.localeCompare(a.id)
        );

      const offset = (params.page - 1) * params.limit;
      const sliced = filtered.slice(offset, offset + params.limit);

      return {
        items: sliced.map((a) => {
          const m = store.memberships.get(a.studentMembershipId)!;
          const u = store.users.get(m.userId)!;
          const item = store.assignmentItems.find(
            (i) => i.id === a.assignmentItemId
          )!;
          const cv = store.contentVersions.get(a.contentVersionId)!;
          const ci = store.contentItems.get(cv.contentItemId)!;
          const turnCount = Array.from(store.activityAttemptTurns.values()).filter(
            (t) => t.attemptId === a.id
          ).length;
          return {
            attempt: a,
            studentDisplayName: u.displayName,
            studentOrgUsername: m.orgUsername,
            assignmentItemSortOrder: item.sortOrder,
            contentItemId: ci.id,
            contentType: ci.contentType,
            contentVersionNumber: cv.versionNumber,
            contentTitle: cv.title,
            turnCount,
          };
        }),
        total: filtered.length,
      };
    },

    async findAttemptDetailForTeacher(params) {
      const a = store.activityAttempts.get(params.attemptId);
      if (
        !a ||
        a.organizationId !== params.organizationId ||
        a.assignmentId !== params.assignmentId
      ) {
        return null;
      }
      const m = store.memberships.get(a.studentMembershipId)!;
      const u = store.users.get(m.userId)!;
      const item = store.assignmentItems.find(
        (i) => i.id === a.assignmentItemId
      )!;
      const cv = store.contentVersions.get(a.contentVersionId)!;
      const ci = store.contentItems.get(cv.contentItemId)!;
      const turnCount = Array.from(store.activityAttemptTurns.values()).filter(
        (t) => t.attemptId === a.id
      ).length;
      return {
        attempt: a,
        studentDisplayName: u.displayName,
        studentOrgUsername: m.orgUsername,
        assignmentItemSortOrder: item.sortOrder,
        contentItemId: ci.id,
        contentType: ci.contentType,
        contentVersionNumber: cv.versionNumber,
        contentTitle: cv.title,
        turnCount,
      };
    },
  };
}

function createFakeAssignmentRepo(store: InMemoryP206Store): AssignmentRepository {
  return {
    async withTransaction(fn) {
      return fn({} as never);
    },
    async findClassByIdInOrg(organizationId, classId): Promise<AssignmentClassRecord | null> {
      const c = store.classes.get(classId);
      if (!c || c.organizationId !== organizationId) return null;
      return c;
    },
    async isTeacherAssignedToClassInOrg(organizationId, classId, teacherMembershipId) {
      return store.classTeachers.some(
        (ct) =>
          ct.organizationId === organizationId &&
          ct.classId === classId &&
          ct.teacherMembershipId === teacherMembershipId
      );
    },
    async findEligibleStudentsInClass() {
      return [];
    },
    async findContentVersionsForPinning() {
      return [];
    },
    async createAssignmentWithItemsAndTargets() {},
    async listAssignmentsForTeacherClasses() {
      return { items: [], total: 0 };
    },
    async findAssignmentByIdInOrg(organizationId, assignmentId) {
      const a = store.assignments.get(assignmentId);
      if (!a || a.organizationId !== organizationId) return null;
      const cls = store.classes.get(a.classId);
      if (!cls) return null;
      return { ...a, className: cls.name };
    },
    async findAssignmentByIdInOrgForUpdate() {
      return null;
    },
    async listAssignmentItemsWithPinnedContent(organizationId, assignmentId) {
      return store.assignmentItems
        .filter(
          (i) => i.organizationId === organizationId && i.assignmentId === assignmentId
        )
        .map((i) => {
          const cv = store.contentVersions.get(i.contentVersionId)!;
          const ci = store.contentItems.get(cv.contentItemId)!;
          return {
            id: i.id,
            organizationId: i.organizationId,
            assignmentId: i.assignmentId,
            contentVersionId: i.contentVersionId,
            sortOrder: i.sortOrder,
            createdAt: i.createdAt,
            contentItemId: ci.id,
            slug: ci.slug,
            contentType: ci.contentType,
            versionNumber: cv.versionNumber,
            versionStatus: cv.status,
            title: cv.title,
            summary: cv.summary,
            locale: cv.locale,
            payloadJson: cv.payloadJson,
            metadataJson: cv.metadataJson,
            publishedAt: cv.publishedAt,
          };
        });
    },
    async listAssignmentTargetsWithStudents() {
      return [];
    },
    async updateAssignmentFields() {
      return null;
    },
    async findTargetIdsWithActivity() {
      return [];
    },
    async syncAssignmentTargets() {},
    async listAssignmentProgressSummary(organizationId, assignmentId, itemCount) {
      return store.assignmentTargets
        .filter(
          (t) => t.organizationId === organizationId && t.assignmentId === assignmentId
        )
        .map((t) => {
          const m = store.memberships.get(t.studentMembershipId)!;
          const u = store.users.get(m.userId)!;
          const p = Array.from(store.assignmentProgress.values()).find(
            (row) =>
              row.organizationId === organizationId &&
              row.assignmentTargetId === t.id
          );
          return {
            assignmentTargetId: t.id,
            studentMembershipId: t.studentMembershipId,
            displayName: u.displayName,
            orgUsername: m.orgUsername,
            hasProgressRecord: Boolean(p),
            status: p?.status ?? 'not_started',
            totalItems: p?.totalItems ?? itemCount,
            completedItems: p?.completedItems ?? 0,
            attemptCount: p?.attemptCount ?? 0,
            lastActivityAt: p?.lastActivityAt ?? null,
            completedAt: p?.completedAt ?? null,
          };
        });
    },
    async listAssignmentsForStudent() {
      return { items: [], total: 0 };
    },
    async findAssignmentForStudentById() {
      return null;
    },
  };
}

function createFakeAuthRepo(store: InMemoryP206Store): AuthRepository {
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
    async findMembershipsForUser() {
      return [];
    },
    async createSession() {},
    async findSessionWithContextByTokenHash(tokenHash) {
      const s = Array.from(store.sessions.values()).find(
        (x) => x.tokenHash === tokenHash
      );
      if (!s) return null;
      const u = store.users.get(s.userId);
      if (!u) return null;

      let activeOrganization: SessionWithContextRecord['activeOrganization'] =
        null;
      let activeMembership: SessionWithContextRecord['activeMembership'] =
        null;
      if (s.activeOrganizationId) {
        const org = store.organizations.get(s.activeOrganizationId);
        if (org) {
          activeOrganization = { ...org };
        }
        const m = Array.from(store.memberships.values()).find(
          (x) =>
            x.userId === u.id && x.organizationId === s.activeOrganizationId
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
    async touchSessionActivity(sessionId, now, nextIdleExpiresAt) {
      const s = store.sessions.get(sessionId);
      if (s) {
        s.lastActivityAt = now;
        s.idleExpiresAt = nextIdleExpiresAt;
      }
    },
    async rotateSession() {
      return true;
    },
    async revokeSessionById(sessionId, reason, now) {
      const s = store.sessions.get(sessionId);
      if (s) {
        s.revokedAt = now;
        s.revokedReason = reason;
      }
    },
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

function seedFixture(store: InMemoryP206Store) {
  const now = new Date('2026-11-17T10:00:00.000Z');
  const org1Id = generateUuidV7();
  const org2Id = generateUuidV7();
  store.organizations.set(org1Id, {
    id: org1Id,
    code: 'TRUONG-A',
    name: 'Trường A',
    status: 'active',
  });
  store.organizations.set(org2Id, {
    id: org2Id,
    code: 'TRUONG-B',
    name: 'Trường B',
    status: 'active',
  });

  const adminUserId = generateUuidV7();
  const t1UserId = generateUuidV7();
  const t2UserId = generateUuidV7();
  const tUnassignedUserId = generateUuidV7();
  const tOrg2UserId = generateUuidV7();
  const s1UserId = generateUuidV7();
  const s2UserId = generateUuidV7();
  const sOrg2UserId = generateUuidV7();

  store.users.set(adminUserId, {
    id: adminUserId,
    email: 'admin@mimora.local',
    platformUsername: 'sysadmin',
    platformRole: 'platform_admin',
    displayName: 'Platform Admin',
    status: 'active',
  });
  for (const [id, name] of [
    [t1UserId, 'Cô Lan'],
    [t2UserId, 'Thầy Minh (Co-teacher)'],
    [tUnassignedUserId, 'Cô Hoa (Khác lớp)'],
    [tOrg2UserId, 'Thầy Nam (Org2)'],
    [s1UserId, 'Bé An'],
    [s2UserId, 'Bé Bình'],
    [sOrg2UserId, 'Bé Chi (Org2)'],
  ] as const) {
    store.users.set(id, {
      id,
      email: null,
      platformUsername: null,
      platformRole: null,
      displayName: name,
      status: 'active',
    });
  }

  const t1MemId = generateUuidV7();
  const t2MemId = generateUuidV7();
  const tUnassignedMemId = generateUuidV7();
  const tOrg2MemId = generateUuidV7();
  const s1MemId = generateUuidV7();
  const s2MemId = generateUuidV7();
  const sOrg2MemId = generateUuidV7();

  store.memberships.set(t1MemId, {
    id: t1MemId,
    organizationId: org1Id,
    userId: t1UserId,
    role: 'teacher',
    orgUsername: 'co.lan',
    status: 'active',
  });
  store.memberships.set(t2MemId, {
    id: t2MemId,
    organizationId: org1Id,
    userId: t2UserId,
    role: 'teacher',
    orgUsername: 'thay.minh',
    status: 'active',
  });
  store.memberships.set(tUnassignedMemId, {
    id: tUnassignedMemId,
    organizationId: org1Id,
    userId: tUnassignedUserId,
    role: 'teacher',
    orgUsername: 'co.hoa',
    status: 'active',
  });
  store.memberships.set(tOrg2MemId, {
    id: tOrg2MemId,
    organizationId: org2Id,
    userId: tOrg2UserId,
    role: 'teacher',
    orgUsername: 'thay.nam',
    status: 'active',
  });
  store.memberships.set(s1MemId, {
    id: s1MemId,
    organizationId: org1Id,
    userId: s1UserId,
    role: 'student',
    orgUsername: 'be.an',
    status: 'active',
  });
  store.memberships.set(s2MemId, {
    id: s2MemId,
    organizationId: org1Id,
    userId: s2UserId,
    role: 'student',
    orgUsername: 'be.binh',
    status: 'active',
  });
  store.memberships.set(sOrg2MemId, {
    id: sOrg2MemId,
    organizationId: org2Id,
    userId: sOrg2UserId,
    role: 'student',
    orgUsername: 'be.chi',
    status: 'active',
  });

  const classId = generateUuidV7();
  store.classes.set(classId, {
    id: classId,
    organizationId: org1Id,
    name: 'Lớp SEL 1A',
    academicYear: '2026-2027',
    status: 'active',
  });
  store.classTeachers.push(
    { organizationId: org1Id, classId, teacherMembershipId: t1MemId },
    { organizationId: org1Id, classId, teacherMembershipId: t2MemId }
  );
  store.classEnrollments.push(
    {
      organizationId: org1Id,
      classId,
      studentMembershipId: s1MemId,
      status: 'active',
    },
    {
      organizationId: org1Id,
      classId,
      studentMembershipId: s2MemId,
      status: 'active',
    }
  );

  const ci1Id = generateUuidV7();
  const cv1Id = generateUuidV7();
  const ci2Id = generateUuidV7();
  const cv2Id = generateUuidV7();

  store.contentItems.set(ci1Id, {
    id: ci1Id,
    slug: 'nhan-dien-niem-vui',
    contentType: 'emotion_card',
    currentPublishedVersionId: cv1Id,
    isArchived: false,
  });
  store.contentVersions.set(cv1Id, {
    id: cv1Id,
    contentItemId: ci1Id,
    versionNumber: 1,
    status: 'published',
    title: 'Nhận diện niềm vui',
    summary: 'Nhận diện cảm xúc vui vẻ qua tình huống',
    locale: 'vi-VN',
    payloadJson: { prompt: 'Bạn nhỏ cảm thấy thế nào?' },
    metadataJson: null,
    publishedAt: now,
  });

  store.contentItems.set(ci2Id, {
    id: ci2Id,
    slug: 'tinh-huong-chia-se',
    contentType: 'situation_card',
    currentPublishedVersionId: cv2Id,
    isArchived: false,
  });
  store.contentVersions.set(cv2Id, {
    id: cv2Id,
    contentItemId: ci2Id,
    versionNumber: 1,
    status: 'published',
    title: 'Tình huống chia sẻ đồ chơi',
    summary: 'Khám phá lựa chọn ứng xử cùng bạn bè',
    locale: 'vi-VN',
    payloadJson: { scenario: 'Bạn muốn mượn bút màu.' },
    metadataJson: null,
    publishedAt: now,
  });

  const assignmentId = generateUuidV7();
  const item1Id = generateUuidV7();
  const item2Id = generateUuidV7();
  const targetS1Id = generateUuidV7();
  const targetS2Id = generateUuidV7();

  store.assignments.set(assignmentId, {
    id: assignmentId,
    organizationId: org1Id,
    classId,
    createdByTeacherMembershipId: t1MemId,
    title: 'Bài tập Tuần 1 — Cảm xúc & Chia sẻ',
    homePracticeInstructions: 'Cùng con trò chuyện nhẹ nhàng ở nhà.',
    dueAt: null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  store.assignmentItems.push(
    {
      id: item1Id,
      organizationId: org1Id,
      assignmentId,
      contentVersionId: cv1Id,
      sortOrder: 0,
      createdAt: now,
    },
    {
      id: item2Id,
      organizationId: org1Id,
      assignmentId,
      contentVersionId: cv2Id,
      sortOrder: 1,
      createdAt: now,
    }
  );
  store.assignmentTargets.push(
    {
      id: targetS1Id,
      organizationId: org1Id,
      assignmentId,
      studentMembershipId: s1MemId,
      assignedAt: now,
    },
    {
      id: targetS2Id,
      organizationId: org1Id,
      assignmentId,
      studentMembershipId: s2MemId,
      assignedAt: now,
    }
  );

  return {
    org1Id,
    org2Id,
    adminUserId,
    t1UserId,
    t2UserId,
    tUnassignedUserId,
    tOrg2UserId,
    s1UserId,
    s2UserId,
    sOrg2UserId,
    t1MemId,
    t2MemId,
    tUnassignedMemId,
    tOrg2MemId,
    s1MemId,
    s2MemId,
    sOrg2MemId,
    classId,
    cv1Id,
    cv2Id,
    assignmentId,
    item1Id,
    item2Id,
    targetS1Id,
    targetS2Id,
  };
}

function issueTestSession(
  store: InMemoryP206Store,
  params: {
    userId: string;
    sessionScope: 'platform_admin' | 'teacher' | 'student';
    activeOrganizationId: string | null;
    now?: Date;
  }
) {
  const now = params.now ?? new Date();
  const rawToken = generateSessionToken();
  const sessionId = generateUuidV7();
  store.sessions.set(sessionId, {
    id: sessionId,
    tokenHash: hashSessionToken(rawToken),
    userId: params.userId,
    sessionScope: params.sessionScope,
    activeOrganizationId: params.activeOrganizationId,
    idleExpiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    absoluteExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    lastActivityAt: now,
    revokedAt: null,
    revokedReason: null,
  });
  return { sessionId, rawToken };
}

test('P2-06 AttemptService: lifecycle, idempotency, retry without double-count, deliberate abandon, closed boundary, SEL safety', async () => {
  const store = createFakeStore();
  const fx = seedFixture(store);
  let clockMs = Date.parse('2026-11-17T10:05:00.000Z');
  const service = createAttemptService({
    repo: createFakeAttemptRepo(store),
    now: () => {
      clockMs += 1000;
      return new Date(clockMs);
    },
    auditFn: async (entry) => {
      store.audits.push(entry);
      return {};
    },
  });

  const s1Actor = {
    actorUserId: fx.s1UserId,
    organizationId: fx.org1Id,
    studentMembershipId: fx.s1MemId,
    ipPrefix: '127.0.0.0/24',
  };

  // 1. Version mismatch check
  await assert.rejects(
    () =>
      service.startOrResumeAttempt(
        {
          targetId: fx.targetS1Id,
          itemId: fx.item1Id,
          expectedContentVersionId: fx.cv2Id,
        },
        s1Actor
      ),
    (err: unknown) =>
      err instanceof AppError &&
      err.httpStatus === 409 &&
      err.code === 'PINNED_CONTENT_VERSION_MISMATCH'
  );

  // 2. Start item 1 cleanly without any support metadata (neutral)
  const started = await service.startOrResumeAttempt(
    {
      targetId: fx.targetS1Id,
      itemId: fx.item1Id,
      idempotencyKey: 'start-item1-k1',
    },
    s1Actor
  );
  assert.equal(started.httpStatus, 201);
  assert.equal(started.action, 'started');
  assert.equal(started.attempt.attemptNumber, 1);
  assert.equal(started.attempt.state, 'in_progress');
  assert.equal(started.attempt.supportContext.usedAacSupport, false);
  assert.equal(started.attempt.supportContext.usedReadAloud, false);
  assert.equal(started.attempt.progress.status, 'in_progress');
  assert.equal(started.attempt.progress.totalItems, 2);
  assert.equal(started.attempt.progress.completedItems, 0);
  assert.equal(started.attempt.progress.attemptCount, 1);
  assert.equal(
    started.attempt.progress.activeAttemptId,
    started.attempt.attemptId
  );

  // 3. Repeated start-or-resume (both with same key and without key) resumes exact attempt
  const replayedByKey = await service.startOrResumeAttempt(
    {
      targetId: fx.targetS1Id,
      itemId: fx.item1Id,
      idempotencyKey: 'start-item1-k1',
    },
    s1Actor
  );
  assert.equal(replayedByKey.httpStatus, 200);
  assert.equal(replayedByKey.action, 'idempotent_replay');
  assert.equal(replayedByKey.attempt.attemptId, started.attempt.attemptId);

  const resumed = await service.startOrResumeAttempt(
    {
      targetId: fx.targetS1Id,
      itemId: fx.item1Id,
    },
    s1Actor
  );
  assert.equal(resumed.httpStatus, 200);
  assert.equal(resumed.action, 'resumed');
  assert.equal(resumed.attempt.attemptId, started.attempt.attemptId);

  // 4. Retry rejected while in_progress exists
  await assert.rejects(
    () =>
      service.startOrResumeAttempt(
        {
          targetId: fx.targetS1Id,
          itemId: fx.item1Id,
          intent: 'retry',
          idempotencyKey: 'retry-while-active',
        },
        s1Actor
      ),
    (err: unknown) =>
      err instanceof AppError &&
      err.httpStatus === 409 &&
      err.code === 'ATTEMPT_ALREADY_IN_PROGRESS'
  );

  // 5. Reject unsafe/gamified/credential turn payload
  await assert.rejects(
    () =>
      service.saveTurn(
        {
          attemptId: started.attempt.attemptId,
          turnIndex: 0,
          stepKey: 'emotion_pick',
          selectedEmotionKey: 'vui_ve',
          responsePayloadJson: { isCorrect: true },
        },
        s1Actor
      ),
    (err: unknown) =>
      err instanceof AppError && err.httpStatus === 422
  );

  // 6. Save ordered turns + optional AAC/read-aloud + idempotent replay + conflict check
  const turn0 = await service.saveTurn(
    {
      attemptId: started.attempt.attemptId,
      turnIndex: 0,
      stepKey: 'intro_story',
      usedReadAloud: true,
      readAloudDelta: 1,
      durationSeconds: 12,
      responsePayloadJson: { note: 'nghe hướng dẫn chậm' },
    },
    s1Actor
  );
  assert.equal(turn0.httpStatus, 201);
  assert.equal(turn0.idempotentReplay, false);
  assert.equal(turn0.attempt.supportContext.usedReadAloud, true);
  assert.equal(turn0.attempt.supportContext.readAloudCount, 1);

  const turn0Replay = await service.saveTurn(
    {
      attemptId: started.attempt.attemptId,
      turnIndex: 0,
      stepKey: 'intro_story',
      usedReadAloud: true,
      readAloudDelta: 1,
      durationSeconds: 12,
      responsePayloadJson: { note: 'nghe hướng dẫn chậm' },
    },
    s1Actor
  );
  assert.equal(turn0Replay.httpStatus, 200);
  assert.equal(turn0Replay.idempotentReplay, true);
  assert.equal(turn0Replay.savedTurn.id, turn0.savedTurn.id);
  // Count did NOT double increment on replay
  assert.equal(turn0Replay.attempt.supportContext.readAloudCount, 1);

  // Conflict when turnIndex 0 has different content
  await assert.rejects(
    () =>
      service.saveTurn(
        {
          attemptId: started.attempt.attemptId,
          turnIndex: 0,
          stepKey: 'intro_story_modified',
        },
        s1Actor
      ),
    (err: unknown) =>
      err instanceof AppError &&
      err.httpStatus === 409 &&
      err.code === 'TURN_INDEX_CONFLICT'
  );

  const turn1 = await service.saveTurn(
    {
      attemptId: started.attempt.attemptId,
      turnIndex: 1,
      stepKey: 'emotion_pick',
      selectedEmotionKey: 'vui_ve',
      selectedChoiceKey: 'chia_se_cung_ban',
      usedAac: true,
      aacTapDelta: 2,
      durationSeconds: 30,
    },
    s1Actor
  );
  assert.equal(turn1.httpStatus, 201);
  assert.equal(turn1.attempt.resumePosition.savedTurnCount, 2);
  assert.equal(turn1.attempt.resumePosition.nextTurnIndex, 2);
  assert.equal(turn1.attempt.supportContext.usedAacSupport, true);
  assert.equal(turn1.attempt.supportContext.aacTapCount, 2);

  // 7. Complete item 1 attempt #1 + idempotent re-complete
  const completed1 = await service.completeAttempt(
    {
      attemptId: started.attempt.attemptId,
      durationSeconds: 35,
    },
    s1Actor
  );
  assert.equal(completed1.idempotentReplay, false);
  assert.equal(completed1.attempt.state, 'completed');
  assert.ok(completed1.attempt.completedAt);
  assert.equal(completed1.attempt.progress.completedItems, 1);
  assert.equal(completed1.attempt.progress.totalItems, 2);
  assert.equal(completed1.attempt.progress.status, 'in_progress');
  assert.equal(completed1.attempt.progress.activeAttemptId, null);
  assert.equal(
    completed1.attempt.progress.latestCompletedAttemptId,
    started.attempt.attemptId
  );

  const completed1Replay = await service.completeAttempt(
    { attemptId: started.attempt.attemptId },
    s1Actor
  );
  assert.equal(completed1Replay.idempotentReplay, true);

  // Abandoning an already-completed attempt is 409
  await assert.rejects(
    () =>
      service.abandonAttempt(
        { attemptId: started.attempt.attemptId },
        s1Actor
      ),
    (err: unknown) =>
      err instanceof AppError &&
      err.httpStatus === 409 &&
      err.code === 'INVALID_ATTEMPT_STATE'
  );

  // 8. Start-or-resume after completion WITHOUT retry intent is rejected cleanly
  await assert.rejects(
    () =>
      service.startOrResumeAttempt(
        { targetId: fx.targetS1Id, itemId: fx.item1Id },
        s1Actor
      ),
    (err: unknown) =>
      err instanceof AppError &&
      err.httpStatus === 409 &&
      err.code === 'RETRY_INTENT_REQUIRED'
  );

  // 9. Complete item 2 so target reaches completedItems = 2/2 -> status = 'completed'
  const item2Attempt = await service.startOrResumeAttempt(
    { targetId: fx.targetS1Id, itemId: fx.item2Id },
    s1Actor
  );
  assert.equal(item2Attempt.httpStatus, 201);
  const item2Completed = await service.completeAttempt(
    { attemptId: item2Attempt.attempt.attemptId },
    s1Actor
  );
  assert.equal(item2Completed.attempt.progress.completedItems, 2);
  assert.equal(item2Completed.attempt.progress.status, 'completed');
  assert.ok(item2Completed.attempt.progress.completedAt);
  const initialAssignmentCompletedAt =
    item2Completed.attempt.progress.completedAt;

  // 10. Explicit retry on item 1 does NOT double-count completedItems or lose completed status
  const item1Retry = await service.startOrResumeAttempt(
    {
      targetId: fx.targetS1Id,
      itemId: fx.item1Id,
      intent: 'retry',
      idempotencyKey: 'retry-item1-k1',
    },
    s1Actor
  );
  assert.equal(item1Retry.httpStatus, 201);
  assert.equal(item1Retry.action, 'retried');
  assert.equal(item1Retry.attempt.attemptNumber, 2);
  assert.equal(item1Retry.attempt.progress.attemptCount, 3);
  assert.equal(item1Retry.attempt.progress.completedItems, 2);
  assert.equal(item1Retry.attempt.progress.status, 'completed');
  assert.equal(
    item1Retry.attempt.progress.completedAt,
    initialAssignmentCompletedAt
  );
  assert.equal(
    item1Retry.attempt.progress.activeAttemptId,
    item1Retry.attempt.attemptId
  );

  // 11. Save a turn on retry attempt, then deliberately abandon it
  await service.saveTurn(
    {
      attemptId: item1Retry.attempt.attemptId,
      turnIndex: 0,
      stepKey: 'retry_step_0',
      selectedChoiceKey: 'chon_1',
    },
    s1Actor
  );

  await assert.rejects(
    () =>
      service.abandonAttempt(
        { attemptId: item1Retry.attempt.attemptId, confirmed: false },
        s1Actor
      ),
    (err: unknown) => err instanceof AppError && err.httpStatus === 422
  );

  const abandoned = await service.abandonAttempt(
    { attemptId: item1Retry.attempt.attemptId },
    s1Actor
  );
  assert.equal(abandoned.idempotentReplay, false);
  assert.equal(abandoned.attempt.state, 'abandoned');
  assert.equal(abandoned.attempt.turns.length, 1);
  assert.equal(abandoned.attempt.progress.activeAttemptId, null);
  assert.equal(abandoned.attempt.progress.completedItems, 2);

  const abandonedReplay = await service.abandonAttempt(
    { attemptId: item1Retry.attempt.attemptId },
    s1Actor
  );
  assert.equal(abandonedReplay.idempotentReplay, true);

  await assert.rejects(
    () =>
      service.completeAttempt(
        { attemptId: item1Retry.attempt.attemptId },
        s1Actor
      ),
    (err: unknown) =>
      err instanceof AppError &&
      err.httpStatus === 409 &&
      err.code === 'INVALID_ATTEMPT_STATE'
  );

  // 12. Closed-assignment boundary: start an unfinished attempt, close assignment, verify preserved read-only
  const s2Actor = {
    actorUserId: fx.s2UserId,
    organizationId: fx.org1Id,
    studentMembershipId: fx.s2MemId,
    ipPrefix: '127.0.0.0/24',
  };
  const s2Start = await service.startOrResumeAttempt(
    { targetId: fx.targetS2Id, itemId: fx.item1Id },
    s2Actor
  );
  await service.saveTurn(
    {
      attemptId: s2Start.attempt.attemptId,
      turnIndex: 0,
      stepKey: 'saved_before_close',
      selectedEmotionKey: 'binh_yen',
    },
    s2Actor
  );

  const assignmentRec = store.assignments.get(fx.assignmentId)!;
  assignmentRec.status = 'closed';

  // Existing unfinished attempt is NOT auto-abandoned; GET still succeeds read-only
  const s2ReadAfterClose = await service.getStudentAttempt(
    s2Start.attempt.attemptId,
    s2Actor
  );
  assert.equal(s2ReadAfterClose.state, 'in_progress');
  assert.equal(s2ReadAfterClose.assignmentStatus, 'closed');
  assert.equal(s2ReadAfterClose.isReadOnly, true);
  assert.equal(s2ReadAfterClose.turns.length, 1);
  assert.equal(s2ReadAfterClose.availableActions.canSubmitTurn, false);
  assert.equal(s2ReadAfterClose.availableActions.canComplete, false);
  assert.equal(s2ReadAfterClose.availableActions.canAbandon, false);
  assert.equal(s2ReadAfterClose.availableActions.canRetry, false);

  // Mutations on closed assignment fail cleanly with 409 ASSIGNMENT_CLOSED
  for (const fn of [
    () =>
      service.startOrResumeAttempt(
        { targetId: fx.targetS2Id, itemId: fx.item1Id },
        s2Actor
      ),
    () =>
      service.saveTurn(
        {
          attemptId: s2Start.attempt.attemptId,
          turnIndex: 1,
          stepKey: 'after_close',
        },
        s2Actor
      ),
    () =>
      service.completeAttempt(
        { attemptId: s2Start.attempt.attemptId },
        s2Actor
      ),
    () =>
      service.abandonAttempt(
        { attemptId: s2Start.attempt.attemptId },
        s2Actor
      ),
  ]) {
    await assert.rejects(
      fn,
      (err: unknown) =>
        err instanceof AppError &&
        err.httpStatus === 409 &&
        err.code === 'ASSIGNMENT_CLOSED'
    );
  }
});

test('P2-06 HTTP routes: session recovery after expiry, Student/Teacher/Co-teacher/Admin boundaries, CSRF, 405 Allow, audit safety', async () => {
  const store = createFakeStore();
  const fx = seedFixture(store);

  const attemptService = createAttemptService({
    repo: createFakeAttemptRepo(store),
    auditFn: async (entry) => {
      store.audits.push(entry);
      return {};
    },
  });
  const assignmentService = createAssignmentService({
    repo: createFakeAssignmentRepo(store),
    auditFn: async (entry) => {
      store.audits.push(entry);
      return {};
    },
  });

  const serverConfigBase: ServerConfig = parseServerConfig({
    NODE_ENV: 'test',
    SESSION_COOKIE_NAME: 'mimora_session',
    CSRF_SECRET: 'p2-06-test-csrf-secret-value-at-least-32-chars',
    TRUSTED_ORIGINS: 'http://127.0.0.1',
  });

  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const configWithPort: ServerConfig = {
    ...serverConfigBase,
    auth: {
      ...serverConfigBase.auth,
      trustedOrigins: [baseUrl],
    },
  };

  const authMiddlewares = createAuthMiddlewareSuite({
    repo: createFakeAuthRepo(store),
    getConfig: () => configWithPort,
    auditExecutor: {
      insert: (() => ({
        values: async () => undefined,
      })) as never,
    },
  });
  const authenticatedCsrf = createAuthenticatedCsrfMiddleware({
    config: configWithPort,
    auditExecutor: {
      insert: (() => ({
        values: async () => undefined,
      })) as never,
    },
  });

  const { teacherAssignmentsRouter, studentAssignmentsRouter } =
    createAssignmentsRouters({
      assignmentService,
      authMiddlewares,
      authenticatedCsrf,
    });
  const { studentAttemptsRouter, teacherAssignmentAttemptsRouter } =
    createAttemptsRouters({
      attemptService,
      authMiddlewares,
      authenticatedCsrf,
    });

  app.use('/api/v1/assignments', teacherAssignmentsRouter);
  app.use('/api/v1/assignments', teacherAssignmentAttemptsRouter);
  app.use('/api/v1/student/assignments', studentAssignmentsRouter);
  app.use('/api/v1/student', studentAttemptsRouter);
  app.use('/api', apiNotFoundHandler);
  app.use('/api', apiErrorHandler);

  const s1SessionA = issueTestSession(store, {
    userId: fx.s1UserId,
    sessionScope: 'student',
    activeOrganizationId: fx.org1Id,
  });
  const s2Session = issueTestSession(store, {
    userId: fx.s2UserId,
    sessionScope: 'student',
    activeOrganizationId: fx.org1Id,
  });
  const sOrg2Session = issueTestSession(store, {
    userId: fx.sOrg2UserId,
    sessionScope: 'student',
    activeOrganizationId: fx.org2Id,
  });
  const t1Session = issueTestSession(store, {
    userId: fx.t1UserId,
    sessionScope: 'teacher',
    activeOrganizationId: fx.org1Id,
  });
  const t2CoTeacherSession = issueTestSession(store, {
    userId: fx.t2UserId,
    sessionScope: 'teacher',
    activeOrganizationId: fx.org1Id,
  });
  const tUnassignedSession = issueTestSession(store, {
    userId: fx.tUnassignedUserId,
    sessionScope: 'teacher',
    activeOrganizationId: fx.org1Id,
  });
  const tOrg2Session = issueTestSession(store, {
    userId: fx.tOrg2UserId,
    sessionScope: 'teacher',
    activeOrganizationId: fx.org2Id,
  });
  const adminSession = issueTestSession(store, {
    userId: fx.adminUserId,
    sessionScope: 'platform_admin',
    activeOrganizationId: null,
  });

  async function apiCall(
    method: string,
    path: string,
    session?: { sessionId: string; rawToken: string },
    body?: unknown,
    options?: { skipCsrf?: boolean; extraHeaders?: Record<string, string> }
  ) {
    const headers: Record<string, string> = {
      ...(options?.extraHeaders ?? {}),
    };
    if (session) {
      headers.Cookie = `${configWithPort.cookie.name}=${session.rawToken}`;
    }
    if (method !== 'GET' && !options?.skipCsrf && session) {
      headers.Origin = baseUrl;
      headers[CUSTOM_REQUEST_HEADER] = '1';
      headers[CSRF_TOKEN_HEADER] = deriveSessionCsrfToken(
        session.rawToken,
        session.sessionId,
        configWithPort.auth.csrfSecret
      );
    }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    return { status: res.status, headers: res.headers, json };
  }

  try {
    // 1. Unauthenticated + missing CSRF + invalid Idempotency-Key + 405 Allow
    const unauth = await apiCall(
      'POST',
      `/api/v1/student/assignments/${fx.targetS1Id}/items/${fx.item1Id}/start-or-resume`,
      undefined,
      {}
    );
    assert.equal(unauth.status, 401);

    const noCsrf = await apiCall(
      'POST',
      `/api/v1/student/assignments/${fx.targetS1Id}/items/${fx.item1Id}/start-or-resume`,
      s1SessionA,
      {},
      { skipCsrf: true }
    );
    assert.equal(noCsrf.status, 403);

    const badIdemHeader = await apiCall(
      'POST',
      `/api/v1/student/assignments/${fx.targetS1Id}/items/${fx.item1Id}/start-or-resume`,
      s1SessionA,
      {},
      { extraHeaders: { 'Idempotency-Key': 'bad key with spaces!' } }
    );
    assert.equal(badIdemHeader.status, 422);

    const method405 = await apiCall(
      'DELETE',
      `/api/v1/assignments/${fx.assignmentId}/attempts`,
      t1Session
    );
    assert.equal(method405.status, 405);
    assert.equal(method405.headers.get('allow'), 'GET');

    // 2. Student starts attempt & saves turns, then session expires, Student re-logs in & resumes
    const startRes = await apiCall(
      'POST',
      `/api/v1/student/assignments/${fx.targetS1Id}/items/${fx.item1Id}/start-or-resume`,
      s1SessionA,
      { usedReadAloud: true },
      { extraHeaders: { 'Idempotency-Key': 'http-start-1' } }
    );
    assert.equal(startRes.status, 201);
    const attemptId = (startRes.json!.attempt as Record<string, unknown>)
      .attemptId as string;

    const turn0Res = await apiCall(
      'POST',
      `/api/v1/student/attempts/${attemptId}/turns`,
      s1SessionA,
      {
        turnIndex: 0,
        stepKey: 'step_one',
        selectedEmotionKey: 'vui_ve',
        selectedChoiceKey: 'choice_share',
      }
    );
    assert.equal(turn0Res.status, 201);

    const turn1Res = await apiCall(
      'POST',
      `/api/v1/student/attempts/${attemptId}/turns`,
      s1SessionA,
      {
        turnIndex: 1,
        stepKey: 'step_two',
        usedAac: true,
        responsePayloadJson: { feelingNote: 'Em chọn cùng chơi với bạn' },
      }
    );
    assert.equal(turn1Res.status, 201);

    // Expire Student's first session
    const sessA = store.sessions.get(s1SessionA.sessionId)!;
    sessA.idleExpiresAt = new Date(Date.now() - 60_000);

    const expiredCall = await apiCall(
      'GET',
      `/api/v1/student/attempts/${attemptId}`,
      s1SessionA
    );
    assert.equal(expiredCall.status, 401);

    // Confirm attempt was NOT abandoned when session expired
    assert.equal(store.activityAttempts.get(attemptId)?.status, 'in_progress');

    // Issue fresh Student session after re-authentication
    const s1SessionB = issueTestSession(store, {
      userId: fx.s1UserId,
      sessionScope: 'student',
      activeOrganizationId: fx.org1Id,
    });

    const resumedAfterRelogin = await apiCall(
      'POST',
      `/api/v1/student/assignments/${fx.targetS1Id}/items/${fx.item1Id}/start-or-resume`,
      s1SessionB,
      {}
    );
    assert.equal(resumedAfterRelogin.status, 200);
    assert.equal(resumedAfterRelogin.json!.action, 'resumed');
    const resumedAttempt = resumedAfterRelogin.json!.attempt as {
      attemptId: string;
      state: string;
      turns: Array<{ turnIndex: number; stepKey: string }>;
      resumePosition: { nextTurnIndex: number; lastStepKey: string };
    };
    assert.equal(resumedAttempt.attemptId, attemptId);
    assert.equal(resumedAttempt.state, 'in_progress');
    assert.deepEqual(
      resumedAttempt.turns.map((t) => [t.turnIndex, t.stepKey]),
      [
        [0, 'step_one'],
        [1, 'step_two'],
      ]
    );
    assert.equal(resumedAttempt.resumePosition.nextTurnIndex, 2);
    assert.equal(resumedAttempt.resumePosition.lastStepKey, 'step_two');

    // 3. Cross-student & cross-org isolation
    for (const badStudentSess of [s2Session, sOrg2Session]) {
      const getOther = await apiCall(
        'GET',
        `/api/v1/student/attempts/${attemptId}`,
        badStudentSess
      );
      assert.equal(getOther.status, 404);

      const postOtherTurn = await apiCall(
        'POST',
        `/api/v1/student/attempts/${attemptId}/turns`,
        badStudentSess,
        { turnIndex: 2, stepKey: 'intrusion' }
      );
      assert.equal(postOtherTurn.status, 404);
    }

    // 4. Complete attempt via new session
    const completeRes = await apiCall(
      'POST',
      `/api/v1/student/attempts/${attemptId}/complete`,
      s1SessionB,
      { durationSeconds: 45 }
    );
    assert.equal(completeRes.status, 200);

    // 5. Teacher & Co-teacher read-only review + P2-05 progress sync
    for (const teacherSess of [t1Session, t2CoTeacherSession]) {
      const progressRes = await apiCall(
        'GET',
        `/api/v1/assignments/${fx.assignmentId}/progress`,
        teacherSess
      );
      assert.equal(progressRes.status, 200);
      const targets = progressRes.json!.targets as Array<{
        studentMembershipId: string;
        completedItems: number;
        attemptCount: number;
        status: string;
      }>;
      const s1Progress = targets.find(
        (t) => t.studentMembershipId === fx.s1MemId
      )!;
      assert.equal(s1Progress.completedItems, 1);
      assert.equal(s1Progress.attemptCount, 1);
      assert.equal(s1Progress.status, 'in_progress');

      const attemptsListRes = await apiCall(
        'GET',
        `/api/v1/assignments/${fx.assignmentId}/attempts`,
        teacherSess
      );
      assert.equal(attemptsListRes.status, 200);
      assert.equal(attemptsListRes.json!.total, 1);

      const attemptDetailRes = await apiCall(
        'GET',
        `/api/v1/assignments/${fx.assignmentId}/attempts/${attemptId}`,
        teacherSess
      );
      assert.equal(attemptDetailRes.status, 200);
      const detailAttempt = attemptDetailRes.json!.attempt as {
        turns: Array<{ turnIndex: number }>;
        supportContext: { contextNote: string };
      };
      assert.equal(detailAttempt.turns.length, 2);
      assert.ok(detailAttempt.supportContext.contextNote.includes('hỗ trợ'));
    }

    // Unassigned same-org teacher -> 403; Cross-org teacher -> 404
    const unassignedRes = await apiCall(
      'GET',
      `/api/v1/assignments/${fx.assignmentId}/attempts/${attemptId}`,
      tUnassignedSession
    );
    assert.equal(unassignedRes.status, 403);

    const crossOrgTeacherRes = await apiCall(
      'GET',
      `/api/v1/assignments/${fx.assignmentId}/attempts`,
      tOrg2Session
    );
    assert.equal(crossOrgTeacherRes.status, 404);

    // Teacher cannot mutate student attempt
    const teacherMutateRes = await apiCall(
      'POST',
      `/api/v1/student/attempts/${attemptId}/complete`,
      t1Session,
      {}
    );
    assert.equal(teacherMutateRes.status, 403);

    // Platform Admin explicitly denied across student attempts, teacher attempts, and progress
    for (const adminCall of [
      () =>
        apiCall(
          'GET',
          `/api/v1/assignments/${fx.assignmentId}/attempts`,
          adminSession
        ),
      () =>
        apiCall(
          'GET',
          `/api/v1/assignments/${fx.assignmentId}/attempts/${attemptId}`,
          adminSession
        ),
      () =>
        apiCall(
          'GET',
          `/api/v1/assignments/${fx.assignmentId}/progress`,
          adminSession
        ),
      () =>
        apiCall('GET', `/api/v1/student/attempts/${attemptId}`, adminSession),
    ]) {
      const res = await adminCall();
      assert.equal(res.status, 403);
    }

    // Verify no Student response/emotion/turn leaked into audit_logs
    const serializedAudits = JSON.stringify(store.audits);
    assert.equal(serializedAudits.includes('choice_share'), false);
    assert.equal(serializedAudits.includes('vui_ve'), false);
    assert.equal(serializedAudits.includes('Em chọn cùng chơi với bạn'), false);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});
