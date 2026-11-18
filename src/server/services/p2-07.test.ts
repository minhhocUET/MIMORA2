import assert from 'node:assert/strict';
import express, { type NextFunction, type Request, type Response } from 'express';
import http from 'node:http';
import test from 'node:test';
import { CANONICAL_CONTENT_TYPES } from '../db/schema/_shared.ts';
import { apiErrorHandler, apiNotFoundHandler } from '../http/middleware.ts';
import type { MvpRole } from '../middleware/auth.ts';
import type { AuthenticatedPrincipal } from './auth.service.ts';
import {
  createGoalRepository,
  type GoalRepository,
  type StudentGoalRecord,
  type StudentProfileRecord,
} from '../repositories/goal.repository.ts';
import type {
  InsightRepository,
  OrgInsightSnapshotRecord,
  SnapshotSourceAttemptRow,
  SnapshotSourceGoalRow,
  SnapshotSourceTurnRow,
} from '../repositories/insight.repository.ts';
import type {
  ObservationRepository,
  TeacherObservationRecord,
} from '../repositories/observation.repository.ts';
import { createAdminInsightsRouter } from '../routes/admin-insights.routes.ts';
import { createGoalsRouters } from '../routes/goals.routes.ts';
import { createObservationsRouter } from '../routes/observations.routes.ts';
import { ApiErrors } from '../http/errors.ts';
import {
  buildAuditLogRow,
  type RecordAuditEventInput,
} from './audit.service.ts';
import { createGoalService } from './goal.service.ts';
import {
  applyOrgPeriodSuppression,
  createInsightService,
  evaluateRowThreshold,
} from './insight.service.ts';
import { createObservationService } from './observation.service.ts';

const ORG_A = '01950000-0000-7000-8000-000000000001';
const ORG_B = '01950000-0000-7000-8000-000000000002';

const ADMIN_USER = '01950000-0000-7000-8000-000000000010';
const TEACHER_A_USER = '01950000-0000-7000-8000-000000000011';
const TEACHER_B_USER = '01950000-0000-7000-8000-000000000012';
const TEACHER_UNASSIGNED_USER = '01950000-0000-7000-8000-000000000013';
const STUDENT_1_USER = '01950000-0000-7000-8000-000000000014';
const STUDENT_2_USER = '01950000-0000-7000-8000-000000000015';

const TEACHER_A_MEM = '01950000-0000-7000-8000-000000000111';
const TEACHER_B_MEM = '01950000-0000-7000-8000-000000000112';
const TEACHER_UNASSIGNED_MEM = '01950000-0000-7000-8000-000000000113';
const STUDENT_1_MEM = '01950000-0000-7000-8000-000000000114';
const STUDENT_2_MEM = '01950000-0000-7000-8000-000000000115';
const STUDENT_ORG_B_MEM = '01950000-0000-7000-8000-000000000116';

const CLASS_1 = '01950000-0000-7000-8000-000000000201';
const CLASS_2 = '01950000-0000-7000-8000-000000000202';
const ASSIGN_A = '01950000-0000-7000-8000-000000000301';
const ASSIGN_B = '01950000-0000-7000-8000-000000000302';
const ATTEMPT_1_A = '01950000-0000-7000-8000-000000000401';
const ATTEMPT_1_B = '01950000-0000-7000-8000-000000000402';
const ATTEMPT_2_A = '01950000-0000-7000-8000-000000000403';

interface FakeWorld {
  observations: Map<string, TeacherObservationRecord>;
  profiles: Map<string, StudentProfileRecord>;
  goals: Map<string, StudentGoalRecord>;
  snapshots: OrgInsightSnapshotRecord[];
  audits: RecordAuditEventInput[];
}

function createFakeWorld(): FakeWorld {
  return {
    observations: new Map(),
    profiles: new Map(),
    goals: new Map(),
    snapshots: [],
    audits: [],
  };
}

function createFakeObservationRepo(world: FakeWorld): ObservationRepository {
  const memberships = new Map([
    [
      `${ORG_A}:${TEACHER_A_MEM}`,
      {
        id: TEACHER_A_MEM,
        organizationId: ORG_A,
        userId: TEACHER_A_USER,
        role: 'teacher',
        status: 'active',
        userStatus: 'active',
        organizationStatus: 'active',
      },
    ],
    [
      `${ORG_A}:${TEACHER_B_MEM}`,
      {
        id: TEACHER_B_MEM,
        organizationId: ORG_A,
        userId: TEACHER_B_USER,
        role: 'teacher',
        status: 'active',
        userStatus: 'active',
        organizationStatus: 'active',
      },
    ],
    [
      `${ORG_A}:${TEACHER_UNASSIGNED_MEM}`,
      {
        id: TEACHER_UNASSIGNED_MEM,
        organizationId: ORG_A,
        userId: TEACHER_UNASSIGNED_USER,
        role: 'teacher',
        status: 'active',
        userStatus: 'active',
        organizationStatus: 'active',
      },
    ],
    [
      `${ORG_A}:${STUDENT_1_MEM}`,
      {
        id: STUDENT_1_MEM,
        organizationId: ORG_A,
        userId: STUDENT_1_USER,
        role: 'student',
        status: 'active',
        userStatus: 'active',
        organizationStatus: 'active',
      },
    ],
    [
      `${ORG_A}:${STUDENT_2_MEM}`,
      {
        id: STUDENT_2_MEM,
        organizationId: ORG_A,
        userId: STUDENT_2_USER,
        role: 'student',
        status: 'active',
        userStatus: 'active',
        organizationStatus: 'active',
      },
    ],
    [
      `${ORG_B}:${STUDENT_ORG_B_MEM}`,
      {
        id: STUDENT_ORG_B_MEM,
        organizationId: ORG_B,
        userId: STUDENT_2_USER,
        role: 'student',
        status: 'active',
        userStatus: 'active',
        organizationStatus: 'active',
      },
    ],
  ]);

  const teacherClasses = new Set([
    `${ORG_A}:${TEACHER_A_MEM}:${CLASS_1}`,
    `${ORG_A}:${TEACHER_B_MEM}:${CLASS_1}`, // Co-teacher on CLASS_1
    `${ORG_A}:${TEACHER_A_MEM}:${CLASS_2}`,
  ]);

  const studentClasses = new Set([
    `${ORG_A}:${STUDENT_1_MEM}:${CLASS_1}`,
    `${ORG_A}:${STUDENT_2_MEM}:${CLASS_2}`,
  ]);

  const attempts = new Map([
    [
      `${ORG_A}:${ATTEMPT_1_A}`,
      {
        attemptId: ATTEMPT_1_A,
        organizationId: ORG_A,
        assignmentId: ASSIGN_A,
        classId: CLASS_1,
        studentMembershipId: STUDENT_1_MEM,
      },
    ],
    [
      `${ORG_A}:${ATTEMPT_1_B}`,
      {
        attemptId: ATTEMPT_1_B,
        organizationId: ORG_A,
        assignmentId: ASSIGN_B,
        classId: CLASS_1,
        studentMembershipId: STUDENT_1_MEM,
      },
    ],
    [
      `${ORG_A}:${ATTEMPT_2_A}`,
      {
        attemptId: ATTEMPT_2_A,
        organizationId: ORG_A,
        assignmentId: ASSIGN_A,
        classId: CLASS_1,
        studentMembershipId: STUDENT_2_MEM,
      },
    ],
  ]);

  const assignmentsMap = new Map([
    [
      `${ORG_A}:${ASSIGN_A}`,
      { assignmentId: ASSIGN_A, organizationId: ORG_A, classId: CLASS_1 },
    ],
    [
      `${ORG_A}:${ASSIGN_B}`,
      { assignmentId: ASSIGN_B, organizationId: ORG_A, classId: CLASS_1 },
    ],
  ]);

  const classesMap = new Map([
    [`${ORG_A}:${CLASS_1}`, { classId: CLASS_1, organizationId: ORG_A, status: 'active' }],
    [`${ORG_A}:${CLASS_2}`, { classId: CLASS_2, organizationId: ORG_A, status: 'active' }],
  ]);

  return {
    async withTransaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      return fn(undefined as never);
    },
    async findMembershipInOrg(orgId, memId) {
      return memberships.get(`${orgId}:${memId}`) ?? null;
    },
    async isTeacherAssignedToClass(orgId, teacherMemId, classId) {
      const assigned = teacherClasses.has(`${orgId}:${teacherMemId}:${classId}`);
      return {
        assigned,
        classStatus: assigned ? classesMap.get(`${orgId}:${classId}`)?.status ?? 'active' : null,
      };
    },
    async isStudentActivelyEnrolledInClass(orgId, studentMemId, classId) {
      return studentClasses.has(`${orgId}:${studentMemId}:${classId}`);
    },
    async hasSharedActiveTeacherStudentClass(orgId, teacherMemId, studentMemId) {
      for (const clsId of [CLASS_1, CLASS_2]) {
        if (
          teacherClasses.has(`${orgId}:${teacherMemId}:${clsId}`) &&
          studentClasses.has(`${orgId}:${studentMemId}:${clsId}`)
        ) {
          return true;
        }
      }
      return false;
    },
    async findAttemptWithAssignmentInOrg(orgId, attemptId) {
      return attempts.get(`${orgId}:${attemptId}`) ?? null;
    },
    async findAssignmentInOrg(orgId, assignmentId) {
      return assignmentsMap.get(`${orgId}:${assignmentId}`) ?? null;
    },
    async findClassInOrg(orgId, classId) {
      return classesMap.get(`${orgId}:${classId}`) ?? null;
    },
    async listObservationsByAuthor(params) {
      const all = Array.from(world.observations.values()).filter((o) => {
        if (o.organizationId !== params.organizationId) return false;
        if (o.authorTeacherMembershipId !== params.authorTeacherMembershipId) return false;
        if (o.deletedAt !== null) return false;
        if (params.studentMembershipId && o.studentMembershipId !== params.studentMembershipId) return false;
        if (params.classId && o.classId !== params.classId) return false;
        if (params.assignmentId && o.assignmentId !== params.assignmentId) return false;
        if (params.attemptId && o.attemptId !== params.attemptId) return false;
        return true;
      });
      all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const start = (params.page - 1) * params.limit;
      return {
        items: all.slice(start, start + params.limit),
        total: all.length,
      };
    },
    async findObservationByIdForAuthor(orgId, authorId, obsId) {
      const o = world.observations.get(obsId);
      if (
        !o ||
        o.organizationId !== orgId ||
        o.authorTeacherMembershipId !== authorId ||
        o.deletedAt !== null
      ) {
        return null;
      }
      return o;
    },
    async insertObservation(row) {
      const rec: TeacherObservationRecord = {
        id: row.id,
        organizationId: row.organizationId,
        authorTeacherMembershipId: row.authorTeacherMembershipId,
        studentMembershipId: row.studentMembershipId,
        classId: row.classId ?? null,
        assignmentId: row.assignmentId ?? null,
        attemptId: row.attemptId ?? null,
        noteBody: row.noteBody,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        deletedAt: row.deletedAt ?? null,
      };
      world.observations.set(rec.id, rec);
      return rec;
    },
    async updateObservationForAuthor(params) {
      const o = world.observations.get(params.observationId);
      if (
        !o ||
        o.organizationId !== params.organizationId ||
        o.authorTeacherMembershipId !== params.authorTeacherMembershipId ||
        o.deletedAt !== null
      ) {
        return null;
      }
      const next: TeacherObservationRecord = {
        ...o,
        classId: params.classId,
        assignmentId: params.assignmentId,
        attemptId: params.attemptId,
        noteBody: params.noteBody,
        updatedAt: params.updatedAt,
      };
      world.observations.set(next.id, next);
      return next;
    },
    async softDeleteObservationForAuthor(params) {
      const o = world.observations.get(params.observationId);
      if (
        !o ||
        o.organizationId !== params.organizationId ||
        o.authorTeacherMembershipId !== params.authorTeacherMembershipId ||
        o.deletedAt !== null
      ) {
        return false;
      }
      world.observations.set(o.id, {
        ...o,
        deletedAt: params.deletedAt,
        updatedAt: params.updatedAt,
      });
      return true;
    },
  };
}

function createFakeGoalRepo(world: FakeWorld): GoalRepository {
  const obsRepo = createFakeObservationRepo(world);
  const teacherClasses = new Set([
    `${ORG_A}:${TEACHER_A_MEM}:${CLASS_1}`,
    `${ORG_A}:${TEACHER_B_MEM}:${CLASS_1}`,
  ]);
  const studentClasses = new Set([`${ORG_A}:${STUDENT_1_MEM}:${CLASS_1}`]);

  return {
    async withTransaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      return fn(undefined as never);
    },
    findMembershipInOrg: (orgId, memId) => obsRepo.findMembershipInOrg(orgId, memId),
    async findSharedActiveClassIds(orgId, teacherMemId, studentMemId) {
      const out: string[] = [];
      for (const clsId of [CLASS_1, CLASS_2]) {
        if (
          teacherClasses.has(`${orgId}:${teacherMemId}:${clsId}`) &&
          studentClasses.has(`${orgId}:${studentMemId}:${clsId}`)
        ) {
          out.push(clsId);
        }
      }
      return out;
    },
    async isTeacherAssignedToActiveClass(orgId, teacherMemId, classId) {
      return teacherClasses.has(`${orgId}:${teacherMemId}:${classId}`);
    },
    async isStudentEnrolledInClass(orgId, studentMemId, classId) {
      return studentClasses.has(`${orgId}:${studentMemId}:${classId}`);
    },
    async findStudentProfile(orgId, studentMemId) {
      return world.profiles.get(`${orgId}:${studentMemId}`) ?? null;
    },
    async upsertStudentProfile(params) {
      const key = `${params.organizationId}:${params.studentMembershipId}`;
      const existing = world.profiles.get(key);
      if (!existing) {
        const rec: StudentProfileRecord = {
          id: params.id,
          organizationId: params.organizationId,
          studentMembershipId: params.studentMembershipId,
          preferredName: params.hasPreferredName ? params.preferredName ?? null : null,
          supportPreferencesJson: params.hasSupportPreferencesJson
            ? params.supportPreferencesJson ?? null
            : null,
          createdAt: params.now,
          updatedAt: params.now,
        };
        world.profiles.set(key, rec);
        return rec;
      }
      const next: StudentProfileRecord = {
        ...existing,
        preferredName: params.hasPreferredName
          ? params.preferredName ?? null
          : existing.preferredName,
        supportPreferencesJson: params.hasSupportPreferencesJson
          ? params.supportPreferencesJson ?? null
          : existing.supportPreferencesJson,
        updatedAt: params.now,
      };
      world.profiles.set(key, next);
      return next;
    },
    async listStudentGoals(params) {
      const items = Array.from(world.goals.values()).filter((g) => {
        if (g.organizationId !== params.organizationId) return false;
        if (g.studentMembershipId !== params.studentMembershipId) return false;
        if (params.status) return g.status === params.status;
        if (!params.includeArchived && g.status === 'archived') return false;
        return true;
      });
      const start = (params.page - 1) * params.limit;
      return { items: items.slice(start, start + params.limit), total: items.length };
    },
    async findStudentGoalByIdInOrg(orgId, goalId) {
      const g = world.goals.get(goalId);
      if (!g || g.organizationId !== orgId) return null;
      return g;
    },
    async insertStudentGoal(row) {
      const rec: StudentGoalRecord = {
        id: row.id,
        organizationId: row.organizationId,
        studentMembershipId: row.studentMembershipId,
        classId: row.classId ?? null,
        createdByTeacherMembershipId: row.createdByTeacherMembershipId,
        title: row.title,
        description: row.description ?? null,
        focusArea: row.focusArea ?? null,
        status: row.status ?? 'active',
        targetDate: row.targetDate ?? null,
        achievedAt: row.achievedAt ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
      world.goals.set(rec.id, rec);
      return rec;
    },
    async updateStudentGoalInOrg(params) {
      const g = world.goals.get(params.goalId);
      if (!g || g.organizationId !== params.organizationId) return null;
      const next: StudentGoalRecord = {
        ...g,
        title: params.title !== undefined ? params.title : g.title,
        description: params.hasDescription ? params.description ?? null : g.description,
        focusArea: params.hasFocusArea ? params.focusArea ?? null : g.focusArea,
        status: params.status !== undefined ? params.status : g.status,
        targetDate: params.hasTargetDate ? params.targetDate ?? null : g.targetDate,
        achievedAt: params.hasAchievedAt ? params.achievedAt ?? null : g.achievedAt,
        updatedAt: params.now,
      };
      world.goals.set(next.id, next);
      return next;
    },
  };
}

function createFakeInsightRepo(
  world: FakeWorld,
  sourceFixtures?: {
    eligibleStudentsByOrg?: Map<string, string[]>;
    attemptsByOrg?: Map<string, SnapshotSourceAttemptRow[]>;
    turnsByOrg?: Map<string, SnapshotSourceTurnRow[]>;
    goalsByOrg?: Map<string, SnapshotSourceGoalRow[]>;
  }
): InsightRepository {
  const orgs = new Map([
    [ORG_A, { id: ORG_A, code: 'ORGA', name: 'Truong A', status: 'active' }],
    [ORG_B, { id: ORG_B, code: 'ORGB', name: 'Truong B', status: 'active' }],
  ]);

  return {
    async withTransaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      return fn(undefined as never);
    },
    async findOrganizationById(orgId) {
      return orgs.get(orgId) ?? null;
    },
    async listOrganizationsByIds(orgIds) {
      return orgIds.map((id) => orgs.get(id)).filter((o): o is NonNullable<typeof o> => Boolean(o));
    },
    async findLatestSnapshotDate(params) {
      const matching = world.snapshots
        .filter(
          (s) =>
            s.periodType === params.periodType &&
            (!params.organizationId || s.organizationId === params.organizationId)
        )
        .map((s) => s.snapshotDate)
        .sort();
      return matching.length > 0 ? matching[matching.length - 1] : null;
    },
    async listSnapshotsForPeriod(params) {
      return world.snapshots.filter(
        (s) =>
          s.periodType === params.periodType &&
          s.snapshotDate === params.snapshotDate &&
          (!params.organizationId || s.organizationId === params.organizationId)
      );
    },
    async listEligibleEnrolledStudentIds(orgId) {
      return sourceFixtures?.eligibleStudentsByOrg?.get(orgId) ?? [];
    },
    async listAttemptsInWindow(params) {
      const list = sourceFixtures?.attemptsByOrg?.get(params.organizationId) ?? [];
      return list.filter(
        (a) => a.startedAt >= params.windowStart && a.startedAt < params.windowEndExclusive
      );
    },
    async listTurnsForAttempts(orgId, attemptIds) {
      const set = new Set(attemptIds);
      return (sourceFixtures?.turnsByOrg?.get(orgId) ?? []).filter((t) =>
        set.has(t.attemptId)
      );
    },
    async listOrgGoalsForSnapshot(orgId, windowEndExclusive) {
      return (sourceFixtures?.goalsByOrg?.get(orgId) ?? []).filter(
        (g) => g.createdAt < windowEndExclusive
      );
    },
    async upsertSnapshotRows(rows) {
      const saved: OrgInsightSnapshotRecord[] = [];
      for (const row of rows) {
        const idx = world.snapshots.findIndex(
          (s) =>
            s.organizationId === row.organizationId &&
            s.periodType === (row.periodType ?? 'daily') &&
            s.snapshotDate === row.snapshotDate &&
            s.contentType === row.contentType
        );
        const rec: OrgInsightSnapshotRecord = {
          id: row.id,
          organizationId: row.organizationId,
          periodType: row.periodType ?? 'daily',
          snapshotDate: row.snapshotDate,
          contentType: row.contentType,
          eligibleEnrolledStudentsCount: row.eligibleEnrolledStudentsCount ?? 0,
          activeStudentsCount: row.activeStudentsCount ?? 0,
          attemptsStartedCount: row.attemptsStartedCount ?? 0,
          attemptsCompletedCount: row.attemptsCompletedCount ?? 0,
          distinctContentUsedCount: row.distinctContentUsedCount ?? 0,
          aacAssistedAttemptsCount: row.aacAssistedAttemptsCount ?? 0,
          readAloudAssistedAttemptsCount: row.readAloudAssistedAttemptsCount ?? 0,
          activeGoalsCount: row.activeGoalsCount ?? 0,
          achievedGoalsCount: row.achievedGoalsCount ?? 0,
          choiceTrendsSummaryJson: row.choiceTrendsSummaryJson ?? null,
          computedAt: row.computedAt,
        };
        if (idx >= 0) {
          world.snapshots[idx] = { ...rec, id: world.snapshots[idx].id };
          saved.push(world.snapshots[idx]);
        } else {
          world.snapshots.push(rec);
          saved.push(rec);
        }
      }
      return saved;
    },
  };
}

function makeFakeAuthMiddlewares(
  getAuthForHeader: (actorHeader: string | undefined) => AuthenticatedPrincipal | null
) {
  return {
    requireAuth(req: Request, _res: Response, next: NextFunction) {
      const ctx = getAuthForHeader(req.get('x-test-actor') ?? undefined);
      if (!ctx) {
        next(ApiErrors.unauthorized());
        return;
      }
      req.auth = ctx;
      next();
    },
    requireOrgContext(req: Request, _res: Response, next: NextFunction) {
      if (
        !req.auth ||
        !req.auth.activeOrganizationId ||
        !req.auth.organizationMembershipId
      ) {
        next(ApiErrors.forbidden());
        return;
      }
      next();
    },
    requireRole(...allowedRoles: MvpRole[]) {
      return (req: Request, _res: Response, next: NextFunction) => {
        if (!req.auth) {
          next(ApiErrors.forbidden());
          return;
        }
        const effectiveRole: MvpRole | null =
          req.auth.sessionScope === 'platform_admin'
            ? 'platform_admin'
            : req.auth.organizationRole;
        if (!effectiveRole || !allowedRoles.includes(effectiveRole)) {
          next(ApiErrors.forbidden());
          return;
        }
        next();
      };
    },
  };
}

async function withHttpTestServer(
  world: FakeWorld,
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  const obsRepo = createFakeObservationRepo(world);
  const goalRepo = createFakeGoalRepo(world);
  const insightRepo = createFakeInsightRepo(world);

  const auditLogger = async (input: RecordAuditEventInput) => {
    world.audits.push(input);
    return buildAuditLogRow(input);
  };

  const observationService = createObservationService({
    observationRepo: obsRepo,
    auditLogger,
  });
  const goalService = createGoalService({
    goalRepo,
    auditLogger,
  });
  const insightService = createInsightService({
    insightRepo,
  });

  const actorMap: Record<string, AuthenticatedPrincipal> = {
    admin: {
      sessionId: 'sess-admin',
      userId: ADMIN_USER,
      platformRole: 'platform_admin',
      sessionScope: 'platform_admin',
      activeOrganizationId: null,
      organizationMembershipId: null,
      organizationRole: null,
      displayName: 'Admin',
      email: 'admin@test.invalid',
      platformUsername: 'admin',
    },
    teacherA: {
      sessionId: 'sess-ta',
      userId: TEACHER_A_USER,
      platformRole: null,
      sessionScope: 'teacher',
      activeOrganizationId: ORG_A,
      organizationMembershipId: TEACHER_A_MEM,
      organizationRole: 'teacher',
      displayName: 'Teacher A',
      email: 'ta@test.invalid',
      platformUsername: null,
    },
    teacherB: {
      sessionId: 'sess-tb',
      userId: TEACHER_B_USER,
      platformRole: null,
      sessionScope: 'teacher',
      activeOrganizationId: ORG_A,
      organizationMembershipId: TEACHER_B_MEM,
      organizationRole: 'teacher',
      displayName: 'Teacher B',
      email: 'tb@test.invalid',
      platformUsername: null,
    },
    teacherUnassigned: {
      sessionId: 'sess-tu',
      userId: TEACHER_UNASSIGNED_USER,
      platformRole: null,
      sessionScope: 'teacher',
      activeOrganizationId: ORG_A,
      organizationMembershipId: TEACHER_UNASSIGNED_MEM,
      organizationRole: 'teacher',
      displayName: 'Teacher U',
      email: 'tu@test.invalid',
      platformUsername: null,
    },
    student1: {
      sessionId: 'sess-s1',
      userId: STUDENT_1_USER,
      platformRole: null,
      sessionScope: 'student',
      activeOrganizationId: ORG_A,
      organizationMembershipId: STUDENT_1_MEM,
      organizationRole: 'student',
      displayName: 'Student 1',
      email: null,
      platformUsername: null,
    },
  };

  const authMiddlewares = makeFakeAuthMiddlewares((h) =>
    h ? actorMap[h] ?? null : null
  );
  const passCsrf = (_req: Request, _res: Response, next: NextFunction) => next();

  const app = express();
  app.use(express.json());
  app.use(
    '/api/v1/observations',
    createObservationsRouter({
      observationService,
      authMiddlewares: authMiddlewares as never,
      authenticatedCsrf: passCsrf as never,
    })
  );
  const { teacherStudentGoalsRouter, teacherGoalsRouter, studentGoalsRouter } =
    createGoalsRouters({
      goalService,
      authMiddlewares: authMiddlewares as never,
      authenticatedCsrf: passCsrf as never,
    });
  app.use('/api/v1/students', teacherStudentGoalsRouter);
  app.use('/api/v1/goals', teacherGoalsRouter);
  app.use('/api/v1/student', studentGoalsRouter);
  app.use(
    '/api/v1/admin/insights',
    createAdminInsightsRouter({
      insightService,
      authMiddlewares: authMiddlewares as never,
    })
  );
  app.use('/api', apiNotFoundHandler);
  app.use('/api', apiErrorHandler);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

function makeSnapshot(
  overrides: Partial<OrgInsightSnapshotRecord> & { contentType: string }
): OrgInsightSnapshotRecord {
  return {
    id: `snap-${overrides.organizationId ?? ORG_A}-${overrides.contentType}`,
    organizationId: overrides.organizationId ?? ORG_A,
    periodType: overrides.periodType ?? 'daily',
    snapshotDate: overrides.snapshotDate ?? '2026-11-17',
    contentType: overrides.contentType,
    eligibleEnrolledStudentsCount: overrides.eligibleEnrolledStudentsCount ?? 10,
    activeStudentsCount: overrides.activeStudentsCount ?? 6,
    attemptsStartedCount: overrides.attemptsStartedCount ?? 12,
    attemptsCompletedCount: overrides.attemptsCompletedCount ?? 10,
    distinctContentUsedCount: overrides.distinctContentUsedCount ?? 4,
    aacAssistedAttemptsCount: overrides.aacAssistedAttemptsCount ?? 3,
    readAloudAssistedAttemptsCount: overrides.readAloudAssistedAttemptsCount ?? 4,
    activeGoalsCount: overrides.activeGoalsCount ?? 7,
    achievedGoalsCount: overrides.achievedGoalsCount ?? 2,
    choiceTrendsSummaryJson:
      overrides.choiceTrendsSummaryJson !== undefined
        ? overrides.choiceTrendsSummaryJson
        : { totalRecordedTurns: 8, emotionKeyCounts: { calm: 5 } },
    computedAt: overrides.computedAt ?? new Date('2026-11-17T12:00:00.000Z'),
  };
}

test('Observations: author-only isolation (co-teacher, unassigned, admin, student denied) + T-OBS-01..04 + soft delete', async () => {
  const world = createFakeWorld();

  await withHttpTestServer(world, async (baseUrl) => {
    // T-OBS-02b: attempt-linked observation auto-populates assignmentId & classId
    const createRes = await fetch(`${baseUrl}/api/v1/observations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-actor': 'teacherA',
      },
      body: JSON.stringify({
        studentMembershipId: STUDENT_1_MEM,
        attemptId: ATTEMPT_1_A,
        noteBody: 'Học sinh bình tĩnh chọn thẻ cảm xúc.',
      }),
    });
    assert.equal(createRes.status, 201);
    const createdJson = (await createRes.json()) as {
      observation: {
        id: string;
        assignmentId: string | null;
        classId: string | null;
        attemptId: string | null;
      };
    };
    assert.equal(createdJson.observation.assignmentId, ASSIGN_A);
    assert.equal(createdJson.observation.classId, CLASS_1);
    assert.equal(createdJson.observation.attemptId, ATTEMPT_1_A);

    const obsId = createdJson.observation.id;

    // T-OBS-01: mismatch assignmentId vs attemptId rejected (422 ATTEMPT_ASSIGNMENT_MISMATCH)
    const mismatchAssign = await fetch(`${baseUrl}/api/v1/observations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-actor': 'teacherA',
      },
      body: JSON.stringify({
        studentMembershipId: STUDENT_1_MEM,
        assignmentId: ASSIGN_A,
        attemptId: ATTEMPT_1_B,
        noteBody: 'Sai bài giao',
      }),
    });
    assert.equal(mismatchAssign.status, 422);
    const mismatchAssignJson = (await mismatchAssign.json()) as { code: string };
    assert.equal(mismatchAssignJson.code, 'ATTEMPT_ASSIGNMENT_MISMATCH');

    // T-OBS-02a: mismatch classId vs attempt's class rejected (422 ASSIGNMENT_CLASS_MISMATCH)
    const mismatchClass = await fetch(`${baseUrl}/api/v1/observations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-actor': 'teacherA',
      },
      body: JSON.stringify({
        studentMembershipId: STUDENT_1_MEM,
        classId: CLASS_2,
        attemptId: ATTEMPT_1_A,
        noteBody: 'Sai lớp',
      }),
    });
    assert.equal(mismatchClass.status, 422);
    const mismatchClassJson = (await mismatchClass.json()) as { code: string };
    assert.equal(mismatchClassJson.code, 'ASSIGNMENT_CLASS_MISMATCH');

    // T-OBS-03: attempt belongs to another student -> rejected (422 ATTEMPT_STUDENT_MISMATCH)
    const crossStudentAttempt = await fetch(`${baseUrl}/api/v1/observations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-actor': 'teacherA',
      },
      body: JSON.stringify({
        studentMembershipId: STUDENT_1_MEM,
        attemptId: ATTEMPT_2_A,
        noteBody: 'Nhầm học sinh',
      }),
    });
    assert.equal(crossStudentAttempt.status, 422);

    // T-OBS-03b: unassigned teacher denied
    const unassignedCreate = await fetch(`${baseUrl}/api/v1/observations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-actor': 'teacherUnassigned',
      },
      body: JSON.stringify({
        studentMembershipId: STUDENT_1_MEM,
        noteBody: 'Không phụ trách lớp',
      }),
    });
    assert.equal(unassignedCreate.status, 403);

    // T-OBS-04: Author-only isolation — co-teacher (teacherB in CLASS_1) gets empty list and 404 on GET/PATCH/DELETE
    const coTeacherList = await fetch(`${baseUrl}/api/v1/observations`, {
      headers: { 'x-test-actor': 'teacherB' },
    });
    assert.equal(coTeacherList.status, 200);
    const coListJson = (await coTeacherList.json()) as { items: unknown[] };
    assert.equal(coListJson.items.length, 0);

    const coTeacherGet = await fetch(`${baseUrl}/api/v1/observations/${obsId}`, {
      headers: { 'x-test-actor': 'teacherB' },
    });
    assert.equal(coTeacherGet.status, 404);

    const coTeacherPatch = await fetch(`${baseUrl}/api/v1/observations/${obsId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-test-actor': 'teacherB',
      },
      body: JSON.stringify({ noteBody: 'Cố sửa ghi chú của giáo viên A' }),
    });
    assert.equal(coTeacherPatch.status, 404);

    const coTeacherDel = await fetch(`${baseUrl}/api/v1/observations/${obsId}`, {
      method: 'DELETE',
      headers: { 'x-test-actor': 'teacherB' },
    });
    assert.equal(coTeacherDel.status, 404);

    // Platform Admin and Student get 403 on all observation endpoints
    for (const actor of ['admin', 'student1']) {
      const rGet = await fetch(`${baseUrl}/api/v1/observations/${obsId}`, {
        headers: { 'x-test-actor': actor },
      });
      assert.equal(rGet.status, 403);
      const rList = await fetch(`${baseUrl}/api/v1/observations`, {
        headers: { 'x-test-actor': actor },
      });
      assert.equal(rList.status, 403);
    }

    // Author Teacher A updates and soft-deletes own observation
    const patchRes = await fetch(`${baseUrl}/api/v1/observations/${obsId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-test-actor': 'teacherA',
      },
      body: JSON.stringify({ noteBody: 'Đã cập nhật ghi chú sư phạm.' }),
    });
    assert.equal(patchRes.status, 200);

    const delRes = await fetch(`${baseUrl}/api/v1/observations/${obsId}`, {
      method: 'DELETE',
      headers: { 'x-test-actor': 'teacherA' },
    });
    assert.equal(delRes.status, 200);

    const afterDelGet = await fetch(`${baseUrl}/api/v1/observations/${obsId}`, {
      headers: { 'x-test-actor': 'teacherA' },
    });
    assert.equal(afterDelGet.status, 404);
  });

  // Verify zero noteBody ever touched audit logs
  for (const a of world.audits) {
    assert.equal(
      JSON.stringify(a.metadata ?? {}).includes('ghi chú'),
      false
    );
  }
});

test('Student Profiles & SEL Goals: Teacher assigned CRUD, Student self-only read, SEL safety & audit redaction', async () => {
  const world = createFakeWorld();

  await withHttpTestServer(world, async (baseUrl) => {
    // Reject diagnostic/gamified keys in supportPreferencesJson
    const badPrefRes = await fetch(
      `${baseUrl}/api/v1/students/${STUDENT_1_MEM}/profile`,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-test-actor': 'teacherA',
        },
        body: JSON.stringify({
          supportPreferencesJson: {
            aacEnabled: true,
            diagnosis: 'clinical label',
          },
        }),
      }
    );
    assert.equal(badPrefRes.status, 422);

    // Valid accessibility profile update by assigned teacher
    const okPrefRes = await fetch(
      `${baseUrl}/api/v1/students/${STUDENT_1_MEM}/profile`,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-test-actor': 'teacherA',
        },
        body: JSON.stringify({
          preferredName: 'Bé An',
          supportPreferencesJson: {
            preferredCommunicationMode: 'aac',
            aacEnabled: true,
            readAloudEnabled: true,
            speechRate: 'slow',
            visualContrast: 'soft',
            reducedMotion: true,
          },
        }),
      }
    );
    assert.equal(okPrefRes.status, 200);

    // Unassigned teacher blocked (403)
    const unassignedProf = await fetch(
      `${baseUrl}/api/v1/students/${STUDENT_1_MEM}/profile`,
      {
        headers: { 'x-test-actor': 'teacherUnassigned' },
      }
    );
    assert.equal(unassignedProf.status, 403);

    // Admin blocked from teacher student profile/goals endpoints (403)
    const adminProf = await fetch(
      `${baseUrl}/api/v1/students/${STUDENT_1_MEM}/profile`,
      {
        headers: { 'x-test-actor': 'admin' },
      }
    );
    assert.equal(adminProf.status, 403);

    // Reject clinical/ranking SEL goal text and invalid calendar date
    const badGoalRes = await fetch(
      `${baseUrl}/api/v1/students/${STUDENT_1_MEM}/goals`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-actor': 'teacherA',
        },
        body: JSON.stringify({
          title: 'Mục tiêu vượt mặt bạn đạt top student',
        }),
      }
    );
    assert.equal(badGoalRes.status, 422);

    const badDateRes = await fetch(
      `${baseUrl}/api/v1/students/${STUDENT_1_MEM}/goals`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-actor': 'teacherA',
        },
        body: JSON.stringify({
          title: 'Thực hành gọi tên cảm xúc nhẹ nhàng',
          targetDate: '2026-02-30',
        }),
      }
    );
    assert.equal(badDateRes.status, 422);

    // Valid goal create -> update status to achieved -> archive
    const createGoalRes = await fetch(
      `${baseUrl}/api/v1/students/${STUDENT_1_MEM}/goals`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-actor': 'teacherA',
        },
        body: JSON.stringify({
          classId: CLASS_1,
          title: 'Nhận biết khi bản thân cần nghỉ ngơi',
          description: 'Chọn thẻ tạm nghỉ khi cảm thấy quá tải âm thanh.',
          focusArea: 'self_regulation',
          targetDate: '2026-12-15',
        }),
      }
    );
    assert.equal(createGoalRes.status, 201);
    const createdGoal = (await createGoalRes.json()) as {
      goal: { id: string; status: string; achievedAt: string | null };
    };
    assert.equal(createdGoal.goal.status, 'active');
    assert.equal(createdGoal.goal.achievedAt, null);

    // Student self-access sees own profile & goals (read-only)
    const selfProfileRes = await fetch(`${baseUrl}/api/v1/student/profile`, {
      headers: { 'x-test-actor': 'student1' },
    });
    assert.equal(selfProfileRes.status, 200);
    const selfProfileJson = (await selfProfileRes.json()) as {
      profile: { preferredName: string; studentMembershipId: string };
    };
    assert.equal(selfProfileJson.profile.preferredName, 'Bé An');
    assert.equal(selfProfileJson.profile.studentMembershipId, STUDENT_1_MEM);

    const selfGoalsRes = await fetch(`${baseUrl}/api/v1/student/goals`, {
      headers: { 'x-test-actor': 'student1' },
    });
    assert.equal(selfGoalsRes.status, 200);
    const selfGoalsJson = (await selfGoalsRes.json()) as {
      items: Array<{ id: string }>;
    };
    assert.equal(selfGoalsJson.items.length, 1);

    // Student blocked from mutating goals or reading /students/:id/goals
    const studentTeacherEndpoint = await fetch(
      `${baseUrl}/api/v1/students/${STUDENT_1_MEM}/goals`,
      { headers: { 'x-test-actor': 'student1' } }
    );
    assert.equal(studentTeacherEndpoint.status, 403);

    // Mark achieved
    const achieveRes = await fetch(
      `${baseUrl}/api/v1/goals/${createdGoal.goal.id}`,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-test-actor': 'teacherA',
        },
        body: JSON.stringify({ status: 'achieved' }),
      }
    );
    assert.equal(achieveRes.status, 200);
    const achievedJson = (await achieveRes.json()) as {
      goal: { status: string; achievedAt: string | null };
    };
    assert.equal(achievedJson.goal.status, 'achieved');
    assert.ok(achievedJson.goal.achievedAt);

    // Archive goal via DELETE
    const archiveRes = await fetch(
      `${baseUrl}/api/v1/goals/${createdGoal.goal.id}`,
      {
        method: 'DELETE',
        headers: { 'x-test-actor': 'teacherA' },
      }
    );
    assert.equal(archiveRes.status, 200);
    const archivedJson = (await archiveRes.json()) as {
      goal: { status: string };
    };
    assert.equal(archivedJson.goal.status, 'archived');

    // Student list hides archived goals
    const selfGoalsAfterArchive = await fetch(`${baseUrl}/api/v1/student/goals`, {
      headers: { 'x-test-actor': 'student1' },
    });
    const afterJson = (await selfGoalsAfterArchive.json()) as {
      items: unknown[];
    };
    assert.equal(afterJson.items.length, 0);
  });

  // Verify audit service strictly rejects goal title/description and supportPreferences
  assert.throws(() =>
    buildAuditLogRow({
      organizationId: ORG_A,
      actorUserId: TEACHER_A_USER,
      actorRole: 'teacher',
      eventType: 'security.unauthorized_access_denied',
      targetType: 'student_goal',
      metadata: { title: 'Secret goal title' },
    })
  );
  assert.throws(() =>
    buildAuditLogRow({
      organizationId: ORG_A,
      actorUserId: TEACHER_A_USER,
      actorRole: 'teacher',
      eventType: 'security.unauthorized_access_denied',
      targetType: 'teacher_observation',
      metadata: { noteBody: 'Secret note' },
    })
  );
  assert.throws(() =>
    buildAuditLogRow({
      organizationId: ORG_A,
      actorUserId: TEACHER_A_USER,
      actorRole: 'teacher',
      eventType: 'security.unauthorized_access_denied',
      targetType: 'student_profile',
      metadata: { supportPreferencesJson: { aacEnabled: true } },
    })
  );
  assert.ok(createGoalRepository);
});

test('Insights k=5 threshold, N-1 complement protection, complementary suppression, and null propagation', () => {
  // 1. Cohort 4 suppressed completely (counts, rates, goals, choiceTrends all null — never 0)
  const threshold4 = evaluateRowThreshold({
    eligibleEnrolledStudentsCount: 10,
    activeStudentsCount: 4,
  });
  assert.equal(threshold4.isPrimarySuppressed, true);
  assert.equal(threshold4.reason, 'COHORT_BELOW_THRESHOLD');

  const thresholdEligible4 = evaluateRowThreshold({
    eligibleEnrolledStudentsCount: 4,
    activeStudentsCount: 4,
  });
  assert.equal(thresholdEligible4.isPrimarySuppressed, true);

  // 2. N-1 complement protection: eligible=7, active=5 => inactiveComplement = 2 (in 1..4) => suppressed!
  const complementRisk = evaluateRowThreshold({
    eligibleEnrolledStudentsCount: 7,
    activeStudentsCount: 5,
  });
  assert.equal(complementRisk.isPrimarySuppressed, true);
  assert.equal(complementRisk.reason, 'COMPLEMENT_REIDENTIFICATION_RISK');

  // 3. Passing cohort: eligible=10, active=5 (inactiveComplement = 5)
  const passing5 = evaluateRowThreshold({
    eligibleEnrolledStudentsCount: 10,
    activeStudentsCount: 5,
  });
  assert.equal(passing5.isPrimarySuppressed, false);

  // 4. Complementary suppression: 1 canonical category < 5 + 4 >= 5 + 'all' visible
  // Must suppress the 1 primary category AND the smallest passing category ('social_story_card')!
  const rowsSingleSuppressed: OrgInsightSnapshotRecord[] = [
    makeSnapshot({
      contentType: 'all',
      eligibleEnrolledStudentsCount: 20,
      activeStudentsCount: 12,
      attemptsStartedCount: 40,
      attemptsCompletedCount: 35,
    }),
    makeSnapshot({
      contentType: 'emotion_card',
      eligibleEnrolledStudentsCount: 20,
      activeStudentsCount: 10,
      attemptsStartedCount: 15,
    }),
    makeSnapshot({
      contentType: 'situation_card',
      eligibleEnrolledStudentsCount: 20,
      activeStudentsCount: 8,
      attemptsStartedCount: 10,
    }),
    makeSnapshot({
      contentType: 'action_card',
      eligibleEnrolledStudentsCount: 20,
      activeStudentsCount: 7,
      attemptsStartedCount: 8,
    }),
    makeSnapshot({
      contentType: 'social_story_card',
      eligibleEnrolledStudentsCount: 20,
      activeStudentsCount: 5,
      attemptsStartedCount: 5,
    }),
    makeSnapshot({
      contentType: 'communication_card',
      eligibleEnrolledStudentsCount: 20,
      activeStudentsCount: 2,
      attemptsStartedCount: 2,
    }),
  ];

  const suppressed = applyOrgPeriodSuppression(rowsSingleSuppressed);
  assert.equal(suppressed.overall?.suppression.isSuppressed, false);
  assert.equal(suppressed.overall?.participation.activeStudentsCount, 12);

  const byType = new Map(
    suppressed.byContentType.map((c) => [c.contentType, c])
  );
  // Primary suppressed
  const comm = byType.get('communication_card')!;
  assert.equal(comm.suppression.isSuppressed, true);
  assert.equal(comm.suppression.suppressionReason, 'COHORT_BELOW_THRESHOLD');
  assert.equal(comm.participation.activeStudentsCount, null);
  assert.equal(comm.participation.attemptsStartedCount, null);
  assert.equal(comm.participation.participationRatePercent, null);
  assert.equal(comm.participation.completionRatePercent, null);
  assert.equal(comm.breadthOfExperience.distinctContentUsedCount, null);
  assert.equal(comm.choiceTrends.summary, null);
  assert.equal(comm.supportUse.aacAssistedAttemptsCount, null);
  assert.equal(comm.supportUse.aacSupportRatePercent, null);
  assert.equal(comm.goals.activeGoalsCount, null);
  assert.equal(comm.goals.achievedGoalsCount, null);

  // Complementary suppressed partner (smallest passing cell: social_story_card with active=5)
  const story = byType.get('social_story_card')!;
  assert.equal(story.suppression.isSuppressed, true);
  assert.equal(story.suppression.suppressionReason, 'COMPLEMENTARY_SUPPRESSION');
  assert.equal(story.participation.activeStudentsCount, null);
  assert.equal(story.participation.attemptsStartedCount, null);
  assert.equal(story.choiceTrends.summary, null);

  // Remaining 3 categories stay visible
  assert.equal(byType.get('emotion_card')?.suppression.isSuppressed, false);
  assert.equal(byType.get('situation_card')?.suppression.isSuppressed, false);
  assert.equal(byType.get('action_card')?.suppression.isSuppressed, false);

  // 5. Majority (>= 3 of 5) below threshold => suppress entire breakdown table
  const rowsMajoritySuppressed: OrgInsightSnapshotRecord[] = [
    makeSnapshot({
      contentType: 'all',
      eligibleEnrolledStudentsCount: 12,
      activeStudentsCount: 6,
      attemptsStartedCount: 15,
    }),
    makeSnapshot({
      contentType: 'emotion_card',
      eligibleEnrolledStudentsCount: 12,
      activeStudentsCount: 5,
    }),
    makeSnapshot({
      contentType: 'situation_card',
      eligibleEnrolledStudentsCount: 12,
      activeStudentsCount: 5,
    }),
    makeSnapshot({
      contentType: 'action_card',
      eligibleEnrolledStudentsCount: 12,
      activeStudentsCount: 2,
    }),
    makeSnapshot({
      contentType: 'social_story_card',
      eligibleEnrolledStudentsCount: 12,
      activeStudentsCount: 1,
    }),
    makeSnapshot({
      contentType: 'communication_card',
      eligibleEnrolledStudentsCount: 12,
      activeStudentsCount: 0,
    }),
  ];

  const majorityRes = applyOrgPeriodSuppression(rowsMajoritySuppressed);
  assert.equal(majorityRes.overall?.suppression.isSuppressed, false);
  assert.equal(
    majorityRes.byContentType.every((c) => c.suppression.isSuppressed),
    true
  );
});

test('Admin Insights HTTP: platform_admin-only, anti-differencing filter guard, fixed periods, and deterministic rollup', async () => {
  const world = createFakeWorld();

  // Seed deterministic source fixtures for computeAndUpsertOrgInsightSnapshots (cohort=5 passes; 1 type=1 triggers complementary suppression)
  const eligibleA = [
    STUDENT_1_MEM,
    STUDENT_2_MEM,
    '01950000-0000-7000-8000-000000000121',
    '01950000-0000-7000-8000-000000000122',
    '01950000-0000-7000-8000-000000000123',
    '01950000-0000-7000-8000-000000000124',
    '01950000-0000-7000-8000-000000000125',
    '01950000-0000-7000-8000-000000000126',
    '01950000-0000-7000-8000-000000000127',
    '01950000-0000-7000-8000-000000000128',
  ];
  const attemptsA: SnapshotSourceAttemptRow[] = eligibleA
    .slice(0, 5)
    .map((sId, idx) => ({
      attemptId: `att-a-${idx}`,
      studentMembershipId: sId,
      contentItemId: 'item-1',
      contentType: 'emotion_card',
      status: 'completed',
      startedAt: new Date('2026-11-17T08:00:00.000Z'),
      completedAt: new Date('2026-11-17T08:05:00.000Z'),
      usedAacSupport: idx < 2,
      usedReadAloud: true,
    }));

  const fakeComputeRepo = createFakeInsightRepo(world, {
    eligibleStudentsByOrg: new Map([[ORG_A, eligibleA]]),
    attemptsByOrg: new Map([[ORG_A, attemptsA]]),
    turnsByOrg: new Map([
      [
        ORG_A,
        [
          {
            attemptId: 'att-a-0',
            selectedChoiceKey: 'take_breath',
            selectedEmotionKey: 'calm',
          },
        ],
      ],
    ]),
    goalsByOrg: new Map([
      [
        ORG_A,
        [
          {
            id: 'g-1',
            status: 'active',
            createdAt: new Date('2026-11-17T05:00:00.000Z'),
            achievedAt: null,
          },
          {
            id: 'g-2',
            status: 'achieved',
            createdAt: new Date('2026-11-16T05:00:00.000Z'),
            achievedAt: new Date('2026-11-17T07:00:00.000Z'),
          },
        ],
      ],
    ]),
  });

  const computeSvc = createInsightService({ insightRepo: fakeComputeRepo });
  const computedRows = await computeSvc.computeAndUpsertOrgInsightSnapshots({
    organizationId: ORG_A,
    periodType: 'daily',
    snapshotDate: '2026-11-17',
    now: new Date('2026-11-17T15:00:00.000Z'),
  });
  assert.equal(computedRows.length, 1 + CANONICAL_CONTENT_TYPES.length);

  await withHttpTestServer(world, async (baseUrl) => {
    // Teacher & Student blocked (403)
    for (const actor of ['teacherA', 'student1']) {
      const denied = await fetch(`${baseUrl}/api/v1/admin/insights`, {
        headers: { 'x-test-actor': actor },
      });
      assert.equal(denied.status, 403);
    }

    // Anti-differencing filters rejected (422)
    for (const badQuery of [
      `studentId=${STUDENT_1_MEM}`,
      `classId=${CLASS_1}`,
      `teacherId=${TEACHER_A_MEM}`,
      `startDate=2026-11-01&endDate=2026-11-14`,
      `unknownParam=1`,
      `periodType=weekly&snapshotDate=2026-11-17`, // Tuesday, not Monday!
      `periodType=monthly&snapshotDate=2026-11-02`, // Not 1st of month!
    ]) {
      const badRes = await fetch(
        `${baseUrl}/api/v1/admin/insights?${badQuery}`,
        { headers: { 'x-test-actor': 'admin' } }
      );
      assert.equal(badRes.status, 422, `Expected 422 for query: ${badQuery}`);
    }

    // Valid Platform Admin query returns suppressed breakdown (since 4/5 categories have 0) & visible overall (5 active / 10 eligible)
    const okRes = await fetch(
      `${baseUrl}/api/v1/admin/insights?organizationId=${ORG_A}&periodType=daily&snapshotDate=2026-11-17`,
      { headers: { 'x-test-actor': 'admin' } }
    );
    assert.equal(okRes.status, 200);
    const json = (await okRes.json()) as {
      insights: {
        platformSummary: {
          participation: {
            activeStudentsCount: number | null;
            eligibleEnrolledStudentsCount: number | null;
          };
          breadthOfExperience: { distinctContentUsedCount: number | null };
          goals: { activeGoalsCount: number | null; achievedGoalsCount: number | null };
          supportUse: { aacAssistedAttemptsCount: number | null };
          choiceTrends: { summary: { totalRecordedTurns?: number } | null };
        };
        organizations: Array<{
          byContentType: Array<{
            contentType: string;
            suppression: { isSuppressed: boolean };
          }>;
        }>;
      };
    };

    assert.equal(json.insights.platformSummary.participation.activeStudentsCount, 5);
    assert.equal(
      json.insights.platformSummary.participation.eligibleEnrolledStudentsCount,
      10
    );
    assert.equal(
      json.insights.platformSummary.breadthOfExperience.distinctContentUsedCount,
      1
    );
    assert.equal(json.insights.platformSummary.goals.activeGoalsCount, 1);
    assert.equal(json.insights.platformSummary.goals.achievedGoalsCount, 1);
    assert.equal(json.insights.platformSummary.supportUse.aacAssistedAttemptsCount, 2);
    assert.equal(
      json.insights.platformSummary.choiceTrends.summary?.totalRecordedTurns,
      1
    );

    // Since 4 of 5 categories had active=0 (<5), ALL 5 breakdown cells must be suppressed
    assert.equal(
      json.insights.organizations[0].byContentType.every(
        (c) => c.suppression.isSuppressed
      ),
      true
    );

    // Single-contentType request CANNOT bypass complementary suppression
    const bypassAttempt = await fetch(
      `${baseUrl}/api/v1/admin/insights?organizationId=${ORG_A}&periodType=daily&snapshotDate=2026-11-17&contentType=emotion_card`,
      { headers: { 'x-test-actor': 'admin' } }
    );
    assert.equal(bypassAttempt.status, 200);
    const bypassJson = (await bypassAttempt.json()) as {
      insights: {
        platformSummary: {
          suppression: { isSuppressed: boolean; suppressionReason: string };
          participation: { activeStudentsCount: number | null };
        };
      };
    };
    assert.equal(bypassJson.insights.platformSummary.suppression.isSuppressed, true);
    assert.equal(
      bypassJson.insights.platformSummary.suppression.suppressionReason,
      'COMPLEMENTARY_SUPPRESSION'
    );
    assert.equal(
      bypassJson.insights.platformSummary.participation.activeStudentsCount,
      null
    );
  });
});
