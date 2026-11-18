import type { BadgeVariant } from '../components/ui/index.ts';
import type {
  AccountStatus,
  CanonicalContentPayload,
  ClassStatus,
  ContentVersionStatus,
  MembershipStatus,
  OrganizationStatus,
  SuppressionReason,
} from '../types/admin.ts';
import type { CanonicalContentType } from '../types/chapter.ts';
import type { AssignmentStatus, AttemptStatus, GoalStatus } from '../types/teacher.ts';
import type { AppLocale } from '../i18n/index.ts';

export const CANONICAL_CONTENT_TYPE_LIST: readonly CanonicalContentType[] = [
  'emotion_card',
  'situation_card',
  'action_card',
  'social_story_card',
  'communication_card',
];

export const STRATEGY_CATEGORIES_7 = [
  { key: 'breathing_grounding', vi: 'Thở & Neo lại bình tĩnh', en: 'Breathing & Grounding' },
  { key: 'sensory_comfort', vi: 'Điều chỉnh giác quan', en: 'Sensory Comfort' },
  { key: 'movement_release', vi: 'Vận động nhẹ giải tỏa', en: 'Movement & Release' },
  { key: 'ask_for_help', vi: 'Nhờ hỗ trợ / AAC', en: 'Asking for Help / AAC' },
  { key: 'quiet_corner', vi: 'Góc yên tĩnh', en: 'Quiet Corner' },
  { key: 'self_talk', vi: 'Tự trấn an tích cực', en: 'Kind Self-Talk' },
  { key: 'social_turn', vi: 'Kết nối & Chờ lượt', en: 'Social Connection & Turns' },
] as const;

export const EMOTION_TIERS = [
  { key: 'basic', vi: 'Cơ bản (8 thẻ)', en: 'Basic (8 cards)' },
  { key: 'extended', vi: 'Mở rộng (8 thẻ)', en: 'Extended (8 cards)' },
] as const;

export function formatDateTime(iso: string | null | undefined, locale: AppLocale = 'vi-VN'): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString(locale === 'en' ? 'en-US' : 'vi-VN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function formatDateOnly(isoOrYmd: string | null | undefined, locale: AppLocale = 'vi-VN'): string {
  if (!isoOrYmd) {
    return '—';
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrYmd)) {
    const [y, m, d] = isoOrYmd.split('-').map(Number);
    const utc = new Date(Date.UTC(y, m - 1, d));
    return utc.toLocaleDateString(locale === 'en' ? 'en-US' : 'vi-VN', {
      timeZone: 'UTC',
      dateStyle: 'medium',
    });
  }
  const d = new Date(isoOrYmd);
  if (Number.isNaN(d.getTime())) {
    return isoOrYmd;
  }
  return d.toLocaleDateString(locale === 'en' ? 'en-US' : 'vi-VN', {
    dateStyle: 'medium',
  });
}

/**
 * Privacy-preserving Insight metric formatter.
 * Strictly NEVER coerces null or suppressed cohort values to 0.
 */
export function formatInsightCount(
  value: number | null | undefined,
  isSuppressed: boolean,
  suppressedLabel = 'Ẩn (k < 5)'
): string {
  if (isSuppressed || value === null || value === undefined) {
    return suppressedLabel;
  }
  return String(value);
}

export function formatInsightPercent(
  value: number | null | undefined,
  isSuppressed: boolean,
  suppressedLabel = 'Ẩn (k < 5)'
): string {
  if (isSuppressed || value === null || value === undefined) {
    return suppressedLabel;
  }
  return `${value}%`;
}

export function describeSuppressionReason(
  reason: SuppressionReason,
  locale: AppLocale = 'vi-VN'
): string {
  if (locale === 'en') {
    switch (reason) {
      case 'COHORT_BELOW_THRESHOLD':
        return 'Cohort has fewer than 5 eligible or active students (k = 5 minimum).';
      case 'COMPLEMENT_REIDENTIFICATION_RISK':
        return 'Hidden to prevent inferring small inactive subgroups by subtraction.';
      case 'COMPLEMENTARY_SUPPRESSION':
        return 'Complementary privacy suppression across breakdown rows.';
      default:
        return 'Suppressed for student privacy protection (k = 5).';
    }
  }
  switch (reason) {
    case 'COHORT_BELOW_THRESHOLD':
      return 'Nhóm có ít hơn 5 học sinh đủ điều kiện hoặc tham gia (ngưỡng tối thiểu k = 5).';
    case 'COMPLEMENT_REIDENTIFICATION_RISK':
      return 'Được ẩn để tránh suy luận ngược nhóm nhỏ bằng phép trừ phần bù.';
    case 'COMPLEMENTARY_SUPPRESSION':
      return 'Được ẩn bổ sung nhằm bảo vệ quyền riêng tư giữa các dòng phân tách.';
    default:
      return 'Dữ liệu được ẩn để bảo vệ quyền riêng tư học sinh (k = 5).';
  }
}

export function getContentTypeLabel(type: CanonicalContentType, locale: AppLocale = 'vi-VN'): string {
  if (locale === 'en') {
    const map: Record<CanonicalContentType, string> = {
      emotion_card: 'Emotion Card',
      situation_card: 'Situation Card',
      action_card: 'Strategy / Action Card',
      social_story_card: 'Social Story Card',
      communication_card: 'Communication Card',
    };
    return map[type];
  }
  const map: Record<CanonicalContentType, string> = {
    emotion_card: 'Thẻ Cảm xúc',
    situation_card: 'Thẻ Tình huống',
    action_card: 'Thẻ Chiến lược / Hành động',
    social_story_card: 'Truyện Xã hội',
    communication_card: 'Thẻ Giao tiếp AAC',
  };
  return map[type];
}

export function getVersionStatusMeta(
  status: ContentVersionStatus,
  locale: AppLocale = 'vi-VN'
): { label: string; variant: BadgeVariant } {
  const labels: Record<ContentVersionStatus, { vi: string; en: string; variant: BadgeVariant }> = {
    draft: { vi: 'Bản nháp', en: 'Draft', variant: 'neutral' },
    pending_review: { vi: 'Chờ phê duyệt', en: 'Pending review', variant: 'warning' },
    approved: { vi: 'Đã duyệt (chờ xuất bản)', en: 'Approved', variant: 'info' },
    rejected: { vi: 'Cần chỉnh sửa', en: 'Rejected', variant: 'danger' },
    published: { vi: 'Đang xuất bản', en: 'Published', variant: 'success' },
    superseded: { vi: 'Phiên bản cũ', en: 'Superseded', variant: 'neutral' },
  };
  const item = labels[status];
  return { label: locale === 'en' ? item.en : item.vi, variant: item.variant };
}

export function getOrgStatusMeta(
  status: OrganizationStatus,
  locale: AppLocale = 'vi-VN'
): { label: string; variant: BadgeVariant } {
  return status === 'active'
    ? { label: locale === 'en' ? 'Active' : 'Đang hoạt động', variant: 'success' }
    : { label: locale === 'en' ? 'Suspended' : 'Tạm ngưng', variant: 'warning' };
}

export function getAccountStatusMeta(
  status: AccountStatus,
  locale: AppLocale = 'vi-VN'
): { label: string; variant: BadgeVariant } {
  if (status === 'active') {
    return { label: locale === 'en' ? 'Active' : 'Đang hoạt động', variant: 'success' };
  }
  if (status === 'locked') {
    return { label: locale === 'en' ? 'Locked' : 'Đang tạm khóa', variant: 'warning' };
  }
  return { label: locale === 'en' ? 'Disabled' : 'Đã vô hiệu hóa', variant: 'danger' };
}

export function getMembershipStatusMeta(
  status: MembershipStatus,
  locale: AppLocale = 'vi-VN'
): { label: string; variant: BadgeVariant } {
  if (status === 'active') {
    return { label: locale === 'en' ? 'Active' : 'Đang hoạt động', variant: 'success' };
  }
  if (status === 'transferred') {
    return { label: locale === 'en' ? 'Transferred' : 'Đã chuyển trường', variant: 'neutral' };
  }
  return { label: locale === 'en' ? 'Disabled' : 'Ngưng hoạt động', variant: 'danger' };
}

export function getClassStatusMeta(
  status: ClassStatus,
  locale: AppLocale = 'vi-VN'
): { label: string; variant: BadgeVariant } {
  return status === 'active'
    ? { label: locale === 'en' ? 'Active' : 'Đang hoạt động', variant: 'success' }
    : { label: locale === 'en' ? 'Archived' : 'Đã lưu trữ', variant: 'neutral' };
}

export function getAssignmentStatusMeta(
  status: AssignmentStatus,
  locale: AppLocale = 'vi-VN'
): { label: string; variant: BadgeVariant } {
  const map: Record<AssignmentStatus, { vi: string; en: string; variant: BadgeVariant }> = {
    draft: { vi: 'Bản nháp', en: 'Draft', variant: 'neutral' },
    active: { vi: 'Đang mở cho học sinh', en: 'Active', variant: 'success' },
    closed: { vi: 'Đã đóng (chỉ đọc)', en: 'Closed', variant: 'warning' },
    archived: { vi: 'Đã lưu trữ', en: 'Archived', variant: 'neutral' },
  };
  const item = map[status];
  return { label: locale === 'en' ? item.en : item.vi, variant: item.variant };
}

export function getProgressStatusMeta(
  status: string,
  locale: AppLocale = 'vi-VN'
): { label: string; variant: BadgeVariant } {
  if (status === 'completed') {
    return { label: locale === 'en' ? 'Completed' : 'Đã hoàn thành', variant: 'success' };
  }
  if (status === 'in_progress') {
    return { label: locale === 'en' ? 'In progress' : 'Đang thực hành', variant: 'info' };
  }
  return { label: locale === 'en' ? 'Not started' : 'Chưa bắt đầu', variant: 'neutral' };
}

export function getAttemptStatusMeta(
  status: AttemptStatus,
  locale: AppLocale = 'vi-VN'
): { label: string; variant: BadgeVariant } {
  if (status === 'completed') {
    return { label: locale === 'en' ? 'Completed' : 'Đã hoàn thành', variant: 'success' };
  }
  if (status === 'abandoned') {
    return { label: locale === 'en' ? 'Ended early' : 'Tạm dừng giữa chừng', variant: 'neutral' };
  }
  return { label: locale === 'en' ? 'In progress' : 'Đang thực hành', variant: 'info' };
}

export function getGoalStatusMeta(
  status: GoalStatus,
  locale: AppLocale = 'vi-VN'
): { label: string; variant: BadgeVariant } {
  const map: Record<GoalStatus, { vi: string; en: string; variant: BadgeVariant }> = {
    active: { vi: 'Đang đồng hành', en: 'Active', variant: 'info' },
    achieved: { vi: 'Đã đạt mục tiêu', en: 'Achieved', variant: 'success' },
    paused: { vi: 'Tạm nghỉ', en: 'Paused', variant: 'warning' },
    archived: { vi: 'Đã lưu trữ', en: 'Archived', variant: 'neutral' },
  };
  const item = map[status] ?? map.active;
  return { label: locale === 'en' ? item.en : item.vi, variant: item.variant };
}

export function createDefaultPayloadForType(type: CanonicalContentType): CanonicalContentPayload {
  switch (type) {
    case 'emotion_card':
      return {
        displayTitle: '',
        childText: '',
        emotionKey: '',
        emotionLabel: '',
        accessibleDescription: '',
        supportiveBodyCue: '',
        reflectionPrompts: [],
        readAloud: { text: '', speechRateHint: 'normal' },
        aacSupport: { symbolLabel: '', coreVocabulary: [] },
      };
    case 'situation_card':
      return {
        displayTitle: '',
        situationText: '',
        narrativeContext: '',
        accessibleDescription: '',
        discussionPrompts: [],
        readAloud: { text: '', speechRateHint: 'normal' },
        aacSupport: { symbolLabel: '', coreVocabulary: [] },
      };
    case 'action_card':
      return {
        displayTitle: '',
        actionPhrase: '',
        accessibleDescription: '',
        contextExplanation: '',
        possibleOutcomes: [],
        readAloud: { text: '', speechRateHint: 'normal' },
        aacSupport: { symbolLabel: '', coreVocabulary: [] },
      };
    case 'social_story_card':
      return {
        displayTitle: '',
        storyIntro: '',
        scenes: [
          { sceneNumber: 1, text: '', accessibleDescription: '' },
          { sceneNumber: 2, text: '', accessibleDescription: '' },
        ],
        closingReflection: '',
        readAloud: { text: '', speechRateHint: 'normal' },
      };
    case 'communication_card':
      return {
        displayTitle: '',
        communicationIntent: '',
        phrase: '',
        accessibleDescription: '',
        aacSupport: { symbolLabel: '', coreVocabulary: [] },
        readAloud: { text: '', speechRateHint: 'normal' },
      };
  }
}

export const CSV_STUDENT_TEMPLATE =
  'org_username,display_name,email,initial_password\nminh.an,Nguyễn Minh An,,MimoraHocSinh!2026\nha.my,Trần Hà My,hamy.phuhuynh@example.edu.vn,MimoraHocSinh!2026\n';
