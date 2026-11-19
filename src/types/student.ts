import type { CanonicalContentType, SessionNumber, StepComponentType, StepNumber, StrategyCategory } from './chapter.ts';

export type AssignmentStudentStatus = 'active' | 'closed';
export type AttemptLifecycleState = 'in_progress' | 'completed' | 'abandoned';
export type GoalStatus = 'active' | 'achieved' | 'paused' | 'archived';

export interface SafeStudentProgressSnapshot {
  hasProgressRecord: boolean;
  status: string;
  totalItems: number;
  completedItems: number;
  attemptCount: number;
  lastActivityAt: string | null;
  completedAt: string | null;
}

export interface SafeStudentHomePracticeView {
  hasInstructions: boolean;
  instructions: string | null;
}

export interface SafeStudentPrintableGuide {
  assignmentTitle: string;
  className: string;
  dueAt: string | null;
  instructions: string | null;
  activityTitles: string[];
}

export interface SafeStudentAssignmentListItemView {
  id: string;
  organizationId: string;
  classId: string;
  className: string;
  targetId: string;
  title: string;
  status: AssignmentStudentStatus;
  isReadOnly: boolean;
  dueAt: string | null;
  isPastDue: boolean;
  homePracticeInstructions: string | null;
  homePractice: SafeStudentHomePracticeView;
  itemCount: number;
  assignedAt: string;
  createdAt: string;
  updatedAt: string;
  progress: SafeStudentProgressSnapshot;
}

export interface SafeStudentPinnedItemView {
  assignmentItemId: string;
  sortOrder: number;
  contentItemId: string;
  contentVersionId: string;
  slug: string;
  contentType: CanonicalContentType;
  versionNumber: number;
  title: string;
  summary: string | null;
  locale: string;
  payloadJson: Record<string, unknown>;
  metadataJson: Record<string, unknown> | null;
  publishedAt: string | null;
}

export interface SafeStudentAssignmentDetailView {
  id: string;
  organizationId: string;
  classId: string;
  className: string;
  targetId: string;
  title: string;
  status: AssignmentStudentStatus;
  isReadOnly: boolean;
  dueAt: string | null;
  isPastDue: boolean;
  homePracticeInstructions: string | null;
  homePractice: {
    hasInstructions: boolean;
    instructions: string | null;
    printableGuide: SafeStudentPrintableGuide;
  };
  assignedAt: string;
  createdAt: string;
  updatedAt: string;
  items: SafeStudentPinnedItemView[];
  progress: SafeStudentProgressSnapshot;
}

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

export interface SafeAttemptProgressSnapshotView {
  status: string;
  totalItems: number;
  completedItems: number;
  attemptCount: number;
  activeAttemptId: string | null;
  latestCompletedAttemptId: string | null;
  lastActivityAt: string | null;
  completedAt: string | null;
}

export interface SafeStudentAttemptView {
  attemptId: string;
  organizationId: string;
  assignmentId: string;
  assignmentTitle: string;
  assignmentStatus: AssignmentStudentStatus;
  isReadOnly: boolean;
  assignmentTargetId: string;
  assignmentItemId: string;
  itemSortOrder: number;
  pinnedContentVersion: {
    contentItemId: string;
    contentVersionId: string;
    contentType: CanonicalContentType;
    versionNumber: number;
    title: string;
    summary: string | null;
    locale: string;
  };
  attemptNumber: number;
  state: AttemptLifecycleState;
  startedAt: string;
  lastInteractedAt: string;
  completedAt: string | null;
  elapsedSeconds: number;
  supportContext: SafeSupportContextView;
  turns: SafeTurnView[];
  resumePosition: {
    savedTurnCount: number;
    nextTurnIndex: number;
    lastTurnIndex: number | null;
    lastStepKey: string | null;
  };
  availableActions: {
    canResume: boolean;
    canSubmitTurn: boolean;
    canComplete: boolean;
    canAbandon: boolean;
    canRetry: boolean;
  };
  progress: SafeAttemptProgressSnapshotView;
}

export interface StudentSupportPreferencesJson {
  preferredCommunicationMode?: 'aac' | 'read_aloud' | 'visual' | 'mixed';
  aacEnabled?: boolean;
  readAloudEnabled?: boolean;
  speechRate?: 'slow' | 'normal';
  visualContrast?: 'standard' | 'high_contrast' | 'soft';
  reducedMotion?: boolean;
  preferredVisualCues?: string[];
  sensoryNotes?: string;
}

export interface SafeStudentProfileView {
  id: string | null;
  organizationId: string;
  studentMembershipId: string;
  preferredName: string | null;
  supportPreferencesJson: StudentSupportPreferencesJson | null;
  createdAt: string | null;
  updatedAt: string | null;
}

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

export interface ParsedMediaRef {
  assetRef: string;
  altText: string;
  visualDescription?: string;
}

export interface ParsedReadAloud {
  text: string;
  audioAssetRef?: string;
  speechRateHint?: 'slow' | 'normal';
}

export interface ParsedAacSupport {
  symbolRef?: string;
  symbolLabel?: string;
  coreVocabulary: string[];
}

export interface ParsedEmotionCardPayload {
  displayTitle: string;
  childText: string;
  emotionKey: string;
  emotionLabel: string;
  accessibleDescription: string;
  illustration?: ParsedMediaRef;
  supportiveBodyCue?: string;
  reflectionPrompts: string[];
  readAloud?: ParsedReadAloud;
  aacSupport?: ParsedAacSupport;
}

export interface ParsedSituationCardPayload {
  displayTitle: string;
  situationText: string;
  narrativeContext: string;
  accessibleDescription: string;
  illustration?: ParsedMediaRef;
  discussionPrompts: string[];
  readAloud?: ParsedReadAloud;
  aacSupport?: ParsedAacSupport;
}

export interface ParsedActionCardPayload {
  displayTitle: string;
  actionPhrase: string;
  accessibleDescription: string;
  visualSupport?: ParsedMediaRef;
  contextExplanation?: string;
  possibleOutcomes: string[];
  readAloud?: ParsedReadAloud;
  aacSupport?: ParsedAacSupport;
}

export interface ParsedSocialStoryScene {
  sceneNumber: number;
  text: string;
  accessibleDescription: string;
  illustration?: ParsedMediaRef;
  readAloud?: ParsedReadAloud;
  aacSupport?: ParsedAacSupport;
}

export interface ParsedSocialStoryCardPayload {
  displayTitle: string;
  storyIntro?: string;
  scenes: ParsedSocialStoryScene[];
  closingReflection?: string;
  readAloud?: ParsedReadAloud;
}

export interface ParsedCommunicationCardPayload {
  displayTitle: string;
  communicationIntent: string;
  phrase: string;
  accessibleDescription: string;
  aacSupport?: ParsedAacSupport;
  visualSupport?: ParsedMediaRef;
  readAloud?: ParsedReadAloud;
}

export interface ResolvedChapterItemPlacement {
  item: SafeStudentPinnedItemView;
  sessionNumber: SessionNumber;
  stepNumber: StepNumber;
  componentType: StepComponentType;
  chapterKey: string | null;
  strategyCategory: StrategyCategory | null;
  groupingSource: 'sel_theme_convention' | 'content_type_fallback';
}

export interface StudentAccessibilityRuntime {
  largeText: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
  aacEnabled: boolean;
  readAloudEnabled: boolean;
  speechRate: 'slow' | 'normal';
}

export interface PendingTurnDraft {
  turnIndex: number;
  stepKey: string;
  selectedChoiceKey: string | null;
  selectedEmotionKey: string | null;
  usedAac: boolean;
  usedReadAloud: boolean;
  aacTapDelta?: number;
  readAloudDelta?: number;
  durationSeconds?: number;
  responsePayloadJson: Record<string, unknown> | null;
}

export type TurnPersistenceStatus = 'idle' | 'saving' | 'saved' | 'error';

export type FamilyLearningStateCode = 'not_started' | 'in_progress' | 'completed';

export interface SafeStudentFamilyProgramSummaryView {
  enrollmentId: string;
  familyWorkspaceId: string;
  workspaceCode: string;
  workspaceName: string;
  familyProgramId: string;
  familyProgramVersionId: string;
  versionNumber: number;
  programSlug: string;
  title: string;
  description: string | null;
  locale: string;
  ageBand: string | null;
  activationSource: string;
  learningStatus: FamilyLearningStateCode;
  statusLabelVi: 'Chưa bắt đầu' | 'Đang học' | 'Đã hoàn thành';
  totalActivities: number;
  completedActivities: number;
  startedAt: string | null;
  lastActivityAt: string | null;
  completedAt: string | null;
  activatedAt: string;
}

export interface SafeStudentFamilyProgramItemView {
  id: string;
  itemId: string;
  chapterNumber: number;
  chapterTitle: string;
  sortOrder: number;
  pinnedContentVersion: {
    contentItemId: string;
    contentVersionId: string;
    contentType: CanonicalContentType;
    versionNumber: number;
    title: string;
    summary: string | null;
    locale: string;
    payloadJson: Record<string, unknown>;
    metadataJson: Record<string, unknown> | null;
  };
  progress: {
    hasInProgress: boolean;
    activeAttemptId: string | null;
    completedAttempts: number;
    latestCompletedAttemptId: string | null;
    status: FamilyLearningStateCode;
  };
}

export interface SafeStudentFamilyProgramDetailView {
  program: {
    enrollmentId: string;
    familyWorkspaceId: string;
    workspaceCode: string;
    workspaceName: string;
    familyProgramId: string;
    familyProgramVersionId: string;
    versionNumber: number;
    programSlug: string;
    title: string;
    description: string | null;
    locale: string;
    ageBand: string | null;
    learningStatus: FamilyLearningStateCode;
    statusLabelVi: 'Chưa bắt đầu' | 'Đang học' | 'Đã hoàn thành';
    totalActivities: number;
    completedActivities: number;
    startedAt: string | null;
    lastActivityAt: string | null;
    completedAt: string | null;
  };
  items: SafeStudentFamilyProgramItemView[];
}

export interface SafeFamilyStudentAttemptView {
  attemptId: string;
  enrollmentId: string;
  familyWorkspaceId: string;
  itemId: string;
  itemSortOrder: number;
  chapterNumber: number;
  chapterTitle: string;
  pinnedContentVersion: {
    contentItemId: string;
    contentVersionId: string;
    contentType: CanonicalContentType;
    versionNumber: number;
    title: string;
    summary: string | null;
    locale: string;
  };
  attemptNumber: number;
  state: AttemptLifecycleState;
  isReadOnly: boolean;
  startedAt: string;
  lastInteractedAt: string;
  completedAt: string | null;
  elapsedSeconds: number;
  supportContext: SafeSupportContextView;
  turns: SafeTurnView[];
  resumePosition: {
    savedTurnCount: number;
    nextTurnIndex: number;
    lastTurnIndex: number | null;
    lastStepKey: string | null;
  };
  availableActions: {
    canResume: boolean;
    canSubmitTurn: boolean;
    canComplete: boolean;
    canAbandon: boolean;
    canRetry: boolean;
  };
  enrollmentProgress: {
    learningStatus: FamilyLearningStateCode;
    totalActivities: number;
    completedActivities: number;
    startedAt: string | null;
    lastActivityAt: string | null;
    completedAt: string | null;
  };
}

export interface SafeStudentFamilyPreferencesView {
  studentUserId: string;
  preferredName: string | null;
  supportPreferencesJson: StudentSupportPreferencesJson | null;
  updatedAt: string | null;
}
