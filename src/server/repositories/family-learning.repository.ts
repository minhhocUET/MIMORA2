import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import {
  assignments,
  assignmentProgress,
  assignmentTargets,
} from '../db/schema/assignments.ts';
import { contentItems, contentVersions } from '../db/schema/content.ts';
import {
  familyStudents,
  familyWorkspaces,
  guardianStudentLinks,
} from '../db/schema/family.ts';
import {
  familyActivityAttempts,
  familyActivityAttemptTurns,
  familyProgramEnrollments,
  familyProgramItems,
  familyPrograms,
  familyProgramVersions,
  studentFamilyPreferences,
} from '../db/schema/family-learning.ts';
import {
  organizationMemberships,
  organizations,
  users,
} from '../db/schema/identity.ts';
import {
  getDb,
  withTransaction,
  type MimoraDatabase,
  type MimoraTransaction,
} from '../db/tidb.ts';

export type FamilyLearningDbOrTx = MimoraDatabase | MimoraTransaction;

export const FAMILY_PROGRAM_AVAILABILITY_MODES = [
  'admin_assigned',
  'free_family',
] as const;
export type FamilyProgramAvailabilityMode =
  (typeof FAMILY_PROGRAM_AVAILABILITY_MODES)[number];

export const FAMILY_PROGRAM_STATUSES = ['draft', 'published', 'retired'] as const;
export type FamilyProgramStatus = (typeof FAMILY_PROGRAM_STATUSES)[number];

export const FAMILY_ENROLLMENT_SOURCES = ['admin_grant', 'free_program'] as const;
export type FamilyEnrollmentSource = (typeof FAMILY_ENROLLMENT_SOURCES)[number];

export const FAMILY_ATTEMPT_STATUSES = [
  'in_progress',
  'completed',
  'abandoned',
] as const;
export type FamilyAttemptStatus = (typeof FAMILY_ATTEMPT_STATUSES)[number];

export interface FamilyProgramRecord {
  id: string;
  slug: string;
  availabilityMode: string;
  status: string;
  currentPublishedVersionId: string | null;
  createdByUserId: string;
  retiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FamilyProgramVersionRecord {
  id: string;
  familyProgramId: string;
  versionNumber: number;
  status: string;
  title: string;
  description: string | null;
  locale: string;
  ageBand: string | null;
  availabilityMode: string;
  createdByUserId: string;
  publishedByUserId: string | null;
  publishedAt: Date | null;
  retiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FamilyProgramItemJoinedRecord {
  id: string;
  familyProgramVersionId: string;
  chapterNumber: number;
  chapterTitle: string;
  sortOrder: number;
  contentVersionId: string;
  createdAt: Date;
  contentItemId: string;
  contentSlug: string;
  contentType: string;
  contentVersionNumber: number;
  contentStatus: string;
  contentTitle: string;
  contentSummary: string | null;
  contentLocale: string;
  payloadJson: Record<string, unknown>;
  metadataJson: Record<string, unknown> | null;
  publishedAt: Date | null;
}

export interface PublishedContentVersionLookupRecord {
  id: string;
  contentItemId: string;
  slug: string;
  contentType: string;
  versionNumber: number;
  status: string;
  isArchived: boolean;
  title: string;
  summary: string | null;
  locale: string;
}

export interface FamilyProgramEnrollmentRecord {
  id: string;
  familyWorkspaceId: string;
  studentUserId: string;
  familyProgramId: string;
  familyProgramVersionId: string;
  activationSource: string;
  activatedByUserId: string;
  status: string;
  learningStatus: string;
  totalActivities: number;
  completedActivities: number;
  startedAt: Date | null;
  lastActivityAt: Date | null;
  completedAt: Date | null;
  activatedAt: Date;
  revokedAt: Date | null;
  revokedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminEnrollmentRosterRecord {
  enrollment: FamilyProgramEnrollmentRecord;
  workspaceCode: string;
  workspaceName: string;
  studentDisplayName: string;
  familyUsername: string | null;
  versionNumber: number;
  programTitle: string;
}

export interface AdminFamilyWorkspaceCandidateRecord {
  workspaceId: string;
  workspaceCode: string;
  workspaceName: string;
  students: Array<{
    studentUserId: string;
    displayName: string;
    familyUsername: string;
    activeGuardianCount: number;
  }>;
}

export interface FamilyActivityAttemptRecord {
  id: string;
  enrollmentId: string;
  familyWorkspaceId: string;
  studentUserId: string;
  familyProgramVersionId: string;
  familyProgramItemId: string;
  contentVersionId: string;
  attemptNumber: number;
  startIdempotencyKey: string | null;
  status: string;
  startedAt: Date;
  lastInteractedAt: Date;
  completedAt: Date | null;
  durationSeconds: number;
  usedAacSupport: boolean;
  usedReadAloud: boolean;
  aacTapCount: number;
  readAloudCount: number;
  responseSummaryJson: Record<string, unknown> | null;
}

export interface FamilyActivityAttemptTurnRecord {
  id: string;
  studentUserId: string;
  attemptId: string;
  turnIndex: number;
  stepKey: string;
  selectedChoiceKey: string | null;
  selectedEmotionKey: string | null;
  usedAac: boolean;
  usedReadAloud: boolean;
  responsePayloadJson: Record<string, unknown> | null;
  respondedAt: Date;
}

export interface StudentFamilyPreferencesRecord {
  id: string;
  studentUserId: string;
  preferredName: string | null;
  supportPreferencesJson: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StudentEnrollmentJoinedRecord {
  enrollment: FamilyProgramEnrollmentRecord;
  program: FamilyProgramRecord;
  version: FamilyProgramVersionRecord;
  workspaceCode: string;
  workspaceName: string;
}

export interface GuardianLinkedStudentSummary {
  studentUserId: string;
  studentDisplayName: string;
  studentStatus: string;
  workspaceIds: string[];
}

export interface GuardianFamilyEnrollmentOverviewRow {
  enrollment: FamilyProgramEnrollmentRecord;
  workspaceName: string;
  workspaceCode: string;
  programTitle: string;
  versionNumber: number;
  items: Array<{
    itemId: string;
    chapterNumber: number;
    chapterTitle: string;
    sortOrder: number;
  }>;
  completedItemIds: string[];
}

export interface GuardianSchoolAssignmentOverviewRow {
  assignmentTargetId: string;
  organizationId: string;
  organizationName: string;
  assignmentTitle: string;
  assignmentStatus: string;
  assignedAt: Date;
  totalItems: number;
  completedItems: number;
  progressStatus: string;
  startedAt: Date | null;
  lastActivityAt: Date | null;
  completedAt: Date | null;
}

export interface FamilyLearningRepository {
  withTransaction<T>(fn: (tx: MimoraTransaction) => Promise<T>): Promise<T>;

  // Programs & Versions (Admin + Catalog)
  findProgramBySlug(
    slug: string,
    executor?: FamilyLearningDbOrTx
  ): Promise<FamilyProgramRecord | null>;
  findProgramById(
    programId: string,
    executor?: FamilyLearningDbOrTx
  ): Promise<FamilyProgramRecord | null>;
  listPrograms(executor?: FamilyLearningDbOrTx): Promise<FamilyProgramRecord[]>;
  listProgramVersions(
    programId: string,
    executor?: FamilyLearningDbOrTx
  ): Promise<FamilyProgramVersionRecord[]>;
  listAllLatestVersions(
    programIds: string[],
    executor?: FamilyLearningDbOrTx
  ): Promise<FamilyProgramVersionRecord[]>;
  findProgramVersionById(
    versionId: string,
    executor?: FamilyLearningDbOrTx
  ): Promise<FamilyProgramVersionRecord | null>;
  listProgramVersionItemsJoined(
    versionId: string,
    executor?: FamilyLearningDbOrTx
  ): Promise<FamilyProgramItemJoinedRecord[]>;
  findPublishedContentVersionsByIds(
    ids: string[],
    executor?: FamilyLearningDbOrTx
  ): Promise<PublishedContentVersionLookupRecord[]>;
  createProgramWithDraftVersion(
    params: {
      program: typeof familyPrograms.$inferInsert;
      version: typeof familyProgramVersions.$inferInsert;
      items: Array<typeof familyProgramItems.$inferInsert>;
    },
    executor?: FamilyLearningDbOrTx
  ): Promise<void>;
  createDraftProgramVersion(
    params: {
      version: typeof familyProgramVersions.$inferInsert;
      items: Array<typeof familyProgramItems.$inferInsert>;
    },
    executor?: FamilyLearningDbOrTx
  ): Promise<void>;
  updateDraftProgramVersionAndItems(
    params: {
      programId: string;
      versionId: string;
      availabilityMode: string;
      title: string;
      description: string | null;
      locale: string;
      ageBand: string | null;
      items: Array<typeof familyProgramItems.$inferInsert>;
      now: Date;
    },
    executor?: FamilyLearningDbOrTx
  ): Promise<void>;
  publishProgramVersion(
    params: {
      programId: string;
      versionId: string;
      availabilityMode: string;
      publishedByUserId: string;
      now: Date;
    },
    executor?: FamilyLearningDbOrTx
  ): Promise<void>;
  retireProgram(
    params: {
      programId: string;
      now: Date;
    },
    executor?: FamilyLearningDbOrTx
  ): Promise<void>;
  retireProgramVersion(
    params: {
      programId: string;
      versionId: string;
      now: Date;
    },
    executor?: FamilyLearningDbOrTx
  ): Promise<void>;
  listEnrollmentsForProgram(
    programId: string,
    executor?: FamilyLearningDbOrTx
  ): Promise<AdminEnrollmentRosterRecord[]>;

  // Admin Workspace/Student Eligibility Lookup & Enrollments
  listEligibleFamilyWorkspacesForAdmin(
    search?: string,
    executor?: FamilyLearningDbOrTx
  ): Promise<AdminFamilyWorkspaceCandidateRecord[]>;
  verifyStudentEligibleForFamilyWorkspace(
    params: {
      familyWorkspaceId: string;
      studentUserId: string;
    },
    executor?: FamilyLearningDbOrTx
  ): Promise<{
    eligible: boolean;
    reason?: string;
  }>;
  findActiveEnrollment(
    params: {
      familyWorkspaceId: string;
      studentUserId: string;
      familyProgramId: string;
    },
    executor?: FamilyLearningDbOrTx
  ): Promise<FamilyProgramEnrollmentRecord | null>;
  findEnrollmentById(
    enrollmentId: string,
    executor?: FamilyLearningDbOrTx
  ): Promise<FamilyProgramEnrollmentRecord | null>;
  createEnrollment(
    record: typeof familyProgramEnrollments.$inferInsert,
    executor?: FamilyLearningDbOrTx
  ): Promise<void>;
  revokeEnrollment(
    params: {
      enrollmentId: string;
      revokedByUserId: string;
      now: Date;
    },
    executor?: FamilyLearningDbOrTx
  ): Promise<boolean>;

  // Guardian Discovery & Progress Overview (Option B)
  listPublishedFreePrograms(executor?: FamilyLearningDbOrTx): Promise<
    Array<{
      program: FamilyProgramRecord;
      version: FamilyProgramVersionRecord;
      itemCount: number;
    }>
  >;
  getGuardianLinkedStudentOverview(
    guardianUserId: string,
    studentUserId: string,
    executor?: FamilyLearningDbOrTx
  ): Promise<GuardianLinkedStudentSummary | null>;
  listFamilyEnrollmentsForGuardianOverview(
    params: {
      studentUserId: string;
      workspaceIds: string[];
    },
    executor?: FamilyLearningDbOrTx
  ): Promise<GuardianFamilyEnrollmentOverviewRow[]>;
  listSchoolAssignmentsForGuardianOverview(
    studentUserId: string,
    executor?: FamilyLearningDbOrTx
  ): Promise<GuardianSchoolAssignmentOverviewRow[]>;

  // Student Learning & Family Attempts
  listActiveStudentEnrollments(
    studentUserId: string,
    executor?: FamilyLearningDbOrTx
  ): Promise<StudentEnrollmentJoinedRecord[]>;
  findActiveStudentEnrollmentById(
    studentUserId: string,
    enrollmentId: string,
    executor?: FamilyLearningDbOrTx
  ): Promise<StudentEnrollmentJoinedRecord | null>;
  listFamilyAttemptsForEnrollment(
    studentUserId: string,
    enrollmentId: string,
    executor?: FamilyLearningDbOrTx
  ): Promise<FamilyActivityAttemptRecord[]>;
  findFamilyAttemptByIdForStudent(
    studentUserId: string,
    attemptId: string,
    executor?: FamilyLearningDbOrTx
  ): Promise<FamilyActivityAttemptRecord | null>;
  findInProgressFamilyAttempt(
    enrollmentId: string,
    familyProgramItemId: string,
    executor?: FamilyLearningDbOrTx
  ): Promise<FamilyActivityAttemptRecord | null>;
  findFamilyAttemptByIdempotencyKey(
    enrollmentId: string,
    familyProgramItemId: string,
    idempotencyKey: string,
    executor?: FamilyLearningDbOrTx
  ): Promise<FamilyActivityAttemptRecord | null>;
  countFamilyAttemptsForItem(
    enrollmentId: string,
    familyProgramItemId: string,
    executor?: FamilyLearningDbOrTx
  ): Promise<{ total: number; completed: number; maxAttemptNumber?: number }>;
  createFamilyAttempt(
    attempt: typeof familyActivityAttempts.$inferInsert,
    executor?: FamilyLearningDbOrTx
  ): Promise<FamilyActivityAttemptRecord>;
  listTurnsForFamilyAttempt(
    studentUserId: string,
    attemptId: string,
    executor?: FamilyLearningDbOrTx
  ): Promise<FamilyActivityAttemptTurnRecord[]>;
  findTurnForFamilyAttempt(
    studentUserId: string,
    attemptId: string,
    turnIndex: number,
    executor?: FamilyLearningDbOrTx
  ): Promise<FamilyActivityAttemptTurnRecord | null>;
  insertFamilyTurnAndUpdateAttempt(
    params: {
      turn: typeof familyActivityAttemptTurns.$inferInsert;
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
    },
    executor?: FamilyLearningDbOrTx
  ): Promise<FamilyActivityAttemptRecord>;
  updateFamilyAttemptTerminalState(
    params: {
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
    },
    executor?: FamilyLearningDbOrTx
  ): Promise<FamilyActivityAttemptRecord>;
  recomputeAndUpdateEnrollmentProgress(
    params: {
      enrollmentId: string;
      studentUserId: string;
      totalActivities: number;
      fallbackActivityAt: Date;
      now: Date;
    },
    executor?: FamilyLearningDbOrTx
  ): Promise<FamilyProgramEnrollmentRecord>;

  // Student Family Preferences (canonical user-level)
  findStudentFamilyPreferences(
    studentUserId: string,
    executor?: FamilyLearningDbOrTx
  ): Promise<StudentFamilyPreferencesRecord | null>;
  upsertStudentFamilyPreferences(
    params: {
      id: string;
      studentUserId: string;
      preferredName: string | null;
      supportPreferencesJson: Record<string, unknown> | null;
      now: Date;
    },
    executor?: FamilyLearningDbOrTx
  ): Promise<StudentFamilyPreferencesRecord>;
}

export function createFamilyLearningRepository(): FamilyLearningRepository {
  const resolveDb = (executor?: FamilyLearningDbOrTx) => executor ?? getDb();

  return {
    withTransaction<T>(fn: (tx: MimoraTransaction) => Promise<T>): Promise<T> {
      return withTransaction(fn);
    },

    async findProgramBySlug(slug, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select()
        .from(familyPrograms)
        .where(eq(familyPrograms.slug, slug))
        .limit(1);
      return rows[0] ?? null;
    },

    async findProgramById(programId, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select()
        .from(familyPrograms)
        .where(eq(familyPrograms.id, programId))
        .limit(1);
      return rows[0] ?? null;
    },

    async listPrograms(executor) {
      const db = resolveDb(executor);
      return db
        .select()
        .from(familyPrograms)
        .orderBy(desc(familyPrograms.updatedAt));
    },

    async listProgramVersions(programId, executor) {
      const db = resolveDb(executor);
      return db
        .select()
        .from(familyProgramVersions)
        .where(eq(familyProgramVersions.familyProgramId, programId))
        .orderBy(desc(familyProgramVersions.versionNumber));
    },

    async listAllLatestVersions(programIds, executor) {
      if (programIds.length === 0) return [];
      const db = resolveDb(executor);
      return db
        .select()
        .from(familyProgramVersions)
        .where(inArray(familyProgramVersions.familyProgramId, programIds))
        .orderBy(desc(familyProgramVersions.versionNumber));
    },

    async findProgramVersionById(versionId, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select()
        .from(familyProgramVersions)
        .where(eq(familyProgramVersions.id, versionId))
        .limit(1);
      return rows[0] ?? null;
    },

    async listProgramVersionItemsJoined(versionId, executor) {
      const db = resolveDb(executor);
      return db
        .select({
          id: familyProgramItems.id,
          familyProgramVersionId: familyProgramItems.familyProgramVersionId,
          chapterNumber: familyProgramItems.chapterNumber,
          chapterTitle: familyProgramItems.chapterTitle,
          sortOrder: familyProgramItems.sortOrder,
          contentVersionId: familyProgramItems.contentVersionId,
          createdAt: familyProgramItems.createdAt,
          contentItemId: contentItems.id,
          contentSlug: contentItems.slug,
          contentType: contentItems.contentType,
          contentVersionNumber: contentVersions.versionNumber,
          contentStatus: contentVersions.status,
          contentTitle: contentVersions.title,
          contentSummary: contentVersions.summary,
          contentLocale: contentVersions.locale,
          payloadJson: contentVersions.payloadJson,
          metadataJson: contentVersions.metadataJson,
          publishedAt: contentVersions.publishedAt,
        })
        .from(familyProgramItems)
        .innerJoin(
          contentVersions,
          eq(contentVersions.id, familyProgramItems.contentVersionId)
        )
        .innerJoin(
          contentItems,
          eq(contentItems.id, contentVersions.contentItemId)
        )
        .where(eq(familyProgramItems.familyProgramVersionId, versionId))
        .orderBy(asc(familyProgramItems.sortOrder));
    },

    async findPublishedContentVersionsByIds(ids, executor) {
      if (ids.length === 0) return [];
      const db = resolveDb(executor);
      return db
        .select({
          id: contentVersions.id,
          contentItemId: contentVersions.contentItemId,
          slug: contentItems.slug,
          contentType: contentItems.contentType,
          versionNumber: contentVersions.versionNumber,
          status: contentVersions.status,
          isArchived: contentItems.isArchived,
          title: contentVersions.title,
          summary: contentVersions.summary,
          locale: contentVersions.locale,
        })
        .from(contentVersions)
        .innerJoin(
          contentItems,
          eq(contentItems.id, contentVersions.contentItemId)
        )
        .where(inArray(contentVersions.id, ids));
    },

    async createProgramWithDraftVersion(params, executor) {
      const db = resolveDb(executor);
      await db.insert(familyPrograms).values(params.program);
      await db.insert(familyProgramVersions).values(params.version);
      if (params.items.length > 0) {
        await db.insert(familyProgramItems).values(params.items);
      }
    },

    async createDraftProgramVersion(params, executor) {
      const db = resolveDb(executor);
      await db.insert(familyProgramVersions).values(params.version);
      if (params.items.length > 0) {
        await db.insert(familyProgramItems).values(params.items);
      }
    },

    async updateDraftProgramVersionAndItems(params, executor) {
      const db = resolveDb(executor);
      await db
        .update(familyProgramVersions)
        .set({
          title: params.title,
          description: params.description,
          locale: params.locale,
          ageBand: params.ageBand,
          availabilityMode: params.availabilityMode,
          updatedAt: params.now,
        })
        .where(eq(familyProgramVersions.id, params.versionId));

      await db
        .update(familyPrograms)
        .set({
          availabilityMode: params.availabilityMode,
          updatedAt: params.now,
        })
        .where(eq(familyPrograms.id, params.programId));

      await db
        .delete(familyProgramItems)
        .where(eq(familyProgramItems.familyProgramVersionId, params.versionId));

      if (params.items.length > 0) {
        await db.insert(familyProgramItems).values(params.items);
      }
    },

    async publishProgramVersion(params, executor) {
      const db = resolveDb(executor);
      await db
        .update(familyProgramVersions)
        .set({
          status: 'published',
          publishedByUserId: params.publishedByUserId,
          publishedAt: params.now,
          updatedAt: params.now,
        })
        .where(eq(familyProgramVersions.id, params.versionId));

      await db
        .update(familyPrograms)
        .set({
          status: 'published',
          availabilityMode: params.availabilityMode,
          currentPublishedVersionId: params.versionId,
          updatedAt: params.now,
        })
        .where(eq(familyPrograms.id, params.programId));
    },

    async retireProgram(params, executor) {
      const db = resolveDb(executor);
      await db
        .update(familyPrograms)
        .set({
          status: 'retired',
          retiredAt: params.now,
          updatedAt: params.now,
        })
        .where(eq(familyPrograms.id, params.programId));
    },

    async retireProgramVersion(params, executor) {
      const db = resolveDb(executor);
      await db
        .update(familyProgramVersions)
        .set({
          status: 'retired',
          retiredAt: params.now,
          updatedAt: params.now,
        })
        .where(
          and(
            eq(familyProgramVersions.id, params.versionId),
            eq(familyProgramVersions.familyProgramId, params.programId)
          )
        );
    },

    async listEnrollmentsForProgram(programId, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select({
          enrollment: familyProgramEnrollments,
          workspaceCode: familyWorkspaces.code,
          workspaceName: familyWorkspaces.name,
          studentDisplayName: users.displayName,
          familyUsername: familyStudents.familyUsername,
          versionNumber: familyProgramVersions.versionNumber,
          programTitle: familyProgramVersions.title,
        })
        .from(familyProgramEnrollments)
        .innerJoin(
          familyWorkspaces,
          eq(familyWorkspaces.id, familyProgramEnrollments.familyWorkspaceId)
        )
        .innerJoin(users, eq(users.id, familyProgramEnrollments.studentUserId))
        .innerJoin(
          familyProgramVersions,
          eq(
            familyProgramVersions.id,
            familyProgramEnrollments.familyProgramVersionId
          )
        )
        .leftJoin(
          familyStudents,
          and(
            eq(
              familyStudents.familyWorkspaceId,
              familyProgramEnrollments.familyWorkspaceId
            ),
            eq(
              familyStudents.studentUserId,
              familyProgramEnrollments.studentUserId
            )
          )
        )
        .where(eq(familyProgramEnrollments.familyProgramId, programId))
        .orderBy(desc(familyProgramEnrollments.activatedAt));

      return rows;
    },

    async listEligibleFamilyWorkspacesForAdmin(search, executor) {
      const db = resolveDb(executor);
      const normalizedSearch = search?.trim().toLowerCase() ?? '';
      const wsRows = await db
        .select({
          id: familyWorkspaces.id,
          code: familyWorkspaces.code,
          name: familyWorkspaces.name,
        })
        .from(familyWorkspaces)
        .where(eq(familyWorkspaces.status, 'active'))
        .orderBy(desc(familyWorkspaces.createdAt));

      const filteredWs = normalizedSearch
        ? wsRows.filter(
            (w) =>
              w.code.toLowerCase().includes(normalizedSearch) ||
              w.name.toLowerCase().includes(normalizedSearch)
          )
        : wsRows;

      if (filteredWs.length === 0) return [];
      const wsIds = filteredWs.map((w) => w.id);

      const studentRows = await db
        .select({
          familyWorkspaceId: familyStudents.familyWorkspaceId,
          studentUserId: familyStudents.studentUserId,
          displayName: users.displayName,
          familyUsername: familyStudents.familyUsername,
        })
        .from(familyStudents)
        .innerJoin(users, eq(users.id, familyStudents.studentUserId))
        .where(
          and(
            inArray(familyStudents.familyWorkspaceId, wsIds),
            eq(familyStudents.status, 'active'),
            eq(users.status, 'active')
          )
        );

      const linkCounts = await db
        .select({
          familyWorkspaceId: guardianStudentLinks.familyWorkspaceId,
          studentUserId: guardianStudentLinks.studentUserId,
          cnt: sql<number>`count(*)`,
        })
        .from(guardianStudentLinks)
        .where(
          and(
            inArray(guardianStudentLinks.familyWorkspaceId, wsIds),
            eq(guardianStudentLinks.relationshipStatus, 'active')
          )
        )
        .groupBy(
          guardianStudentLinks.familyWorkspaceId,
          guardianStudentLinks.studentUserId
        );

      const countMap = new Map(
        linkCounts.map((c) => [
          `${c.familyWorkspaceId}:${c.studentUserId}`,
          Number(c.cnt),
        ])
      );

      const studentsByWs = new Map<
        string,
        AdminFamilyWorkspaceCandidateRecord['students']
      >();
      for (const s of studentRows) {
        const activeGuardianCount =
          countMap.get(`${s.familyWorkspaceId}:${s.studentUserId}`) ?? 0;
        if (activeGuardianCount === 0) continue;
        const list = studentsByWs.get(s.familyWorkspaceId) ?? [];
        list.push({
          studentUserId: s.studentUserId,
          displayName: s.displayName,
          familyUsername: s.familyUsername,
          activeGuardianCount,
        });
        studentsByWs.set(s.familyWorkspaceId, list);
      }

      return filteredWs.map((ws) => ({
        workspaceId: ws.id,
        workspaceCode: ws.code,
        workspaceName: ws.name,
        students: studentsByWs.get(ws.id) ?? [],
      }));
    },

    async verifyStudentEligibleForFamilyWorkspace(params, executor) {
      const db = resolveDb(executor);
      const ws = await db
        .select({ id: familyWorkspaces.id, status: familyWorkspaces.status })
        .from(familyWorkspaces)
        .where(eq(familyWorkspaces.id, params.familyWorkspaceId))
        .limit(1);
      if (!ws[0] || ws[0].status !== 'active') {
        return { eligible: false, reason: 'workspace_not_active' };
      }

      const studentRows = await db
        .select({
          id: users.id,
          status: users.status,
          platformRole: users.platformRole,
        })
        .from(users)
        .where(eq(users.id, params.studentUserId))
        .limit(1);
      if (
        !studentRows[0] ||
        studentRows[0].status !== 'active' ||
        studentRows[0].platformRole !== null
      ) {
        return { eligible: false, reason: 'student_not_active' };
      }

      const fs = await db
        .select({ id: familyStudents.id, status: familyStudents.status })
        .from(familyStudents)
        .where(
          and(
            eq(familyStudents.familyWorkspaceId, params.familyWorkspaceId),
            eq(familyStudents.studentUserId, params.studentUserId)
          )
        )
        .limit(1);
      if (!fs[0] || fs[0].status !== 'active') {
        return { eligible: false, reason: 'student_not_in_workspace' };
      }

      const links = await db
        .select({ id: guardianStudentLinks.id })
        .from(guardianStudentLinks)
        .where(
          and(
            eq(guardianStudentLinks.familyWorkspaceId, params.familyWorkspaceId),
            eq(guardianStudentLinks.studentUserId, params.studentUserId),
            eq(guardianStudentLinks.relationshipStatus, 'active')
          )
        )
        .limit(1);
      if (!links[0]) {
        return { eligible: false, reason: 'no_active_guardian_link' };
      }

      return { eligible: true };
    },

    async findActiveEnrollment(params, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select()
        .from(familyProgramEnrollments)
        .where(
          and(
            eq(
              familyProgramEnrollments.familyWorkspaceId,
              params.familyWorkspaceId
            ),
            eq(familyProgramEnrollments.studentUserId, params.studentUserId),
            eq(familyProgramEnrollments.familyProgramId, params.familyProgramId),
            eq(familyProgramEnrollments.status, 'active')
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async findEnrollmentById(enrollmentId, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select()
        .from(familyProgramEnrollments)
        .where(eq(familyProgramEnrollments.id, enrollmentId))
        .limit(1);
      return rows[0] ?? null;
    },

    async createEnrollment(record, executor) {
      const db = resolveDb(executor);
      await db.insert(familyProgramEnrollments).values(record);
    },

    async revokeEnrollment(params, executor) {
      const db = resolveDb(executor);
      const [result] = await db
        .update(familyProgramEnrollments)
        .set({
          status: 'revoked',
          revokedAt: params.now,
          revokedByUserId: params.revokedByUserId,
          updatedAt: params.now,
        })
        .where(
          and(
            eq(familyProgramEnrollments.id, params.enrollmentId),
            eq(familyProgramEnrollments.status, 'active')
          )
        );
      return (result.affectedRows ?? 0) > 0;
    },

    async listPublishedFreePrograms(executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select({
          program: familyPrograms,
          version: familyProgramVersions,
        })
        .from(familyPrograms)
        .innerJoin(
          familyProgramVersions,
          eq(familyProgramVersions.id, familyPrograms.currentPublishedVersionId)
        )
        .where(
          and(
            eq(familyPrograms.status, 'published'),
            eq(familyPrograms.availabilityMode, 'free_family'),
            eq(familyProgramVersions.status, 'published')
          )
        )
        .orderBy(desc(familyProgramVersions.publishedAt));

      if (rows.length === 0) return [];
      const versionIds = rows.map((r) => r.version.id);
      const counts = await db
        .select({
          versionId: familyProgramItems.familyProgramVersionId,
          cnt: sql<number>`count(*)`,
        })
        .from(familyProgramItems)
        .where(inArray(familyProgramItems.familyProgramVersionId, versionIds))
        .groupBy(familyProgramItems.familyProgramVersionId);
      const countMap = new Map(counts.map((c) => [c.versionId, Number(c.cnt)]));

      return rows.map((r) => ({
        program: r.program,
        version: r.version,
        itemCount: countMap.get(r.version.id) ?? 0,
      }));
    },

    async getGuardianLinkedStudentOverview(
      guardianUserId,
      studentUserId,
      executor
    ) {
      const db = resolveDb(executor);
      const rows = await db
        .select({
          studentUserId: users.id,
          studentDisplayName: users.displayName,
          studentStatus: users.status,
          familyWorkspaceId: guardianStudentLinks.familyWorkspaceId,
        })
        .from(guardianStudentLinks)
        .innerJoin(
          familyWorkspaces,
          eq(familyWorkspaces.id, guardianStudentLinks.familyWorkspaceId)
        )
        .innerJoin(users, eq(users.id, guardianStudentLinks.studentUserId))
        .where(
          and(
            eq(guardianStudentLinks.guardianUserId, guardianUserId),
            eq(guardianStudentLinks.studentUserId, studentUserId),
            eq(guardianStudentLinks.relationshipStatus, 'active'),
            eq(familyWorkspaces.status, 'active')
          )
        );

      if (rows.length === 0) return null;
      return {
        studentUserId: rows[0].studentUserId,
        studentDisplayName: rows[0].studentDisplayName,
        studentStatus: rows[0].studentStatus,
        workspaceIds: Array.from(new Set(rows.map((r) => r.familyWorkspaceId))),
      };
    },

    async listFamilyEnrollmentsForGuardianOverview(params, executor) {
      if (params.workspaceIds.length === 0) return [];
      const db = resolveDb(executor);
      const enrollments = await db
        .select({
          enrollment: familyProgramEnrollments,
          workspaceName: familyWorkspaces.name,
          workspaceCode: familyWorkspaces.code,
          programTitle: familyProgramVersions.title,
          versionNumber: familyProgramVersions.versionNumber,
        })
        .from(familyProgramEnrollments)
        .innerJoin(
          familyWorkspaces,
          eq(familyWorkspaces.id, familyProgramEnrollments.familyWorkspaceId)
        )
        .innerJoin(
          familyProgramVersions,
          eq(
            familyProgramVersions.id,
            familyProgramEnrollments.familyProgramVersionId
          )
        )
        .where(
          and(
            eq(familyProgramEnrollments.studentUserId, params.studentUserId),
            inArray(
              familyProgramEnrollments.familyWorkspaceId,
              params.workspaceIds
            ),
            eq(familyProgramEnrollments.status, 'active')
          )
        )
        .orderBy(desc(familyProgramEnrollments.activatedAt));

      if (enrollments.length === 0) return [];

      const versionIds = Array.from(
        new Set(enrollments.map((e) => e.enrollment.familyProgramVersionId))
      );
      const enrollmentIds = enrollments.map((e) => e.enrollment.id);

      const [items, completedAttempts] = await Promise.all([
        db
          .select({
            itemId: familyProgramItems.id,
            familyProgramVersionId: familyProgramItems.familyProgramVersionId,
            chapterNumber: familyProgramItems.chapterNumber,
            chapterTitle: familyProgramItems.chapterTitle,
            sortOrder: familyProgramItems.sortOrder,
          })
          .from(familyProgramItems)
          .where(inArray(familyProgramItems.familyProgramVersionId, versionIds))
          .orderBy(asc(familyProgramItems.sortOrder)),
        db
          .select({
            enrollmentId: familyActivityAttempts.enrollmentId,
            familyProgramItemId: familyActivityAttempts.familyProgramItemId,
          })
          .from(familyActivityAttempts)
          .where(
            and(
              eq(familyActivityAttempts.studentUserId, params.studentUserId),
              inArray(familyActivityAttempts.enrollmentId, enrollmentIds),
              eq(familyActivityAttempts.status, 'completed')
            )
          ),
      ]);

      const itemsByVersion = new Map<
        string,
        GuardianFamilyEnrollmentOverviewRow['items']
      >();
      for (const item of items) {
        const list = itemsByVersion.get(item.familyProgramVersionId) ?? [];
        list.push({
          itemId: item.itemId,
          chapterNumber: item.chapterNumber,
          chapterTitle: item.chapterTitle,
          sortOrder: item.sortOrder,
        });
        itemsByVersion.set(item.familyProgramVersionId, list);
      }

      const completedByEnrollment = new Map<string, Set<string>>();
      for (const att of completedAttempts) {
        const set = completedByEnrollment.get(att.enrollmentId) ?? new Set();
        set.add(att.familyProgramItemId);
        completedByEnrollment.set(att.enrollmentId, set);
      }

      return enrollments.map((row) => ({
        enrollment: row.enrollment,
        workspaceName: row.workspaceName,
        workspaceCode: row.workspaceCode,
        programTitle: row.programTitle,
        versionNumber: row.versionNumber,
        items: itemsByVersion.get(row.enrollment.familyProgramVersionId) ?? [],
        completedItemIds: Array.from(
          completedByEnrollment.get(row.enrollment.id) ?? []
        ),
      }));
    },

    async listSchoolAssignmentsForGuardianOverview(studentUserId, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select({
          assignmentTargetId: assignmentTargets.id,
          organizationId: organizations.id,
          organizationName: organizations.name,
          assignmentTitle: assignments.title,
          assignmentStatus: assignments.status,
          assignedAt: assignmentTargets.assignedAt,
          progressStatus: assignmentProgress.status,
          totalItems: assignmentProgress.totalItems,
          completedItems: assignmentProgress.completedItems,
          lastActivityAt: assignmentProgress.lastActivityAt,
          completedAt: assignmentProgress.completedAt,
        })
        .from(assignmentTargets)
        .innerJoin(
          organizationMemberships,
          and(
            eq(
              organizationMemberships.id,
              assignmentTargets.studentMembershipId
            ),
            eq(
              organizationMemberships.organizationId,
              assignmentTargets.organizationId
            ),
            eq(organizationMemberships.userId, studentUserId),
            eq(organizationMemberships.role, 'student'),
            eq(organizationMemberships.status, 'active')
          )
        )
        .innerJoin(
          organizations,
          and(
            eq(organizations.id, assignmentTargets.organizationId),
            eq(organizations.status, 'active')
          )
        )
        .innerJoin(
          assignments,
          and(
            eq(assignments.id, assignmentTargets.assignmentId),
            eq(assignments.organizationId, assignmentTargets.organizationId),
            or(
              eq(assignments.status, 'active'),
              eq(assignments.status, 'closed')
            )
          )
        )
        .leftJoin(
          assignmentProgress,
          and(
            eq(
              assignmentProgress.assignmentTargetId,
              assignmentTargets.id
            ),
            eq(
              assignmentProgress.organizationId,
              assignmentTargets.organizationId
            )
          )
        )
        .orderBy(desc(assignmentTargets.assignedAt));

      return rows.map((r) => ({
        assignmentTargetId: r.assignmentTargetId,
        organizationId: r.organizationId,
        organizationName: r.organizationName,
        assignmentTitle: r.assignmentTitle,
        assignmentStatus: r.assignmentStatus,
        assignedAt: r.assignedAt,
        totalItems: r.totalItems ?? 0,
        completedItems: r.completedItems ?? 0,
        progressStatus: r.progressStatus ?? 'not_started',
        startedAt: r.lastActivityAt ?? null,
        lastActivityAt: r.lastActivityAt ?? null,
        completedAt: r.completedAt ?? null,
      }));
    },

    async listActiveStudentEnrollments(studentUserId, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select({
          enrollment: familyProgramEnrollments,
          program: familyPrograms,
          version: familyProgramVersions,
          workspaceCode: familyWorkspaces.code,
          workspaceName: familyWorkspaces.name,
        })
        .from(familyProgramEnrollments)
        .innerJoin(
          familyWorkspaces,
          eq(familyWorkspaces.id, familyProgramEnrollments.familyWorkspaceId)
        )
        .innerJoin(
          familyStudents,
          and(
            eq(
              familyStudents.familyWorkspaceId,
              familyProgramEnrollments.familyWorkspaceId
            ),
            eq(
              familyStudents.studentUserId,
              familyProgramEnrollments.studentUserId
            ),
            eq(familyStudents.status, 'active')
          )
        )
        .innerJoin(
          familyPrograms,
          eq(familyPrograms.id, familyProgramEnrollments.familyProgramId)
        )
        .innerJoin(
          familyProgramVersions,
          eq(
            familyProgramVersions.id,
            familyProgramEnrollments.familyProgramVersionId
          )
        )
        .where(
          and(
            eq(familyProgramEnrollments.studentUserId, studentUserId),
            eq(familyProgramEnrollments.status, 'active'),
            eq(familyWorkspaces.status, 'active')
          )
        )
        .orderBy(desc(familyProgramEnrollments.activatedAt));

      if (rows.length === 0) return [];
      const wsIds = Array.from(
        new Set(rows.map((r) => r.enrollment.familyWorkspaceId))
      );
      const activeLinks = await db
        .select({ familyWorkspaceId: guardianStudentLinks.familyWorkspaceId })
        .from(guardianStudentLinks)
        .where(
          and(
            eq(guardianStudentLinks.studentUserId, studentUserId),
            inArray(guardianStudentLinks.familyWorkspaceId, wsIds),
            eq(guardianStudentLinks.relationshipStatus, 'active')
          )
        );
      const activeWsSet = new Set(activeLinks.map((l) => l.familyWorkspaceId));

      return rows.filter((r) =>
        activeWsSet.has(r.enrollment.familyWorkspaceId)
      );
    },

    async findActiveStudentEnrollmentById(
      studentUserId,
      enrollmentId,
      executor
    ) {
      if (!executor) {
        const all = await this.listActiveStudentEnrollments(studentUserId);
        return all.find((e) => e.enrollment.id === enrollmentId) ?? null;
      }

      // Inside a transaction: lock the target enrollment row first so concurrent
      // start/turn/complete/abandon operations serialize per (student, enrollment).
      const lockQuery = executor
        .select({
          enrollment: familyProgramEnrollments,
          program: familyPrograms,
          version: familyProgramVersions,
          workspaceCode: familyWorkspaces.code,
          workspaceName: familyWorkspaces.name,
        })
        .from(familyProgramEnrollments)
        .innerJoin(
          familyWorkspaces,
          eq(familyWorkspaces.id, familyProgramEnrollments.familyWorkspaceId)
        )
        .innerJoin(
          familyStudents,
          and(
            eq(
              familyStudents.familyWorkspaceId,
              familyProgramEnrollments.familyWorkspaceId
            ),
            eq(
              familyStudents.studentUserId,
              familyProgramEnrollments.studentUserId
            ),
            eq(familyStudents.status, 'active')
          )
        )
        .innerJoin(
          familyPrograms,
          eq(familyPrograms.id, familyProgramEnrollments.familyProgramId)
        )
        .innerJoin(
          familyProgramVersions,
          eq(
            familyProgramVersions.id,
            familyProgramEnrollments.familyProgramVersionId
          )
        )
        .where(
          and(
            eq(familyProgramEnrollments.id, enrollmentId),
            eq(familyProgramEnrollments.studentUserId, studentUserId),
            eq(familyProgramEnrollments.status, 'active'),
            eq(familyWorkspaces.status, 'active')
          )
        )
        .limit(1)
        .for('update');

      const [matched] = await lockQuery;
      if (!matched) {
        return null;
      }

      const [activeLink] = await executor
        .select({ id: guardianStudentLinks.id })
        .from(guardianStudentLinks)
        .where(
          and(
            eq(guardianStudentLinks.studentUserId, studentUserId),
            eq(
              guardianStudentLinks.familyWorkspaceId,
              matched.enrollment.familyWorkspaceId
            ),
            eq(guardianStudentLinks.relationshipStatus, 'active')
          )
        )
        .limit(1);

      return activeLink ? matched : null;
    },

    async listFamilyAttemptsForEnrollment(
      studentUserId,
      enrollmentId,
      executor
    ) {
      const db = resolveDb(executor);
      return db
        .select()
        .from(familyActivityAttempts)
        .where(
          and(
            eq(familyActivityAttempts.studentUserId, studentUserId),
            eq(familyActivityAttempts.enrollmentId, enrollmentId)
          )
        )
        .orderBy(desc(familyActivityAttempts.startedAt));
    },

    async findFamilyAttemptByIdForStudent(studentUserId, attemptId, executor) {
      const db = resolveDb(executor);
      const baseQuery = db
        .select()
        .from(familyActivityAttempts)
        .where(
          and(
            eq(familyActivityAttempts.studentUserId, studentUserId),
            eq(familyActivityAttempts.id, attemptId)
          )
        )
        .limit(1);
      const rows = executor ? await baseQuery.for('update') : await baseQuery;
      return rows[0] ?? null;
    },

    async findInProgressFamilyAttempt(
      enrollmentId,
      familyProgramItemId,
      executor
    ) {
      const db = resolveDb(executor);
      const baseQuery = db
        .select()
        .from(familyActivityAttempts)
        .where(
          and(
            eq(familyActivityAttempts.enrollmentId, enrollmentId),
            eq(
              familyActivityAttempts.familyProgramItemId,
              familyProgramItemId
            ),
            eq(familyActivityAttempts.status, 'in_progress')
          )
        )
        .limit(1);
      const rows = executor ? await baseQuery.for('update') : await baseQuery;
      return rows[0] ?? null;
    },

    async findFamilyAttemptByIdempotencyKey(
      enrollmentId,
      familyProgramItemId,
      idempotencyKey,
      executor
    ) {
      const db = resolveDb(executor);
      const baseQuery = db
        .select()
        .from(familyActivityAttempts)
        .where(
          and(
            eq(familyActivityAttempts.enrollmentId, enrollmentId),
            eq(
              familyActivityAttempts.familyProgramItemId,
              familyProgramItemId
            ),
            eq(familyActivityAttempts.startIdempotencyKey, idempotencyKey)
          )
        )
        .limit(1);
      const rows = executor ? await baseQuery.for('update') : await baseQuery;
      return rows[0] ?? null;
    },

    async countFamilyAttemptsForItem(
      enrollmentId,
      familyProgramItemId,
      executor
    ) {
      const db = resolveDb(executor);
      const baseQuery = db
        .select({
          status: familyActivityAttempts.status,
          attemptNumber: familyActivityAttempts.attemptNumber,
        })
        .from(familyActivityAttempts)
        .where(
          and(
            eq(familyActivityAttempts.enrollmentId, enrollmentId),
            eq(familyActivityAttempts.familyProgramItemId, familyProgramItemId)
          )
        );
      const rows = executor ? await baseQuery.for('update') : await baseQuery;
      let maxAttemptNumber = 0;
      let completed = 0;
      for (const r of rows) {
        if (r.attemptNumber > maxAttemptNumber) {
          maxAttemptNumber = r.attemptNumber;
        }
        if (r.status === 'completed') {
          completed += 1;
        }
      }
      return {
        total: rows.length,
        completed,
        maxAttemptNumber,
      };
    },

    async createFamilyAttempt(attempt, executor) {
      const db = resolveDb(executor);
      await db.insert(familyActivityAttempts).values(attempt);
      const created = await this.findFamilyAttemptByIdForStudent(
        attempt.studentUserId,
        attempt.id,
        db
      );
      return created!;
    },

    async listTurnsForFamilyAttempt(studentUserId, attemptId, executor) {
      const db = resolveDb(executor);
      const baseQuery = db
        .select()
        .from(familyActivityAttemptTurns)
        .where(
          and(
            eq(familyActivityAttemptTurns.studentUserId, studentUserId),
            eq(familyActivityAttemptTurns.attemptId, attemptId)
          )
        )
        .orderBy(
          asc(familyActivityAttemptTurns.turnIndex),
          asc(familyActivityAttemptTurns.respondedAt),
          asc(familyActivityAttemptTurns.id)
        );
      return executor ? baseQuery.for('update') : baseQuery;
    },

    async findTurnForFamilyAttempt(
      studentUserId,
      attemptId,
      turnIndex,
      executor
    ) {
      const db = resolveDb(executor);
      const baseQuery = db
        .select()
        .from(familyActivityAttemptTurns)
        .where(
          and(
            eq(familyActivityAttemptTurns.studentUserId, studentUserId),
            eq(familyActivityAttemptTurns.attemptId, attemptId),
            eq(familyActivityAttemptTurns.turnIndex, turnIndex)
          )
        )
        .limit(1);
      const rows = executor ? await baseQuery.for('update') : await baseQuery;
      return rows[0] ?? null;
    },

    async insertFamilyTurnAndUpdateAttempt(params, executor) {
      const db = resolveDb(executor);
      await db.insert(familyActivityAttemptTurns).values(params.turn);
      await db
        .update(familyActivityAttempts)
        .set({
          lastInteractedAt: params.attemptUpdate.lastInteractedAt,
          durationSeconds: params.attemptUpdate.durationSeconds,
          usedAacSupport: params.attemptUpdate.usedAacSupport,
          usedReadAloud: params.attemptUpdate.usedReadAloud,
          aacTapCount: params.attemptUpdate.aacTapCount,
          readAloudCount: params.attemptUpdate.readAloudCount,
        })
        .where(
          and(
            eq(
              familyActivityAttempts.studentUserId,
              params.attemptUpdate.studentUserId
            ),
            eq(familyActivityAttempts.id, params.attemptUpdate.attemptId)
          )
        );
      const updated = await this.findFamilyAttemptByIdForStudent(
        params.attemptUpdate.studentUserId,
        params.attemptUpdate.attemptId,
        db
      );
      return updated!;
    },

    async updateFamilyAttemptTerminalState(params, executor) {
      const db = resolveDb(executor);
      await db
        .update(familyActivityAttempts)
        .set({
          status: params.status,
          completedAt: params.completedAt,
          lastInteractedAt: params.lastInteractedAt,
          durationSeconds: params.durationSeconds,
          usedAacSupport: params.usedAacSupport,
          usedReadAloud: params.usedReadAloud,
          aacTapCount: params.aacTapCount,
          readAloudCount: params.readAloudCount,
          ...(params.responseSummaryJson !== undefined
            ? { responseSummaryJson: params.responseSummaryJson }
            : {}),
        })
        .where(
          and(
            eq(familyActivityAttempts.studentUserId, params.studentUserId),
            eq(familyActivityAttempts.id, params.attemptId),
            eq(familyActivityAttempts.status, 'in_progress')
          )
        );
      const updated = await this.findFamilyAttemptByIdForStudent(
        params.studentUserId,
        params.attemptId,
        db
      );
      return updated!;
    },

    async recomputeAndUpdateEnrollmentProgress(params, executor) {
      const db = resolveDb(executor);
      const enrollmentQuery = db
        .select()
        .from(familyProgramEnrollments)
        .where(eq(familyProgramEnrollments.id, params.enrollmentId))
        .limit(1);
      const [existingEnrollment] = executor
        ? await enrollmentQuery.for('update')
        : await enrollmentQuery;

      const attemptsQuery = db
        .select({
          familyProgramItemId: familyActivityAttempts.familyProgramItemId,
          status: familyActivityAttempts.status,
          startedAt: familyActivityAttempts.startedAt,
          lastInteractedAt: familyActivityAttempts.lastInteractedAt,
          completedAt: familyActivityAttempts.completedAt,
        })
        .from(familyActivityAttempts)
        .where(
          and(
            eq(familyActivityAttempts.enrollmentId, params.enrollmentId),
            eq(familyActivityAttempts.studentUserId, params.studentUserId)
          )
        );
      const attempts = executor
        ? await attemptsQuery.for('update')
        : await attemptsQuery;

      const completedItemIds = new Set(
        attempts
          .filter((a) => a.status === 'completed')
          .map((a) => a.familyProgramItemId)
      );
      const totalActivities = params.totalActivities;
      const completedActivities = Math.min(
        totalActivities,
        completedItemIds.size
      );

      let learningStatus: 'not_started' | 'in_progress' | 'completed' =
        'not_started';
      if (totalActivities > 0 && completedActivities >= totalActivities) {
        learningStatus = 'completed';
      } else if (attempts.length > 0) {
        learningStatus = 'in_progress';
      }

      const startedDates = attempts.map((a) => a.startedAt.getTime());
      const earliestStarted =
        startedDates.length > 0 ? new Date(Math.min(...startedDates)) : null;

      const activityDates = attempts.map((a) => a.lastInteractedAt.getTime());
      const latestActivity =
        activityDates.length > 0
          ? new Date(Math.max(...activityDates))
          : params.fallbackActivityAt;

      const completedDates = attempts
        .map((a) => a.completedAt?.getTime() ?? null)
        .filter((t): t is number => t !== null);
      const completedAt =
        learningStatus === 'completed'
          ? (existingEnrollment?.completedAt ??
            (completedDates.length > 0
              ? new Date(Math.max(...completedDates))
              : params.now))
          : null;

      await db
        .update(familyProgramEnrollments)
        .set({
          learningStatus,
          totalActivities,
          completedActivities,
          startedAt: earliestStarted,
          lastActivityAt: attempts.length > 0 ? latestActivity : null,
          completedAt,
          updatedAt: params.now,
        })
        .where(eq(familyProgramEnrollments.id, params.enrollmentId));

      const updated = await this.findEnrollmentById(params.enrollmentId, db);
      return updated!;
    },

    async findStudentFamilyPreferences(studentUserId, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select()
        .from(studentFamilyPreferences)
        .where(eq(studentFamilyPreferences.studentUserId, studentUserId))
        .limit(1);
      return rows[0] ?? null;
    },

    async upsertStudentFamilyPreferences(params, executor) {
      const db = resolveDb(executor);
      const existing = await this.findStudentFamilyPreferences(
        params.studentUserId,
        db
      );
      if (existing) {
        await db
          .update(studentFamilyPreferences)
          .set({
            preferredName: params.preferredName,
            supportPreferencesJson: params.supportPreferencesJson,
            updatedAt: params.now,
          })
          .where(eq(studentFamilyPreferences.id, existing.id));
        return {
          ...existing,
          preferredName: params.preferredName,
          supportPreferencesJson: params.supportPreferencesJson,
          updatedAt: params.now,
        };
      }

      await db.insert(studentFamilyPreferences).values({
        id: params.id,
        studentUserId: params.studentUserId,
        preferredName: params.preferredName,
        supportPreferencesJson: params.supportPreferencesJson,
        createdAt: params.now,
        updatedAt: params.now,
      });

      return {
        id: params.id,
        studentUserId: params.studentUserId,
        preferredName: params.preferredName,
        supportPreferencesJson: params.supportPreferencesJson,
        createdAt: params.now,
        updatedAt: params.now,
      };
    },
  };
}
