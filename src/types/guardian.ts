export interface SafeGuardianProfileView {
  id: string;
  displayName: string;
  email: string | null;
  platformRole: 'guardian';
  emailVerified: boolean;
}

export interface SafeFamilyWorkspaceView {
  id: string;
  code: string;
  name: string;
  status: string;
  myRole: string;
  memberCount: number;
  studentCount: number;
  createdAt: string;
}

export interface SafeFamilyMemberView {
  membershipId: string;
  guardianUserId: string;
  displayName: string;
  role: string;
  status: string;
  joinedAt: string;
}

export interface SafeFamilyWorkspaceStudentView {
  familyStudentId: string;
  familyWorkspaceId: string;
  studentUserId: string;
  familyUsername: string;
  status: string;
  displayName: string;
  userStatus: string;
  hasSchoolMembership: boolean;
  linkedByCurrentGuardian: boolean;
  currentGuardianLinkId: string | null;
  createdAt: string;
}

export interface SafeGuardianStudentLinkView {
  linkId: string;
  familyWorkspaceId: string;
  workspaceCode: string;
  workspaceName: string;
  studentUserId: string;
  studentDisplayName: string;
  studentStatus: string;
  familyUsername: string | null;
  relationshipStatus: string;
  verificationSource: string;
  sourceOrganizationName: string | null;
  hasSchoolMembership: boolean;
  verifiedAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export type EffectiveInvitationStatus = 'pending' | 'claimed' | 'revoked' | 'expired';

export interface SafeInvitationSharedStudentView {
  studentUserId: string;
  displayName: string;
  familyUsername: string | null;
}

export interface SafeInvitationStatusView {
  id: string;
  invitationType: string;
  status: EffectiveInvitationStatus;
  rawStatus: string;
  expiresAt: string;
  createdByRole: string;
  claimedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  sharedStudents?: SafeInvitationSharedStudentView[];
}

export interface FamilyWorkspaceDetailView {
  workspace: SafeFamilyWorkspaceView;
  members: SafeFamilyMemberView[];
  students: SafeFamilyWorkspaceStudentView[];
  coGuardianInvitations: SafeInvitationStatusView[];
}

export interface CreateFamilyStudentResult {
  student: {
    userId: string;
    displayName: string;
    familyUsername: string;
    familyWorkspaceId: string;
    workspaceCode: string;
    linkId: string;
    relationshipStatus: string;
    verificationSource: string;
    status: string;
    createdAt: string;
  };
  loginGuide: {
    workspaceCode: string;
    familyUsername: string;
  };
}

export interface ClaimSchoolInvitationResult {
  linkId: string;
  studentUserId: string;
  studentDisplayName: string;
  familyWorkspaceId: string;
  workspaceCode: string;
  workspaceName: string;
  familyUsername: string;
  verificationSource: string;
  verifiedAt: string;
}

export type LearningStateCode = 'not_started' | 'in_progress' | 'completed';

export interface FreeFamilyProgramView {
  programId: string;
  slug: string;
  versionId: string;
  versionNumber: number;
  title: string;
  description: string | null;
  locale: string;
  ageBand: string | null;
  itemCount: number;
  publishedAt: string | null;
}

export interface SafeGuardianProgressChapterView {
  chapterNumber: number;
  chapterTitle: string;
  status: LearningStateCode;
  statusLabelVi: 'Chưa bắt đầu' | 'Đang học' | 'Đã hoàn thành';
  totalActivities: number;
  completedActivities: number;
}

export interface SafeGuardianProgressItemView {
  id: string;
  sourceContext: 'family' | 'school';
  sourceLabel: string;
  familyWorkspaceId: string | null;
  title: string;
  versionNumber: number | null;
  status: LearningStateCode;
  statusLabelVi: 'Chưa bắt đầu' | 'Đang học' | 'Đã hoàn thành';
  totalActivities: number;
  completedActivities: number;
  startedAt: string | null;
  lastActivityAt: string | null;
  completedAt: string | null;
  chapters: SafeGuardianProgressChapterView[];
}

export interface SafeGuardianStudentProgressOverview {
  student: {
    studentUserId: string;
    displayName: string;
  };
  privacyNotice: string;
  items: SafeGuardianProgressItemView[];
}

export interface GuardianProgramEnrollmentResult {
  enrollmentId: string;
  familyWorkspaceId: string;
  studentUserId: string;
  familyProgramId: string;
  familyProgramVersionId: string;
  activationSource: 'free_program';
  status: 'active';
  activatedAt: string;
}
