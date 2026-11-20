import { apiRequest } from './client.ts';
import type { CanonicalContentType } from '../types/chapter.ts';
import type {
  ClassStatus,
  ClassStudentRoster,
  CsvImportJobView,
  CsvImportRunResponse,
  PaginatedResult,
  SafeAdminUserView,
  SafeClassView,
  SafeMembershipView,
} from '../types/admin.ts';
import type {
  AssignmentStatus,
  AttemptStatus,
  GoalStatus,
  SafeAssignmentProgressSummaryView,
  SafeAssignmentTargetView,
  SafePinnedAssignmentItemView,
  SafeStudentGoalView,
  SafeStudentProfileView,
  SafeTeacherAssignmentListItemView,
  SafeTeacherAssignmentView,
  SafeTeacherAttemptDetailView,
  SafeTeacherAttemptSummaryView,
  SafeTeacherLibraryContentView,
  SafeTeacherObservationView,
  StudentSupportPreferences,
} from '../types/teacher.ts';
import type { SafeInvitationStatusView } from '../types/guardian.ts';

function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null && String(val).trim().length > 0) {
      sp.set(key, String(val));
    }
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

export const teacherApi = {
  // Assigned Classes & Roster
  listMyClasses(
    query: { page?: number; limit?: number; status?: ClassStatus } = {},
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<PaginatedResult<SafeClassView>>(
      `/classes${buildQuery(query)}`,
      { method: 'GET', fetchImpl }
    );
  },

  getClassStudents(classId: string, fetchImpl?: typeof fetch) {
    return apiRequest<{
      status: 'ok';
      class: SafeClassView;
      students: ClassStudentRoster[];
    }>(`/classes/${encodeURIComponent(classId)}/students`, {
      method: 'GET',
      fetchImpl,
    });
  },

  createClassStudent(
    classId: string,
    body: {
      displayName: string;
      orgUsername: string;
      password: string;
      email?: string | null;
    },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{
      status: 'ok';
      user: SafeAdminUserView;
      membership: SafeMembershipView;
      enrolledClassId: string;
    }>(`/classes/${encodeURIComponent(classId)}/students`, {
      method: 'POST',
      body,
      fetchImpl,
    });
  },

  runClassCsvImport(
    classId: string,
    body: {
      sourceFilename: string;
      csvContent: string;
      mode: 'preview' | 'commit';
    },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<CsvImportRunResponse>(
      `/classes/${encodeURIComponent(classId)}/csv-imports`,
      { method: 'POST', body, fetchImpl }
    );
  },

  getClassCsvImportJob(classId: string, jobId: string, fetchImpl?: typeof fetch) {
    return apiRequest<{ status: 'ok'; job: CsvImportJobView }>(
      `/classes/${encodeURIComponent(classId)}/csv-imports/${encodeURIComponent(jobId)}`,
      { method: 'GET', fetchImpl }
    );
  },

  // Published SEL Library (read-only)
  async listPublishedLibrary(
    query: {
      page?: number;
      limit?: number;
      contentType?: CanonicalContentType;
      locale?: string;
      search?: string;
    } = {},
    fetchImpl?: typeof fetch
  ) {
    const res = await apiRequest<PaginatedResult<SafeTeacherLibraryContentView>>(
      `/library/content${buildQuery(query)}`,
      { method: 'GET', fetchImpl }
    );
    return {
      ...res,
      items: res.items.map((it) => ({
        ...it,
        itemId: it.itemId || it.contentItemId || '',
        versionId: it.versionId || it.publishedVersionId || '',
      })),
    };
  },

  async getPublishedLibraryItem(itemId: string, fetchImpl?: typeof fetch) {
    const res = await apiRequest<{ status: 'ok'; item: SafeTeacherLibraryContentView }>(
      `/library/content/${encodeURIComponent(itemId)}`,
      { method: 'GET', fetchImpl }
    );
    return {
      ...res,
      item: {
        ...res.item,
        itemId: res.item.itemId || res.item.contentItemId || '',
        versionId: res.item.versionId || res.item.publishedVersionId || '',
      },
    };
  },

  // Assignments, Targets, Progress & Read-only Attempts
  listAssignments(
    query: {
      classId?: string;
      status?: AssignmentStatus;
      page?: number;
      limit?: number;
    } = {},
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<PaginatedResult<SafeTeacherAssignmentListItemView>>(
      `/assignments${buildQuery(query)}`,
      { method: 'GET', fetchImpl }
    );
  },

  createAssignment(
    body: {
      classId: string;
      title: string;
      homePracticeInstructions?: string | null;
      dueAt?: string | null;
      status?: 'draft' | 'active';
      items: Array<{
        contentVersionId: string;
        sortOrder: number;
        expectedContentItemId?: string;
      }>;
      targetStudentMembershipIds: string[];
    },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{
      status: 'ok';
      assignment: SafeTeacherAssignmentView;
      items: SafePinnedAssignmentItemView[];
      targets: SafeAssignmentTargetView[];
    }>('/assignments', { method: 'POST', body, fetchImpl });
  },

  getAssignmentDetail(assignmentId: string, fetchImpl?: typeof fetch) {
    return apiRequest<{
      status: 'ok';
      assignment: SafeTeacherAssignmentView;
      items: SafePinnedAssignmentItemView[];
      targets: SafeAssignmentTargetView[];
    }>(`/assignments/${encodeURIComponent(assignmentId)}`, {
      method: 'GET',
      fetchImpl,
    });
  },

  updateAssignment(
    assignmentId: string,
    body: {
      title?: string;
      homePracticeInstructions?: string | null;
      dueAt?: string | null;
      status?: AssignmentStatus;
    },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{ status: 'ok'; assignment: SafeTeacherAssignmentView }>(
      `/assignments/${encodeURIComponent(assignmentId)}`,
      { method: 'PATCH', body, fetchImpl }
    );
  },

  updateAssignmentTargets(
    assignmentId: string,
    targetStudentMembershipIds: string[],
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{
      status: 'ok';
      assignmentId: string;
      targets: SafeAssignmentTargetView[];
    }>(`/assignments/${encodeURIComponent(assignmentId)}/targets`, {
      method: 'PUT',
      body: { targetStudentMembershipIds },
      fetchImpl,
    });
  },

  closeAssignment(assignmentId: string, fetchImpl?: typeof fetch) {
    return apiRequest<{ status: 'ok'; assignment: SafeTeacherAssignmentView }>(
      `/assignments/${encodeURIComponent(assignmentId)}/close`,
      { method: 'POST', body: {}, fetchImpl }
    );
  },

  getAssignmentProgress(assignmentId: string, fetchImpl?: typeof fetch) {
    return apiRequest<{
      status: 'ok';
      assignment: SafeTeacherAssignmentView;
      totalItems: number;
      targets: SafeAssignmentProgressSummaryView[];
    }>(`/assignments/${encodeURIComponent(assignmentId)}/progress`, {
      method: 'GET',
      fetchImpl,
    });
  },

  listAssignmentAttempts(
    assignmentId: string,
    query: {
      studentMembershipId?: string;
      assignmentItemId?: string;
      status?: AttemptStatus;
      page?: number;
      limit?: number;
    } = {},
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<
      PaginatedResult<SafeTeacherAttemptSummaryView> & {
        assignment: {
          id: string;
          organizationId: string;
          classId: string;
          title: string;
          status: AssignmentStatus;
          readOnly: true;
        };
      }
    >(`/assignments/${encodeURIComponent(assignmentId)}/attempts${buildQuery(query)}`, {
      method: 'GET',
      fetchImpl,
    });
  },

  getAssignmentAttemptDetail(
    assignmentId: string,
    attemptId: string,
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{
      status: 'ok';
      assignment: {
        id: string;
        organizationId: string;
        classId: string;
        title: string;
        status: AssignmentStatus;
        readOnly: true;
      };
      attempt: SafeTeacherAttemptDetailView;
    }>(
      `/assignments/${encodeURIComponent(assignmentId)}/attempts/${encodeURIComponent(attemptId)}`,
      { method: 'GET', fetchImpl }
    );
  },

  // Student Support Profile
  getStudentProfile(membershipId: string, fetchImpl?: typeof fetch) {
    return apiRequest<{ status: 'ok'; profile: SafeStudentProfileView }>(
      `/students/${encodeURIComponent(membershipId)}/profile`,
      { method: 'GET', fetchImpl }
    );
  },

  updateStudentProfile(
    membershipId: string,
    body: {
      preferredName?: string | null;
      supportPreferencesJson?: StudentSupportPreferences | null;
    },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{ status: 'ok'; profile: SafeStudentProfileView }>(
      `/students/${encodeURIComponent(membershipId)}/profile`,
      { method: 'PATCH', body, fetchImpl }
    );
  },

  // Individual SEL Goals
  listStudentGoals(
    membershipId: string,
    query: {
      status?: GoalStatus;
      includeArchived?: 'true' | 'false';
      page?: number;
      limit?: number;
    } = {},
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<PaginatedResult<SafeStudentGoalView>>(
      `/students/${encodeURIComponent(membershipId)}/goals${buildQuery(query)}`,
      { method: 'GET', fetchImpl }
    );
  },

  createStudentGoal(
    membershipId: string,
    body: {
      classId?: string | null;
      title: string;
      description?: string | null;
      focusArea?: string | null;
      targetDate?: string | null;
    },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{ status: 'ok'; goal: SafeStudentGoalView }>(
      `/students/${encodeURIComponent(membershipId)}/goals`,
      { method: 'POST', body, fetchImpl }
    );
  },

  updateGoal(
    goalId: string,
    body: {
      title?: string;
      description?: string | null;
      focusArea?: string | null;
      status?: GoalStatus;
      targetDate?: string | null;
    },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{ status: 'ok'; goal: SafeStudentGoalView }>(
      `/goals/${encodeURIComponent(goalId)}`,
      { method: 'PATCH', body, fetchImpl }
    );
  },

  archiveGoal(goalId: string, fetchImpl?: typeof fetch) {
    return apiRequest<{ status: 'ok'; goal: SafeStudentGoalView }>(
      `/goals/${encodeURIComponent(goalId)}`,
      { method: 'DELETE', fetchImpl }
    );
  },

  // Author-only Private Teacher Observations
  listObservations(
    query: {
      studentMembershipId?: string;
      classId?: string;
      assignmentId?: string;
      attemptId?: string;
      page?: number;
      limit?: number;
    } = {},
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<PaginatedResult<SafeTeacherObservationView>>(
      `/observations${buildQuery(query)}`,
      { method: 'GET', fetchImpl }
    );
  },

  createObservation(
    body: {
      studentMembershipId: string;
      classId?: string | null;
      assignmentId?: string | null;
      attemptId?: string | null;
      noteBody: string;
    },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{ status: 'ok'; observation: SafeTeacherObservationView }>(
      '/observations',
      { method: 'POST', body, fetchImpl }
    );
  },

  updateObservation(
    observationId: string,
    body: {
      noteBody?: string;
      classId?: string | null;
      assignmentId?: string | null;
      attemptId?: string | null;
    },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{ status: 'ok'; observation: SafeTeacherObservationView }>(
      `/observations/${encodeURIComponent(observationId)}`,
      { method: 'PATCH', body, fetchImpl }
    );
  },

  deleteObservation(observationId: string, fetchImpl?: typeof fetch) {
    return apiRequest<{ status: 'ok'; deleted: boolean; id: string }>(
      `/observations/${encodeURIComponent(observationId)}`,
      { method: 'DELETE', fetchImpl }
    );
  },

  // School Student -> Guardian Link Invitations
  listGuardianInvitations(membershipId: string, fetchImpl?: typeof fetch) {
    return apiRequest<{ status: 'ok'; invitations: SafeInvitationStatusView[] }>(
      `/students/${encodeURIComponent(membershipId)}/guardian-invitations`,
      { method: 'GET', fetchImpl }
    );
  },

  createGuardianInvitation(
    membershipId: string,
    body: { expiresInHours?: number } = {},
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{
      status: 'ok';
      invitation: SafeInvitationStatusView;
      claimCode: string;
    }>(`/students/${encodeURIComponent(membershipId)}/guardian-invitations`, {
      method: 'POST',
      body,
      fetchImpl,
    });
  },

  revokeGuardianInvitation(invitationId: string, fetchImpl?: typeof fetch) {
    return apiRequest<{
      status: 'ok';
      invitation: { id: string; status: 'revoked'; revokedAt: string };
    }>(`/students/guardian-invitations/${encodeURIComponent(invitationId)}/revoke`, {
      method: 'POST',
      body: {},
      fetchImpl,
    });
  },
};
