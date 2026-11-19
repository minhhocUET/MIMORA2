import assert from 'node:assert/strict';
import test from 'node:test';
import { generateUuidV7 } from '../db/uuid.ts';
import { AppError } from '../http/errors.ts';
import type {
  ActivityAttemptRecord,
  ActivityAttemptTurnRecord,
  AssignmentProgressRecord,
  AttemptRepository,
  ProgressStatus,
} from '../repositories/attempt.repository.ts';
import type {
  FamilyActivityAttemptRecord,
  FamilyActivityAttemptTurnRecord,
  FamilyLearningRepository,
  FamilyProgramEnrollmentRecord,
  FamilyProgramItemJoinedRecord,
  FamilyProgramRecord,
  FamilyProgramVersionRecord,
} from '../repositories/family-learning.repository.ts';
import { createAttemptService } from './attempt.service.ts';
import { createFamilyLearningService } from './family-learning.service.ts';

import express from 'express';
import http from 'node:http';
import { parseServerConfig } from '../config/env.ts';
import { createAuthMiddlewareSuite } from '../middleware/auth.ts';
import {
  apiErrorHandler,
  apiNotFoundHandler,
} from '../http/middleware.ts';
import {
  createAuthenticatedCsrfMiddleware,
  CSRF_TOKEN_HEADER,
  CUSTOM_REQUEST_HEADER,
  deriveSessionCsrfToken,
} from '../security/csrf.ts';
import {
  generateSessionToken,
  hashSessionToken,
} from '../security/session.ts';
import { createAttemptsRouters } from '../routes/attempts.routes.ts';
import { createFamilyLearningRouters } from '../routes/family-learning.routes.ts';
import type {
  AuthRepository,
  SessionWithContextRecord,
} from '../repositories/auth.repository.ts';
import {
  areAttemptTurnPayloadsEquivalent,
  assertAttemptCanAbandon,
  assertAttemptCanComplete,
  canonicalizeAttemptPayload,
  resolveStartOrResumeEligibility,
  validateSafeAttemptJsonObject,
} from './attempt-shared.ts';

interface ParityStartInput {
  intent?: 'start_or_resume' | 'retry';
  expectedContentVersionId?: string;
  idempotencyKey?: string;
  usedAacSupport?: boolean;
  usedReadAloud?: boolean;
}

interface ParityStartResult {
  httpStatus: 200 | 201;
  action: 'started' | 'resumed' | 'retried' | 'idempotent_replay';
  attemptId: string;
  attemptNumber: number;
  state: 'in_progress' | 'completed' | 'abandoned';
  completedCount: number;
  aacTapCount: number;
  readAloudCount: number;
}

interface ParitySaveTurnInput {
  attemptId: string;
  turnIndex: number;
  stepKey: string;
  selectedChoiceKey?: string | null;
  selectedEmotionKey?: string | null;
  usedAac?: boolean;
  usedReadAloud?: boolean;
  aacTapDelta?: number;
  readAloudDelta?: number;
  responsePayloadJson?: Record<string, unknown> | null;
}

interface ParitySaveTurnResult {
  httpStatus: 200 | 201;
  idempotentReplay: boolean;
  aacTapCount: number;
  readAloudCount: number;
  usedAacSupport: boolean;
  usedReadAloud: boolean;
  isOptionalContextOnly: true;
  hasNumericScoreField: boolean;
  turnIndices: number[];
  nextTurnIndex: number;
}

interface ParityTerminalView {
  idempotentReplay: boolean;
  attemptId: string;
  state: 'in_progress' | 'completed' | 'abandoned';
  turnCount: number;
  completedCount: number;
  aacTapCount: number;
  readAloudCount: number;
}

interface ParityEngineHarness {
  name: 'school' | 'family';
  startOrResume(input?: ParityStartInput): Promise<ParityStartResult>;
  saveTurn(input: ParitySaveTurnInput): Promise<ParitySaveTurnResult>;
  complete(
    attemptId: string,
    options?: { usedAacSupport?: boolean; usedReadAloud?: boolean }
  ): Promise<ParityTerminalView>;
  abandon(
    attemptId: string,
    options?: { confirmed?: boolean }
  ): Promise<ParityTerminalView>;
  getAttempt(attemptId: string): Promise<{
    attemptId: string;
    state: 'in_progress' | 'completed' | 'abandoned';
    turnIndices: number[];
    nextTurnIndex: number;
  }>;
  verifyPrivacyBoundaries(attemptId: string): Promise<void>;
}

function createSchoolHarness(): ParityEngineHarness {
  const orgId = generateUuidV7();
  const assignmentId = generateUuidV7();
  const targetId = generateUuidV7();
  const itemId = generateUuidV7();
  const contentItemId = generateUuidV7();
  const contentVersionId = generateUuidV7();
  const classId = generateUuidV7();
  const teacherUserId = generateUuidV7();
  const teacherMembershipId = generateUuidV7();
  const unassignedTeacherUserId = generateUuidV7();
  const unassignedTeacherMembershipId = generateUuidV7();
  const studentUserId = generateUuidV7();
  const studentMembershipId = generateUuidV7();
  const otherStudentUserId = generateUuidV7();
  const otherStudentMembershipId = generateUuidV7();

  const baseNow = new Date('2026-11-19T12:00:00.000Z');
  let tick = 0;
  const nextDate = () => new Date(baseNow.getTime() + ++tick * 1000);

  const attempts = new Map<string, ActivityAttemptRecord>();
  const turns = new Map<string, ActivityAttemptTurnRecord>();
  const progressByTarget = new Map<string, AssignmentProgressRecord>();

  const repo: AttemptRepository = {
    async withTransaction(fn) {
      return fn({} as never);
    },
    async findAndLockTargetAndItemForStudent(params) {
      if (
        params.organizationId !== orgId ||
        params.studentMembershipId !== studentMembershipId ||
        params.targetId !== targetId ||
        params.itemId !== itemId
      ) {
        return null;
      }
      return {
        target: {
          id: targetId,
          organizationId: orgId,
          assignmentId,
          studentMembershipId,
          assignedAt: baseNow,
        },
        assignment: {
          id: assignmentId,
          organizationId: orgId,
          classId,
          title: 'School SEL Practice',
          status: 'active',
          dueAt: null,
          homePracticeInstructions: null,
        },
        item: {
          id: itemId,
          organizationId: orgId,
          assignmentId,
          contentVersionId,
          sortOrder: 0,
        },
        contentVersion: {
          id: contentVersionId,
          contentItemId,
          contentType: 'emotion_card',
          versionNumber: 1,
          title: 'Calm Breathing',
          summary: null,
          locale: 'vi',
        },
        totalItemsInAssignment: 2,
      };
    },
    async findAttemptByStartIdempotencyKey(params) {
      for (const a of attempts.values()) {
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
      for (const a of attempts.values()) {
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
      const matched = Array.from(attempts.values()).filter(
        (a) =>
          a.organizationId === params.organizationId &&
          a.studentMembershipId === params.studentMembershipId &&
          a.assignmentTargetId === params.assignmentTargetId &&
          a.assignmentItemId === params.assignmentItemId
      );
      return {
        totalCount: matched.length,
        maxAttemptNumber: matched.reduce(
          (max, a) => Math.max(max, a.attemptNumber),
          0
        ),
      };
    },
    async insertActivityAttempt(row) {
      const rec: ActivityAttemptRecord = {
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
          row.status === 'in_progress' ? row.assignmentTargetId : null,
        inProgressItemGuard:
          row.status === 'in_progress' ? row.assignmentItemId : null,
      };
      attempts.set(rec.id, rec);
      return rec;
    },
    async listTurnsForAttempt(params) {
      return Array.from(turns.values())
        .filter((t) => t.attemptId === params.attemptId)
        .sort(
          (a, b) =>
            a.turnIndex - b.turnIndex ||
            a.respondedAt.getTime() - b.respondedAt.getTime() ||
            a.id.localeCompare(b.id)
        );
    },
    async findTurnByAttemptAndIndex(params) {
      for (const t of turns.values()) {
        if (t.attemptId === params.attemptId && t.turnIndex === params.turnIndex) {
          return t;
        }
      }
      return null;
    },
    async insertTurnAndUpdateAttempt(params) {
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
      turns.set(turn.id, turn);
      const current = attempts.get(params.attemptUpdate.attemptId)!;
      const updated: ActivityAttemptRecord = {
        ...current,
        lastInteractedAt: params.attemptUpdate.lastInteractedAt,
        durationSeconds: params.attemptUpdate.durationSeconds,
        usedAacSupport: params.attemptUpdate.usedAacSupport,
        usedReadAloud: params.attemptUpdate.usedReadAloud,
        aacTapCount: params.attemptUpdate.aacTapCount,
        readAloudCount: params.attemptUpdate.readAloudCount,
      };
      attempts.set(updated.id, updated);
      return { turn, attempt: updated };
    },
    async findAttemptRefForStudent(params) {
      const a = attempts.get(params.attemptId);
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
      const a = attempts.get(params.attemptId);
      if (
        !a ||
        a.organizationId !== params.organizationId ||
        a.studentMembershipId !== params.studentMembershipId ||
        a.assignmentTargetId !== params.targetId
      ) {
        return null;
      }
      return {
        attempt: a,
        assignment: {
          id: assignmentId,
          organizationId: orgId,
          classId,
          title: 'School SEL Practice',
          status: 'active',
          dueAt: null,
        },
        item: {
          id: itemId,
          sortOrder: 0,
          contentVersionId,
        },
        contentVersion: {
          id: contentVersionId,
          contentItemId,
          contentType: 'emotion_card',
          versionNumber: 1,
          title: 'Calm Breathing',
          summary: null,
          locale: 'vi',
        },
        totalItemsInAssignment: 2,
      };
    },
    async loadStudentAttemptReadOnly(params) {
      const a = attempts.get(params.attemptId);
      if (
        !a ||
        a.organizationId !== params.organizationId ||
        a.studentMembershipId !== params.studentMembershipId
      ) {
        return null;
      }
      return this.lockTargetAndLoadStudentAttempt(
        {
          organizationId: params.organizationId,
          studentMembershipId: params.studentMembershipId,
          targetId: a.assignmentTargetId,
          attemptId: a.id,
        },
        {} as never
      );
    },
    async updateAttemptStatus(params) {
      const a = attempts.get(params.attemptId)!;
      const updated: ActivityAttemptRecord = {
        ...a,
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
            : a.responseSummaryJson,
        inProgressTargetGuard: null,
        inProgressItemGuard: null,
      };
      attempts.set(updated.id, updated);
      return updated;
    },
    async findAssignmentProgressByTarget(params) {
      return progressByTarget.get(params.assignmentTargetId) ?? null;
    },
    async recomputeAndUpsertAssignmentProgress(params) {
      const all = Array.from(attempts.values()).filter(
        (a) => a.assignmentTargetId === params.assignmentTargetId
      );
      const completedSet = new Set(
        all.filter((a) => a.status === 'completed').map((a) => a.assignmentItemId)
      );
      const active = all.find((a) => a.status === 'in_progress') ?? null;
      const completed = all.find((a) => a.status === 'completed') ?? null;
      const status: ProgressStatus =
        completedSet.size >= params.totalItems
          ? 'completed'
          : all.length > 0
            ? 'in_progress'
            : 'not_started';
      const row: AssignmentProgressRecord = {
        id: progressByTarget.get(params.assignmentTargetId)?.id ?? generateUuidV7(),
        organizationId: params.organizationId,
        assignmentTargetId: params.assignmentTargetId,
        studentMembershipId: params.studentMembershipId,
        activeAttemptId: active?.id ?? null,
        latestCompletedAttemptId: completed?.id ?? null,
        totalItems: params.totalItems,
        completedItems: completedSet.size,
        attemptCount: all.length,
        status,
        lastActivityAt: params.now,
        completedAt: status === 'completed' ? params.now : null,
        updatedAt: params.now,
      };
      progressByTarget.set(params.assignmentTargetId, row);
      return row;
    },
    async findTeacherAssignmentAccess(params) {
      if (params.organizationId !== orgId || params.assignmentId !== assignmentId) {
        return null;
      }
      return {
        assignment: {
          id: assignmentId,
          organizationId: orgId,
          classId,
          className: 'Lớp 3A',
          createdByTeacherMembershipId: teacherMembershipId,
          title: 'School SEL Practice',
          status: 'active',
          dueAt: null,
          createdAt: baseNow,
          updatedAt: baseNow,
        },
        isTeacherAssigned: params.teacherMembershipId === teacherMembershipId,
      };
    },
    async listAttemptsForTeacherAssignment() {
      return { items: [], total: 0 };
    },
    async findAttemptDetailForTeacher(params) {
      const a = attempts.get(params.attemptId);
      if (!a || a.assignmentId !== params.assignmentId) return null;
      return {
        attempt: a,
        studentDisplayName: 'Bé An',
        studentOrgUsername: 'bean',
        assignmentItemSortOrder: 0,
        contentItemId,
        contentType: 'emotion_card',
        contentVersionNumber: 1,
        contentTitle: 'Calm Breathing',
        turnCount: Array.from(turns.values()).filter((t) => t.attemptId === a.id)
          .length,
      };
    },
  };

  const service = createAttemptService({
    repo,
    now: nextDate,
    auditFn: async () => ({}) as never,
  });

  const studentActor = {
    actorUserId: studentUserId,
    organizationId: orgId,
    studentMembershipId,
    ipPrefix: '127.0.0.1',
  };

  return {
    name: 'school',
    async startOrResume(input) {
      const res = await service.startOrResumeAttempt(
        {
          targetId,
          itemId,
          intent: input?.intent,
          expectedContentVersionId: input?.expectedContentVersionId,
          idempotencyKey: input?.idempotencyKey,
          usedAacSupport: input?.usedAacSupport,
          usedReadAloud: input?.usedReadAloud,
        },
        studentActor
      );
      return {
        httpStatus: res.httpStatus,
        action: res.action,
        attemptId: res.attempt.attemptId,
        attemptNumber: res.attempt.attemptNumber,
        state: res.attempt.state,
        completedCount: res.attempt.progress.completedItems,
        aacTapCount: res.attempt.supportContext.aacTapCount,
        readAloudCount: res.attempt.supportContext.readAloudCount,
      };
    },
    async saveTurn(input) {
      const res = await service.saveTurn(input, studentActor);
      const rawAttempt = res.attempt as unknown as Record<string, unknown>;
      return {
        httpStatus: res.httpStatus,
        idempotentReplay: res.idempotentReplay,
        aacTapCount: res.attempt.supportContext.aacTapCount,
        readAloudCount: res.attempt.supportContext.readAloudCount,
        usedAacSupport: res.attempt.supportContext.usedAacSupport,
        usedReadAloud: res.attempt.supportContext.usedReadAloud,
        isOptionalContextOnly: res.attempt.supportContext.isOptionalContextOnly,
        hasNumericScoreField: 'score' in rawAttempt || 'ranking' in rawAttempt,
        turnIndices: res.attempt.turns.map((t) => t.turnIndex),
        nextTurnIndex: res.attempt.resumePosition.nextTurnIndex,
      };
    },
    async complete(attemptId, options) {
      const res = await service.completeAttempt(
        {
          attemptId,
          usedAacSupport: options?.usedAacSupport,
          usedReadAloud: options?.usedReadAloud,
        },
        studentActor
      );
      return {
        idempotentReplay: res.idempotentReplay,
        attemptId: res.attempt.attemptId,
        state: res.attempt.state,
        turnCount: res.attempt.turns.length,
        completedCount: res.attempt.progress.completedItems,
        aacTapCount: res.attempt.supportContext.aacTapCount,
        readAloudCount: res.attempt.supportContext.readAloudCount,
      };
    },
    async abandon(attemptId, options) {
      const res = await service.abandonAttempt(
        { attemptId, confirmed: options?.confirmed ?? true },
        studentActor
      );
      return {
        idempotentReplay: res.idempotentReplay,
        attemptId: res.attempt.attemptId,
        state: res.attempt.state,
        turnCount: res.attempt.turns.length,
        completedCount: res.attempt.progress.completedItems,
        aacTapCount: res.attempt.supportContext.aacTapCount,
        readAloudCount: res.attempt.supportContext.readAloudCount,
      };
    },
    async getAttempt(attemptId) {
      const view = await service.getStudentAttempt(attemptId, studentActor);
      return {
        attemptId: view.attemptId,
        state: view.state,
        turnIndices: view.turns.map((t) => t.turnIndex),
        nextTurnIndex: view.resumePosition.nextTurnIndex,
      };
    },
    async verifyPrivacyBoundaries(attemptId) {
      // Unassigned teacher blocked (403)
      await assert.rejects(
        () =>
          service.getTeacherAttemptDetail(
            { assignmentId, attemptId },
            {
              actorUserId: unassignedTeacherUserId,
              organizationId: orgId,
              teacherMembershipId: unassignedTeacherMembershipId,
              ipPrefix: '127.0.0.1',
            }
          ),
        (err: unknown) => err instanceof AppError && err.httpStatus === 403
      );

      // Assigned teacher gets safe read-only view with neutrality note
      const detail = await service.getTeacherAttemptDetail(
        { assignmentId, attemptId },
        {
          actorUserId: teacherUserId,
          organizationId: orgId,
          teacherMembershipId,
          ipPrefix: '127.0.0.1',
        }
      );
      assert.equal(detail.attempt.supportContext.isOptionalContextOnly, true);

      // Another student receives 404
      await assert.rejects(
        () =>
          service.getStudentAttempt(attemptId, {
            actorUserId: otherStudentUserId,
            organizationId: orgId,
            studentMembershipId: otherStudentMembershipId,
            ipPrefix: '127.0.0.1',
          }),
        (err: unknown) => err instanceof AppError && err.httpStatus === 404
      );
    },
  };
}

function createFamilyHarness(): ParityEngineHarness {
  const wsId = generateUuidV7();
  const programId = generateUuidV7();
  const programVersionId = generateUuidV7();
  const itemId = generateUuidV7();
  const contentItemId = generateUuidV7();
  const contentVersionId = generateUuidV7();
  const enrollmentId = generateUuidV7();
  const guardianUserId = generateUuidV7();
  const unlinkedGuardianUserId = generateUuidV7();
  const studentUserId = generateUuidV7();
  const otherStudentUserId = generateUuidV7();

  const baseNow = new Date('2026-11-19T12:00:00.000Z');
  let tick = 0;
  const nextDate = () => new Date(baseNow.getTime() + ++tick * 1000);

  const program: FamilyProgramRecord = {
    id: programId,
    slug: 'family-calm-program',
    availabilityMode: 'free_family',
    status: 'published',
    currentPublishedVersionId: programVersionId,
    createdByUserId: generateUuidV7(),
    retiredAt: null,
    createdAt: baseNow,
    updatedAt: baseNow,
  };
  const version: FamilyProgramVersionRecord = {
    id: programVersionId,
    familyProgramId: programId,
    versionNumber: 1,
    status: 'published',
    title: 'Family SEL Practice',
    description: null,
    locale: 'vi',
    ageBand: '6-9',
    availabilityMode: 'free_family',
    createdByUserId: generateUuidV7(),
    publishedByUserId: generateUuidV7(),
    publishedAt: baseNow,
    retiredAt: null,
    createdAt: baseNow,
    updatedAt: baseNow,
  };
  const joinedItem: FamilyProgramItemJoinedRecord = {
    id: itemId,
    familyProgramVersionId: programVersionId,
    chapterNumber: 1,
    chapterTitle: 'Chapter 1',
    sortOrder: 0,
    contentVersionId,
    createdAt: baseNow,
    contentItemId,
    contentSlug: 'calm-breathing',
    contentType: 'emotion_card',
    contentVersionNumber: 1,
    contentStatus: 'published',
    contentTitle: 'Calm Breathing',
    contentSummary: null,
    contentLocale: 'vi',
    payloadJson: {},
    metadataJson: null,
    publishedAt: baseNow,
  };
  let enrollment: FamilyProgramEnrollmentRecord = {
    id: enrollmentId,
    familyWorkspaceId: wsId,
    studentUserId,
    familyProgramId: programId,
    familyProgramVersionId: programVersionId,
    activationSource: 'guardian_free',
    activatedByUserId: guardianUserId,
    status: 'active',
    learningStatus: 'not_started',
    totalActivities: 2,
    completedActivities: 0,
    startedAt: null,
    lastActivityAt: null,
    completedAt: null,
    activatedAt: baseNow,
    revokedAt: null,
    revokedByUserId: null,
    createdAt: baseNow,
    updatedAt: baseNow,
  };

  const attempts = new Map<string, FamilyActivityAttemptRecord>();
  const turns = new Map<string, FamilyActivityAttemptTurnRecord>();

  const repo = {
    async withTransaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      return fn({} as never);
    },
    async listProgramVersionItemsJoined(versionId: string) {
      return versionId === programVersionId ? [joinedItem] : [];
    },
    async findActiveStudentEnrollmentById(uid: string, eid: string) {
      if (uid !== studentUserId || eid !== enrollmentId) return null;
      return {
        enrollment,
        program,
        version,
        workspaceCode: 'FAM-TEST',
        workspaceName: 'Gia đình Test',
      };
    },
    async findInProgressFamilyAttempt(eid: string, iid: string) {
      for (const a of attempts.values()) {
        if (
          a.enrollmentId === eid &&
          a.familyProgramItemId === iid &&
          a.status === 'in_progress'
        ) {
          return a;
        }
      }
      return null;
    },
    async findFamilyAttemptByIdempotencyKey(
      eid: string,
      iid: string,
      key: string
    ) {
      for (const a of attempts.values()) {
        if (
          a.enrollmentId === eid &&
          a.familyProgramItemId === iid &&
          a.startIdempotencyKey === key
        ) {
          return a;
        }
      }
      return null;
    },
    async countFamilyAttemptsForItem(eid: string, iid: string) {
      const matched = Array.from(attempts.values()).filter(
        (a) => a.enrollmentId === eid && a.familyProgramItemId === iid
      );
      return {
        total: matched.length,
        completed: matched.filter((a) => a.status === 'completed').length,
        maxAttemptNumber: matched.reduce(
          (max, a) => Math.max(max, a.attemptNumber),
          0
        ),
      };
    },
    async createFamilyAttempt(row: typeof attempts extends Map<string, infer V> ? V : never) {
      const rec: FamilyActivityAttemptRecord = { ...row };
      attempts.set(rec.id, rec);
      return rec;
    },
    async findFamilyAttemptByIdForStudent(uid: string, aid: string) {
      const a = attempts.get(aid);
      return a && a.studentUserId === uid ? a : null;
    },
    async listTurnsForFamilyAttempt(uid: string, aid: string) {
      return Array.from(turns.values())
        .filter((t) => t.studentUserId === uid && t.attemptId === aid)
        .sort(
          (a, b) =>
            a.turnIndex - b.turnIndex ||
            a.respondedAt.getTime() - b.respondedAt.getTime() ||
            a.id.localeCompare(b.id)
        );
    },
    async findTurnForFamilyAttempt(uid: string, aid: string, turnIndex: number) {
      for (const t of turns.values()) {
        if (
          t.studentUserId === uid &&
          t.attemptId === aid &&
          t.turnIndex === turnIndex
        ) {
          return t;
        }
      }
      return null;
    },
    async insertFamilyTurnAndUpdateAttempt(params: {
      turn: FamilyActivityAttemptTurnRecord;
      attemptUpdate: {
        studentUserId: string;
        attemptId: string;
        lastInteractedAt: Date;
        durationSeconds: number;
        usedAacSupport: boolean;
        usedReadAloud: boolean;
        aacTapCount: number;
        readAloudCount: number;
      };
    }) {
      turns.set(params.turn.id, { ...params.turn });
      const current = attempts.get(params.attemptUpdate.attemptId)!;
      const updated: FamilyActivityAttemptRecord = {
        ...current,
        lastInteractedAt: params.attemptUpdate.lastInteractedAt,
        durationSeconds: params.attemptUpdate.durationSeconds,
        usedAacSupport: params.attemptUpdate.usedAacSupport,
        usedReadAloud: params.attemptUpdate.usedReadAloud,
        aacTapCount: params.attemptUpdate.aacTapCount,
        readAloudCount: params.attemptUpdate.readAloudCount,
      };
      attempts.set(updated.id, updated);
      return updated;
    },
    async updateFamilyAttemptTerminalState(params: {
      studentUserId: string;
      attemptId: string;
      status: 'completed' | 'abandoned';
      completedAt: Date | null;
      lastInteractedAt: Date;
      durationSeconds: number;
      usedAacSupport: boolean;
      usedReadAloud: boolean;
      aacTapCount: number;
      readAloudCount: number;
      responseSummaryJson?: Record<string, unknown> | null;
    }) {
      const current = attempts.get(params.attemptId)!;
      const updated: FamilyActivityAttemptRecord = {
        ...current,
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
            : current.responseSummaryJson,
      };
      attempts.set(updated.id, updated);
      return updated;
    },
    async recomputeAndUpdateEnrollmentProgress(params: {
      enrollmentId: string;
      studentUserId: string;
      totalActivities: number;
      fallbackActivityAt: Date;
      now: Date;
    }) {
      const all = Array.from(attempts.values()).filter(
        (a) => a.enrollmentId === params.enrollmentId
      );
      const completedSet = new Set(
        all
          .filter((a) => a.status === 'completed')
          .map((a) => a.familyProgramItemId)
      );
      const completedActivities = completedSet.size;
      const learningStatus =
        completedActivities >= 2
          ? 'completed'
          : all.length > 0
            ? 'in_progress'
            : 'not_started';
      enrollment = {
        ...enrollment,
        totalActivities: 2,
        completedActivities,
        learningStatus,
        startedAt: enrollment.startedAt ?? params.now,
        lastActivityAt: params.now,
        completedAt: learningStatus === 'completed' ? params.now : null,
        updatedAt: params.now,
      };
      return enrollment;
    },
    async getGuardianLinkedStudentOverview(gid: string, sid: string) {
      if (gid !== guardianUserId || sid !== studentUserId) return null;
      return {
        studentUserId,
        studentDisplayName: 'Bé An',
        studentStatus: 'active',
        workspaceIds: [wsId],
      };
    },
    async listFamilyEnrollmentsForGuardianOverview() {
      const completedIds = Array.from(attempts.values())
        .filter((a) => a.status === 'completed')
        .map((a) => a.familyProgramItemId);
      return [
        {
          enrollment,
          workspaceName: 'Gia đình Test',
          workspaceCode: 'FAM-TEST',
          programTitle: version.title,
          versionNumber: 1,
          items: [
            {
              itemId: joinedItem.id,
              chapterNumber: joinedItem.chapterNumber,
              chapterTitle: joinedItem.chapterTitle,
              sortOrder: joinedItem.sortOrder,
            },
          ],
          completedItemIds: Array.from(new Set(completedIds)),
        },
      ];
    },
    async listSchoolAssignmentsForGuardianOverview() {
      return [];
    },
  } as unknown as FamilyLearningRepository;

  const service = createFamilyLearningService({
    repo,
    now: nextDate,
    auditFn: async () => ({}) as never,
  });

  const studentActor = { actorUserId: studentUserId, ipPrefix: '127.0.0.1' };

  return {
    name: 'family',
    async startOrResume(input) {
      const res = await service.startOrResumeFamilyAttempt(
        {
          enrollmentId,
          itemId,
          intent: input?.intent,
          expectedContentVersionId: input?.expectedContentVersionId,
          idempotencyKey: input?.idempotencyKey,
          usedAacSupport: input?.usedAacSupport,
          usedReadAloud: input?.usedReadAloud,
        },
        studentActor
      );
      return {
        httpStatus: res.httpStatus,
        action: res.action,
        attemptId: res.attempt.attemptId,
        attemptNumber: res.attempt.attemptNumber,
        state: res.attempt.state,
        completedCount: res.attempt.enrollmentProgress.completedActivities,
        aacTapCount: res.attempt.supportContext.aacTapCount,
        readAloudCount: res.attempt.supportContext.readAloudCount,
      };
    },
    async saveTurn(input) {
      const res = await service.saveFamilyTurn(input, studentActor);
      const rawAttempt = res.attempt as unknown as Record<string, unknown>;
      return {
        httpStatus: res.httpStatus,
        idempotentReplay: res.idempotentReplay,
        aacTapCount: res.attempt.supportContext.aacTapCount,
        readAloudCount: res.attempt.supportContext.readAloudCount,
        usedAacSupport: res.attempt.supportContext.usedAacSupport,
        usedReadAloud: res.attempt.supportContext.usedReadAloud,
        isOptionalContextOnly: res.attempt.supportContext.isOptionalContextOnly,
        hasNumericScoreField: 'score' in rawAttempt || 'ranking' in rawAttempt,
        turnIndices: res.attempt.turns.map((t) => t.turnIndex),
        nextTurnIndex: res.attempt.resumePosition.nextTurnIndex,
      };
    },
    async complete(attemptId, options) {
      const res = await service.completeFamilyAttempt(
        {
          attemptId,
          usedAacSupport: options?.usedAacSupport,
          usedReadAloud: options?.usedReadAloud,
        },
        studentActor
      );
      return {
        idempotentReplay: res.idempotentReplay,
        attemptId: res.attempt.attemptId,
        state: res.attempt.state,
        turnCount: res.attempt.turns.length,
        completedCount: res.attempt.enrollmentProgress.completedActivities,
        aacTapCount: res.attempt.supportContext.aacTapCount,
        readAloudCount: res.attempt.supportContext.readAloudCount,
      };
    },
    async abandon(attemptId, options) {
      const res = await service.abandonFamilyAttempt(
        { attemptId, confirmed: options?.confirmed ?? true },
        studentActor
      );
      return {
        idempotentReplay: res.idempotentReplay,
        attemptId: res.attempt.attemptId,
        state: res.attempt.state,
        turnCount: res.attempt.turns.length,
        completedCount: res.attempt.enrollmentProgress.completedActivities,
        aacTapCount: res.attempt.supportContext.aacTapCount,
        readAloudCount: res.attempt.supportContext.readAloudCount,
      };
    },
    async getAttempt(attemptId) {
      const view = await service.getFamilyAttemptForStudent(
        attemptId,
        studentActor
      );
      return {
        attemptId: view.attemptId,
        state: view.state,
        turnIndices: view.turns.map((t) => t.turnIndex),
        nextTurnIndex: view.resumePosition.nextTurnIndex,
      };
    },
    async verifyPrivacyBoundaries(attemptId) {
      // Unlinked guardian receives 403 Forbidden
      await assert.rejects(
        () =>
          service.getLinkedStudentProgressOverviewForGuardian(studentUserId, {
            userId: unlinkedGuardianUserId,
            ipPrefix: '127.0.0.1',
          }),
        (err: unknown) => err instanceof AppError && err.httpStatus === 403
      );

      // Linked guardian gets Option B descriptive progress only (no turns / choices / notes)
      const overview = await service.getLinkedStudentProgressOverviewForGuardian(
        studentUserId,
        {
          userId: guardianUserId,
          ipPrefix: '127.0.0.1',
        }
      );
      const serialized = JSON.stringify(overview);
      assert.equal(serialized.includes('turns'), false);
      assert.equal(serialized.includes('selectedChoiceKey'), false);
      assert.equal(serialized.includes('selectedEmotionKey'), false);
      assert.equal(serialized.includes('responsePayloadJson'), false);

      // Another student receives 404
      await assert.rejects(
        () =>
          service.getFamilyAttemptForStudent(attemptId, {
            actorUserId: otherStudentUserId,
            ipPrefix: '127.0.0.1',
          }),
        (err: unknown) => err instanceof AppError && err.httpStatus === 404
      );
    },
  };
}

test('attempt-shared [Unit]: canonical payload equivalence, retry eligibility, state transitions, and JSON bounds', () => {
  assert.deepEqual(
    canonicalizeAttemptPayload({ b: 2, a: { y: 1, x: undefined } }),
    { a: { y: 1 }, b: 2 }
  );

  assert.equal(
    areAttemptTurnPayloadsEquivalent(
      {
        stepKey: 's1',
        selectedChoiceKey: 'c1',
        selectedEmotionKey: null,
        usedAac: true,
        usedReadAloud: false,
        responsePayloadJson: { b: 2, a: 1 },
      },
      {
        stepKey: 's1',
        selectedChoiceKey: 'c1',
        selectedEmotionKey: null,
        usedAac: true,
        usedReadAloud: false,
        responsePayloadJson: { a: 1, b: 2 },
      }
    ),
    true
  );

  assert.equal(
    resolveStartOrResumeEligibility({
      hasInProgress: false,
      priorAttemptCount: 0,
      intent: 'start_or_resume',
    }),
    'started'
  );
  assert.throws(
    () =>
      resolveStartOrResumeEligibility({
        hasInProgress: true,
        priorAttemptCount: 1,
        intent: 'retry',
      }),
    (err: unknown) =>
      err instanceof AppError && err.code === 'ATTEMPT_ALREADY_IN_PROGRESS'
  );
  assert.throws(
    () =>
      resolveStartOrResumeEligibility({
        hasInProgress: false,
        priorAttemptCount: 1,
        intent: 'start_or_resume',
      }),
    (err: unknown) =>
      err instanceof AppError && err.code === 'RETRY_INTENT_REQUIRED'
  );

  assert.equal(assertAttemptCanComplete('completed'), 'replay');
  assert.throws(
    () => assertAttemptCanComplete('abandoned'),
    (err: unknown) =>
      err instanceof AppError && err.code === 'INVALID_ATTEMPT_STATE'
  );
  assert.equal(assertAttemptCanAbandon('abandoned'), 'replay');
  assert.throws(
    () => assertAttemptCanAbandon('completed'),
    (err: unknown) =>
      err instanceof AppError && err.code === 'INVALID_ATTEMPT_STATE'
  );

  // Depth > 5 rejected
  assert.throws(
    () =>
      validateSafeAttemptJsonObject(
        { l1: { l2: { l3: { l4: { l5: { l6: 'deep' } } } } } },
        'body.responsePayloadJson'
      ),
    (err: unknown) => err instanceof AppError && err.httpStatus === 422
  );
});

for (const makeHarness of [createSchoolHarness, createFamilyHarness]) {
  test(`attempt-engine contract matrix [Mock Repo][${makeHarness().name}]: idempotency, retry conflict, version check, turn ordering, telemetry, safety, single-counting, abandon & privacy`, async () => {
    const engine = makeHarness();

    // 0. Expected content version mismatch rejected symmetrically with PINNED_CONTENT_VERSION_MISMATCH
    await assert.rejects(
      () =>
        engine.startOrResume({
          expectedContentVersionId: generateUuidV7(),
        }),
      (err: unknown) =>
        err instanceof AppError &&
        err.httpStatus === 409 &&
        err.code === 'PINNED_CONTENT_VERSION_MISMATCH'
    );

    // 1. Start idempotency & in_progress reuse + initial support telemetry parity
    const started = await engine.startOrResume({
      idempotencyKey: 'start-k1',
      usedAacSupport: true,
      usedReadAloud: true,
    });
    assert.equal(started.httpStatus, 201);
    assert.equal(started.action, 'started');
    assert.equal(started.attemptNumber, 1);
    assert.equal(started.aacTapCount, 1);
    assert.equal(started.readAloudCount, 1);

    const replayStart = await engine.startOrResume({ idempotencyKey: 'start-k1' });
    assert.equal(replayStart.httpStatus, 200);
    assert.equal(replayStart.action, 'idempotent_replay');
    assert.equal(replayStart.attemptId, started.attemptId);

    const resumed = await engine.startOrResume({});
    assert.equal(resumed.httpStatus, 200);
    assert.equal(resumed.action, 'resumed');
    assert.equal(resumed.attemptId, started.attemptId);

    // 1b. Explicit retry while in_progress rejects symmetrically with 409 ATTEMPT_ALREADY_IN_PROGRESS
    await assert.rejects(
      () => engine.startOrResume({ intent: 'retry' }),
      (err: unknown) =>
        err instanceof AppError &&
        err.httpStatus === 409 &&
        err.code === 'ATTEMPT_ALREADY_IN_PROGRESS'
    );

    // 2. Turn ordering (submit 2 then 0), replay (canonical key order), conflict & support telemetry neutrality
    const turn2 = await engine.saveTurn({
      attemptId: started.attemptId,
      turnIndex: 2,
      stepKey: 'strategy_step',
      selectedChoiceKey: 'deep_breath',
    });
    assert.equal(turn2.httpStatus, 201);
    assert.deepEqual(turn2.turnIndices, [2]);

    const turn0 = await engine.saveTurn({
      attemptId: started.attemptId,
      turnIndex: 0,
      stepKey: 'emotion_select',
      selectedEmotionKey: 'calm',
      usedAac: true,
      aacTapDelta: 2,
      usedReadAloud: true,
      readAloudDelta: 1,
      responsePayloadJson: { feelingIntensity: 2, note: 'em thở chậm' },
    });
    assert.equal(turn0.httpStatus, 201);
    assert.equal(turn0.idempotentReplay, false);
    assert.equal(turn0.usedAacSupport, true);
    assert.equal(turn0.usedReadAloud, true);
    assert.equal(turn0.aacTapCount, 3);
    assert.equal(turn0.readAloudCount, 2);
    assert.equal(turn0.isOptionalContextOnly, true);
    assert.equal(turn0.hasNumericScoreField, false);
    assert.deepEqual(turn0.turnIndices, [0, 2]);
    assert.equal(turn0.nextTurnIndex, 3);

    const turn0Replay = await engine.saveTurn({
      attemptId: started.attemptId,
      turnIndex: 0,
      stepKey: 'emotion_select',
      selectedEmotionKey: 'calm',
      usedAac: true,
      usedReadAloud: true,
      responsePayloadJson: { note: 'em thở chậm', feelingIntensity: 2 },
    });
    assert.equal(turn0Replay.httpStatus, 200);
    assert.equal(turn0Replay.idempotentReplay, true);
    assert.equal(turn0Replay.aacTapCount, 3);

    await assert.rejects(
      () =>
        engine.saveTurn({
          attemptId: started.attemptId,
          turnIndex: 0,
          stepKey: 'emotion_select',
          selectedEmotionKey: 'happy',
        }),
      (err: unknown) =>
        err instanceof AppError &&
        err.httpStatus === 409 &&
        err.code === 'TURN_INDEX_CONFLICT'
    );

    // 3. Forbidden scoring / clinical / credential keys + bounds rejected symmetrically with 422
    for (const badPayload of [
      { score: 100 },
      { ranking: 1 },
      { isCorrect: true },
      { diagnosis: 'clinical_note' },
      { timer: 30 },
      { mastery: 0.9 },
      { currentpassword: 'secret' },
      { correctemotion: 'happy' },
      { l1: { l2: { l3: { l4: { l5: { l6: 'too_deep' } } } } } },
    ]) {
      await assert.rejects(
        () =>
          engine.saveTurn({
            attemptId: started.attemptId,
            turnIndex: 1,
            stepKey: 'strategy_choice',
            responsePayloadJson: badPayload,
          }),
        (err: unknown) =>
          err instanceof AppError &&
          err.httpStatus === 422 &&
          err.code === 'VALIDATION_ERROR'
      );
    }

    // 4. Completion idempotency + support boolean delta parity + abandon rejected after complete + retry required
    const completed1 = await engine.complete(started.attemptId, {
      usedAacSupport: true,
    });
    assert.equal(completed1.idempotentReplay, false);
    assert.equal(completed1.state, 'completed');
    assert.equal(completed1.completedCount, 1);
    assert.equal(completed1.aacTapCount, 4);

    const completedReplay = await engine.complete(started.attemptId);
    assert.equal(completedReplay.idempotentReplay, true);
    assert.equal(completedReplay.state, 'completed');
    assert.equal(completedReplay.completedCount, 1);

    await assert.rejects(
      () => engine.abandon(started.attemptId, { confirmed: true }),
      (err: unknown) =>
        err instanceof AppError &&
        err.httpStatus === 409 &&
        err.code === 'INVALID_ATTEMPT_STATE'
    );

    await assert.rejects(
      () => engine.startOrResume({}),
      (err: unknown) =>
        err instanceof AppError &&
        err.httpStatus === 409 &&
        err.code === 'RETRY_INTENT_REQUIRED'
    );

    const retried = await engine.startOrResume({ intent: 'retry' });
    assert.equal(retried.httpStatus, 201);
    assert.equal(retried.action, 'retried');
    assert.equal(retried.attemptNumber, 2);

    const completedRetry = await engine.complete(retried.attemptId);
    assert.equal(completedRetry.state, 'completed');
    assert.equal(
      completedRetry.completedCount,
      1,
      'Retrying and re-completing the same item must not double-count progress'
    );

    // 5. Intentional abandon requires confirmation, preserves partial turns, blocks subsequent turns/complete, and requires retry for attempt #4
    const attempt3 = await engine.startOrResume({ intent: 'retry' });
    await engine.saveTurn({
      attemptId: attempt3.attemptId,
      turnIndex: 0,
      stepKey: 'emotion_select',
      selectedChoiceKey: 'deep_breath',
    });

    await assert.rejects(
      () => engine.abandon(attempt3.attemptId, { confirmed: false }),
      (err: unknown) =>
        err instanceof AppError &&
        (err.code === 'ABANDON_CONFIRMATION_REQUIRED' ||
          (err.code === 'VALIDATION_ERROR' &&
            Boolean(
              err.details?.some(
                (d) => d.code === 'ABANDON_CONFIRMATION_REQUIRED'
              )
            )))
    );

    const abandoned = await engine.abandon(attempt3.attemptId, {
      confirmed: true,
    });
    assert.equal(abandoned.idempotentReplay, false);
    assert.equal(abandoned.state, 'abandoned');
    assert.equal(abandoned.turnCount, 1);

    const abandonedReplay = await engine.abandon(attempt3.attemptId, {
      confirmed: true,
    });
    assert.equal(abandonedReplay.idempotentReplay, true);

    await assert.rejects(
      () =>
        engine.saveTurn({
          attemptId: attempt3.attemptId,
          turnIndex: 1,
          stepKey: 'wrap_up',
          selectedChoiceKey: 'done',
        }),
      (err: unknown) =>
        err instanceof AppError &&
        err.httpStatus === 409 &&
        err.code === 'ATTEMPT_NOT_IN_PROGRESS'
    );

    await assert.rejects(
      () => engine.complete(attempt3.attemptId),
      (err: unknown) =>
        err instanceof AppError &&
        err.httpStatus === 409 &&
        err.code === 'INVALID_ATTEMPT_STATE'
    );

    await assert.rejects(
      () => engine.startOrResume({}),
      (err: unknown) =>
        err instanceof AppError &&
        err.httpStatus === 409 &&
        err.code === 'RETRY_INTENT_REQUIRED'
    );

    const attempt4 = await engine.startOrResume({ intent: 'retry' });
    assert.equal(attempt4.attemptNumber, 4);

    // 6. Privacy boundaries
    await engine.verifyPrivacyBoundaries(started.attemptId);
  });
}

test('attempt-engine concurrency & transient lock recovery [Mock Repo]: both School and Family handle ER_LOCK_WAIT_TIMEOUT retry and ER_DUP_ENTRY conflict deterministically', async () => {
  // School simulated lock wait + persistent dup entry
  {
    const orgId = generateUuidV7();
    const targetId = generateUuidV7();
    const itemId = generateUuidV7();
    const studentMembershipId = generateUuidV7();
    const contentVersionId = generateUuidV7();
    let txAttempt = 0;

    const lockError = Object.assign(new Error('Lock wait timeout exceeded'), {
      code: 'ER_LOCK_WAIT_TIMEOUT',
      errno: 1205,
    });
    const dupError = Object.assign(new Error('Duplicate entry'), {
      code: 'ER_DUP_ENTRY',
      errno: 1062,
    });

    const attempts = new Map<string, ActivityAttemptRecord>();
    const schoolRepo = {
      async withTransaction<T>(fn: (tx: never) => Promise<T>) {
        txAttempt += 1;
        if (txAttempt === 1) {
          throw lockError;
        }
        return fn({} as never);
      },
      async findAndLockTargetAndItemForStudent() {
        return {
          target: {
            id: targetId,
            organizationId: orgId,
            assignmentId: targetId,
            studentMembershipId,
            assignedAt: new Date(),
          },
          assignment: {
            id: targetId,
            organizationId: orgId,
            classId: orgId,
            title: 'T',
            status: 'active',
            dueAt: null,
            homePracticeInstructions: null,
          },
          item: {
            id: itemId,
            organizationId: orgId,
            assignmentId: targetId,
            contentVersionId,
            sortOrder: 0,
          },
          contentVersion: {
            id: contentVersionId,
            contentItemId: itemId,
            contentType: 'emotion_card',
            versionNumber: 1,
            title: 'Card',
            summary: null,
            locale: 'vi',
          },
          totalItemsInAssignment: 1,
        };
      },
      async findAttemptByStartIdempotencyKey() {
        return null;
      },
      async findInProgressAttemptForItem() {
        return null;
      },
      async findAttemptAggregateStatsForItem() {
        return { totalCount: 0, maxAttemptNumber: 0 };
      },
      async insertActivityAttempt(row: ActivityAttemptRecord) {
        if (row.startIdempotencyKey === 'force-dup') {
          throw dupError;
        }
        attempts.set(row.id, { ...row });
        return row;
      },
      async recomputeAndUpsertAssignmentProgress() {
        return null;
      },
    } as unknown as AttemptRepository;

    const schoolSvc = createAttemptService({
      repo: schoolRepo,
      now: () => new Date('2026-11-19T12:00:00.000Z'),
      auditFn: async () => ({}) as never,
    });
    const actor = {
      actorUserId: generateUuidV7(),
      organizationId: orgId,
      studentMembershipId,
      ipPrefix: '127.0.0.1',
    };

    const recovered = await schoolSvc.startOrResumeAttempt(
      { targetId, itemId, idempotencyKey: 'recover-lock' },
      actor
    );
    assert.equal(recovered.httpStatus, 201);
    assert.equal(txAttempt, 2);

    await assert.rejects(
      () =>
        schoolSvc.startOrResumeAttempt(
          { targetId, itemId, idempotencyKey: 'force-dup' },
          actor
        ),
      (err: unknown) =>
        err instanceof AppError &&
        err.httpStatus === 409 &&
        err.code === 'ATTEMPT_CONCURRENT_CONFLICT'
    );
  }

  // Family simulated lock wait + persistent dup entry (on start AND on saveTurn)
  {
    const enrollmentId = generateUuidV7();
    const itemId = generateUuidV7();
    const studentUserId = generateUuidV7();
    const attemptId = generateUuidV7();
    const contentVersionId = generateUuidV7();
    let txAttempt = 0;

    const lockError = Object.assign(new Error('Lock wait timeout exceeded'), {
      code: 'ER_LOCK_WAIT_TIMEOUT',
      errno: 1205,
    });
    const dupError = Object.assign(new Error('Duplicate entry'), {
      code: 'ER_DUP_ENTRY',
      errno: 1062,
    });

    const attempts = new Map<string, FamilyActivityAttemptRecord>();
    const baseNow = new Date('2026-11-19T12:00:00.000Z');
    const enrollment: FamilyProgramEnrollmentRecord = {
      id: enrollmentId,
      familyWorkspaceId: generateUuidV7(),
      studentUserId,
      familyProgramId: generateUuidV7(),
      familyProgramVersionId: generateUuidV7(),
      activationSource: 'free_program',
      activatedByUserId: generateUuidV7(),
      status: 'active',
      learningStatus: 'not_started',
      totalActivities: 1,
      completedActivities: 0,
      startedAt: null,
      lastActivityAt: null,
      completedAt: null,
      activatedAt: baseNow,
      revokedAt: null,
      revokedByUserId: null,
      createdAt: baseNow,
      updatedAt: baseNow,
    };

    const familyRepo = {
      async withTransaction<T>(fn: (tx: never) => Promise<T>) {
        txAttempt += 1;
        if (txAttempt === 1) {
          throw lockError;
        }
        return fn({} as never);
      },
      async findActiveStudentEnrollmentById() {
        return {
          enrollment,
          program: {
            id: enrollment.familyProgramId,
            slug: 'p',
            availabilityMode: 'free_family',
            status: 'published',
            currentPublishedVersionId: enrollment.familyProgramVersionId,
            createdByUserId: studentUserId,
            retiredAt: null,
            createdAt: baseNow,
            updatedAt: baseNow,
          },
          version: {
            id: enrollment.familyProgramVersionId,
            familyProgramId: enrollment.familyProgramId,
            versionNumber: 1,
            status: 'published',
            title: 'Family Test',
            description: null,
            locale: 'vi',
            ageBand: '6-9',
            availabilityMode: 'free_family',
            createdByUserId: studentUserId,
            publishedByUserId: studentUserId,
            publishedAt: baseNow,
            retiredAt: null,
            createdAt: baseNow,
            updatedAt: baseNow,
          },
          workspaceCode: 'FAM-LOCK',
          workspaceName: 'Lock Test',
        };
      },
      async listProgramVersionItemsJoined() {
        return [
          {
            id: itemId,
            familyProgramVersionId: enrollment.familyProgramVersionId,
            chapterNumber: 1,
            chapterTitle: 'C1',
            sortOrder: 0,
            contentVersionId,
            createdAt: baseNow,
            contentItemId: generateUuidV7(),
            contentSlug: 'c1',
            contentType: 'emotion_card',
            contentVersionNumber: 1,
            contentStatus: 'published',
            contentTitle: 'Card',
            contentSummary: null,
            contentLocale: 'vi',
            payloadJson: {},
            metadataJson: null,
            publishedAt: baseNow,
          },
        ];
      },
      async findFamilyAttemptByIdempotencyKey() {
        return null;
      },
      async findInProgressFamilyAttempt() {
        return null;
      },
      async countFamilyAttemptsForItem() {
        return { total: 0, completed: 0, maxAttemptNumber: 0 };
      },
      async createFamilyAttempt(row: FamilyActivityAttemptRecord) {
        if (row.startIdempotencyKey === 'force-dup') {
          throw dupError;
        }
        attempts.set(row.id, { ...row });
        return row;
      },
      async findFamilyAttemptByIdForStudent(_uid: string, aid: string) {
        return attempts.get(aid) ?? {
          id: attemptId,
          enrollmentId,
          familyWorkspaceId: enrollment.familyWorkspaceId,
          studentUserId,
          familyProgramVersionId: enrollment.familyProgramVersionId,
          familyProgramItemId: itemId,
          contentVersionId,
          attemptNumber: 1,
          startIdempotencyKey: null,
          status: 'in_progress',
          startedAt: baseNow,
          lastInteractedAt: baseNow,
          completedAt: null,
          durationSeconds: 0,
          usedAacSupport: false,
          usedReadAloud: false,
          aacTapCount: 0,
          readAloudCount: 0,
          responseSummaryJson: null,
        };
      },
      async findTurnForFamilyAttempt() {
        return null;
      },
      async insertFamilyTurnAndUpdateAttempt() {
        throw dupError;
      },
      async recomputeAndUpdateEnrollmentProgress() {
        return enrollment;
      },
    } as unknown as FamilyLearningRepository;

    const familySvc = createFamilyLearningService({
      repo: familyRepo,
      now: () => baseNow,
      auditFn: async () => ({}) as never,
    });
    const actor = { actorUserId: studentUserId, ipPrefix: '127.0.0.1' };

    const recovered = await familySvc.startOrResumeFamilyAttempt(
      { enrollmentId, itemId, idempotencyKey: 'recover-lock' },
      actor
    );
    assert.equal(recovered.httpStatus, 201);
    assert.equal(txAttempt, 2);

    await assert.rejects(
      () =>
        familySvc.startOrResumeFamilyAttempt(
          { enrollmentId, itemId, idempotencyKey: 'force-dup' },
          actor
        ),
      (err: unknown) =>
        err instanceof AppError &&
        err.httpStatus === 409 &&
        err.code === 'ATTEMPT_CONCURRENT_CONFLICT'
    );

    await assert.rejects(
      () =>
        familySvc.saveFamilyTurn(
          { attemptId, turnIndex: 0, stepKey: 's0' },
          actor
        ),
      (err: unknown) =>
        err instanceof AppError &&
        err.httpStatus === 409 &&
        err.code === 'TURN_INDEX_CONFLICT'
    );
  }
});

test('attempt-engine dual-context, family-only student & session-expiry recovery [Mock HTTP]', async () => {
  const baseNow = new Date('2026-11-19T12:00:00.000Z');
  const familyOnlyStudentId = generateUuidV7();
  const dualStudentId = generateUuidV7();
  const dualOrgId = generateUuidV7();
  const dualStudentMemId = generateUuidV7();

  const familyWsId = generateUuidV7();
  const programId = generateUuidV7();
  const programVersionId = generateUuidV7();
  const famItemId = generateUuidV7();
  const famEnrollmentId = generateUuidV7();
  const famDualEnrollmentId = generateUuidV7();
  const schoolAssignmentId = generateUuidV7();
  const schoolTargetId = generateUuidV7();
  const schoolItemId = generateUuidV7();
  const contentVersionId = generateUuidV7();

  const sessions = new Map<string, SessionWithContextRecord>();
  const issueSession = (params: {
    userId: string;
    activeOrganizationId: string | null;
    orgMembershipId: string | null;
  }) => {
    const rawToken = generateSessionToken();
    const tokenHash = hashSessionToken(rawToken);
    const sessionId = generateUuidV7();
    sessions.set(tokenHash, {
      session: {
        id: sessionId,
        tokenHash,
        userId: params.userId,
        sessionScope: 'student',
        activeOrganizationId: params.activeOrganizationId,
        idleExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        absoluteExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        lastActivityAt: baseNow,
        revokedAt: null,
        revokedReason: null,
      },
      user: {
        id: params.userId,
        email: null,
        emailVerifiedAt: null,
        platformUsername: null,
        platformRole: null,
        displayName: 'Student',
        status: 'active',
        lockedUntil: null,
      },
      activeOrganization: params.activeOrganizationId
        ? {
            id: params.activeOrganizationId,
            code: 'TR-MAU',
            name: 'Trường Mẫu',
            status: 'active',
          }
        : null,
      activeMembership: params.orgMembershipId
        ? {
            id: params.orgMembershipId,
            organizationId: params.activeOrganizationId!,
            role: 'student',
            orgUsername: 'hs_dual',
            status: 'active',
          }
        : null,
      hasActiveFamilyStudentContext: true,
    });
    return { sessionId, rawToken };
  };

  const authRepo = {
    async findSessionWithContextByTokenHash(tokenHash: string) {
      return sessions.get(tokenHash) ?? null;
    },
    async touchSessionActivity() {},
    async revokeSessionById() {},
  } as unknown as AuthRepository;

  const schoolAttempts = new Map<string, ActivityAttemptRecord>();
  const schoolTurns = new Map<string, ActivityAttemptTurnRecord>();
  const schoolProgress = new Map<string, AssignmentProgressRecord>();
  const schoolRepo = {
    async withTransaction<T>(fn: (tx: never) => Promise<T>) {
      return fn({} as never);
    },
    async findAndLockTargetAndItemForStudent(params: {
      organizationId: string;
      studentMembershipId: string;
      targetId: string;
      itemId: string;
    }) {
      if (
        params.organizationId !== dualOrgId ||
        params.studentMembershipId !== dualStudentMemId ||
        params.targetId !== schoolTargetId ||
        params.itemId !== schoolItemId
      ) {
        return null;
      }
      return {
        target: {
          id: schoolTargetId,
          organizationId: dualOrgId,
          assignmentId: schoolAssignmentId,
          studentMembershipId: dualStudentMemId,
          assignedAt: baseNow,
        },
        assignment: {
          id: schoolAssignmentId,
          organizationId: dualOrgId,
          classId: dualOrgId,
          title: 'School Dual Test',
          status: 'active',
          dueAt: null,
          homePracticeInstructions: null,
        },
        item: {
          id: schoolItemId,
          organizationId: dualOrgId,
          assignmentId: schoolAssignmentId,
          contentVersionId,
          sortOrder: 0,
        },
        contentVersion: {
          id: contentVersionId,
          contentItemId: generateUuidV7(),
          contentType: 'emotion_card',
          versionNumber: 1,
          title: 'Emotion',
          summary: null,
          locale: 'vi',
        },
        totalItemsInAssignment: 1,
      };
    },
    async findAttemptByStartIdempotencyKey() {
      return null;
    },
    async findInProgressAttemptForItem(params: {
      studentMembershipId: string;
      assignmentTargetId: string;
      assignmentItemId: string;
    }) {
      return (
        Array.from(schoolAttempts.values()).find(
          (a) =>
            a.studentMembershipId === params.studentMembershipId &&
            a.assignmentTargetId === params.assignmentTargetId &&
            a.assignmentItemId === params.assignmentItemId &&
            a.status === 'in_progress'
        ) ?? null
      );
    },
    async findAttemptAggregateStatsForItem(params: {
      studentMembershipId: string;
      assignmentTargetId: string;
      assignmentItemId: string;
    }) {
      const m = Array.from(schoolAttempts.values()).filter(
        (a) =>
          a.studentMembershipId === params.studentMembershipId &&
          a.assignmentTargetId === params.assignmentTargetId &&
          a.assignmentItemId === params.assignmentItemId
      );
      return {
        totalCount: m.length,
        maxAttemptNumber: m.reduce((mx, a) => Math.max(mx, a.attemptNumber), 0),
      };
    },
    async insertActivityAttempt(row: ActivityAttemptRecord) {
      schoolAttempts.set(row.id, { ...row });
      return row;
    },
    async listTurnsForAttempt(params: { attemptId: string }) {
      return Array.from(schoolTurns.values()).filter(
        (t) => t.attemptId === params.attemptId
      );
    },
    async findAttemptRefForStudent(params: {
      studentMembershipId: string;
      attemptId: string;
    }) {
      const a = schoolAttempts.get(params.attemptId);
      if (!a || a.studentMembershipId !== params.studentMembershipId) return null;
      return {
        id: a.id,
        assignmentTargetId: a.assignmentTargetId,
        assignmentId: a.assignmentId,
        assignmentItemId: a.assignmentItemId,
      };
    },
    async lockTargetAndLoadStudentAttempt(params: { attemptId: string }) {
      const a = schoolAttempts.get(params.attemptId);
      if (!a) return null;
      return {
        attempt: a,
        assignment: {
          id: schoolAssignmentId,
          organizationId: dualOrgId,
          classId: dualOrgId,
          title: 'School Dual Test',
          status: 'active',
          dueAt: null,
        },
        item: { id: schoolItemId, sortOrder: 0, contentVersionId },
        contentVersion: {
          id: contentVersionId,
          contentItemId: generateUuidV7(),
          contentType: 'emotion_card',
          versionNumber: 1,
          title: 'Emotion',
          summary: null,
          locale: 'vi',
        },
        totalItemsInAssignment: 1,
      };
    },
    async updateAttemptStatus(params: { attemptId: string; status: string; completedAt: Date | null; lastInteractedAt: Date }) {
      const a = schoolAttempts.get(params.attemptId)!;
      const upd = { ...a, status: params.status, completedAt: params.completedAt, lastInteractedAt: params.lastInteractedAt };
      schoolAttempts.set(upd.id, upd);
      return upd;
    },
    async recomputeAndUpsertAssignmentProgress(params: {
      organizationId: string;
      assignmentTargetId: string;
      studentMembershipId: string;
      totalItems: number;
      now: Date;
    }) {
      const all = Array.from(schoolAttempts.values()).filter(
        (a) => a.assignmentTargetId === params.assignmentTargetId
      );
      const completedSet = new Set(
        all.filter((a) => a.status === 'completed').map((a) => a.assignmentItemId)
      );
      const row: AssignmentProgressRecord = {
        id: generateUuidV7(),
        organizationId: params.organizationId,
        assignmentTargetId: params.assignmentTargetId,
        studentMembershipId: params.studentMembershipId,
        activeAttemptId: all.find((a) => a.status === 'in_progress')?.id ?? null,
        latestCompletedAttemptId:
          all.find((a) => a.status === 'completed')?.id ?? null,
        totalItems: params.totalItems,
        completedItems: completedSet.size,
        attemptCount: all.length,
        status: completedSet.size >= params.totalItems ? 'completed' : 'in_progress',
        lastActivityAt: params.now,
        completedAt:
          completedSet.size >= params.totalItems ? params.now : null,
        updatedAt: params.now,
      };
      schoolProgress.set(params.assignmentTargetId, row);
      return row;
    },
  } as unknown as AttemptRepository;

  const famEnrollments = new Map<string, FamilyProgramEnrollmentRecord>([
    [
      famEnrollmentId,
      {
        id: famEnrollmentId,
        familyWorkspaceId: familyWsId,
        studentUserId: familyOnlyStudentId,
        familyProgramId: programId,
        familyProgramVersionId: programVersionId,
        activationSource: 'free_program',
        activatedByUserId: generateUuidV7(),
        status: 'active',
        learningStatus: 'not_started',
        totalActivities: 1,
        completedActivities: 0,
        startedAt: null,
        lastActivityAt: null,
        completedAt: null,
        activatedAt: baseNow,
        revokedAt: null,
        revokedByUserId: null,
        createdAt: baseNow,
        updatedAt: baseNow,
      },
    ],
    [
      famDualEnrollmentId,
      {
        id: famDualEnrollmentId,
        familyWorkspaceId: familyWsId,
        studentUserId: dualStudentId,
        familyProgramId: programId,
        familyProgramVersionId: programVersionId,
        activationSource: 'free_program',
        activatedByUserId: generateUuidV7(),
        status: 'active',
        learningStatus: 'not_started',
        totalActivities: 1,
        completedActivities: 0,
        startedAt: null,
        lastActivityAt: null,
        completedAt: null,
        activatedAt: baseNow,
        revokedAt: null,
        revokedByUserId: null,
        createdAt: baseNow,
        updatedAt: baseNow,
      },
    ],
  ]);
  const famAttempts = new Map<string, FamilyActivityAttemptRecord>();
  const famTurns = new Map<string, FamilyActivityAttemptTurnRecord>();
  const famRepo = {
    async withTransaction<T>(fn: (tx: never) => Promise<T>) {
      return fn({} as never);
    },
    async findActiveStudentEnrollmentById(uid: string, eid: string) {
      const e = famEnrollments.get(eid);
      if (!e || e.studentUserId !== uid) return null;
      return {
        enrollment: e,
        program: {
          id: programId,
          slug: 'fam-only',
          availabilityMode: 'free_family',
          status: 'published',
          currentPublishedVersionId: programVersionId,
          createdByUserId: uid,
          retiredAt: null,
          createdAt: baseNow,
          updatedAt: baseNow,
        },
        version: {
          id: programVersionId,
          familyProgramId: programId,
          versionNumber: 1,
          status: 'published',
          title: 'Family Only Program',
          description: null,
          locale: 'vi',
          ageBand: '6-9',
          availabilityMode: 'free_family',
          createdByUserId: uid,
          publishedByUserId: uid,
          publishedAt: baseNow,
          retiredAt: null,
          createdAt: baseNow,
          updatedAt: baseNow,
        },
        workspaceCode: 'FAM-DUAL',
        workspaceName: 'Gia đình Dual',
      };
    },
    async listProgramVersionItemsJoined() {
      return [
        {
          id: famItemId,
          familyProgramVersionId: programVersionId,
          chapterNumber: 1,
          chapterTitle: 'C1',
          sortOrder: 0,
          contentVersionId,
          createdAt: baseNow,
          contentItemId: generateUuidV7(),
          contentSlug: 'emo',
          contentType: 'emotion_card',
          contentVersionNumber: 1,
          contentStatus: 'published',
          contentTitle: 'Emotion',
          contentSummary: null,
          contentLocale: 'vi',
          payloadJson: {},
          metadataJson: null,
          publishedAt: baseNow,
        },
      ];
    },
    async findFamilyAttemptByIdempotencyKey() {
      return null;
    },
    async findInProgressFamilyAttempt(eid: string, iid: string) {
      return (
        Array.from(famAttempts.values()).find(
          (a) =>
            a.enrollmentId === eid &&
            a.familyProgramItemId === iid &&
            a.status === 'in_progress'
        ) ?? null
      );
    },
    async countFamilyAttemptsForItem(eid: string, iid: string) {
      const m = Array.from(famAttempts.values()).filter(
        (a) => a.enrollmentId === eid && a.familyProgramItemId === iid
      );
      return {
        total: m.length,
        completed: m.filter((a) => a.status === 'completed').length,
        maxAttemptNumber: m.reduce((mx, a) => Math.max(mx, a.attemptNumber), 0),
      };
    },
    async createFamilyAttempt(row: FamilyActivityAttemptRecord) {
      famAttempts.set(row.id, { ...row });
      return row;
    },
    async findFamilyAttemptByIdForStudent(uid: string, aid: string) {
      const a = famAttempts.get(aid);
      return a && a.studentUserId === uid ? a : null;
    },
    async listTurnsForFamilyAttempt(uid: string, aid: string) {
      return Array.from(famTurns.values())
        .filter((t) => t.studentUserId === uid && t.attemptId === aid)
        .sort((a, b) => a.turnIndex - b.turnIndex);
    },
    async findTurnForFamilyAttempt(uid: string, aid: string, idx: number) {
      return (
        Array.from(famTurns.values()).find(
          (t) =>
            t.studentUserId === uid &&
            t.attemptId === aid &&
            t.turnIndex === idx
        ) ?? null
      );
    },
    async insertFamilyTurnAndUpdateAttempt(params: {
      turn: FamilyActivityAttemptTurnRecord;
      attemptUpdate: {
        attemptId: string;
        lastInteractedAt: Date;
        durationSeconds: number;
        usedAacSupport: boolean;
        usedReadAloud: boolean;
        aacTapCount: number;
        readAloudCount: number;
      };
    }) {
      famTurns.set(params.turn.id, { ...params.turn });
      const cur = famAttempts.get(params.attemptUpdate.attemptId)!;
      const upd = {
        ...cur,
        ...params.attemptUpdate,
      };
      famAttempts.set(upd.id, upd);
      return upd;
    },
    async updateFamilyAttemptTerminalState(params: {
      attemptId: string;
      status: string;
      completedAt: Date | null;
      lastInteractedAt: Date;
    }) {
      const cur = famAttempts.get(params.attemptId)!;
      const upd = {
        ...cur,
        status: params.status,
        completedAt: params.completedAt,
        lastInteractedAt: params.lastInteractedAt,
      };
      famAttempts.set(upd.id, upd);
      return upd;
    },
    async recomputeAndUpdateEnrollmentProgress(params: {
      enrollmentId: string;
      totalActivities: number;
      now: Date;
    }) {
      const cur = famEnrollments.get(params.enrollmentId)!;
      const all = Array.from(famAttempts.values()).filter(
        (a) => a.enrollmentId === params.enrollmentId
      );
      const completedCount = new Set(
        all.filter((a) => a.status === 'completed').map((a) => a.familyProgramItemId)
      ).size;
      const upd: FamilyProgramEnrollmentRecord = {
        ...cur,
        completedActivities: completedCount,
        learningStatus:
          completedCount >= params.totalActivities ? 'completed' : 'in_progress',
        lastActivityAt: params.now,
        completedAt:
          completedCount >= params.totalActivities ? params.now : null,
      };
      famEnrollments.set(params.enrollmentId, upd);
      return upd;
    },
  } as unknown as FamilyLearningRepository;

  const attemptService = createAttemptService({
    repo: schoolRepo,
    now: () => new Date('2026-11-19T12:05:00.000Z'),
    auditFn: async () => ({}) as never,
  });
  const familyService = createFamilyLearningService({
    repo: famRepo,
    now: () => new Date('2026-11-19T12:05:00.000Z'),
    auditFn: async () => ({}) as never,
  });

  const cfgBase = parseServerConfig({
    NODE_ENV: 'test',
    SESSION_COOKIE_NAME: 'mimora_session',
    CSRF_SECRET: 'ki12-parity-csrf-secret-value-at-least-32-chars',
    TRUSTED_ORIGINS: 'http://127.0.0.1',
  });
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${port}`;
  const cfg = { ...cfgBase, auth: { ...cfgBase.auth, trustedOrigins: [baseUrl] } };

  const noopAudit = { insert: (() => ({ values: async () => undefined })) as never };
  const authMiddlewares = createAuthMiddlewareSuite({
    repo: authRepo,
    getConfig: () => cfg,
    auditExecutor: noopAudit,
  });
  const authenticatedCsrf = createAuthenticatedCsrfMiddleware({
    config: cfg,
    auditExecutor: noopAudit,
  });
  const { studentAttemptsRouter } = createAttemptsRouters({
    attemptService,
    authMiddlewares,
    authenticatedCsrf,
  });
  const { studentFamilyLearningRouter } = createFamilyLearningRouters({
    familyLearningService: familyService,
    authMiddlewares,
    authenticatedCsrf,
  });
  app.use('/api/v1/student', studentAttemptsRouter);
  app.use('/api/v1/student', studentFamilyLearningRouter);
  app.use('/api', apiNotFoundHandler);
  app.use('/api', apiErrorHandler);

  const callHttp = async (
    method: string,
    path: string,
    sess: { sessionId: string; rawToken: string },
    body?: unknown
  ) => {
    const headers: Record<string, string> = {
      Cookie: `${cfg.cookie.name}=${sess.rawToken}`,
    };
    if (method !== 'GET') {
      headers.Origin = baseUrl;
      headers[CUSTOM_REQUEST_HEADER] = '1';
      headers[CSRF_TOKEN_HEADER] = deriveSessionCsrfToken(
        sess.rawToken,
        sess.sessionId,
        cfg.auth.csrfSecret
      );
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };

  try {
    // 1. Family-only Student (activeOrganizationId: null, NO memberships) works cleanly & survives session expiry
    const famSess1 = issueSession({
      userId: familyOnlyStudentId,
      activeOrganizationId: null,
      orgMembershipId: null,
    });
    const famStart = await callHttp(
      'POST',
      `/api/v1/student/family-programs/${famEnrollmentId}/items/${famItemId}/start-or-resume`,
      famSess1,
      {}
    );
    assert.equal(famStart.status, 201);
    const famAttemptId = (famStart.json.attempt as { attemptId: string }).attemptId;

    const famTurn = await callHttp(
      'POST',
      `/api/v1/student/family-attempts/${famAttemptId}/turns`,
      famSess1,
      { turnIndex: 0, stepKey: 's0', selectedEmotionKey: 'calm' }
    );
    assert.equal(famTurn.status, 201);

    // Expire session -> 401; attempt remains in_progress (never auto-abandoned)
    sessions.get(hashSessionToken(famSess1.rawToken))!.session.idleExpiresAt =
      new Date(Date.now() - 60_000);
    const expiredRes = await callHttp(
      'GET',
      `/api/v1/student/family-attempts/${famAttemptId}`,
      famSess1
    );
    assert.equal(expiredRes.status, 401);
    assert.equal(famAttempts.get(famAttemptId)?.status, 'in_progress');

    // Re-login & resume cleanly, then complete + idempotent replay returning idempotentReplay
    const famSess2 = issueSession({
      userId: familyOnlyStudentId,
      activeOrganizationId: null,
      orgMembershipId: null,
    });
    const famResumed = await callHttp(
      'POST',
      `/api/v1/student/family-programs/${famEnrollmentId}/items/${famItemId}/start-or-resume`,
      famSess2,
      {}
    );
    assert.equal(famResumed.status, 200);
    assert.equal(famResumed.json.action, 'resumed');
    assert.equal((famResumed.json.attempt as { turns: unknown[] }).turns.length, 1);

    const famComplete = await callHttp(
      'POST',
      `/api/v1/student/family-attempts/${famAttemptId}/complete`,
      famSess2,
      {}
    );
    assert.equal(famComplete.status, 200);
    assert.equal(famComplete.json.idempotentReplay, false);

    const famCompleteReplay = await callHttp(
      'POST',
      `/api/v1/student/family-attempts/${famAttemptId}/complete`,
      famSess2,
      {}
    );
    assert.equal(famCompleteReplay.status, 200);
    assert.equal(famCompleteReplay.json.idempotentReplay, true);

    // 2. Dual-context Student operates School AND Family attempts independently under same canonical userId
    const dualSess = issueSession({
      userId: dualStudentId,
      activeOrganizationId: dualOrgId,
      orgMembershipId: dualStudentMemId,
    });
    const dualSchoolStart = await callHttp(
      'POST',
      `/api/v1/student/assignments/${schoolTargetId}/items/${schoolItemId}/start-or-resume`,
      dualSess,
      {}
    );
    assert.equal(dualSchoolStart.status, 201);
    const dualSchoolAttemptId = (dualSchoolStart.json.attempt as { attemptId: string }).attemptId;

    // HTTP School abandon requires explicit confirmed=true (empty {} fails!)
    const schoolBadAbandon = await callHttp(
      'POST',
      `/api/v1/student/attempts/${dualSchoolAttemptId}/abandon`,
      dualSess,
      {}
    );
    assert.equal(schoolBadAbandon.status, 422);

    const dualFamStart = await callHttp(
      'POST',
      `/api/v1/student/family-programs/${famDualEnrollmentId}/items/${famItemId}/start-or-resume`,
      dualSess,
      {}
    );
    assert.equal(dualFamStart.status, 201);
    const dualFamAttemptId = (dualFamStart.json.attempt as { attemptId: string }).attemptId;

    // Completing Family attempt does NOT affect School progress
    await callHttp(
      'POST',
      `/api/v1/student/family-attempts/${dualFamAttemptId}/complete`,
      dualSess,
      {}
    );
    assert.equal(famEnrollments.get(famDualEnrollmentId)?.learningStatus, 'completed');
    assert.equal(schoolAttempts.get(dualSchoolAttemptId)?.status, 'in_progress');
    assert.equal(schoolProgress.get(schoolTargetId)?.completedItems, 0);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
});
