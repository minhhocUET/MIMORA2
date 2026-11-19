import { apiRequest } from './client.ts';
import type {
  GoalStatus,
  SafeFamilyStudentAttemptView,
  SafeStudentAssignmentDetailView,
  SafeStudentAssignmentListItemView,
  SafeStudentAttemptView,
  SafeStudentFamilyPreferencesView,
  SafeStudentFamilyProgramDetailView,
  SafeStudentFamilyProgramSummaryView,
  SafeStudentGoalView,
  SafeStudentProfileView,
  SafeTurnView,
  StudentSupportPreferencesJson,
} from '../types/student.ts';

function buildQuery(params: object): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).trim().length > 0) {
      sp.set(key, String(value));
    }
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

export interface ListStudentAssignmentsQuery {
  status?: 'active' | 'closed';
  page?: number;
  limit?: number;
}

export interface StartOrResumeAttemptInput {
  intent?: 'start_or_resume' | 'retry';
  expectedContentVersionId?: string;
  idempotencyKey?: string;
  usedAacSupport?: boolean;
  usedReadAloud?: boolean;
}

export interface SaveStudentTurnInput {
  turnIndex: number;
  stepKey: string;
  selectedChoiceKey?: string | null;
  selectedEmotionKey?: string | null;
  usedAac?: boolean;
  usedReadAloud?: boolean;
  aacTapDelta?: number;
  readAloudDelta?: number;
  durationSeconds?: number;
  responsePayloadJson?: Record<string, unknown> | null;
}

export interface CompleteStudentAttemptInput {
  durationSeconds?: number;
  usedAacSupport?: boolean;
  usedReadAloud?: boolean;
  aacTapDelta?: number;
  readAloudDelta?: number;
  responseSummaryJson?: Record<string, unknown> | null;
}

export interface AbandonStudentAttemptInput {
  confirmed: true;
  reason?: 'paused_for_later' | 'switch_activity' | 'student_requested';
  durationSeconds?: number;
}

export const studentApi = {
  listAssignments(
    query: ListStudentAssignmentsQuery = {},
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{
      status: 'ok';
      items: SafeStudentAssignmentListItemView[];
      page: number;
      limit: number;
      total: number;
    }>(`/student/assignments${buildQuery(query)}`, {
      method: 'GET',
      fetchImpl,
    });
  },

  getAssignmentDetail(assignmentId: string, fetchImpl?: typeof fetch) {
    return apiRequest<{
      status: 'ok';
      assignment: SafeStudentAssignmentDetailView;
    }>(`/student/assignments/${encodeURIComponent(assignmentId)}`, {
      method: 'GET',
      fetchImpl,
    });
  },

  startOrResumeAttempt(
    targetId: string,
    itemId: string,
    body: StartOrResumeAttemptInput = {},
    fetchImpl?: typeof fetch
  ) {
    const headers: Record<string, string> = {};
    if (body.idempotencyKey && body.idempotencyKey.trim().length > 0) {
      headers['Idempotency-Key'] = body.idempotencyKey.trim();
    }

    return apiRequest<{
      status: 'ok';
      action: 'started' | 'resumed' | 'retried' | 'idempotent_replay';
      attempt: SafeStudentAttemptView;
    }>(
      `/student/assignments/${encodeURIComponent(targetId)}/items/${encodeURIComponent(itemId)}/start-or-resume`,
      {
        method: 'POST',
        body,
        headers,
        fetchImpl,
      }
    );
  },

  getAttempt(attemptId: string, fetchImpl?: typeof fetch) {
    return apiRequest<{
      status: 'ok';
      attempt: SafeStudentAttemptView;
    }>(`/student/attempts/${encodeURIComponent(attemptId)}`, {
      method: 'GET',
      fetchImpl,
    });
  },

  saveTurn(
    attemptId: string,
    body: SaveStudentTurnInput,
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{
      status: 'ok';
      idempotentReplay: boolean;
      savedTurn: SafeTurnView;
      attempt: SafeStudentAttemptView;
    }>(`/student/attempts/${encodeURIComponent(attemptId)}/turns`, {
      method: 'POST',
      body,
      fetchImpl,
    });
  },

  completeAttempt(
    attemptId: string,
    body: CompleteStudentAttemptInput = {},
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{
      status: 'ok';
      idempotentReplay: boolean;
      attempt: SafeStudentAttemptView;
    }>(`/student/attempts/${encodeURIComponent(attemptId)}/complete`, {
      method: 'POST',
      body,
      fetchImpl,
    });
  },

  abandonAttempt(
    attemptId: string,
    body: AbandonStudentAttemptInput,
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{
      status: 'ok';
      idempotentReplay: boolean;
      attempt: SafeStudentAttemptView;
    }>(`/student/attempts/${encodeURIComponent(attemptId)}/abandon`, {
      method: 'POST',
      body,
      fetchImpl,
    });
  },

  getProfile(fetchImpl?: typeof fetch) {
    return apiRequest<{
      status: 'ok';
      profile: SafeStudentProfileView;
    }>('/student/profile', {
      method: 'GET',
      fetchImpl,
    });
  },

  listGoals(
    query: { status?: Exclude<GoalStatus, 'archived'>; page?: number; limit?: number } = {},
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{
      status: 'ok';
      items: SafeStudentGoalView[];
      pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      };
    }>(`/student/goals${buildQuery(query)}`, {
      method: 'GET',
      fetchImpl,
    });
  },

  // Teacher-Free Family Learning & Canonical Student Preferences (P4-02)
  getFamilyPreferences(fetchImpl?: typeof fetch) {
    return apiRequest<{
      status: 'ok';
      preferences: SafeStudentFamilyPreferencesView;
    }>('/student/family-preferences', {
      method: 'GET',
      fetchImpl,
    });
  },

  updateFamilyPreferences(
    body: {
      preferredName?: string | null;
      supportPreferencesJson?: StudentSupportPreferencesJson | null;
    },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{
      status: 'ok';
      preferences: SafeStudentFamilyPreferencesView;
    }>('/student/family-preferences', {
      method: 'PATCH',
      body,
      fetchImpl,
    });
  },

  listFamilyPrograms(fetchImpl?: typeof fetch) {
    return apiRequest<{
      status: 'ok';
      programs: SafeStudentFamilyProgramSummaryView[];
    }>('/student/family-programs', {
      method: 'GET',
      fetchImpl,
    });
  },

  getFamilyProgramDetail(enrollmentId: string, fetchImpl?: typeof fetch) {
    return apiRequest<{ status: 'ok' } & SafeStudentFamilyProgramDetailView>(
      `/student/family-programs/${encodeURIComponent(enrollmentId)}`,
      {
        method: 'GET',
        fetchImpl,
      }
    );
  },

  startOrResumeFamilyAttempt(
    enrollmentId: string,
    itemId: string,
    body: StartOrResumeAttemptInput = {},
    fetchImpl?: typeof fetch
  ) {
    const headers: Record<string, string> = {};
    if (body.idempotencyKey && body.idempotencyKey.trim().length > 0) {
      headers['Idempotency-Key'] = body.idempotencyKey.trim();
    }

    return apiRequest<{
      status: 'ok';
      action: 'started' | 'resumed' | 'retried' | 'idempotent_replay';
      attempt: SafeFamilyStudentAttemptView;
    }>(
      `/student/family-programs/${encodeURIComponent(enrollmentId)}/items/${encodeURIComponent(itemId)}/start-or-resume`,
      {
        method: 'POST',
        body,
        headers,
        fetchImpl,
      }
    );
  },

  getFamilyAttempt(attemptId: string, fetchImpl?: typeof fetch) {
    return apiRequest<{
      status: 'ok';
      attempt: SafeFamilyStudentAttemptView;
    }>(`/student/family-attempts/${encodeURIComponent(attemptId)}`, {
      method: 'GET',
      fetchImpl,
    });
  },

  saveFamilyTurn(
    attemptId: string,
    body: SaveStudentTurnInput,
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{
      status: 'ok';
      idempotentReplay: boolean;
      savedTurn: SafeTurnView;
      attempt: SafeFamilyStudentAttemptView;
    }>(`/student/family-attempts/${encodeURIComponent(attemptId)}/turns`, {
      method: 'POST',
      body,
      fetchImpl,
    });
  },

  completeFamilyAttempt(
    attemptId: string,
    body: CompleteStudentAttemptInput = {},
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{
      status: 'ok';
      idempotentReplay: boolean;
      attempt: SafeFamilyStudentAttemptView;
    }>(`/student/family-attempts/${encodeURIComponent(attemptId)}/complete`, {
      method: 'POST',
      body,
      fetchImpl,
    });
  },

  abandonFamilyAttempt(
    attemptId: string,
    body: AbandonStudentAttemptInput,
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{
      status: 'ok';
      idempotentReplay: boolean;
      attempt: SafeFamilyStudentAttemptView;
    }>(`/student/family-attempts/${encodeURIComponent(attemptId)}/abandon`, {
      method: 'POST',
      body,
      fetchImpl,
    });
  },
};
