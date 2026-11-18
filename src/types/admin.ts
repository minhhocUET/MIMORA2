import type { CanonicalContentType } from './chapter.ts';

export type OrganizationStatus = 'active' | 'suspended';
export type AccountStatus = 'active' | 'locked' | 'disabled';
export type MembershipRole = 'teacher' | 'student';
export type MembershipStatus = 'active' | 'disabled' | 'transferred';
export type ClassStatus = 'active' | 'archived';

export interface SafeOrganizationView {
  id: string;
  code: string;
  name: string;
  status: OrganizationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SafeAdminUserView {
  id: string;
  email: string | null;
  platformUsername: string | null;
  displayName: string;
  platformRole: 'platform_admin' | null;
  status: AccountStatus;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SafeMembershipView {
  id: string;
  organizationId: string;
  userId: string;
  role: MembershipRole;
  orgUsername: string | null;
  status: MembershipStatus;
  joinedAt: string;
  leftAt: string | null;
  createdAt: string;
  updatedAt: string;
  organization?: {
    id: string;
    code: string;
    name: string;
    status: OrganizationStatus;
  } | null;
  user?: {
    id: string;
    email: string | null;
    platformUsername: string | null;
    displayName: string;
    status: AccountStatus;
  } | null;
}

export interface SafeClassView {
  id: string;
  organizationId: string;
  name: string;
  academicYear: string | null;
  status: ClassStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ClassTeacherEntry {
  id: string;
  classId: string;
  teacherMembershipId: string;
  assignedAt: string;
  userId: string;
  displayName: string;
  email: string | null;
  platformUsername: string | null;
}

export interface ClassStudentRoster {
  enrollmentId: string;
  studentMembershipId: string;
  userId: string;
  orgUsername: string | null;
  displayName: string;
  enrolledAt: string;
}

export interface CsvImportJobView {
  id: string;
  organizationId: string;
  uploadedByUserId: string;
  targetClassId: string | null;
  sourceFilename: string;
  status: string;
  totalRows: number;
  succeededRows: number;
  failedRows: number;
  errorSummaryJson: Record<string, unknown> | Array<Record<string, unknown>> | null;
  createdAt: string;
  completedAt: string | null;
}

export interface SafeCsvPreviewRow {
  rowNumber: number;
  orgUsername: string;
  displayName: string;
  hasEmail: boolean;
  hasInitialPassword: boolean;
}

export interface SafeCsvRowError {
  rowNumber: number;
  orgUsername: string | null;
  code: string;
  message: string;
}

export interface CsvImportRunResponse {
  status: 'ok';
  job: CsvImportJobView;
  previewRows?: SafeCsvPreviewRow[];
  createdStudents?: Array<{
    rowNumber: number;
    userId: string;
    membershipId: string;
    orgUsername: string;
  }>;
  errors: SafeCsvRowError[];
  credentialProvisioningPolicy?: string;
}

export type ContentVersionStatus =
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'published'
  | 'superseded';

export type ContentApprovalDecision = 'submitted' | 'approved' | 'rejected';

export interface MediaRefPayload {
  assetRef: string;
  altText: string;
  visualDescription?: string;
}

export interface ReadAloudPayload {
  text: string;
  audioAssetRef?: string;
  speechRateHint?: 'slow' | 'normal';
}

export interface AacSupportPayload {
  symbolRef?: string;
  symbolLabel?: string;
  coreVocabulary?: string[];
}

export interface EmotionCardPayload {
  displayTitle: string;
  childText: string;
  emotionKey: string;
  emotionLabel: string;
  accessibleDescription: string;
  illustration?: MediaRefPayload;
  supportiveBodyCue?: string;
  reflectionPrompts?: string[];
  readAloud?: ReadAloudPayload;
  aacSupport?: AacSupportPayload;
}

export interface SituationCardPayload {
  displayTitle: string;
  situationText: string;
  narrativeContext: string;
  accessibleDescription: string;
  illustration?: MediaRefPayload;
  discussionPrompts?: string[];
  readAloud?: ReadAloudPayload;
  aacSupport?: AacSupportPayload;
}

export interface ActionCardPayload {
  displayTitle: string;
  actionPhrase: string;
  accessibleDescription: string;
  visualSupport?: MediaRefPayload;
  contextExplanation?: string;
  possibleOutcomes?: string[];
  readAloud?: ReadAloudPayload;
  aacSupport?: AacSupportPayload;
}

export interface SocialStoryScenePayload {
  sceneNumber: number;
  text: string;
  accessibleDescription: string;
  illustration?: MediaRefPayload;
  readAloud?: ReadAloudPayload;
  aacSupport?: AacSupportPayload;
}

export interface SocialStoryCardPayload {
  displayTitle: string;
  storyIntro?: string;
  scenes: SocialStoryScenePayload[];
  closingReflection?: string;
  readAloud?: ReadAloudPayload;
}

export interface CommunicationCardPayload {
  displayTitle: string;
  communicationIntent: string;
  phrase: string;
  accessibleDescription: string;
  aacSupport?: AacSupportPayload;
  visualSupport?: MediaRefPayload;
  readAloud?: ReadAloudPayload;
}

export type CanonicalContentPayload =
  | EmotionCardPayload
  | SituationCardPayload
  | ActionCardPayload
  | SocialStoryCardPayload
  | CommunicationCardPayload;

export interface ContentMetadataJson {
  ageBand?: string;
  selThemes?: string[];
  assetAttributionNote?: string;
  localizationNotes?: string;
}

export interface SafeContentApprovalView {
  id: string;
  contentVersionId: string;
  roundNumber: number;
  decision: ContentApprovalDecision;
  reviewerUserId: string;
  decisionNote: string | null;
  decidedAt: string;
}

export interface SafeContentVersionView {
  id: string;
  contentItemId: string;
  versionNumber: number;
  title: string;
  summary: string | null;
  locale: string;
  payloadJson: Record<string, unknown>;
  metadataJson: ContentMetadataJson | null;
  status: ContentVersionStatus;
  createdByUserId: string;
  submittedAt: string | null;
  approvedAt: string | null;
  approvedByUserId: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  approvals?: SafeContentApprovalView[];
}

export interface SafeContentItemView {
  id: string;
  slug: string;
  contentType: CanonicalContentType;
  currentPublishedVersionId: string | null;
  isArchived: boolean;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export type InsightPeriodType = 'daily' | 'weekly' | 'monthly';
export type InsightContentScope = 'all' | CanonicalContentType;
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
    minCohortThreshold: number;
  };
  participation: {
    eligibleEnrolledStudentsCount: number | null;
    activeStudentsCount: number | null;
    attemptsStartedCount: number | null;
    attemptsCompletedCount: number | null;
    participationRatePercent: number | null;
    completionRatePercent: number | null;
    notEvaluativeNote: string;
  };
  breadthOfExperience: {
    distinctContentUsedCount: number | null;
  };
  choiceTrends: {
    summary: Record<string, unknown> | null;
    notEvaluativeNote: string;
  };
  supportUse: {
    aacAssistedAttemptsCount: number | null;
    readAloudAssistedAttemptsCount: number | null;
    aacSupportRatePercent: number | null;
    readAloudSupportRatePercent: number | null;
    notEvaluativeNote: string;
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
    minCohortThreshold: number;
    recommendedFallbackPeriodType: 'weekly' | 'monthly' | null;
  };
}

export interface AdminInsightsResponseView {
  periodType: InsightPeriodType;
  snapshotDate: string | null;
  requestedOrganizationId: string | null;
  requestedContentType: InsightContentScope;
  minCohortThreshold: number;
  platformSummary: SafeInsightMetricsView | null;
  organizations: SafeOrgInsightView[];
}

export interface PaginatedResult<T> {
  status: 'ok';
  items: T[];
  page: number;
  limit: number;
  total: number;
}
