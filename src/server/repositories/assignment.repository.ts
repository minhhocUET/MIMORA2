import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  activityAttempts,
  assignmentItems,
  assignmentProgress,
  assignments,
  assignmentTargets,
} from '../db/schema/assignments.ts';
import {
  classEnrollments,
  classes,
  classTeachers,
} from '../db/schema/classes.ts';
import { contentItems, contentVersions } from '../db/schema/content.ts';
import { organizationMemberships, users } from '../db/schema/identity.ts';
import {
  getDb,
  withTransaction,
  type MimoraDatabase,
  type MimoraTransaction,
} from '../db/tidb.ts';

export type AssignmentDbOrTx = MimoraDatabase | MimoraTransaction;

export const ASSIGNMENT_STATUSES = [
  'draft',
  'active',
  'closed',
  'archived',
] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const STUDENT_VISIBLE_ASSIGNMENT_STATUSES = ['active', 'closed'] as const;

export interface AssignmentRecord {
  id: string;
  organizationId: string;
  classId: string;
  createdByTeacherMembershipId: string;
  title: string;
  homePracticeInstructions: string | null;
  dueAt: Date | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssignmentListSummaryRecord {
  assignment: AssignmentRecord;
  className: string;
  itemCount: number;
  targetCount: number;
}

export interface AssignmentClassRecord {
  id: string;
  organizationId: string;
  name: string;
  academicYear: string | null;
  status: string;
}

export interface EligibleStudentInClassRecord {
  membershipId: string;
  userId: string;
  organizationId: string;
  classId: string;
  role: string;
  membershipStatus: string;
  userStatus: string;
  enrollmentStatus: string;
  displayName: string;
  orgUsername: string | null;
}

export interface PinnableContentVersionRecord {
  versionId: string;
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

export interface PinnedAssignmentItemRecord {
  id: string;
  organizationId: string;
  assignmentId: string;
  contentVersionId: string;
  sortOrder: number;
  createdAt: Date;
  contentItemId: string;
  slug: string;
  contentType: string;
  versionNumber: number;
  versionStatus: string;
  title: string;
  summary: string | null;
  locale: string;
  payloadJson: Record<string, unknown>;
  metadataJson: Record<string, unknown> | null;
  publishedAt: Date | null;
}

export interface AssignmentTargetStudentRecord {
  targetId: string;
  organizationId: string;
  assignmentId: string;
  studentMembershipId: string;
  assignedAt: Date;
  displayName: string;
  orgUsername: string | null;
  membershipStatus: string;
}

export interface AssignmentProgressReadRecord {
  assignmentTargetId: string;
  studentMembershipId: string;
  displayName: string;
  orgUsername: string | null;
  hasProgressRecord: boolean;
  status: string;
  totalItems: number;
  completedItems: number;
  attemptCount: number;
  lastActivityAt: Date | null;
  completedAt: Date | null;
}

export interface StudentAssignmentListRow {
  assignment: AssignmentRecord;
  className: string;
  targetId: string;
  assignedAt: Date;
  itemCount: number;
  progress: {
    hasProgressRecord: boolean;
    status: string;
    totalItems: number;
    completedItems: number;
    attemptCount: number;
    lastActivityAt: Date | null;
    completedAt: Date | null;
  } | null;
}

export interface StudentAssignmentDetailRow {
  assignment: AssignmentRecord;
  className: string;
  targetId: string;
  assignedAt: Date;
  progress: {
    hasProgressRecord: boolean;
    status: string;
    totalItems: number;
    completedItems: number;
    attemptCount: number;
    lastActivityAt: Date | null;
    completedAt: Date | null;
  } | null;
}

export interface AssignmentRepository {
  withTransaction<T>(fn: (tx: MimoraTransaction) => Promise<T>): Promise<T>;
  findClassByIdInOrg(
    organizationId: string,
    classId: string,
    executor?: AssignmentDbOrTx
  ): Promise<AssignmentClassRecord | null>;
  isTeacherAssignedToClassInOrg(
    organizationId: string,
    classId: string,
    teacherMembershipId: string,
    executor?: AssignmentDbOrTx
  ): Promise<boolean>;
  findEligibleStudentsInClass(
    organizationId: string,
    classId: string,
    studentMembershipIds: string[],
    executor?: AssignmentDbOrTx
  ): Promise<EligibleStudentInClassRecord[]>;
  findContentVersionsForPinning(
    versionIds: string[],
    executor?: AssignmentDbOrTx
  ): Promise<PinnableContentVersionRecord[]>;
  createAssignmentWithItemsAndTargets(
    params: {
      assignment: AssignmentRecord;
      items: Array<{
        id: string;
        organizationId: string;
        assignmentId: string;
        contentVersionId: string;
        sortOrder: number;
        createdAt: Date;
      }>;
      targets: Array<{
        id: string;
        organizationId: string;
        assignmentId: string;
        studentMembershipId: string;
        assignedAt: Date;
      }>;
    },
    tx: MimoraTransaction
  ): Promise<void>;
  listAssignmentsForTeacherClasses(params: {
    organizationId: string;
    teacherMembershipId: string;
    classId?: string;
    status?: AssignmentStatus;
    page: number;
    limit: number;
  }): Promise<{ items: AssignmentListSummaryRecord[]; total: number }>;
  findAssignmentByIdInOrg(
    organizationId: string,
    assignmentId: string,
    executor?: AssignmentDbOrTx
  ): Promise<(AssignmentRecord & { className: string }) | null>;
  findAssignmentByIdInOrgForUpdate(
    organizationId: string,
    assignmentId: string,
    tx: MimoraTransaction
  ): Promise<AssignmentRecord | null>;
  listAssignmentItemsWithPinnedContent(
    organizationId: string,
    assignmentId: string,
    executor?: AssignmentDbOrTx
  ): Promise<PinnedAssignmentItemRecord[]>;
  listAssignmentTargetsWithStudents(
    organizationId: string,
    assignmentId: string,
    executor?: AssignmentDbOrTx
  ): Promise<AssignmentTargetStudentRecord[]>;
  updateAssignmentFields(
    params: {
      organizationId: string;
      assignmentId: string;
      title?: string;
      homePracticeInstructions?: string | null;
      dueAt?: Date | null;
      status?: AssignmentStatus;
      now: Date;
    },
    tx: MimoraTransaction
  ): Promise<AssignmentRecord | null>;
  findTargetIdsWithActivity(
    organizationId: string,
    assignmentId: string,
    targetIds: string[],
    tx: MimoraTransaction
  ): Promise<string[]>;
  syncAssignmentTargets(
    params: {
      organizationId: string;
      assignmentId: string;
      inserts: Array<{
        id: string;
        organizationId: string;
        assignmentId: string;
        studentMembershipId: string;
        assignedAt: Date;
      }>;
      deleteTargetIds: string[];
      now: Date;
    },
    tx: MimoraTransaction
  ): Promise<void>;
  listAssignmentProgressSummary(
    organizationId: string,
    assignmentId: string,
    itemCount: number,
    executor?: AssignmentDbOrTx
  ): Promise<AssignmentProgressReadRecord[]>;
  listAssignmentsForStudent(params: {
    organizationId: string;
    studentMembershipId: string;
    status?: 'active' | 'closed';
    page: number;
    limit: number;
  }): Promise<{ items: StudentAssignmentListRow[]; total: number }>;
  findAssignmentForStudentById(params: {
    organizationId: string;
    assignmentId: string;
    studentMembershipId: string;
  }): Promise<StudentAssignmentDetailRow | null>;
}

function getExecutor(executor?: AssignmentDbOrTx): AssignmentDbOrTx {
  return executor ?? getDb();
}

export function createAssignmentRepository(): AssignmentRepository {
  return {
    withTransaction<T>(fn: (tx: MimoraTransaction) => Promise<T>): Promise<T> {
      return withTransaction(fn);
    },

    async findClassByIdInOrg(organizationId, classId, executor) {
      const db = getExecutor(executor);
      const rows = await db
        .select({
          id: classes.id,
          organizationId: classes.organizationId,
          name: classes.name,
          academicYear: classes.academicYear,
          status: classes.status,
        })
        .from(classes)
        .where(
          and(eq(classes.organizationId, organizationId), eq(classes.id, classId))
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async isTeacherAssignedToClassInOrg(
      organizationId,
      classId,
      teacherMembershipId,
      executor
    ) {
      const db = getExecutor(executor);
      const rows = await db
        .select({ id: classTeachers.id })
        .from(classTeachers)
        .where(
          and(
            eq(classTeachers.organizationId, organizationId),
            eq(classTeachers.classId, classId),
            eq(classTeachers.teacherMembershipId, teacherMembershipId)
          )
        )
        .limit(1);
      return rows.length > 0;
    },

    async findEligibleStudentsInClass(
      organizationId,
      classId,
      studentMembershipIds,
      executor
    ) {
      if (studentMembershipIds.length === 0) {
        return [];
      }
      const db = getExecutor(executor);
      return db
        .select({
          membershipId: organizationMemberships.id,
          userId: organizationMemberships.userId,
          organizationId: organizationMemberships.organizationId,
          classId: classEnrollments.classId,
          role: organizationMemberships.role,
          membershipStatus: organizationMemberships.status,
          userStatus: users.status,
          enrollmentStatus: classEnrollments.status,
          displayName: users.displayName,
          orgUsername: organizationMemberships.orgUsername,
        })
        .from(classEnrollments)
        .innerJoin(
          organizationMemberships,
          and(
            eq(
              organizationMemberships.organizationId,
              classEnrollments.organizationId
            ),
            eq(
              organizationMemberships.id,
              classEnrollments.studentMembershipId
            )
          )
        )
        .innerJoin(users, eq(users.id, organizationMemberships.userId))
        .where(
          and(
            eq(classEnrollments.organizationId, organizationId),
            eq(classEnrollments.classId, classId),
            eq(classEnrollments.status, 'active'),
            inArray(
              classEnrollments.studentMembershipId,
              studentMembershipIds
            )
          )
        );
    },

    async findContentVersionsForPinning(versionIds, executor) {
      if (versionIds.length === 0) {
        return [];
      }
      const db = getExecutor(executor);
      return db
        .select({
          versionId: contentVersions.id,
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
        .where(inArray(contentVersions.id, versionIds));
    },

    async createAssignmentWithItemsAndTargets(params, tx) {
      await tx.insert(assignments).values(params.assignment);
      if (params.items.length > 0) {
        await tx.insert(assignmentItems).values(params.items);
      }
      if (params.targets.length > 0) {
        await tx.insert(assignmentTargets).values(params.targets);
      }
    },

    async listAssignmentsForTeacherClasses(params) {
      const db = getDb();
      const filters = [
        eq(assignments.organizationId, params.organizationId),
        eq(classTeachers.organizationId, params.organizationId),
        eq(classTeachers.teacherMembershipId, params.teacherMembershipId),
      ];
      if (params.classId) {
        filters.push(eq(assignments.classId, params.classId));
      }
      if (params.status) {
        filters.push(eq(assignments.status, params.status));
      }

      const whereClause = and(...filters);
      const offset = (params.page - 1) * params.limit;

      const [countRows, rows] = await Promise.all([
        db
          .select({ total: count() })
          .from(assignments)
          .innerJoin(
            classTeachers,
            and(
              eq(classTeachers.organizationId, assignments.organizationId),
              eq(classTeachers.classId, assignments.classId)
            )
          )
          .where(whereClause),
        db
          .select({
            id: assignments.id,
            organizationId: assignments.organizationId,
            classId: assignments.classId,
            createdByTeacherMembershipId:
              assignments.createdByTeacherMembershipId,
            title: assignments.title,
            homePracticeInstructions: assignments.homePracticeInstructions,
            dueAt: assignments.dueAt,
            status: assignments.status,
            createdAt: assignments.createdAt,
            updatedAt: assignments.updatedAt,
            className: classes.name,
            itemCount: sql<number>`(SELECT COUNT(*) FROM assignment_items ai WHERE ai.organization_id = ${assignments.organizationId} AND ai.assignment_id = ${assignments.id})`,
            targetCount: sql<number>`(SELECT COUNT(*) FROM assignment_targets at WHERE at.organization_id = ${assignments.organizationId} AND at.assignment_id = ${assignments.id})`,
          })
          .from(assignments)
          .innerJoin(
            classTeachers,
            and(
              eq(classTeachers.organizationId, assignments.organizationId),
              eq(classTeachers.classId, assignments.classId)
            )
          )
          .innerJoin(
            classes,
            and(
              eq(classes.organizationId, assignments.organizationId),
              eq(classes.id, assignments.classId)
            )
          )
          .where(whereClause)
          .orderBy(desc(assignments.createdAt))
          .limit(params.limit)
          .offset(offset),
      ]);

      return {
        items: rows.map((r) => ({
          assignment: {
            id: r.id,
            organizationId: r.organizationId,
            classId: r.classId,
            createdByTeacherMembershipId: r.createdByTeacherMembershipId,
            title: r.title,
            homePracticeInstructions: r.homePracticeInstructions,
            dueAt: r.dueAt,
            status: r.status,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          },
          className: r.className,
          itemCount: Number(r.itemCount ?? 0),
          targetCount: Number(r.targetCount ?? 0),
        })),
        total: Number(countRows[0]?.total ?? 0),
      };
    },

    async findAssignmentByIdInOrg(organizationId, assignmentId, executor) {
      const db = getExecutor(executor);
      const rows = await db
        .select({
          id: assignments.id,
          organizationId: assignments.organizationId,
          classId: assignments.classId,
          createdByTeacherMembershipId:
            assignments.createdByTeacherMembershipId,
          title: assignments.title,
          homePracticeInstructions: assignments.homePracticeInstructions,
          dueAt: assignments.dueAt,
          status: assignments.status,
          createdAt: assignments.createdAt,
          updatedAt: assignments.updatedAt,
          className: classes.name,
        })
        .from(assignments)
        .innerJoin(
          classes,
          and(
            eq(classes.organizationId, assignments.organizationId),
            eq(classes.id, assignments.classId)
          )
        )
        .where(
          and(
            eq(assignments.organizationId, organizationId),
            eq(assignments.id, assignmentId)
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async findAssignmentByIdInOrgForUpdate(organizationId, assignmentId, tx) {
      const rows = await tx
        .select()
        .from(assignments)
        .where(
          and(
            eq(assignments.organizationId, organizationId),
            eq(assignments.id, assignmentId)
          )
        )
        .limit(1)
        .for('update');
      return rows[0] ?? null;
    },

    async listAssignmentItemsWithPinnedContent(
      organizationId,
      assignmentId,
      executor
    ) {
      const db = getExecutor(executor);
      return db
        .select({
          id: assignmentItems.id,
          organizationId: assignmentItems.organizationId,
          assignmentId: assignmentItems.assignmentId,
          contentVersionId: assignmentItems.contentVersionId,
          sortOrder: assignmentItems.sortOrder,
          createdAt: assignmentItems.createdAt,
          contentItemId: contentItems.id,
          slug: contentItems.slug,
          contentType: contentItems.contentType,
          versionNumber: contentVersions.versionNumber,
          versionStatus: contentVersions.status,
          title: contentVersions.title,
          summary: contentVersions.summary,
          locale: contentVersions.locale,
          payloadJson: contentVersions.payloadJson,
          metadataJson: contentVersions.metadataJson,
          publishedAt: contentVersions.publishedAt,
        })
        .from(assignmentItems)
        .innerJoin(
          contentVersions,
          eq(contentVersions.id, assignmentItems.contentVersionId)
        )
        .innerJoin(
          contentItems,
          eq(contentItems.id, contentVersions.contentItemId)
        )
        .where(
          and(
            eq(assignmentItems.organizationId, organizationId),
            eq(assignmentItems.assignmentId, assignmentId)
          )
        )
        .orderBy(asc(assignmentItems.sortOrder));
    },

    async listAssignmentTargetsWithStudents(
      organizationId,
      assignmentId,
      executor
    ) {
      const db = getExecutor(executor);
      return db
        .select({
          targetId: assignmentTargets.id,
          organizationId: assignmentTargets.organizationId,
          assignmentId: assignmentTargets.assignmentId,
          studentMembershipId: assignmentTargets.studentMembershipId,
          assignedAt: assignmentTargets.assignedAt,
          displayName: users.displayName,
          orgUsername: organizationMemberships.orgUsername,
          membershipStatus: organizationMemberships.status,
        })
        .from(assignmentTargets)
        .innerJoin(
          organizationMemberships,
          and(
            eq(
              organizationMemberships.organizationId,
              assignmentTargets.organizationId
            ),
            eq(
              organizationMemberships.id,
              assignmentTargets.studentMembershipId
            )
          )
        )
        .innerJoin(users, eq(users.id, organizationMemberships.userId))
        .where(
          and(
            eq(assignmentTargets.organizationId, organizationId),
            eq(assignmentTargets.assignmentId, assignmentId)
          )
        )
        .orderBy(asc(assignmentTargets.assignedAt));
    },

    async updateAssignmentFields(params, tx) {
      const existing = await this.findAssignmentByIdInOrg(
        params.organizationId,
        params.assignmentId,
        tx
      );
      if (!existing) {
        return null;
      }

      const nextTitle = params.title ?? existing.title;
      const nextInstructions =
        params.homePracticeInstructions !== undefined
          ? params.homePracticeInstructions
          : existing.homePracticeInstructions;
      const nextDueAt =
        params.dueAt !== undefined ? params.dueAt : existing.dueAt;
      const nextStatus = params.status ?? existing.status;

      await tx
        .update(assignments)
        .set({
          title: nextTitle,
          homePracticeInstructions: nextInstructions,
          dueAt: nextDueAt,
          status: nextStatus,
          updatedAt: params.now,
        })
        .where(
          and(
            eq(assignments.organizationId, params.organizationId),
            eq(assignments.id, params.assignmentId)
          )
        );

      return {
        id: existing.id,
        organizationId: existing.organizationId,
        classId: existing.classId,
        createdByTeacherMembershipId: existing.createdByTeacherMembershipId,
        title: nextTitle,
        homePracticeInstructions: nextInstructions,
        dueAt: nextDueAt,
        status: nextStatus,
        createdAt: existing.createdAt,
        updatedAt: params.now,
      };
    },

    async findTargetIdsWithActivity(
      organizationId,
      assignmentId,
      targetIds,
      tx
    ) {
      if (targetIds.length === 0) {
        return [];
      }
      const [attemptRows, progressRows] = await Promise.all([
        tx
          .select({ targetId: activityAttempts.assignmentTargetId })
          .from(activityAttempts)
          .where(
            and(
              eq(activityAttempts.organizationId, organizationId),
              eq(activityAttempts.assignmentId, assignmentId),
              inArray(activityAttempts.assignmentTargetId, targetIds)
            )
          ),
        tx
          .select({ targetId: assignmentProgress.assignmentTargetId })
          .from(assignmentProgress)
          .where(
            and(
              eq(assignmentProgress.organizationId, organizationId),
              inArray(assignmentProgress.assignmentTargetId, targetIds)
            )
          ),
      ]);

      return Array.from(
        new Set([
          ...attemptRows.map((r) => r.targetId),
          ...progressRows.map((r) => r.targetId),
        ])
      );
    },

    async syncAssignmentTargets(params, tx) {
      if (params.deleteTargetIds.length > 0) {
        await tx
          .delete(assignmentTargets)
          .where(
            and(
              eq(assignmentTargets.organizationId, params.organizationId),
              eq(assignmentTargets.assignmentId, params.assignmentId),
              inArray(assignmentTargets.id, params.deleteTargetIds)
            )
          );
      }

      if (params.inserts.length > 0) {
        await tx.insert(assignmentTargets).values(params.inserts);
      }

      await tx
        .update(assignments)
        .set({ updatedAt: params.now })
        .where(
          and(
            eq(assignments.organizationId, params.organizationId),
            eq(assignments.id, params.assignmentId)
          )
        );
    },

    async listAssignmentProgressSummary(
      organizationId,
      assignmentId,
      itemCount,
      executor
    ) {
      const db = getExecutor(executor);
      const rows = await db
        .select({
          assignmentTargetId: assignmentTargets.id,
          studentMembershipId: assignmentTargets.studentMembershipId,
          displayName: users.displayName,
          orgUsername: organizationMemberships.orgUsername,
          progressId: assignmentProgress.id,
          status: assignmentProgress.status,
          totalItems: assignmentProgress.totalItems,
          completedItems: assignmentProgress.completedItems,
          attemptCount: assignmentProgress.attemptCount,
          lastActivityAt: assignmentProgress.lastActivityAt,
          completedAt: assignmentProgress.completedAt,
        })
        .from(assignmentTargets)
        .innerJoin(
          organizationMemberships,
          and(
            eq(
              organizationMemberships.organizationId,
              assignmentTargets.organizationId
            ),
            eq(
              organizationMemberships.id,
              assignmentTargets.studentMembershipId
            )
          )
        )
        .innerJoin(users, eq(users.id, organizationMemberships.userId))
        .leftJoin(
          assignmentProgress,
          and(
            eq(
              assignmentProgress.organizationId,
              assignmentTargets.organizationId
            ),
            eq(assignmentProgress.assignmentTargetId, assignmentTargets.id)
          )
        )
        .where(
          and(
            eq(assignmentTargets.organizationId, organizationId),
            eq(assignmentTargets.assignmentId, assignmentId)
          )
        )
        .orderBy(asc(assignmentTargets.assignedAt));

      return rows.map((r) => ({
        assignmentTargetId: r.assignmentTargetId,
        studentMembershipId: r.studentMembershipId,
        displayName: r.displayName,
        orgUsername: r.orgUsername,
        hasProgressRecord: r.progressId !== null,
        status: r.status ?? 'not_started',
        totalItems: r.totalItems ?? itemCount,
        completedItems: r.completedItems ?? 0,
        attemptCount: r.attemptCount ?? 0,
        lastActivityAt: r.lastActivityAt ?? null,
        completedAt: r.completedAt ?? null,
      }));
    },

    async listAssignmentsForStudent(params) {
      const db = getDb();
      const allowedStatuses = params.status
        ? [params.status]
        : [...STUDENT_VISIBLE_ASSIGNMENT_STATUSES];

      const whereClause = and(
        eq(assignments.organizationId, params.organizationId),
        eq(assignmentTargets.organizationId, params.organizationId),
        eq(assignmentTargets.studentMembershipId, params.studentMembershipId),
        inArray(assignments.status, allowedStatuses)
      );
      const offset = (params.page - 1) * params.limit;

      const [countRows, rows] = await Promise.all([
        db
          .select({ total: count() })
          .from(assignmentTargets)
          .innerJoin(
            assignments,
            and(
              eq(assignments.organizationId, assignmentTargets.organizationId),
              eq(assignments.id, assignmentTargets.assignmentId)
            )
          )
          .where(whereClause),
        db
          .select({
            id: assignments.id,
            organizationId: assignments.organizationId,
            classId: assignments.classId,
            createdByTeacherMembershipId:
              assignments.createdByTeacherMembershipId,
            title: assignments.title,
            homePracticeInstructions: assignments.homePracticeInstructions,
            dueAt: assignments.dueAt,
            status: assignments.status,
            createdAt: assignments.createdAt,
            updatedAt: assignments.updatedAt,
            className: classes.name,
            targetId: assignmentTargets.id,
            assignedAt: assignmentTargets.assignedAt,
            itemCount: sql<number>`(SELECT COUNT(*) FROM assignment_items ai WHERE ai.organization_id = ${assignments.organizationId} AND ai.assignment_id = ${assignments.id})`,
            progressId: assignmentProgress.id,
            progressStatus: assignmentProgress.status,
            totalItems: assignmentProgress.totalItems,
            completedItems: assignmentProgress.completedItems,
            attemptCount: assignmentProgress.attemptCount,
            lastActivityAt: assignmentProgress.lastActivityAt,
            completedAt: assignmentProgress.completedAt,
          })
          .from(assignmentTargets)
          .innerJoin(
            assignments,
            and(
              eq(assignments.organizationId, assignmentTargets.organizationId),
              eq(assignments.id, assignmentTargets.assignmentId)
            )
          )
          .innerJoin(
            classes,
            and(
              eq(classes.organizationId, assignments.organizationId),
              eq(classes.id, assignments.classId)
            )
          )
          .leftJoin(
            assignmentProgress,
            and(
              eq(
                assignmentProgress.organizationId,
                assignmentTargets.organizationId
              ),
              eq(assignmentProgress.assignmentTargetId, assignmentTargets.id),
              eq(
                assignmentProgress.studentMembershipId,
                assignmentTargets.studentMembershipId
              )
            )
          )
          .where(whereClause)
          .orderBy(desc(assignmentTargets.assignedAt))
          .limit(params.limit)
          .offset(offset),
      ]);

      return {
        items: rows.map((r) => {
          const itemCount = Number(r.itemCount ?? 0);
          return {
            assignment: {
              id: r.id,
              organizationId: r.organizationId,
              classId: r.classId,
              createdByTeacherMembershipId: r.createdByTeacherMembershipId,
              title: r.title,
              homePracticeInstructions: r.homePracticeInstructions,
              dueAt: r.dueAt,
              status: r.status,
              createdAt: r.createdAt,
              updatedAt: r.updatedAt,
            },
            className: r.className,
            targetId: r.targetId,
            assignedAt: r.assignedAt,
            itemCount,
            progress: {
              hasProgressRecord: r.progressId !== null,
              status: r.progressStatus ?? 'not_started',
              totalItems: r.totalItems ?? itemCount,
              completedItems: r.completedItems ?? 0,
              attemptCount: r.attemptCount ?? 0,
              lastActivityAt: r.lastActivityAt ?? null,
              completedAt: r.completedAt ?? null,
            },
          };
        }),
        total: Number(countRows[0]?.total ?? 0),
      };
    },

    async findAssignmentForStudentById(params) {
      const db = getDb();
      const rows = await db
        .select({
          id: assignments.id,
          organizationId: assignments.organizationId,
          classId: assignments.classId,
          createdByTeacherMembershipId:
            assignments.createdByTeacherMembershipId,
          title: assignments.title,
          homePracticeInstructions: assignments.homePracticeInstructions,
          dueAt: assignments.dueAt,
          status: assignments.status,
          createdAt: assignments.createdAt,
          updatedAt: assignments.updatedAt,
          className: classes.name,
          targetId: assignmentTargets.id,
          assignedAt: assignmentTargets.assignedAt,
          progressId: assignmentProgress.id,
          progressStatus: assignmentProgress.status,
          totalItems: assignmentProgress.totalItems,
          completedItems: assignmentProgress.completedItems,
          attemptCount: assignmentProgress.attemptCount,
          lastActivityAt: assignmentProgress.lastActivityAt,
          completedAt: assignmentProgress.completedAt,
        })
        .from(assignmentTargets)
        .innerJoin(
          assignments,
          and(
            eq(assignments.organizationId, assignmentTargets.organizationId),
            eq(assignments.id, assignmentTargets.assignmentId)
          )
        )
        .innerJoin(
          classes,
          and(
            eq(classes.organizationId, assignments.organizationId),
            eq(classes.id, assignments.classId)
          )
        )
        .leftJoin(
          assignmentProgress,
          and(
            eq(
              assignmentProgress.organizationId,
              assignmentTargets.organizationId
            ),
            eq(assignmentProgress.assignmentTargetId, assignmentTargets.id),
            eq(
              assignmentProgress.studentMembershipId,
              assignmentTargets.studentMembershipId
            )
          )
        )
        .where(
          and(
            eq(assignments.organizationId, params.organizationId),
            eq(assignments.id, params.assignmentId),
            eq(assignmentTargets.organizationId, params.organizationId),
            eq(assignmentTargets.assignmentId, params.assignmentId),
            eq(
              assignmentTargets.studentMembershipId,
              params.studentMembershipId
            ),
            inArray(assignments.status, [...STUDENT_VISIBLE_ASSIGNMENT_STATUSES])
          )
        )
        .limit(1);

      const r = rows[0];
      if (!r) {
        return null;
      }

      return {
        assignment: {
          id: r.id,
          organizationId: r.organizationId,
          classId: r.classId,
          createdByTeacherMembershipId: r.createdByTeacherMembershipId,
          title: r.title,
          homePracticeInstructions: r.homePracticeInstructions,
          dueAt: r.dueAt,
          status: r.status,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        },
        className: r.className,
        targetId: r.targetId,
        assignedAt: r.assignedAt,
        progress: r.progressId
          ? {
              hasProgressRecord: true,
              status: r.progressStatus ?? 'not_started',
              totalItems: r.totalItems ?? 0,
              completedItems: r.completedItems ?? 0,
              attemptCount: r.attemptCount ?? 0,
              lastActivityAt: r.lastActivityAt ?? null,
              completedAt: r.completedAt ?? null,
            }
          : null,
      };
    },
  };
}
