import {
  CANONICAL_CONTENT_TYPES,
  type CanonicalContentType,
  type InsightPeriodType,
} from '../db/schema/_shared.ts';
import { generateUuidV7 } from '../db/uuid.ts';
import { ApiErrors, AppError } from '../http/errors.ts';
import {
  createInsightRepository,
  type InsightRepository,
  type OrgInsightSnapshotRecord,
} from '../repositories/insight.repository.ts';

export const INSIGHT_MIN_COHORT_THRESHOLD = 5;

export type InsightContentScope = 'all' | CanonicalContentType;
export const INSIGHT_CONTENT_SCOPES: readonly InsightContentScope[] = [
  'all',
  ...CANONICAL_CONTENT_TYPES,
];

export type SuppressionReason =
  | 'COHORT_BELOW_THRESHOLD'
  | 'COMPLEMENT_REIDENTIFICATION_RISK'
  | 'COMPLEMENTARY_SUPPRESSION'
  | null;

export interface SafeInsightMetricsView {
  contentType: InsightContentScope;
  suppression: {
    isSuppressed: boolean;
    suppressionReason: SuppressionReason;
    minCohortThreshold: typeof INSIGHT_MIN_COHORT_THRESHOLD;
  };
  participation: {
    eligibleEnrolledStudentsCount: number | null;
    activeStudentsCount: number | null;
    attemptsStartedCount: number | null;
    attemptsCompletedCount: number | null;
    participationRatePercent: number | null;
    completionRatePercent: number | null;
    notEvaluativeNote: 'Participation metrics measure usage frequency only and do not evaluate child SEL progress.';
  };
  breadthOfExperience: {
    distinctContentUsedCount: number | null;
  };
  choiceTrends: {
    summary: Record<string, unknown> | null;
    notEvaluativeNote: 'Descriptive choice distribution only; non-diagnostic and unranked.';
  };
  supportUse: {
    aacAssistedAttemptsCount: number | null;
    readAloudAssistedAttemptsCount: number | null;
    aacSupportRatePercent: number | null;
    readAloudSupportRatePercent: number | null;
    notEvaluativeNote: 'Accessibility support usage provides learning context only.';
  };
  goals: {
    activeGoalsCount: number | null;
    achievedGoalsCount: number | null;
  };
  computedAt: string | null;
}

export interface SafeOrgInsightView {
  organizationId: string;
  organizationCode: string | null;
  organizationName: string | null;
  periodType: InsightPeriodType;
  snapshotDate: string;
  requestedContentType: InsightContentScope;
  overall: SafeInsightMetricsView | null;
  byContentType: SafeInsightMetricsView[];
  rollupGuidance: {
    minCohortThreshold: typeof INSIGHT_MIN_COHORT_THRESHOLD;
    recommendedFallbackPeriodType: 'weekly' | 'monthly' | null;
  };
}

export interface AdminInsightsResponseView {
  periodType: InsightPeriodType;
  snapshotDate: string | null;
  requestedOrganizationId: string | null;
  requestedContentType: InsightContentScope;
  minCohortThreshold: typeof INSIGHT_MIN_COHORT_THRESHOLD;
  platformSummary: SafeInsightMetricsView | null;
  organizations: SafeOrgInsightView[];
}

export interface GetAdminInsightsInput {
  organizationId?: string;
  periodType: InsightPeriodType;
  snapshotDate?: string;
  contentType: InsightContentScope;
}

export interface ComputeOrgInsightsInput {
  organizationId: string;
  periodType: InsightPeriodType;
  snapshotDate: string;
  now?: Date;
}

export interface InsightServiceDeps {
  insightRepo?: InsightRepository;
  now?: () => Date;
}

const DATE_YYYY_MM_DD_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function parseAndValidateUtcDate(dateStr: string): Date {
  if (!DATE_YYYY_MM_DD_REGEX.test(dateStr)) {
    throw ApiErrors.validation([
      {
        field: 'query.snapshotDate',
        code: 'INVALID_SNAPSHOT_DATE_FORMAT',
        messageKey: 'error.insights.invalid_snapshot_date',
        message: 'snapshotDate phải có định dạng YYYY-MM-DD.',
      },
    ]);
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  if (
    utc.getUTCFullYear() !== y ||
    utc.getUTCMonth() !== m - 1 ||
    utc.getUTCDate() !== d
  ) {
    throw ApiErrors.validation([
      {
        field: 'query.snapshotDate',
        code: 'INVALID_CALENDAR_DATE',
        messageKey: 'error.insights.invalid_calendar_date',
        message: 'snapshotDate không phải ngày dương lịch hợp lệ.',
      },
    ]);
  }
  return utc;
}

export function resolveFixedUtcPeriodWindow(
  periodType: InsightPeriodType,
  snapshotDate: string
): { windowStart: Date; windowEndExclusive: Date } {
  const start = parseAndValidateUtcDate(snapshotDate);

  if (periodType === 'daily') {
    const end = new Date(start.getTime());
    end.setUTCDate(end.getUTCDate() + 1);
    return { windowStart: start, windowEndExclusive: end };
  }

  if (periodType === 'weekly') {
    if (start.getUTCDay() !== 1) {
      throw new AppError({
        httpStatus: 422,
        code: 'INVALID_WEEKLY_SNAPSHOT_DATE',
        messageKey: 'error.insights.invalid_weekly_anchor',
        message:
          'Với periodType=weekly, snapshotDate bắt buộc phải là thứ Hai UTC đầu tuần.',
      });
    }
    const end = new Date(start.getTime());
    end.setUTCDate(end.getUTCDate() + 7);
    return { windowStart: start, windowEndExclusive: end };
  }

  // monthly
  if (start.getUTCDate() !== 1) {
    throw new AppError({
      httpStatus: 422,
      code: 'INVALID_MONTHLY_SNAPSHOT_DATE',
      messageKey: 'error.insights.invalid_monthly_anchor',
      message:
        'Với periodType=monthly, snapshotDate bắt buộc phải là ngày mùng 1 UTC đầu tháng (YYYY-MM-01).',
    });
  }
  const end = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)
  );
  return { windowStart: start, windowEndExclusive: end };
}

function roundPercent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function evaluateRowThreshold(record: {
  eligibleEnrolledStudentsCount: number;
  activeStudentsCount: number;
}): { isPrimarySuppressed: boolean; reason: SuppressionReason } {
  const eligible = record.eligibleEnrolledStudentsCount;
  const active = record.activeStudentsCount;

  if (
    eligible < INSIGHT_MIN_COHORT_THRESHOLD ||
    active < INSIGHT_MIN_COHORT_THRESHOLD
  ) {
    return {
      isPrimarySuppressed: true,
      reason: 'COHORT_BELOW_THRESHOLD',
    };
  }

  const inactiveComplement = eligible - active;
  if (
    inactiveComplement >= 1 &&
    inactiveComplement < INSIGHT_MIN_COHORT_THRESHOLD
  ) {
    return {
      isPrimarySuppressed: true,
      reason: 'COMPLEMENT_REIDENTIFICATION_RISK',
    };
  }

  return {
    isPrimarySuppressed: false,
    reason: null,
  };
}

function buildSuppressedMetricsView(
  contentType: InsightContentScope,
  reason: Exclude<SuppressionReason, null>,
  computedAt: Date | null
): SafeInsightMetricsView {
  return {
    contentType,
    suppression: {
      isSuppressed: true,
      suppressionReason: reason,
      minCohortThreshold: INSIGHT_MIN_COHORT_THRESHOLD,
    },
    participation: {
      eligibleEnrolledStudentsCount: null,
      activeStudentsCount: null,
      attemptsStartedCount: null,
      attemptsCompletedCount: null,
      participationRatePercent: null,
      completionRatePercent: null,
      notEvaluativeNote:
        'Participation metrics measure usage frequency only and do not evaluate child SEL progress.',
    },
    breadthOfExperience: {
      distinctContentUsedCount: null,
    },
    choiceTrends: {
      summary: null,
      notEvaluativeNote:
        'Descriptive choice distribution only; non-diagnostic and unranked.',
    },
    supportUse: {
      aacAssistedAttemptsCount: null,
      readAloudAssistedAttemptsCount: null,
      aacSupportRatePercent: null,
      readAloudSupportRatePercent: null,
      notEvaluativeNote:
        'Accessibility support usage provides learning context only.',
    },
    goals: {
      activeGoalsCount: null,
      achievedGoalsCount: null,
    },
    computedAt: computedAt ? computedAt.toISOString() : null,
  };
}

function buildVisibleMetricsView(
  record: OrgInsightSnapshotRecord,
  options?: { suppressGoals?: boolean; suppressDistinctContent?: boolean }
): SafeInsightMetricsView {
  const contentType = record.contentType as InsightContentScope;
  return {
    contentType,
    suppression: {
      isSuppressed: false,
      suppressionReason: null,
      minCohortThreshold: INSIGHT_MIN_COHORT_THRESHOLD,
    },
    participation: {
      eligibleEnrolledStudentsCount: record.eligibleEnrolledStudentsCount,
      activeStudentsCount: record.activeStudentsCount,
      attemptsStartedCount: record.attemptsStartedCount,
      attemptsCompletedCount: record.attemptsCompletedCount,
      participationRatePercent: roundPercent(
        record.activeStudentsCount,
        record.eligibleEnrolledStudentsCount
      ),
      completionRatePercent: roundPercent(
        record.attemptsCompletedCount,
        record.attemptsStartedCount
      ),
      notEvaluativeNote:
        'Participation metrics measure usage frequency only and do not evaluate child SEL progress.',
    },
    breadthOfExperience: {
      distinctContentUsedCount: options?.suppressDistinctContent
        ? null
        : record.distinctContentUsedCount,
    },
    choiceTrends: {
      summary: record.choiceTrendsSummaryJson ?? null,
      notEvaluativeNote:
        'Descriptive choice distribution only; non-diagnostic and unranked.',
    },
    supportUse: {
      aacAssistedAttemptsCount: record.aacAssistedAttemptsCount,
      readAloudAssistedAttemptsCount: record.readAloudAssistedAttemptsCount,
      aacSupportRatePercent: roundPercent(
        record.aacAssistedAttemptsCount,
        record.attemptsStartedCount
      ),
      readAloudSupportRatePercent: roundPercent(
        record.readAloudAssistedAttemptsCount,
        record.attemptsStartedCount
      ),
      notEvaluativeNote:
        'Accessibility support usage provides learning context only.',
    },
    goals: {
      activeGoalsCount: options?.suppressGoals ? null : record.activeGoalsCount,
      achievedGoalsCount: options?.suppressGoals
        ? null
        : record.achievedGoalsCount,
    },
    computedAt: record.computedAt.toISOString(),
  };
}

export function applyOrgPeriodSuppression(
  rows: OrgInsightSnapshotRecord[]
): {
  overall: SafeInsightMetricsView | null;
  byContentType: SafeInsightMetricsView[];
  allSuppressed: boolean;
} {
  const rowByType = new Map<InsightContentScope, OrgInsightSnapshotRecord>();
  for (const row of rows) {
    if ((INSIGHT_CONTENT_SCOPES as readonly string[]).includes(row.contentType)) {
      rowByType.set(row.contentType as InsightContentScope, row);
    }
  }

  const allRow = rowByType.get('all') ?? null;
  let overallView: SafeInsightMetricsView | null = null;
  let allIsSuppressed = false;

  if (allRow) {
    const evalAll = evaluateRowThreshold(allRow);
    if (evalAll.isPrimarySuppressed && evalAll.reason) {
      allIsSuppressed = true;
      overallView = buildSuppressedMetricsView(
        'all',
        evalAll.reason,
        allRow.computedAt
      );
    } else {
      overallView = buildVisibleMetricsView(allRow);
    }
  }

  const canonicalPresentRows: Array<{
    type: CanonicalContentType;
    row: OrgInsightSnapshotRecord;
    primaryEval: { isPrimarySuppressed: boolean; reason: SuppressionReason };
  }> = [];

  for (const cType of CANONICAL_CONTENT_TYPES) {
    const row = rowByType.get(cType);
    if (row) {
      canonicalPresentRows.push({
        type: cType,
        row,
        primaryEval: evaluateRowThreshold(row),
      });
    }
  }

  if (canonicalPresentRows.length === 0) {
    return {
      overall: overallView,
      byContentType: [],
      allSuppressed: allIsSuppressed || overallView === null,
    };
  }

  // If org-level 'all' is suppressed (or allRow absent and categories exist? still evaluate),
  // force-suppress every breakdown cell so child rows cannot bypass org-level k=5.
  if (allIsSuppressed) {
    const forced = canonicalPresentRows.map((entry) =>
      buildSuppressedMetricsView(
        entry.type,
        entry.primaryEval.reason ?? 'COMPLEMENTARY_SUPPRESSION',
        entry.row.computedAt
      )
    );
    return {
      overall: overallView,
      byContentType: forced,
      allSuppressed: true,
    };
  }

  const missingCanonicalCount =
    CANONICAL_CONTENT_TYPES.length - canonicalPresentRows.length;
  const primarySuppressedPresent = canonicalPresentRows.filter(
    (e) => e.primaryEval.isPrimarySuppressed
  );
  const passingPresent = canonicalPresentRows.filter(
    (e) => !e.primaryEval.isPrimarySuppressed
  );

  const totalPrimarySuppressed =
    primarySuppressedPresent.length + missingCanonicalCount;

  const complementarySuppressedTypes = new Set<CanonicalContentType>();

  if (totalPrimarySuppressed === 1 && passingPresent.length >= 2) {
    // Complementary suppression: suppress the smallest passing cell so 'all' - sum(visible)
    // cannot recover the single suppressed cell.
    const sorted = [...passingPresent].sort((a, b) => {
      if (a.row.activeStudentsCount !== b.row.activeStudentsCount) {
        return a.row.activeStudentsCount - b.row.activeStudentsCount;
      }
      if (a.row.attemptsStartedCount !== b.row.attemptsStartedCount) {
        return a.row.attemptsStartedCount - b.row.attemptsStartedCount;
      }
      return (
        CANONICAL_CONTENT_TYPES.indexOf(a.type) -
        CANONICAL_CONTENT_TYPES.indexOf(b.type)
      );
    });
    complementarySuppressedTypes.add(sorted[0].type);
  } else if (totalPrimarySuppressed >= 3) {
    // Majority of breakdown cells are below threshold (0..4); suppress full breakdown table
    // to prevent inference from sparse residual cells.
    for (const entry of passingPresent) {
      complementarySuppressedTypes.add(entry.type);
    }
  }

  const byContentType: SafeInsightMetricsView[] = canonicalPresentRows.map(
    (entry) => {
      if (entry.primaryEval.isPrimarySuppressed && entry.primaryEval.reason) {
        return buildSuppressedMetricsView(
          entry.type,
          entry.primaryEval.reason,
          entry.row.computedAt
        );
      }
      if (complementarySuppressedTypes.has(entry.type)) {
        return buildSuppressedMetricsView(
          entry.type,
          'COMPLEMENTARY_SUPPRESSION',
          entry.row.computedAt
        );
      }
      return buildVisibleMetricsView(entry.row);
    }
  );

  return {
    overall: overallView,
    byContentType,
    allSuppressed:
      allIsSuppressed &&
      byContentType.every((cell) => cell.suppression.isSuppressed),
  };
}

function buildChoiceTrendsSummary(
  turns: Array<{
    selectedChoiceKey: string | null;
    selectedEmotionKey: string | null;
  }>
): Record<string, unknown> | null {
  if (turns.length === 0) {
    return null;
  }

  const emotionKeyCounts: Record<string, number> = {};
  const choiceKeyCounts: Record<string, number> = {};

  for (const turn of turns) {
    if (turn.selectedEmotionKey) {
      emotionKeyCounts[turn.selectedEmotionKey] =
        (emotionKeyCounts[turn.selectedEmotionKey] ?? 0) + 1;
    }
    if (turn.selectedChoiceKey) {
      choiceKeyCounts[turn.selectedChoiceKey] =
        (choiceKeyCounts[turn.selectedChoiceKey] ?? 0) + 1;
    }
  }

  return {
    totalRecordedTurns: turns.length,
    emotionKeyCounts,
    choiceKeyCounts,
  };
}

function mergeChoiceTrendSummaries(
  summaries: Array<Record<string, unknown> | null>
): Record<string, unknown> | null {
  let totalRecordedTurns = 0;
  const emotionKeyCounts: Record<string, number> = {};
  const choiceKeyCounts: Record<string, number> = {};
  let hasAny = false;

  for (const summary of summaries) {
    if (!summary) {
      continue;
    }
    hasAny = true;
    if (typeof summary.totalRecordedTurns === 'number') {
      totalRecordedTurns += summary.totalRecordedTurns;
    }
    const emotions = summary.emotionKeyCounts as
      | Record<string, unknown>
      | undefined;
    if (emotions && typeof emotions === 'object') {
      for (const [k, v] of Object.entries(emotions)) {
        if (typeof v === 'number') {
          emotionKeyCounts[k] = (emotionKeyCounts[k] ?? 0) + v;
        }
      }
    }
    const choices = summary.choiceKeyCounts as
      | Record<string, unknown>
      | undefined;
    if (choices && typeof choices === 'object') {
      for (const [k, v] of Object.entries(choices)) {
        if (typeof v === 'number') {
          choiceKeyCounts[k] = (choiceKeyCounts[k] ?? 0) + v;
        }
      }
    }
  }

  if (!hasAny) {
    return null;
  }

  return {
    totalRecordedTurns,
    emotionKeyCounts,
    choiceKeyCounts,
  };
}

export function createInsightService(deps?: InsightServiceDeps) {
  const repo = deps?.insightRepo ?? createInsightRepository();
  const nowFn = deps?.now ?? (() => new Date());

  return {
    /**
     * Explicit, deterministic internal rollup calculator callable by a future
     * authorized job. Not wired to any automatic startup task, interval, or cron.
     */
    async computeAndUpsertOrgInsightSnapshots(
      input: ComputeOrgInsightsInput
    ): Promise<OrgInsightSnapshotRecord[]> {
      const org = await repo.findOrganizationById(input.organizationId);
      if (!org) {
        throw ApiErrors.notFound('Không tìm thấy tổ chức.');
      }

      const { windowStart, windowEndExclusive } = resolveFixedUtcPeriodWindow(
        input.periodType,
        input.snapshotDate
      );

      const computedAt = input.now ?? nowFn();

      const [eligibleStudentIds, attempts, goals] = await Promise.all([
        repo.listEligibleEnrolledStudentIds(input.organizationId),
        repo.listAttemptsInWindow({
          organizationId: input.organizationId,
          windowStart,
          windowEndExclusive,
        }),
        repo.listOrgGoalsForSnapshot(input.organizationId, windowEndExclusive),
      ]);

      const attemptIds = attempts.map((a) => a.attemptId);
      const turns = await repo.listTurnsForAttempts(
        input.organizationId,
        attemptIds
      );

      const turnsByAttemptId = new Map<
        string,
        Array<{
          selectedChoiceKey: string | null;
          selectedEmotionKey: string | null;
        }>
      >();
      for (const t of turns) {
        const bucket = turnsByAttemptId.get(t.attemptId) ?? [];
        bucket.push({
          selectedChoiceKey: t.selectedChoiceKey,
          selectedEmotionKey: t.selectedEmotionKey,
        });
        turnsByAttemptId.set(t.attemptId, bucket);
      }

      const eligibleCount = eligibleStudentIds.length;
      const activeGoalsCount = goals.filter((g) => g.status === 'active').length;
      const achievedGoalsCount = goals.filter(
        (g) =>
          g.status === 'achieved' &&
          g.achievedAt !== null &&
          g.achievedAt < windowEndExclusive
      ).length;

      const scopes: InsightContentScope[] = ['all', ...CANONICAL_CONTENT_TYPES];
      const rowsToUpsert = scopes.map((scope) => {
        const scopedAttempts =
          scope === 'all'
            ? attempts
            : attempts.filter((a) => a.contentType === scope);

        const activeStudents = new Set(
          scopedAttempts.map((a) => a.studentMembershipId)
        );
        const distinctContent = new Set(
          scopedAttempts.map((a) => a.contentItemId)
        );
        const completedCount = scopedAttempts.filter(
          (a) => a.status === 'completed'
        ).length;
        const aacCount = scopedAttempts.filter((a) => a.usedAacSupport).length;
        const readAloudCount = scopedAttempts.filter(
          (a) => a.usedReadAloud
        ).length;

        const scopedTurns: Array<{
          selectedChoiceKey: string | null;
          selectedEmotionKey: string | null;
        }> = [];
        for (const a of scopedAttempts) {
          const list = turnsByAttemptId.get(a.attemptId);
          if (list) {
            scopedTurns.push(...list);
          }
        }

        return {
          id: generateUuidV7(),
          organizationId: input.organizationId,
          periodType: input.periodType,
          snapshotDate: input.snapshotDate,
          contentType: scope,
          eligibleEnrolledStudentsCount: eligibleCount,
          activeStudentsCount: activeStudents.size,
          attemptsStartedCount: scopedAttempts.length,
          attemptsCompletedCount: completedCount,
          distinctContentUsedCount: distinctContent.size,
          aacAssistedAttemptsCount: aacCount,
          readAloudAssistedAttemptsCount: readAloudCount,
          activeGoalsCount,
          achievedGoalsCount,
          choiceTrendsSummaryJson: buildChoiceTrendsSummary(scopedTurns),
          computedAt,
        };
      });

      return repo.withTransaction(async (tx) =>
        repo.upsertSnapshotRows(rowsToUpsert, tx)
      );
    },

    async getAdminInsights(
      input: GetAdminInsightsInput
    ): Promise<AdminInsightsResponseView> {
      if (input.organizationId) {
        const org = await repo.findOrganizationById(input.organizationId);
        if (!org) {
          throw ApiErrors.notFound('Không tìm thấy tổ chức được yêu cầu.');
        }
      }

      if (input.snapshotDate) {
        resolveFixedUtcPeriodWindow(input.periodType, input.snapshotDate);
      }

      const targetDate =
        input.snapshotDate ??
        (await repo.findLatestSnapshotDate({
          organizationId: input.organizationId,
          periodType: input.periodType,
        }));

      if (!targetDate) {
        return {
          periodType: input.periodType,
          snapshotDate: null,
          requestedOrganizationId: input.organizationId ?? null,
          requestedContentType: input.contentType,
          minCohortThreshold: INSIGHT_MIN_COHORT_THRESHOLD,
          platformSummary: null,
          organizations: [],
        };
      }

      const rawRows = await repo.listSnapshotsForPeriod({
        organizationId: input.organizationId,
        periodType: input.periodType,
        snapshotDate: targetDate,
      });

      const rowsByOrg = new Map<string, OrgInsightSnapshotRecord[]>();
      for (const row of rawRows) {
        const list = rowsByOrg.get(row.organizationId) ?? [];
        list.push(row);
        rowsByOrg.set(row.organizationId, list);
      }

      const orgIds = Array.from(rowsByOrg.keys()).sort();
      const orgMetaList = await repo.listOrganizationsByIds(orgIds);
      const orgMetaById = new Map(orgMetaList.map((o) => [o.id, o]));

      const fallbackRecommended: 'weekly' | 'monthly' | null =
        input.periodType === 'daily'
          ? 'weekly'
          : input.periodType === 'weekly'
            ? 'monthly'
            : null;

      const orgViews: SafeOrgInsightView[] = orgIds.map((orgId) => {
        const orgRows = rowsByOrg.get(orgId) ?? [];
        const suppressed = applyOrgPeriodSuppression(orgRows);
        const meta = orgMetaById.get(orgId);

        const filteredByContent =
          input.contentType === 'all'
            ? suppressed.byContentType
            : suppressed.byContentType.filter(
                (c) => c.contentType === input.contentType
              );

        return {
          organizationId: orgId,
          organizationCode: meta?.code ?? null,
          organizationName: meta?.name ?? null,
          periodType: input.periodType,
          snapshotDate: targetDate,
          requestedContentType: input.contentType,
          overall: input.contentType === 'all' ? suppressed.overall : null,
          byContentType: filteredByContent,
          rollupGuidance: {
            minCohortThreshold: INSIGHT_MIN_COHORT_THRESHOLD,
            recommendedFallbackPeriodType: suppressed.overall?.suppression
              .isSuppressed
              ? fallbackRecommended
              : null,
          },
        };
      });

      // Platform-level summary across organizations for the requested contentType scope
      let platformSummary: SafeInsightMetricsView | null = null;
      if (orgIds.length === 1) {
        const singleOrg = orgViews[0];
        platformSummary =
          input.contentType === 'all'
            ? singleOrg.overall
            : singleOrg.byContentType[0] ?? null;
      } else if (orgIds.length > 1) {
        const mergedByScope: OrgInsightSnapshotRecord[] = [];
        for (const scope of INSIGHT_CONTENT_SCOPES) {
          const scopeRows = rawRows.filter((r) => r.contentType === scope);
          if (scopeRows.length === 0) {
            continue;
          }
          mergedByScope.push({
            id: `platform-${scope}`,
            organizationId: 'platform',
            periodType: input.periodType,
            snapshotDate: targetDate,
            contentType: scope,
            eligibleEnrolledStudentsCount: scopeRows.reduce(
              (acc, r) => acc + r.eligibleEnrolledStudentsCount,
              0
            ),
            activeStudentsCount: scopeRows.reduce(
              (acc, r) => acc + r.activeStudentsCount,
              0
            ),
            attemptsStartedCount: scopeRows.reduce(
              (acc, r) => acc + r.attemptsStartedCount,
              0
            ),
            attemptsCompletedCount: scopeRows.reduce(
              (acc, r) => acc + r.attemptsCompletedCount,
              0
            ),
            distinctContentUsedCount: 0,
            aacAssistedAttemptsCount: scopeRows.reduce(
              (acc, r) => acc + r.aacAssistedAttemptsCount,
              0
            ),
            readAloudAssistedAttemptsCount: scopeRows.reduce(
              (acc, r) => acc + r.readAloudAssistedAttemptsCount,
              0
            ),
            activeGoalsCount: scopeRows.reduce(
              (acc, r) => acc + r.activeGoalsCount,
              0
            ),
            achievedGoalsCount: scopeRows.reduce(
              (acc, r) => acc + r.achievedGoalsCount,
              0
            ),
            choiceTrendsSummaryJson: mergeChoiceTrendSummaries(
              scopeRows.map((r) => r.choiceTrendsSummaryJson)
            ),
            computedAt: scopeRows.reduce(
              (latest, r) => (r.computedAt > latest ? r.computedAt : latest),
              scopeRows[0].computedAt
            ),
          });
        }

        const platformSuppressed = applyOrgPeriodSuppression(mergedByScope);
        const rawTargetSummary =
          input.contentType === 'all'
            ? platformSuppressed.overall
            : platformSuppressed.byContentType.find(
                (c) => c.contentType === input.contentType
              ) ?? null;

        if (rawTargetSummary) {
          platformSummary = rawTargetSummary.suppression.isSuppressed
            ? rawTargetSummary
            : {
                ...rawTargetSummary,
                breadthOfExperience: {
                  // Cross-org distinct content count is not additive when orgs share catalog items
                  distinctContentUsedCount: null,
                },
              };
        }
      }

      // Cross-org complementary suppression guard when multiple orgs are returned
      // together with a visible platformSummary: prevent reconstructing 1 suppressed org
      // via (platformSummary - sum(visible orgs)).
      if (
        !input.organizationId &&
        platformSummary &&
        !platformSummary.suppression.isSuppressed &&
        orgViews.length >= 2 &&
        input.contentType === 'all'
      ) {
        const suppressedOrgs = orgViews.filter(
          (o) => !o.overall || o.overall.suppression.isSuppressed
        );
        const visibleOrgs = orgViews.filter(
          (o) => o.overall && !o.overall.suppression.isSuppressed
        );

        if (suppressedOrgs.length === 1 && visibleOrgs.length >= 2) {
          visibleOrgs.sort((a, b) => {
            const aActive =
              a.overall?.participation.activeStudentsCount ?? 0;
            const bActive =
              b.overall?.participation.activeStudentsCount ?? 0;
            if (aActive !== bActive) {
              return aActive - bActive;
            }
            return a.organizationId.localeCompare(b.organizationId);
          });
          const partner = visibleOrgs[0];
          const partnerRawComputed = partner.overall?.computedAt
            ? new Date(partner.overall.computedAt)
            : null;
          partner.overall = buildSuppressedMetricsView(
            'all',
            'COMPLEMENTARY_SUPPRESSION',
            partnerRawComputed
          );
          partner.byContentType = partner.byContentType.map((c) =>
            buildSuppressedMetricsView(
              c.contentType,
              c.suppression.suppressionReason ?? 'COMPLEMENTARY_SUPPRESSION',
              c.computedAt ? new Date(c.computedAt) : null
            )
          );
        } else if (
          suppressedOrgs.length > visibleOrgs.length &&
          visibleOrgs.length >= 1
        ) {
          for (const orgView of visibleOrgs) {
            const rawComputed = orgView.overall?.computedAt
              ? new Date(orgView.overall.computedAt)
              : null;
            orgView.overall = buildSuppressedMetricsView(
              'all',
              'COMPLEMENTARY_SUPPRESSION',
              rawComputed
            );
            orgView.byContentType = orgView.byContentType.map((c) =>
              buildSuppressedMetricsView(
                c.contentType,
                c.suppression.suppressionReason ?? 'COMPLEMENTARY_SUPPRESSION',
                c.computedAt ? new Date(c.computedAt) : null
              )
            );
          }
        }
      }

      return {
        periodType: input.periodType,
        snapshotDate: targetDate,
        requestedOrganizationId: input.organizationId ?? null,
        requestedContentType: input.contentType,
        minCohortThreshold: INSIGHT_MIN_COHORT_THRESHOLD,
        platformSummary,
        organizations: orgViews,
      };
    },
  };
}

export type InsightService = ReturnType<typeof createInsightService>;
