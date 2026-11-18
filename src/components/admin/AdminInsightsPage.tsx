import { Lock, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../../api/admin.ts';
import { ApiClientError } from '../../api/client.ts';
import { resolveLocalizedErrorMessage, type AppLocale } from '../../i18n/index.ts';
import type {
  AdminInsightsResponseView,
  InsightContentScope,
  InsightPeriodType,
  SafeInsightMetricsView,
  SafeOrganizationView,
} from '../../types/admin.ts';
import {
  CANONICAL_CONTENT_TYPE_LIST,
  describeSuppressionReason,
  formatInsightCount,
  formatInsightPercent,
  getContentTypeLabel,
} from '../../utils/p302.ts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  FormField,
  Input,
  LoadingState,
  PageHeader,
  Select,
} from '../ui/index.ts';

export interface AdminInsightsPageProps {
  locale: AppLocale;
}

function MetricsCard({
  title,
  subtitle,
  metrics,
  locale,
}: {
  title: string;
  subtitle?: string;
  metrics: SafeInsightMetricsView;
  locale: AppLocale;
}) {
  const suppressed = metrics.suppression.isSuppressed;
  const hiddenLabel = locale === 'en' ? 'Suppressed (k < 5)' : 'Ẩn (k < 5)';

  return (
    <Card padding="md">
      <CardHeader
        title={title}
        description={subtitle}
        action={
          suppressed ? (
            <Badge variant="warning" icon={<Lock className="h-3.5 w-3.5" aria-hidden="true" />}>
              {hiddenLabel}
            </Badge>
          ) : (
            <Badge variant="success" icon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />}>
              Đạt ngưỡng k &ge; {metrics.suppression.minCohortThreshold}
            </Badge>
          )
        }
      />
      <CardContent className="space-y-4">
        {suppressed && (
          <Alert variant="warning" title="Dữ liệu được ẩn để bảo vệ quyền riêng tư học sinh">
            {describeSuppressionReason(metrics.suppression.suppressionReason, locale)} Giá trị bị ẩn luôn hiển thị là <strong>{hiddenLabel}</strong>, không quy đổi thành 0.
          </Alert>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 tabular-nums">
          <div className="rounded-[var(--mimora-radius-sm)] border border-[var(--mimora-border)] p-3">
            <p className="text-xs text-[var(--mimora-muted)]">Học sinh đủ điều kiện</p>
            <p className="text-lg font-semibold mt-1">
              {formatInsightCount(metrics.participation.eligibleEnrolledStudentsCount, suppressed, hiddenLabel)}
            </p>
          </div>
          <div className="rounded-[var(--mimora-radius-sm)] border border-[var(--mimora-border)] p-3">
            <p className="text-xs text-[var(--mimora-muted)]">Học sinh tham gia</p>
            <p className="text-lg font-semibold mt-1">
              {formatInsightCount(metrics.participation.activeStudentsCount, suppressed, hiddenLabel)}
            </p>
          </div>
          <div className="rounded-[var(--mimora-radius-sm)] border border-[var(--mimora-border)] p-3">
            <p className="text-xs text-[var(--mimora-muted)]">Tỷ lệ tham gia</p>
            <p className="text-lg font-semibold mt-1">
              {formatInsightPercent(metrics.participation.participationRatePercent, suppressed, hiddenLabel)}
            </p>
          </div>
          <div className="rounded-[var(--mimora-radius-sm)] border border-[var(--mimora-border)] p-3">
            <p className="text-xs text-[var(--mimora-muted)]">Lượt bắt đầu / hoàn thành</p>
            <p className="text-lg font-semibold mt-1">
              {suppressed
                ? hiddenLabel
                : `${formatInsightCount(metrics.participation.attemptsStartedCount, false, hiddenLabel)} / ${formatInsightCount(metrics.participation.attemptsCompletedCount, false, hiddenLabel)}`}
            </p>
          </div>
          <div className="rounded-[var(--mimora-radius-sm)] border border-[var(--mimora-border)] p-3">
            <p className="text-xs text-[var(--mimora-muted)]">Hỗ trợ AAC / Đọc to</p>
            <p className="text-lg font-semibold mt-1">
              {suppressed
                ? hiddenLabel
                : `${formatInsightPercent(metrics.supportUse.aacSupportRatePercent, false, hiddenLabel)} · ${formatInsightPercent(metrics.supportUse.readAloudSupportRatePercent, false, hiddenLabel)}`}
            </p>
          </div>
          <div className="rounded-[var(--mimora-radius-sm)] border border-[var(--mimora-border)] p-3">
            <p className="text-xs text-[var(--mimora-muted)]">Mục tiêu đang mở / đạt</p>
            <p className="text-lg font-semibold mt-1">
              {suppressed
                ? hiddenLabel
                : `${formatInsightCount(metrics.goals.activeGoalsCount, false, hiddenLabel)} / ${formatInsightCount(metrics.goals.achievedGoalsCount, false, hiddenLabel)}`}
            </p>
          </div>
        </div>

        <p className="text-xs text-[var(--mimora-muted)]">
          Độ đa dạng học liệu đã dùng:{' '}
          <strong>
            {formatInsightCount(metrics.breadthOfExperience.distinctContentUsedCount, suppressed, hiddenLabel)}
          </strong>{' '}
          · Lưu ý: Số liệu chỉ phản ánh tần suất sử dụng và hỗ trợ tiếp cận, không đánh giá hay xếp hạng trẻ.
        </p>
      </CardContent>
    </Card>
  );
}

export function AdminInsightsPage({ locale }: AdminInsightsPageProps) {
  const [orgs, setOrgs] = useState<SafeOrganizationView[]>([]);
  const [periodType, setPeriodType] = useState<InsightPeriodType>('weekly');
  const [organizationId, setOrganizationId] = useState('');
  const [snapshotDate, setSnapshotDate] = useState('');
  const [contentType, setContentType] = useState<InsightContentScope>('all');

  const [data, setData] = useState<AdminInsightsResponseView | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [orgsError, setOrgsError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    adminApi
      .listOrganizations({ page: 1, limit: 100 })
      .then((res) => {
        if (!active) return;
        setOrgs(res.items);
        setOrgsError(null);
      })
      .catch((err) => {
        if (!active) return;
        setOrgsError(
          err instanceof ApiClientError
            ? resolveLocalizedErrorMessage(err.info, locale)
            : 'Không thể tải danh sách trường học để lọc phạm vi.'
        );
      });
    return () => {
      active = false;
    };
  }, [locale]);

  const loadInsights = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await adminApi.getInsights({
        periodType,
        organizationId: organizationId || undefined,
        snapshotDate: snapshotDate.trim() || undefined,
        contentType,
      });
      setData(res.insights);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrorMsg(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setErrorMsg('Không thể tải thống kê tổng hợp.');
      }
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [periodType, organizationId, snapshotDate, contentType, locale]);

  useEffect(() => {
    void loadInsights();
  }, [loadInsights]);

  return (
    <div className="space-y-6">
      <PageHeader
        metadataLine="Cổng Quản trị · P2-07 · Ngưỡng bảo vệ k = 5"
        title="Thống kê Tổng hợp Bảo vệ Quyền riêng tư"
        description="Hiển thị số liệu tần suất sử dụng ẩn danh ở cấp nền tảng hoặc trường học. Không hiển thị học sinh cá nhân, không khoan sâu lớp nhỏ dưới ngưỡng k = 5."
      />

      <Alert variant="info" title="Nguyên tắc bảo vệ quyền riêng tư P2-07">
        Chỉ đọc từ bảng snapshot tổng hợp <span className="font-mono">org_insight_daily_snapshots</span>. Nếu một nhóm có dưới 5 học sinh hoặc có nguy cơ suy luận ngược phần bù, giá trị được ẩn hoàn toàn (<span className="font-mono">null</span>) và không bao giờ quy đổi thành 0. Hệ thống hiện chưa có nút chạy tạo snapshot thủ công từ trình duyệt (tác vụ tính snapshot chạy ở tầng dịch vụ nền).
      </Alert>

      {orgsError && <Alert variant="warning">{orgsError}</Alert>}

      <Card padding="sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-start">
          <FormField label="Chu kỳ tổng hợp" htmlFor="ins-period">
            <Select
              id="ins-period"
              value={periodType}
              onChange={(e) => setPeriodType(e.target.value as InsightPeriodType)}
              options={[
                { value: 'daily', label: 'Theo ngày (daily)' },
                { value: 'weekly', label: 'Theo tuần (weekly)' },
                { value: 'monthly', label: 'Theo tháng (monthly)' },
              ]}
            />
          </FormField>

          <FormField label="Phạm vi trường học" htmlFor="ins-org">
            <Select
              id="ins-org"
              value={organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
              options={[
                { value: '', label: 'Toàn nền tảng (tất cả trường)' },
                ...orgs.map((o) => ({ value: o.id, label: `${o.name} (${o.code})` })),
              ]}
            />
          </FormField>

          <FormField label="Loại thẻ SEL" htmlFor="ins-content-type">
            <Select
              id="ins-content-type"
              value={contentType}
              onChange={(e) => setContentType(e.target.value as InsightContentScope)}
              options={[
                { value: 'all', label: 'Tất cả loại thẻ (all)' },
                ...CANONICAL_CONTENT_TYPE_LIST.map((ct) => ({
                  value: ct,
                  label: getContentTypeLabel(ct, locale),
                })),
              ]}
            />
          </FormField>

          <FormField
            label="Ngày neo (YYYY-MM-DD, tùy chọn)"
            htmlFor="ins-date"
            hint={
              periodType === 'weekly'
                ? 'Tuần: phải là thứ Hai UTC'
                : periodType === 'monthly'
                  ? 'Tháng: phải là ngày 01 (YYYY-MM-01)'
                  : 'Để trống để lấy kỳ gần nhất'
            }
          >
            <Input
              id="ins-date"
              value={snapshotDate}
              onChange={(e) => setSnapshotDate(e.target.value)}
              placeholder="Để trống = gần nhất"
            />
          </FormField>

          <div className="sm:pt-6">
            <Button variant="primary" fullWidth onClick={() => void loadInsights()}>
              Áp dụng bộ lọc
            </Button>
          </div>
        </div>
      </Card>

      {errorMsg && <Alert variant="danger">{errorMsg}</Alert>}

      {loading ? (
        <LoadingState label="Đang tải snapshot thống kê k=5..." />
      ) : !data || (!data.platformSummary && data.organizations.length === 0) ? (
        <EmptyState
          title="Chưa có dữ liệu snapshot cho bộ lọc đã chọn"
          description="Hiện chưa có bản ghi org_insight_daily_snapshots phù hợp với chu kỳ và ngày đã chọn. Khi tác vụ nền tính toán snapshot hoàn tất, số liệu tổng hợp sẽ hiển thị tại đây."
          calmNote="Không hiển thị số liệu giả lập khi chưa có snapshot thực tế."
        />
      ) : (
        <div className="space-y-6">
          {data.platformSummary && (
            <MetricsCard
              title="Tổng hợp Toàn nền tảng"
              subtitle={`Chu kỳ: ${data.periodType} · Ngày snapshot: ${data.snapshotDate ?? '—'} · Phạm vi: ${data.requestedContentType}`}
              metrics={data.platformSummary}
              locale={locale}
            />
          )}

          {data.organizations.map((orgIns) => (
            <div key={orgIns.organizationId} className="space-y-3">
              {orgIns.overall && (
                <MetricsCard
                  title={`${orgIns.organizationName ?? orgIns.organizationId} (${orgIns.organizationCode ?? 'ORG'})`}
                  subtitle={`Ngày snapshot: ${orgIns.snapshotDate}${orgIns.rollupGuidance.recommendedFallbackPeriodType ? ` · Gợi ý gộp chu kỳ dài hơn: ${orgIns.rollupGuidance.recommendedFallbackPeriodType}` : ''}`}
                  metrics={orgIns.overall}
                  locale={locale}
                />
              )}

              {orgIns.byContentType.map((ctMetric) => (
                <MetricsCard
                  key={`${orgIns.organizationId}-${ctMetric.contentType}`}
                  title={`${orgIns.organizationName ?? 'Trường'} · ${
                    ctMetric.contentType === 'all'
                      ? 'Tất cả'
                      : getContentTypeLabel(ctMetric.contentType, locale)
                  }`}
                  metrics={ctMetric}
                  locale={locale}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
