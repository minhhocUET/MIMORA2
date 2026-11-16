import {
  date,
  datetime,
  foreignKey,
  index,
  int,
  json,
  mysqlTable,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';
import { uuidChar36 } from './_shared';
import { organizations } from './identity';

/**
 * 3.21 org_insight_daily_snapshots (Anonymized aggregate rollup for Platform Admin)
 */
export const orgInsightDailySnapshots = mysqlTable(
  'org_insight_daily_snapshots',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    organizationId: uuidChar36('organization_id').notNull(),
    periodType: varchar('period_type', { length: 16 }).notNull().default('daily'),
    snapshotDate: date('snapshot_date', { mode: 'string' }).notNull(),
    contentType: varchar('content_type', { length: 32 }).notNull(),
    eligibleEnrolledStudentsCount: int('eligible_enrolled_students_count')
      .notNull()
      .default(0),
    activeStudentsCount: int('active_students_count').notNull().default(0),
    attemptsStartedCount: int('attempts_started_count').notNull().default(0),
    attemptsCompletedCount: int('attempts_completed_count').notNull().default(0),
    distinctContentUsedCount: int('distinct_content_used_count')
      .notNull()
      .default(0),
    aacAssistedAttemptsCount: int('aac_assisted_attempts_count')
      .notNull()
      .default(0),
    readAloudAssistedAttemptsCount: int('read_aloud_assisted_attempts_count')
      .notNull()
      .default(0),
    activeGoalsCount: int('active_goals_count').notNull().default(0),
    achievedGoalsCount: int('achieved_goals_count').notNull().default(0),
    choiceTrendsSummaryJson: json('choice_trends_summary_json').$type<
      Record<string, unknown>
    >(),
    computedAt: datetime('computed_at', { fsp: 3 }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'fk_org_insights_org',
      columns: [t.organizationId],
      foreignColumns: [organizations.id],
    }),
    unique('uq_org_insights_period').on(
      t.organizationId,
      t.periodType,
      t.snapshotDate,
      t.contentType
    ),
    index('idx_org_insights_org_date').on(
      t.organizationId,
      t.periodType,
      t.snapshotDate
    ),
  ]
);
