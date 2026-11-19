import { apiRequest } from './client.ts';
import type {
  ClaimSchoolInvitationResult,
  CreateFamilyStudentResult,
  FamilyWorkspaceDetailView,
  FreeFamilyProgramView,
  GuardianProgramEnrollmentResult,
  SafeFamilyWorkspaceView,
  SafeGuardianProfileView,
  SafeGuardianStudentLinkView,
  SafeGuardianStudentProgressOverview,
  SafeInvitationStatusView,
} from '../types/guardian.ts';

export const guardianApi = {
  getProfile(fetchImpl?: typeof fetch) {
    return apiRequest<{ status: 'ok'; profile: SafeGuardianProfileView }>(
      '/guardian/profile',
      { method: 'GET', fetchImpl }
    );
  },

  listWorkspaces(fetchImpl?: typeof fetch) {
    return apiRequest<{ status: 'ok'; workspaces: SafeFamilyWorkspaceView[] }>(
      '/guardian/workspaces',
      { method: 'GET', fetchImpl }
    );
  },

  createWorkspace(body: { name: string }, fetchImpl?: typeof fetch) {
    return apiRequest<{ status: 'ok'; workspace: SafeFamilyWorkspaceView }>(
      '/guardian/workspaces',
      { method: 'POST', body, fetchImpl }
    );
  },

  getWorkspaceDetail(workspaceId: string, fetchImpl?: typeof fetch) {
    return apiRequest<{ status: 'ok' } & FamilyWorkspaceDetailView>(
      `/guardian/workspaces/${encodeURIComponent(workspaceId)}`,
      { method: 'GET', fetchImpl }
    );
  },

  createFamilyStudent(
    workspaceId: string,
    body: {
      displayName: string;
      familyUsername: string;
      password: string;
    },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{ status: 'ok' } & CreateFamilyStudentResult>(
      `/guardian/workspaces/${encodeURIComponent(workspaceId)}/students`,
      { method: 'POST', body, fetchImpl }
    );
  },

  listMyStudents(
    options: { includeRevoked?: boolean } = {},
    fetchImpl?: typeof fetch
  ) {
    const qs = options.includeRevoked ? '?includeRevoked=true' : '';
    return apiRequest<{ status: 'ok'; students: SafeGuardianStudentLinkView[] }>(
      `/guardian/students${qs}`,
      { method: 'GET', fetchImpl }
    );
  },

  revokeMyLink(linkId: string, fetchImpl?: typeof fetch) {
    return apiRequest<{
      status: 'ok';
      link: { linkId: string; relationshipStatus: 'revoked'; revokedAt: string };
    }>(`/guardian/links/${encodeURIComponent(linkId)}/revoke`, {
      method: 'POST',
      body: {},
      fetchImpl,
    });
  },

  listCoGuardianInvitations(workspaceId: string, fetchImpl?: typeof fetch) {
    return apiRequest<{ status: 'ok'; invitations: SafeInvitationStatusView[] }>(
      `/guardian/workspaces/${encodeURIComponent(workspaceId)}/co-guardian-invitations`,
      { method: 'GET', fetchImpl }
    );
  },

  createCoGuardianInvitation(
    workspaceId: string,
    body: { expiresInHours?: number; studentUserIds: string[] },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{
      status: 'ok';
      invitation: SafeInvitationStatusView;
      claimCode: string;
    }>(
      `/guardian/workspaces/${encodeURIComponent(workspaceId)}/co-guardian-invitations`,
      { method: 'POST', body, fetchImpl }
    );
  },

  revokeCoGuardianInvitation(
    workspaceId: string,
    invitationId: string,
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{
      status: 'ok';
      invitation: { id: string; status: 'revoked'; revokedAt: string };
    }>(
      `/guardian/workspaces/${encodeURIComponent(workspaceId)}/co-guardian-invitations/${encodeURIComponent(invitationId)}/revoke`,
      { method: 'POST', body: {}, fetchImpl }
    );
  },

  claimCoGuardianInvitation(
    body: { claimCode: string },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{
      status: 'ok';
      workspaceId: string;
      membershipId: string;
      linkedStudentsAdded: number;
      joinedAt: string;
    }>('/guardian/co-guardian-invitations/claim', {
      method: 'POST',
      body,
      fetchImpl,
    });
  },

  claimSchoolInvitation(
    body: {
      targetWorkspaceId: string;
      claimCode: string;
      familyUsername?: string;
    },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{ status: 'ok'; link: ClaimSchoolInvitationResult }>(
      '/guardian/invitations/claim',
      { method: 'POST', body, fetchImpl }
    );
  },

  listFreePrograms(fetchImpl?: typeof fetch) {
    return apiRequest<{ status: 'ok'; programs: FreeFamilyProgramView[] }>(
      '/guardian/free-programs',
      { method: 'GET', fetchImpl }
    );
  },

  getStudentProgress(studentUserId: string, fetchImpl?: typeof fetch) {
    return apiRequest<{ status: 'ok' } & SafeGuardianStudentProgressOverview>(
      `/guardian/students/${encodeURIComponent(studentUserId)}/progress`,
      { method: 'GET', fetchImpl }
    );
  },

  enrollFreeProgram(
    studentUserId: string,
    body: { familyWorkspaceId: string; familyProgramId: string },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{
      status: 'ok';
      enrollment: GuardianProgramEnrollmentResult;
    }>(
      `/guardian/students/${encodeURIComponent(studentUserId)}/programs/enroll`,
      { method: 'POST', body, fetchImpl }
    );
  },
};
