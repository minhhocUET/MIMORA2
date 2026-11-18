import type { CanonicalContentType } from './chapter.ts';
import type { ContentMetadataJson } from './admin.ts';

export interface SafeTeacherLibraryContentView {
  itemId: string;
  slug: string;
  contentType: CanonicalContentType;
  versionId: string;
  versionNumber: number;
  title: string;
  summary: string | null;
  locale: string;
  payloadJson: Record<string, unknown>;
  metadataJson: ContentMetadataJson | null;
  publishedAt: string | null;
}

export type AssignmentStatus = 'draft' | 'active' | 'closed' | 'archived';

export interface HomePracticeView {
  hasInstructions: boolean;
  instructions: string | null;
}

export interface SafePinnedAssignmentItemView {
  assignmentItemId: string;
  sortOrder: number;
  contentItemId: string;
  contentVersionId: string;
  slug: string;
  contentType: CanonicalContentType;
  versionNumber: number;
  versionStatus: string;
  title: string;
  summary: string | null;
  locale: string;
  payloadJson: Record<string, unknown>;
  metadataJson: ContentMetadataJson | null;
  publishedAt: string | null;
}

export interface SafeAssignmentTargetView {
  targetId: string;
  studentMembershipId: string;
  displayName: string;
  orgUsername: string | null;
  membershipStatus: string;
  assignedAt: string;
}

export interface SafeTeacherAssignmentView {
  id: string;
  organizationId: string;
  classId: string;
  className?: string;
  createdByTeacherMembershipId: string;
  canEdit: boolean;
  title: string;
  homePracticeInstructions: string | null;
  homePractice: HomePracticeView;
  dueAt: string | null;
  isPastDue: boolean;
  status: AssignmentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SafeTeacherAssignmentListItemView extends SafeTeacherAssignmentView {
  className: string;
  itemCount: number;
  targetCount: number;
}

export interface SafeAssignmentProgressSummaryView {
  assignmentTargetId: string;
  studentMembershipId: string;
  displayName: string;
  orgUsername: string | null;
  hasProgressRecord: boolean;
  status: string;
  totalItems: number;
  completedItems: number;
  attemptCount: number;
  lastActivityAt: string | null;
  completedAt: string | null;
}

export type AttemptStatus = 'in_progress' | 'completed' | 'abandoned';

export interface SafeTurnView {
  id: string;
  turnIndex: number;
  stepKey: string;
  selectedChoiceKey: string | null;
  selectedEmotionKey: string | null;
  usedAac: boolean;
  usedReadAloud: boolean;
  responsePayloadJson: Record<string, unknown> | null;
  respondedAt: string;
}

export interface SafeSupportContextView {
  usedAacSupport: boolean;
  usedReadAloud: boolean;
  aacTapCount: number;
  readAloudCount: number;
  isOptionalContextOnly: true;
}

export interface SafeTeacherAttemptSummaryView {
  attemptId: string;
  assignmentId: string;
  assignmentTargetId: string;
  assignmentItemId: string;
  itemSortOrder: number;
  studentMembershipId: string;
  studentDisplayName: string;
  studentOrgUsername: string | null;
  pinnedContentVersion: {
    contentItemId: string;
    contentVersionId: string;
    contentType: CanonicalContentType;
    versionNumber: number;
    title: string;
  };
  attemptNumber: number;
  state: AttemptStatus;
  startedAt: string;
  lastInteractedAt: string;
  completedAt: string | null;
  elapsedSeconds: number;
  turnCount: number;
  supportContext: SafeSupportContextView & {
    contextNote: string;
  };
}

export interface SafeTeacherAttemptDetailView extends SafeTeacherAttemptSummaryView {
  turns: SafeTurnView[];
}

export type PreferredCommunicationMode = 'aac' | 'read_aloud' | 'visual' | 'mixed';
export type SupportSpeechRate = 'slow' | 'normal';
export type SupportVisualContrast = 'standard' | 'high_contrast' | 'soft';

/**
 * Matches backend STUDENT_SUPPORT_PREFERENCES_SCHEMA (.strict()) in goal.service.ts.
 */
export interface StudentSupportPreferences {
  preferredCommunicationMode?: PreferredCommunicationMode;
  aacEnabled?: boolean;
  readAloudEnabled?: boolean;
  speechRate?: SupportSpeechRate;
  visualContrast?: SupportVisualContrast;
  reducedMotion?: boolean;
  preferredVisualCues?: string[];
  sensoryNotes?: string;
}

export interface SafeStudentProfileView {
  id: string | null;
  organizationId: string;
  studentMembershipId: string;
  preferredName: string | null;
  supportPreferencesJson: StudentSupportPreferences | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export type GoalStatus = 'active' | 'achieved' | 'paused' | 'archived';

export interface SafeStudentGoalView {
  id: string;
  organizationId: string;
  studentMembershipId: string;
  classId: string | null;
  createdByTeacherMembershipId: string;
  title: string;
  description: string | null;
  focusArea: string | null;
  status: GoalStatus;
  targetDate: string | null;
  achievedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SafeTeacherObservationView {
  id: string;
  organizationId: string;
  authorTeacherMembershipId: string;
  studentMembershipId: string;
  classId: string | null;
  assignmentId: string | null;
  attemptId: string | null;
  noteBody: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChapterSessionGroup {
  sessionNumber: 1 | 2 | 3;
  items: Array<{
    item: SafePinnedAssignmentItemView;
    stepNumber: number;
  }>;
}

/**
 * Presentation-only grouping helper adapting ordered pinned assignment items
 * into a gentle 3-session / 6-step Chapter structure without inventing DB rows.
 */
export function groupAssignmentItemsIntoSessions(
  items: readonly SafePinnedAssignmentItemView[]
): ChapterSessionGroup[] {
  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
  const sessions: ChapterSessionGroup[] = [
    { sessionNumber: 1, items: [] },
    { sessionNumber: 2, items: [] },
    { sessionNumber: 3, items: [] },
  ];

  sorted.forEach((item, index) => {
    const selThemes = item.metadataJson?.selThemes ?? [];
    const sessionTag = selThemes.find((tag) => /^session:[123]$/i.test(tag));
    const stepTag = selThemes.find((tag) => /^step:\d+$/i.test(tag));

    const derivedSession = sessionTag
      ? (Number(sessionTag.split(':')[1]) as 1 | 2 | 3)
      : ((Math.min(3, Math.floor(index / 2) + 1)) as 1 | 2 | 3);

    const derivedStep = stepTag ? Number(stepTag.split(':')[1]) : index + 1;

    sessions[derivedSession - 1].items.push({
      item,
      stepNumber: derivedStep,
    });
  });

  return sessions.filter((s) => s.items.length > 0);
}
