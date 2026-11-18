import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import { type InsightPeriodType } from '../db/schema/_shared.ts';
import {
  activityAttempts,
  activityAttemptTurns,
} from '../db/schema/assignments.ts';
import {
  classEnrollments,
  classes,
  studentGoals,
} from '../db/schema/classes.ts';
import { contentItems, contentVersions } from '../db/schema/content.ts';
import {
  organizationMemberships,
  organizations,
  users,
} from '../db/schema/identity.ts';
import { orgInsightDailySnapshots } from '../db/schema/insights.ts';
import {
  getDb,
  withTransaction,
  type MimoraDatabase,
  type MimoraTransaction,
} from '../db/tidb.ts';

export type InsightDbOrTx = MimoraDatabase | MimoraTransaction;

export interface OrgInsightSnapshotRecord {
  id: string;
  organizationId: string;
  periodType: string;
  snapshotDate: string;
  contentType: string;
  eligibleEnrolledStudentsCount: number;
  activeStudentsCount: number;
  attemptsStartedCount: number;
  attemptsCompletedCount: number;
  distinctContentUsedCount: number;
  aacAssistedAttemptsCount: number;
  readAloudAssistedAttemptsCount: number;
  activeGoalsCount: number;
  achievedGoalsCount: number;
  choiceTrendsSummaryJson: Record<string, unknown> | null;
  computedAt: Date;
}

export interface SnapshotSourceAttemptRow {
  attemptId: string;
  studentMembershipId: string;
  contentItemId: string;
  contentType: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  usedAacSupport: boolean;
  usedReadAloud: boolean;
}

export interface SnapshotSourceTurnRow {
  attemptId: string;
  selectedChoiceKey: string | null;
  selectedEmotionKey: string | null;
}

export interface SnapshotSourceGoalRow {
  id: string;
  status: string;
  createdAt: Date;
  achievedAt: Date | null;
}

export interface InsightRepository {
  withTransaction<T>(fn: (tx: MimoraTransaction) => Promise<T>): Promise<T>;
  findOrganizationById(
    organizationId: string,
    executor?: InsightDbOrTx
  ): Promise<{ id: string; code: string; name: string; status: string } | null>;
  listOrganizationsByIds(
    organizationIds: string[],
    executor?: InsightDbOrTx
  ): Promise<Array<{ id: string; code: string; name: string; status: string }>>;
  findLatestSnapshotDate(
    params: {
      organizationId?: string;
      periodType: InsightPeriodType;
    },
    executor?: InsightDbOrTx
  ): Promise<string | null>;
  listSnapshotsForPeriod(
    params: {
      organizationId?: string;
      periodType: InsightPeriodType;
      snapshotDate: string;
    },
    executor?: InsightDbOrTx
  ): Promise<OrgInsightSnapshotRecord[]>;
  listEligibleEnrolledStudentIds(
    organizationId: string,
    executor?: InsightDbOrTx
  ): Promise<string[]>;
  listAttemptsInWindow(
    params: {
      organizationId: string;
      windowStart: Date;
      windowEndExclusive: Date;
    },
    executor?: InsightDbOrTx
  ): Promise<SnapshotSourceAttemptRow[]>;
  listTurnsForAttempts(
    organizationId: string,
    attemptIds: string[],
    executor?: InsightDbOrTx
  ): Promise<SnapshotSourceTurnRow[]>;
  listOrgGoalsForSnapshot(
    organizationId: string,
    windowEndExclusive: Date,
    executor?: InsightDbOrTx
  ): Promise<SnapshotSourceGoalRow[]>;
  upsertSnapshotRows(
    rows: Array<typeof orgInsightDailySnapshots.$inferInsert>,
    executor?: InsightDbOrTx
  ): Promise<OrgInsightSnapshotRecord[]>;
}

export function createInsightRepository(): InsightRepository {
  const resolveDb = (executor?: InsightDbOrTx) => executor ?? getDb();

  return {
    withTransaction<T>(fn: (tx: MimoraTransaction) => Promise<T>): Promise<T> {
      return withTransaction(fn);
    },

    async findOrganizationById(organizationId, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select({
          id: organizations.id,
          code: organizations.code,
          name: organizations.name,
          status: organizations.status,
        })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

      return rows[0] ?? null;
    },

    async listOrganizationsByIds(organizationIds, executor) {
      if (organizationIds.length === 0) {
        return [];
      }
      const db = resolveDb(executor);
      return db
        .select({
          id: organizations.id,
          code: organizations.code,
          name: organizations.name,
          status: organizations.status,
        })
        .from(organizations)
        .where(inArray(organizations.id, organizationIds));
    },

    async findLatestSnapshotDate(params, executor) {
      const db = resolveDb(executor);
      const conditions = [eq(orgInsightDailySnapshots.periodType, params.periodType)];
      if (params.organizationId) {
        conditions.push(
          eq(orgInsightDailySnapshots.organizationId, params.organizationId)
        );
      }
      const rows = await db
        .select({ snapshotDate: orgInsightDailySnapshots.snapshotDate })
        .from(orgInsightDailySnapshots)
        .where(and(...conditions))
        .orderBy(desc(orgInsightDailySnapshots.snapshotDate))
        .limit(1);

      return rows[0]?.snapshotDate ?? null;
    },

    async listSnapshotsForPeriod(params, executor) {
      const db = resolveDb(executor);
      const conditions = [
        eq(orgInsightDailySnapshots.periodType, params.periodType),
        eq(orgInsightDailySnapshots.snapshotDate, params.snapshotDate),
      ];
      if (params.organizationId) {
        conditions.push(
          eq(orgInsightDailySnapshots.organizationId, params.organizationId)
        );
      }

      return db
        .select()
        .from(orgInsightDailySnapshots)
        .where(and(...conditions));
    },

    async listEligibleEnrolledStudentIds(organizationId, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select({ studentMembershipId: organizationMemberships.id })
        .from(classEnrollments)
        .innerJoin(
          classes,
          and(
            eq(classes.organizationId, classEnrollments.organizationId),
            eq(classes.id, classEnrollments.classId),
            eq(classes.status, 'active')
          )
        )
        .innerJoin(
          organizationMemberships,
          and(
            eq(
              organizationMemberships.organizationId,
              classEnrollments.organizationId
            ),
            eq(organizationMemberships.id, classEnrollments.studentMembershipId),
            eq(organizationMemberships.role, 'student'),
            eq(organizationMemberships.status, 'active')
          )
        )
        .innerJoin(
          users,
          and(
            eq(users.id, organizationMemberships.userId),
            eq(users.status, 'active')
          )
        )
        .where(
          and(
            eq(classEnrollments.organizationId, organizationId),
            eq(classEnrollments.status, 'active')
          )
        );

      return Array.from(new Set(rows.map((r) => r.studentMembershipId)));
    },

    async listAttemptsInWindow(params, executor) {
      const db = resolveDb(executor);
      return db
        .select({
          attemptId: activityAttempts.id,
          studentMembershipId: activityAttempts.studentMembershipId,
          contentItemId: contentItems.id,
          contentType: contentItems.contentType,
          status: activityAttempts.status,
          startedAt: activityAttempts.startedAt,
          completedAt: activityAttempts.completedAt,
          usedAacSupport: activityAttempts.usedAacSupport,
          usedReadAloud: activityAttempts.usedReadAloud,
        })
        .from(activityAttempts)
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
            gte(activityAttempts.startedAt, params.windowStart),
            lt(activityAttempts.startedAt, params.windowEndExclusive)
          )
        );
    },

    async listTurnsForAttempts(organizationId, attemptIds, executor) {
      if (attemptIds.length === 0) {
        return [];
      }
      const db = resolveDb(executor);
      return db
        .select({
          attemptId: activityAttemptTurns.attemptId,
          selectedChoiceKey: activityAttemptTurns.selectedChoiceKey,
          selectedEmotionKey: activityAttemptTurns.selectedEmotionKey,
        })
        .from(activityAttemptTurns)
        .where(
          and(
            eq(activityAttemptTurns.organizationId, organizationId),
            inArray(activityAttemptTurns.attemptId, attemptIds)
          )
        );
    },

    async listOrgGoalsForSnapshot(organizationId, windowEndExclusive, executor) {
      const db = resolveDb(executor);
      return db
        .select({
          id: studentGoals.id,
          status: studentGoals.status,
          createdAt: studentGoals.createdAt,
          achievedAt: studentGoals.achievedAt,
        })
        .from(studentGoals)
        .where(
          and(
            eq(studentGoals.organizationId, organizationId),
            lt(studentGoals.createdAt, windowEndExclusive)
          )
        );
    },

    async upsertSnapshotRows(rows, executor) {
      const db = resolveDb(executor);
      const saved: OrgInsightSnapshotRecord[] = [];
      for (const row of rows) {
        const existing = await db
          .select()
          .from(orgInsightDailySnapshots)
          .where(
            and(
              eq(orgInsightDailySnapshots.organizationId, row.organizationId),
              eq(
                orgInsightDailySnapshots.periodType,
                row.periodType ?? 'daily'
              ),
              eq(orgInsightDailySnapshots.snapshotDate, row.snapshotDate),
              eq(orgInsightDailySnapshots.contentType, row.contentType)
            )
          )
          .limit(1);

        if (existing[0]) {
          await db
            .update(orgInsightDailySnapshots)
            .set({
              eligibleEnrolledStudentsCount: row.eligibleEnrolledStudentsCount ?? 0,
              activeStudentsCount: row.activeStudentsCount ?? 0,
              attemptsStartedCount: row.attemptsStartedCount ?? 0,
              attemptsCompletedCount: row.attemptsCompletedCount ?? 0,
              distinctContentUsedCount: row.distinctContentUsedCount ?? 0,
              aacAssistedAttemptsCount: row.aacAssistedAttemptsCount ?? 0,
              readAloudAssistedAttemptsCount:
                row.readAloudAssistedAttemptsCount ?? 0,
              activeGoalsCount: row.activeGoalsCount ?? 0,
              achievedGoalsCount: row.achievedGoalsCount ?? 0,
              choiceTrendsSummaryJson: row.choiceTrendsSummaryJson ?? null,
              computedAt: row.computedAt,
            })
            .where(eq(orgInsightDailySnapshots.id, existing[0].id));

          saved.push({
            ...existing[0],
            eligibleEnrolledStudentsCount: row.eligibleEnrolledStudentsCount ?? 0,
            activeStudentsCount: row.activeStudentsCount ?? 0,
            attemptsStartedCount: row.attemptsStartedCount ?? 0,
            attemptsCompletedCount: row.attemptsCompletedCount ?? 0,
            distinctContentUsedCount: row.distinctContentUsedCount ?? 0,
            aacAssistedAttemptsCount: row.aacAssistedAttemptsCount ?? 0,
            readAloudAssistedAttemptsCount:
              row.readAloudAssistedAttemptsCount ?? 0,
            activeGoalsCount: row.activeGoalsCount ?? 0,
            achievedGoalsCount: row.achievedGoalsCount ?? 0,
            choiceTrendsSummaryJson: row.choiceTrendsSummaryJson ?? null,
            computedAt: row.computedAt,
          });
        } else {
          await db.insert(orgInsightDailySnapshots).values(row);
          saved.push({
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
            readAloudAssistedAttemptsCount:
              row.readAloudAssistedAttemptsCount ?? 0,
            activeGoalsCount: row.activeGoalsCount ?? 0,
            achievedGoalsCount: row.achievedGoalsCount ?? 0,
            choiceTrendsSummaryJson: row.choiceTrendsSummaryJson ?? null,
            computedAt: row.computedAt,
          });
        }
      }

      return saved;
    },
  };
}
