import { and, asc, count, desc, eq, max, sql } from 'drizzle-orm';
import {
  activityAttempts,
  activityAttemptTurns,
  assignmentItems,
  assignmentProgress,
  assignments,
  assignmentTargets,
} from '../db/schema/assignments.ts';
import { classes, classTeachers } from '../db/schema/classes.ts';
import { contentItems, contentVersions } from '../db/schema/content.ts';
import { organizationMemberships, users } from '../db/schema/identity.ts';
import {
  getDb,
  withTransaction,
  type MimoraDatabase,
  type MimoraTransaction,
} from '../db/tidb.ts';
import { generateUuidV7 } from '../db/uuid.ts';

export type AttemptDbOrTx = MimoraDatabase | MimoraTransaction;

export const ATTEMPT_STATUSES = [
  'in_progress',
  'completed',
  'abandoned',
] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const PROGRESS_STATUSES = [
  'not_started',
  'in_progress',
  'completed',
] as const;
export type ProgressStatus = (typeof PROGRESS_STATUSES)[number];

export type ActivityAttemptRecord = typeof activityAttempts.$inferSelect;
export type ActivityAttemptInsert = typeof activityAttempts.$inferInsert;
export type ActivityAttemptTurnRecord = typeof activityAttemptTurns.$inferSelect;
export type ActivityAttemptTurnInsert = typeof activityAttemptTurns.$inferInsert;
export type AssignmentProgressRecord = typeof assignmentProgress.$inferSelect;

export interface StudentTargetItemContext {
  target: {
    id: string;
    organizationId: string;
    assignmentId: string;
    studentMembershipId: string;
    assignedAt: Date;
  };
  assignment: {
    id: string;
    organizationId: string;
    classId: string;
    title: string;
    status: string;
    dueAt: Date | null;
    homePracticeInstructions: string | null;
  };
  item: {
    id: string;
    organizationId: string;
    assignmentId: string;
    contentVersionId: string;
    sortOrder: number;
  };
  contentVersion: {
    id: string;
    contentItemId: string;
    contentType: string;
    versionNumber: number;
    title: string;
    summary: string | null;
    locale: string;
  };
  totalItemsInAssignment: number;
}

export interface StudentAttemptContext {
  attempt: ActivityAttemptRecord;
  assignment: {
    id: string;
    organizationId: string;
    classId: string;
    title: string;
    status: string;
    dueAt: Date | null;
  };
  item: {
    id: string;
    sortOrder: number;
    contentVersionId: string;
  };
  contentVersion: {
    id: string;
    contentItemId: string;
    contentType: string;
    versionNumber: number;
    title: string;
    summary: string | null;
    locale: string;
  };
  totalItemsInAssignment: number;
}

export interface TeacherAssignmentContext {
  assignment: {
    id: string;
    organizationId: string;
    classId: string;
    className: string;
    createdByTeacherMembershipId: string;
    title: string;
    status: string;
    dueAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
  isTeacherAssigned: boolean;
}

export interface TeacherAttemptSummaryRow {
  attempt: ActivityAttemptRecord;
  studentDisplayName: string;
  studentOrgUsername: string | null;
  assignmentItemSortOrder: number;
  contentItemId: string;
  contentType: string;
  contentVersionNumber: number;
  contentTitle: string;
  turnCount: number;
}

export interface AttemptRepository {
  withTransaction<T>(fn: (tx: MimoraTransaction) => Promise<T>): Promise<T>;
  findAndLockTargetAndItemForStudent(
    params: {
      organizationId: string;
      studentMembershipId: string;
      targetId: string;
      itemId: string;
    },
    tx: MimoraTransaction
  ): Promise<StudentTargetItemContext | null>;
  findAttemptByStartIdempotencyKey(
    params: {
      organizationId: string;
      studentMembershipId: string;
      assignmentTargetId: string;
      assignmentItemId: string;
      startIdempotencyKey: string;
    },
    executor?: AttemptDbOrTx
  ): Promise<ActivityAttemptRecord | null>;
  findInProgressAttemptForItem(
    params: {
      organizationId: string;
      studentMembershipId: string;
      assignmentTargetId: string;
      assignmentItemId: string;
    },
    executor?: AttemptDbOrTx
  ): Promise<ActivityAttemptRecord | null>;
  findAttemptAggregateStatsForItem(
    params: {
      organizationId: string;
      studentMembershipId: string;
      assignmentTargetId: string;
      assignmentItemId: string;
    },
    executor?: AttemptDbOrTx
  ): Promise<{ totalCount: number; maxAttemptNumber: number }>;
  insertActivityAttempt(
    row: ActivityAttemptInsert,
    tx: MimoraTransaction
  ): Promise<ActivityAttemptRecord>;
  listTurnsForAttempt(
    params: {
      organizationId: string;
      attemptId: string;
    },
    executor?: AttemptDbOrTx
  ): Promise<ActivityAttemptTurnRecord[]>;
  findTurnByAttemptAndIndex(
    params: {
      organizationId: string;
      attemptId: string;
      turnIndex: number;
    },
    executor?: AttemptDbOrTx
  ): Promise<ActivityAttemptTurnRecord | null>;
  insertTurnAndUpdateAttempt(
    params: {
      turn: ActivityAttemptTurnInsert;
      attemptUpdate: {
        organizationId: string;
        studentMembershipId: string;
        attemptId: string;
        lastInteractedAt: Date;
        durationSeconds: number;
        usedAacSupport: boolean;
        usedReadAloud: boolean;
        aacTapCount: number;
        readAloudCount: number;
      };
    },
    tx: MimoraTransaction
  ): Promise<{
    turn: ActivityAttemptTurnRecord;
    attempt: ActivityAttemptRecord;
  }>;
  findAttemptRefForStudent(
    params: {
      organizationId: string;
      studentMembershipId: string;
      attemptId: string;
    },
    executor?: AttemptDbOrTx
  ): Promise<{
    id: string;
    assignmentTargetId: string;
    assignmentId: string;
    assignmentItemId: string;
  } | null>;
  lockTargetAndLoadStudentAttempt(
    params: {
      organizationId: string;
      studentMembershipId: string;
      targetId: string;
      attemptId: string;
    },
    tx: MimoraTransaction
  ): Promise<StudentAttemptContext | null>;
  loadStudentAttemptReadOnly(
    params: {
      organizationId: string;
      studentMembershipId: string;
      attemptId: string;
    },
    executor?: AttemptDbOrTx
  ): Promise<StudentAttemptContext | null>;
  updateAttemptStatus(
    params: {
      organizationId: string;
      studentMembershipId: string;
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
    tx: MimoraTransaction
  ): Promise<ActivityAttemptRecord>;
  findAssignmentProgressByTarget(
    params: {
      organizationId: string;
      assignmentTargetId: string;
      studentMembershipId: string;
    },
    executor?: AttemptDbOrTx
  ): Promise<AssignmentProgressRecord | null>;
  recomputeAndUpsertAssignmentProgress(
    params: {
      organizationId: string;
      assignmentTargetId: string;
      studentMembershipId: string;
      totalItems: number;
      fallbackActivityAt: Date;
      now: Date;
    },
    tx: MimoraTransaction
  ): Promise<AssignmentProgressRecord>;
  findTeacherAssignmentAccess(
    params: {
      organizationId: string;
      assignmentId: string;
      teacherMembershipId: string;
    },
    executor?: AttemptDbOrTx
  ): Promise<TeacherAssignmentContext | null>;
  listAttemptsForTeacherAssignment(
    params: {
      organizationId: string;
      assignmentId: string;
      studentMembershipId?: string;
      assignmentItemId?: string;
      status?: AttemptStatus;
      page: number;
      limit: number;
    },
    executor?: AttemptDbOrTx
  ): Promise<{ items: TeacherAttemptSummaryRow[]; total: number }>;
  findAttemptDetailForTeacher(
    params: {
      organizationId: string;
      assignmentId: string;
      attemptId: string;
    },
    executor?: AttemptDbOrTx
  ): Promise<TeacherAttemptSummaryRow | null>;
}

function getExecutor(executor?: AttemptDbOrTx): AttemptDbOrTx {
  return executor ?? getDb();
}

export function createAttemptRepository(): AttemptRepository {
  return {
    withTransaction,

    async findAndLockTargetAndItemForStudent(params, tx) {
      const [lockedTarget] = await tx
        .select({
          id: assignmentTargets.id,
          organizationId: assignmentTargets.organizationId,
          assignmentId: assignmentTargets.assignmentId,
          studentMembershipId: assignmentTargets.studentMembershipId,
          assignedAt: assignmentTargets.assignedAt,
        })
        .from(assignmentTargets)
        .where(
          and(
            eq(assignmentTargets.organizationId, params.organizationId),
            eq(assignmentTargets.studentMembershipId, params.studentMembershipId),
            eq(assignmentTargets.id, params.targetId)
          )
        )
        .for('update');

      if (!lockedTarget) {
        return null;
      }

      const [assignmentRow] = await tx
        .select({
          id: assignments.id,
          organizationId: assignments.organizationId,
          classId: assignments.classId,
          title: assignments.title,
          status: assignments.status,
          dueAt: assignments.dueAt,
          homePracticeInstructions: assignments.homePracticeInstructions,
        })
        .from(assignments)
        .where(
          and(
            eq(assignments.organizationId, params.organizationId),
            eq(assignments.id, lockedTarget.assignmentId)
          )
        )
        .limit(1);

      if (!assignmentRow) {
        return null;
      }

      const [itemRow] = await tx
        .select({
          id: assignmentItems.id,
          organizationId: assignmentItems.organizationId,
          assignmentId: assignmentItems.assignmentId,
          contentVersionId: assignmentItems.contentVersionId,
          sortOrder: assignmentItems.sortOrder,
          contentItemId: contentVersions.contentItemId,
          contentType: contentItems.contentType,
          versionNumber: contentVersions.versionNumber,
          title: contentVersions.title,
          summary: contentVersions.summary,
          locale: contentVersions.locale,
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
            eq(assignmentItems.organizationId, params.organizationId),
            eq(assignmentItems.assignmentId, lockedTarget.assignmentId),
            eq(assignmentItems.id, params.itemId)
          )
        )
        .limit(1);

      if (!itemRow) {
        return null;
      }

      const [countRow] = await tx
        .select({ total: count() })
        .from(assignmentItems)
        .where(
          and(
            eq(assignmentItems.organizationId, params.organizationId),
            eq(assignmentItems.assignmentId, lockedTarget.assignmentId)
          )
        );

      return {
        target: lockedTarget,
        assignment: assignmentRow,
        item: {
          id: itemRow.id,
          organizationId: itemRow.organizationId,
          assignmentId: itemRow.assignmentId,
          contentVersionId: itemRow.contentVersionId,
          sortOrder: itemRow.sortOrder,
        },
        contentVersion: {
          id: itemRow.contentVersionId,
          contentItemId: itemRow.contentItemId,
          contentType: itemRow.contentType,
          versionNumber: itemRow.versionNumber,
          title: itemRow.title,
          summary: itemRow.summary,
          locale: itemRow.locale,
        },
        totalItemsInAssignment: Number(countRow?.total ?? 0),
      };
    },

    async findAttemptByStartIdempotencyKey(params, executor) {
      const db = getExecutor(executor);
      const baseQuery = db
        .select()
        .from(activityAttempts)
        .where(
          and(
            eq(activityAttempts.organizationId, params.organizationId),
            eq(activityAttempts.studentMembershipId, params.studentMembershipId),
            eq(activityAttempts.assignmentTargetId, params.assignmentTargetId),
            eq(activityAttempts.assignmentItemId, params.assignmentItemId),
            eq(activityAttempts.startIdempotencyKey, params.startIdempotencyKey)
          )
        )
        .limit(1);
      const [row] = executor ? await baseQuery.for('update') : await baseQuery;

      return row ?? null;
    },

    async findInProgressAttemptForItem(params, executor) {
      const db = getExecutor(executor);
      const [row] = await db
        .select()
        .from(activityAttempts)
        .where(
          and(
            eq(activityAttempts.organizationId, params.organizationId),
            eq(activityAttempts.studentMembershipId, params.studentMembershipId),
            eq(activityAttempts.assignmentTargetId, params.assignmentTargetId),
            eq(activityAttempts.assignmentItemId, params.assignmentItemId),
            eq(activityAttempts.status, 'in_progress')
          )
        )
        .limit(1)
        .for('update');

      return row ?? null;
    },

    async findAttemptAggregateStatsForItem(params, executor) {
      const db = getExecutor(executor);
      const baseQuery = db
        .select({
          attemptNumber: activityAttempts.attemptNumber,
        })
        .from(activityAttempts)
        .where(
          and(
            eq(activityAttempts.organizationId, params.organizationId),
            eq(activityAttempts.studentMembershipId, params.studentMembershipId),
            eq(activityAttempts.assignmentTargetId, params.assignmentTargetId),
            eq(activityAttempts.assignmentItemId, params.assignmentItemId)
          )
        );
      const rows = executor ? await baseQuery.for('update') : await baseQuery;
      let maxAttemptNumber = 0;
      for (const r of rows) {
        if (r.attemptNumber > maxAttemptNumber) {
          maxAttemptNumber = r.attemptNumber;
        }
      }

      return {
        totalCount: rows.length,
        maxAttemptNumber,
      };
    },

    async insertActivityAttempt(row, tx) {
      await tx.insert(activityAttempts).values(row);
      const [created] = await tx
        .select()
        .from(activityAttempts)
        .where(
          and(
            eq(activityAttempts.organizationId, row.organizationId),
            eq(activityAttempts.id, row.id)
          )
        )
        .limit(1);

      return (
        created ?? {
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
        }
      );
    },

    async listTurnsForAttempt(params, executor) {
      const db = getExecutor(executor);
      const baseQuery = db
        .select()
        .from(activityAttemptTurns)
        .where(
          and(
            eq(activityAttemptTurns.organizationId, params.organizationId),
            eq(activityAttemptTurns.attemptId, params.attemptId)
          )
        )
        .orderBy(
          asc(activityAttemptTurns.turnIndex),
          asc(activityAttemptTurns.respondedAt),
          asc(activityAttemptTurns.id)
        );
      return executor ? baseQuery.for('update') : baseQuery;
    },

    async findTurnByAttemptAndIndex(params, executor) {
      const db = getExecutor(executor);
      const [row] = await db
        .select()
        .from(activityAttemptTurns)
        .where(
          and(
            eq(activityAttemptTurns.organizationId, params.organizationId),
            eq(activityAttemptTurns.attemptId, params.attemptId),
            eq(activityAttemptTurns.turnIndex, params.turnIndex)
          )
        )
        .limit(1)
        .for('update');

      return row ?? null;
    },

    async insertTurnAndUpdateAttempt(params, tx) {
      await tx.insert(activityAttemptTurns).values(params.turn);
      await tx
        .update(activityAttempts)
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
            eq(activityAttempts.organizationId, params.attemptUpdate.organizationId),
            eq(
              activityAttempts.studentMembershipId,
              params.attemptUpdate.studentMembershipId
            ),
            eq(activityAttempts.id, params.attemptUpdate.attemptId)
          )
        );

      const [turn] = await tx
        .select()
        .from(activityAttemptTurns)
        .where(
          and(
            eq(activityAttemptTurns.organizationId, params.turn.organizationId),
            eq(activityAttemptTurns.id, params.turn.id)
          )
        )
        .limit(1);

      const [attempt] = await tx
        .select()
        .from(activityAttempts)
        .where(
          and(
            eq(activityAttempts.organizationId, params.attemptUpdate.organizationId),
            eq(
              activityAttempts.studentMembershipId,
              params.attemptUpdate.studentMembershipId
            ),
            eq(activityAttempts.id, params.attemptUpdate.attemptId)
          )
        )
        .limit(1);

      return {
        turn: turn!,
        attempt: attempt!,
      };
    },

    async findAttemptRefForStudent(params, executor) {
      const db = getExecutor(executor);
      const [row] = await db
        .select({
          id: activityAttempts.id,
          assignmentTargetId: activityAttempts.assignmentTargetId,
          assignmentId: activityAttempts.assignmentId,
          assignmentItemId: activityAttempts.assignmentItemId,
        })
        .from(activityAttempts)
        .where(
          and(
            eq(activityAttempts.organizationId, params.organizationId),
            eq(activityAttempts.studentMembershipId, params.studentMembershipId),
            eq(activityAttempts.id, params.attemptId)
          )
        )
        .limit(1);

      return row ?? null;
    },

    async lockTargetAndLoadStudentAttempt(params, tx) {
      const [lockedTarget] = await tx
        .select({ id: assignmentTargets.id })
        .from(assignmentTargets)
        .where(
          and(
            eq(assignmentTargets.organizationId, params.organizationId),
            eq(assignmentTargets.studentMembershipId, params.studentMembershipId),
            eq(assignmentTargets.id, params.targetId)
          )
        )
        .for('update');

      if (!lockedTarget) {
        return null;
      }

      const [attemptRow] = await tx
        .select()
        .from(activityAttempts)
        .where(
          and(
            eq(activityAttempts.organizationId, params.organizationId),
            eq(activityAttempts.studentMembershipId, params.studentMembershipId),
            eq(activityAttempts.assignmentTargetId, lockedTarget.id),
            eq(activityAttempts.id, params.attemptId)
          )
        )
        .for('update');

      if (!attemptRow) {
        return null;
      }

      return loadAttemptContextMetadata(attemptRow, tx);
    },

    async loadStudentAttemptReadOnly(params, executor) {
      const db = getExecutor(executor);
      const [attemptRow] = await db
        .select()
        .from(activityAttempts)
        .where(
          and(
            eq(activityAttempts.organizationId, params.organizationId),
            eq(activityAttempts.studentMembershipId, params.studentMembershipId),
            eq(activityAttempts.id, params.attemptId)
          )
        )
        .limit(1);

      if (!attemptRow) {
        return null;
      }

      return loadAttemptContextMetadata(attemptRow, db);
    },

    async updateAttemptStatus(params, tx) {
      await tx
        .update(activityAttempts)
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
            eq(activityAttempts.organizationId, params.organizationId),
            eq(activityAttempts.studentMembershipId, params.studentMembershipId),
            eq(activityAttempts.id, params.attemptId)
          )
        );

      const [updated] = await tx
        .select()
        .from(activityAttempts)
        .where(
          and(
            eq(activityAttempts.organizationId, params.organizationId),
            eq(activityAttempts.studentMembershipId, params.studentMembershipId),
            eq(activityAttempts.id, params.attemptId)
          )
        )
        .limit(1);

      return updated!;
    },

    async findAssignmentProgressByTarget(params, executor) {
      const db = getExecutor(executor);
      const baseQuery = db
        .select()
        .from(assignmentProgress)
        .where(
          and(
            eq(assignmentProgress.organizationId, params.organizationId),
            eq(assignmentProgress.assignmentTargetId, params.assignmentTargetId),
            eq(assignmentProgress.studentMembershipId, params.studentMembershipId)
          )
        )
        .limit(1);
      const [row] = executor ? await baseQuery.for('update') : await baseQuery;

      return row ?? null;
    },

    async recomputeAndUpsertAssignmentProgress(params, tx) {
      const targetAttempts = await tx
        .select({
          id: activityAttempts.id,
          assignmentItemId: activityAttempts.assignmentItemId,
          status: activityAttempts.status,
          lastInteractedAt: activityAttempts.lastInteractedAt,
          completedAt: activityAttempts.completedAt,
        })
        .from(activityAttempts)
        .where(
          and(
            eq(activityAttempts.organizationId, params.organizationId),
            eq(activityAttempts.assignmentTargetId, params.assignmentTargetId),
            eq(activityAttempts.studentMembershipId, params.studentMembershipId)
          )
        )
        .for('update');

      const [existingProgress] = await tx
        .select()
        .from(assignmentProgress)
        .where(
          and(
            eq(assignmentProgress.organizationId, params.organizationId),
            eq(assignmentProgress.assignmentTargetId, params.assignmentTargetId)
          )
        )
        .for('update');

      const completedItemIds = new Set<string>();
      let latestInProgress: { id: string; at: number } | null = null;
      let latestCompleted: { id: string; at: number; completedAt: Date } | null =
        null;
      let maxLastActivityAt: Date | null = null;

      for (const row of targetAttempts) {
        if (
          maxLastActivityAt === null ||
          row.lastInteractedAt.getTime() > maxLastActivityAt.getTime()
        ) {
          maxLastActivityAt = row.lastInteractedAt;
        }

        if (row.status === 'in_progress') {
          const ts = row.lastInteractedAt.getTime();
          if (
            !latestInProgress ||
            ts > latestInProgress.at ||
            (ts === latestInProgress.at && row.id > latestInProgress.id)
          ) {
            latestInProgress = { id: row.id, at: ts };
          }
        } else if (row.status === 'completed') {
          completedItemIds.add(row.assignmentItemId);
          const completedDate = row.completedAt ?? row.lastInteractedAt;
          const ts = completedDate.getTime();
          if (
            !latestCompleted ||
            ts > latestCompleted.at ||
            (ts === latestCompleted.at && row.id > latestCompleted.id)
          ) {
            latestCompleted = {
              id: row.id,
              at: ts,
              completedAt: completedDate,
            };
          }
        }
      }

      const attemptCount = targetAttempts.length;
      const completedItems = completedItemIds.size;
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

      const lastActivityAt =
        maxLastActivityAt ??
        existingProgress?.lastActivityAt ??
        params.fallbackActivityAt;

      if (existingProgress) {
        await tx
          .update(assignmentProgress)
          .set({
            activeAttemptId,
            latestCompletedAttemptId,
            totalItems: params.totalItems,
            completedItems,
            attemptCount,
            status,
            lastActivityAt,
            completedAt,
            updatedAt: params.now,
          })
          .where(
            and(
              eq(assignmentProgress.organizationId, params.organizationId),
              eq(assignmentProgress.id, existingProgress.id)
            )
          );

        const [updated] = await tx
          .select()
          .from(assignmentProgress)
          .where(eq(assignmentProgress.id, existingProgress.id))
          .limit(1);
        return updated!;
      }

      const progressRow: typeof assignmentProgress.$inferInsert = {
        id: generateUuidV7(),
        organizationId: params.organizationId,
        assignmentTargetId: params.assignmentTargetId,
        studentMembershipId: params.studentMembershipId,
        activeAttemptId,
        latestCompletedAttemptId,
        totalItems: params.totalItems,
        completedItems,
        attemptCount,
        status,
        lastActivityAt,
        completedAt,
        updatedAt: params.now,
      };
      await tx.insert(assignmentProgress).values(progressRow);
      const [inserted] = await tx
        .select()
        .from(assignmentProgress)
        .where(eq(assignmentProgress.id, progressRow.id))
        .limit(1);
      return inserted!;
    },

    async findTeacherAssignmentAccess(params, executor) {
      const db = getExecutor(executor);
      const [assignmentRow] = await db
        .select({
          id: assignments.id,
          organizationId: assignments.organizationId,
          classId: assignments.classId,
          className: classes.name,
          createdByTeacherMembershipId: assignments.createdByTeacherMembershipId,
          title: assignments.title,
          status: assignments.status,
          dueAt: assignments.dueAt,
          createdAt: assignments.createdAt,
          updatedAt: assignments.updatedAt,
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
            eq(assignments.organizationId, params.organizationId),
            eq(assignments.id, params.assignmentId)
          )
        )
        .limit(1);

      if (!assignmentRow) {
        return null;
      }

      const [ctRow] = await db
        .select({ id: classTeachers.id })
        .from(classTeachers)
        .where(
          and(
            eq(classTeachers.organizationId, params.organizationId),
            eq(classTeachers.classId, assignmentRow.classId),
            eq(classTeachers.teacherMembershipId, params.teacherMembershipId)
          )
        )
        .limit(1);

      return {
        assignment: assignmentRow,
        isTeacherAssigned: Boolean(ctRow),
      };
    },

    async listAttemptsForTeacherAssignment(params, executor) {
      const db = getExecutor(executor);
      const conditions = [
        eq(activityAttempts.organizationId, params.organizationId),
        eq(activityAttempts.assignmentId, params.assignmentId),
      ];
      if (params.studentMembershipId) {
        conditions.push(
          eq(activityAttempts.studentMembershipId, params.studentMembershipId)
        );
      }
      if (params.assignmentItemId) {
        conditions.push(
          eq(activityAttempts.assignmentItemId, params.assignmentItemId)
        );
      }
      if (params.status) {
        conditions.push(eq(activityAttempts.status, params.status));
      }

      const whereClause = and(...conditions);
      const offset = (params.page - 1) * params.limit;

      const [countRow, rows] = await Promise.all([
        db.select({ total: count() }).from(activityAttempts).where(whereClause),
        db
          .select({
            attempt: activityAttempts,
            studentDisplayName: users.displayName,
            studentOrgUsername: organizationMemberships.orgUsername,
            assignmentItemSortOrder: assignmentItems.sortOrder,
            contentItemId: contentVersions.contentItemId,
            contentType: contentItems.contentType,
            contentVersionNumber: contentVersions.versionNumber,
            contentTitle: contentVersions.title,
            turnCount: sql<number>`(SELECT COUNT(*) FROM activity_attempt_turns t WHERE t.organization_id = ${activityAttempts.organizationId} AND t.attempt_id = ${activityAttempts.id})`,
          })
          .from(activityAttempts)
          .innerJoin(
            organizationMemberships,
            and(
              eq(
                organizationMemberships.organizationId,
                activityAttempts.organizationId
              ),
              eq(organizationMemberships.id, activityAttempts.studentMembershipId)
            )
          )
          .innerJoin(users, eq(users.id, organizationMemberships.userId))
          .innerJoin(
            assignmentItems,
            and(
              eq(assignmentItems.organizationId, activityAttempts.organizationId),
              eq(assignmentItems.assignmentId, activityAttempts.assignmentId),
              eq(assignmentItems.id, activityAttempts.assignmentItemId)
            )
          )
          .innerJoin(
            contentVersions,
            eq(contentVersions.id, activityAttempts.contentVersionId)
          )
          .innerJoin(
            contentItems,
            eq(contentItems.id, contentVersions.contentItemId)
          )
          .where(whereClause)
          .orderBy(
            desc(activityAttempts.lastInteractedAt),
            desc(activityAttempts.id)
          )
          .limit(params.limit)
          .offset(offset),
      ]);

      return {
        items: rows.map((r) => ({
          attempt: r.attempt,
          studentDisplayName: r.studentDisplayName,
          studentOrgUsername: r.studentOrgUsername,
          assignmentItemSortOrder: r.assignmentItemSortOrder,
          contentItemId: r.contentItemId,
          contentType: r.contentType,
          contentVersionNumber: r.contentVersionNumber,
          contentTitle: r.contentTitle,
          turnCount: Number(r.turnCount ?? 0),
        })),
        total: Number(countRow[0]?.total ?? 0),
      };
    },

    async findAttemptDetailForTeacher(params, executor) {
      const db = getExecutor(executor);
      const [r] = await db
        .select({
          attempt: activityAttempts,
          studentDisplayName: users.displayName,
          studentOrgUsername: organizationMemberships.orgUsername,
          assignmentItemSortOrder: assignmentItems.sortOrder,
          contentItemId: contentVersions.contentItemId,
          contentType: contentItems.contentType,
          contentVersionNumber: contentVersions.versionNumber,
          contentTitle: contentVersions.title,
          turnCount: sql<number>`(SELECT COUNT(*) FROM activity_attempt_turns t WHERE t.organization_id = ${activityAttempts.organizationId} AND t.attempt_id = ${activityAttempts.id})`,
        })
        .from(activityAttempts)
        .innerJoin(
          organizationMemberships,
          and(
            eq(
              organizationMemberships.organizationId,
              activityAttempts.organizationId
            ),
            eq(organizationMemberships.id, activityAttempts.studentMembershipId)
          )
        )
        .innerJoin(users, eq(users.id, organizationMemberships.userId))
        .innerJoin(
          assignmentItems,
          and(
            eq(assignmentItems.organizationId, activityAttempts.organizationId),
            eq(assignmentItems.assignmentId, activityAttempts.assignmentId),
            eq(assignmentItems.id, activityAttempts.assignmentItemId)
          )
        )
        .innerJoin(
          contentVersions,
          eq(contentVersions.id, activityAttempts.contentVersionId)
        )
        .innerJoin(
          contentItems,
          eq(contentItems.id, contentVersions.contentItemId)
        )
        .where(
          and(
            eq(activityAttempts.organizationId, params.organizationId),
            eq(activityAttempts.assignmentId, params.assignmentId),
            eq(activityAttempts.id, params.attemptId)
          )
        )
        .limit(1);

      if (!r) {
        return null;
      }

      return {
        attempt: r.attempt,
        studentDisplayName: r.studentDisplayName,
        studentOrgUsername: r.studentOrgUsername,
        assignmentItemSortOrder: r.assignmentItemSortOrder,
        contentItemId: r.contentItemId,
        contentType: r.contentType,
        contentVersionNumber: r.contentVersionNumber,
        contentTitle: r.contentTitle,
        turnCount: Number(r.turnCount ?? 0),
      };
    },
  };
}

async function loadAttemptContextMetadata(
  attemptRow: ActivityAttemptRecord,
  db: AttemptDbOrTx
): Promise<StudentAttemptContext | null> {
  const [assignmentRow] = await db
    .select({
      id: assignments.id,
      organizationId: assignments.organizationId,
      classId: assignments.classId,
      title: assignments.title,
      status: assignments.status,
      dueAt: assignments.dueAt,
    })
    .from(assignments)
    .where(
      and(
        eq(assignments.organizationId, attemptRow.organizationId),
        eq(assignments.id, attemptRow.assignmentId)
      )
    )
    .limit(1);

  if (!assignmentRow) {
    return null;
  }

  const [itemRow] = await db
    .select({
      id: assignmentItems.id,
      sortOrder: assignmentItems.sortOrder,
      contentVersionId: assignmentItems.contentVersionId,
      contentItemId: contentVersions.contentItemId,
      contentType: contentItems.contentType,
      versionNumber: contentVersions.versionNumber,
      title: contentVersions.title,
      summary: contentVersions.summary,
      locale: contentVersions.locale,
    })
    .from(assignmentItems)
    .innerJoin(
      contentVersions,
      eq(contentVersions.id, assignmentItems.contentVersionId)
    )
    .innerJoin(contentItems, eq(contentItems.id, contentVersions.contentItemId))
    .where(
      and(
        eq(assignmentItems.organizationId, attemptRow.organizationId),
        eq(assignmentItems.assignmentId, attemptRow.assignmentId),
        eq(assignmentItems.id, attemptRow.assignmentItemId)
      )
    )
    .limit(1);

  if (!itemRow) {
    return null;
  }

  const [countRow] = await db
    .select({ total: count() })
    .from(assignmentItems)
    .where(
      and(
        eq(assignmentItems.organizationId, attemptRow.organizationId),
        eq(assignmentItems.assignmentId, attemptRow.assignmentId)
      )
    );

  return {
    attempt: attemptRow,
    assignment: assignmentRow,
    item: {
      id: itemRow.id,
      sortOrder: itemRow.sortOrder,
      contentVersionId: itemRow.contentVersionId,
    },
    contentVersion: {
      id: itemRow.contentVersionId,
      contentItemId: itemRow.contentItemId,
      contentType: itemRow.contentType,
      versionNumber: itemRow.versionNumber,
      title: itemRow.title,
      summary: itemRow.summary,
      locale: itemRow.locale,
    },
    totalItemsInAssignment: Number(countRow?.total ?? 0),
  };
}
