import { apiRequest } from './client.ts';
import type { CanonicalContentType } from '../types/chapter.ts';
import type {
  AccountStatus,
  AdminFamilyWorkspaceCandidate,
  AdminInsightsResponseView,
  ClassStatus,
  ClassStudentRoster,
  ClassTeacherEntry,
  ContentMetadataJson,
  CsvImportJobView,
  CsvImportRunResponse,
  FamilyProgramAvailabilityMode,
  InsightContentScope,
  InsightPeriodType,
  MembershipRole,
  MembershipStatus,
  OrganizationStatus,
  PaginatedResult,
  SafeAdminProgramDetailResponse,
  SafeAdminProgramSummaryView,
  SafeAdminUserView,
  SafeClassView,
  SafeContentApprovalView,
  SafeContentItemView,
  SafeContentVersionView,
  SafeMembershipView,
  SafeOrganizationView,
} from '../types/admin.ts';
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

export const adminApi = {
  // Organizations
  listOrganizations(
    query: { page?: number; limit?: number; status?: OrganizationStatus; search?: string } = {},
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<PaginatedResult<SafeOrganizationView>>(
      `/admin/organizations${buildQuery(query)}`,
      { method: 'GET', fetchImpl }
    );
  },

  createOrganization(
    body: { code: string; name: string; status?: OrganizationStatus },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{ status: 'ok'; organization: SafeOrganizationView }>(
      '/admin/organizations',
      { method: 'POST', body, fetchImpl }
    );
  },

  getOrganization(orgId: string, fetchImpl?: typeof fetch) {
    return apiRequest<{ status: 'ok'; organization: SafeOrganizationView }>(
      `/admin/organizations/${encodeURIComponent(orgId)}`,
      { method: 'GET', fetchImpl }
    );
  },

  updateOrganization(
    orgId: string,
    body: { code?: string; name?: string; status?: OrganizationStatus },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{ status: 'ok'; organization: SafeOrganizationView }>(
      `/admin/organizations/${encodeURIComponent(orgId)}`,
      { method: 'PATCH', body, fetchImpl }
    );
  },

  // Users & Memberships
  listUsers(
    query: {
      page?: number;
      limit?: number;
      status?: AccountStatus;
      platformRole?: 'platform_admin';
      search?: string;
    } = {},
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<PaginatedResult<SafeAdminUserView>>(
      `/admin/users${buildQuery(query)}`,
      { method: 'GET', fetchImpl }
    );
  },

  createUser(
    body: {
      role: MembershipRole;
      organizationId: string;
      displayName: string;
      password: string;
      email?: string | null;
      platformUsername?: string | null;
      orgUsername?: string | null;
      classId?: string;
    },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{
      status: 'ok';
      user: SafeAdminUserView;
      membership: SafeMembershipView;
      enrolledClassId: string | null;
    }>('/admin/users', { method: 'POST', body, fetchImpl });
  },

  getUser(userId: string, fetchImpl?: typeof fetch) {
    return apiRequest<{
      status: 'ok';
      user: SafeAdminUserView;
      memberships: SafeMembershipView[];
    }>(`/admin/users/${encodeURIComponent(userId)}`, { method: 'GET', fetchImpl });
  },

  updateUser(
    userId: string,
    body: { displayName?: string; email?: string | null; status?: AccountStatus },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{ status: 'ok'; user: SafeAdminUserView }>(
      `/admin/users/${encodeURIComponent(userId)}`,
      { method: 'PATCH', body, fetchImpl }
    );
  },

  listOrganizationMemberships(
    orgId: string,
    query: {
      page?: number;
      limit?: number;
      role?: MembershipRole;
      status?: MembershipStatus;
      search?: string;
    } = {},
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<PaginatedResult<SafeMembershipView>>(
      `/admin/organizations/${encodeURIComponent(orgId)}/memberships${buildQuery(query)}`,
      { method: 'GET', fetchImpl }
    );
  },

  createOrganizationMembership(
    orgId: string,
    body: { userId: string; role: MembershipRole; orgUsername?: string | null },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{ status: 'ok'; membership: SafeMembershipView }>(
      `/admin/organizations/${encodeURIComponent(orgId)}/memberships`,
      { method: 'POST', body, fetchImpl }
    );
  },

  updateOrganizationMembership(
    orgId: string,
    membershipId: string,
    body: { orgUsername?: string | null; status?: 'active' | 'disabled' },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{ status: 'ok'; membership: SafeMembershipView }>(
      `/admin/organizations/${encodeURIComponent(orgId)}/memberships/${encodeURIComponent(membershipId)}`,
      { method: 'PATCH', body, fetchImpl }
    );
  },

  // Classes
  listOrganizationClasses(
    orgId: string,
    query: { page?: number; limit?: number; status?: ClassStatus; search?: string } = {},
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<PaginatedResult<SafeClassView>>(
      `/admin/organizations/${encodeURIComponent(orgId)}/classes${buildQuery(query)}`,
      { method: 'GET', fetchImpl }
    );
  },

  createClass(
    orgId: string,
    body: { name: string; academicYear?: string | null },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{ status: 'ok'; class: SafeClassView }>(
      `/admin/organizations/${encodeURIComponent(orgId)}/classes`,
      { method: 'POST', body, fetchImpl }
    );
  },

  getClassDetail(orgId: string, classId: string, fetchImpl?: typeof fetch) {
    return apiRequest<{
      status: 'ok';
      class: SafeClassView;
      teachers: ClassTeacherEntry[];
      students: ClassStudentRoster[];
    }>(
      `/admin/organizations/${encodeURIComponent(orgId)}/classes/${encodeURIComponent(classId)}`,
      { method: 'GET', fetchImpl }
    );
  },

  updateClass(
    orgId: string,
    classId: string,
    body: { name?: string; academicYear?: string | null; status?: ClassStatus },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{ status: 'ok'; class: SafeClassView }>(
      `/admin/organizations/${encodeURIComponent(orgId)}/classes/${encodeURIComponent(classId)}`,
      { method: 'PATCH', body, fetchImpl }
    );
  },

  setClassTeachers(
    orgId: string,
    classId: string,
    teacherMembershipIds: string[],
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{
      status: 'ok';
      classId: string;
      teachers: ClassTeacherEntry[];
    }>(
      `/admin/organizations/${encodeURIComponent(orgId)}/classes/${encodeURIComponent(classId)}/teachers`,
      { method: 'PUT', body: { teacherMembershipIds }, fetchImpl }
    );
  },

  updateClassStudents(
    orgId: string,
    classId: string,
    body:
      | {
          mode?: 'set';
          studentMembershipIds: string[];
          removedStatus?: 'transferred_out' | 'archived';
        }
      | { mode: 'enroll'; studentMembershipIds: string[] }
      | {
          mode: 'remove';
          studentMembershipIds: string[];
          removedStatus?: 'transferred_out' | 'archived';
        },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{
      status: 'ok';
      classId: string;
      students: ClassStudentRoster[];
    }>(
      `/admin/organizations/${encodeURIComponent(orgId)}/classes/${encodeURIComponent(classId)}/students`,
      { method: 'PUT', body, fetchImpl }
    );
  },

  // CSV Imports
  listCsvImports(
    orgId: string,
    query: { page?: number; limit?: number } = {},
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<PaginatedResult<CsvImportJobView>>(
      `/admin/organizations/${encodeURIComponent(orgId)}/csv-imports${buildQuery(query)}`,
      { method: 'GET', fetchImpl }
    );
  },

  runCsvImport(
    orgId: string,
    body: {
      sourceFilename: string;
      csvContent: string;
      targetClassId?: string | null;
      mode: 'preview' | 'commit';
    },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<CsvImportRunResponse>(
      `/admin/organizations/${encodeURIComponent(orgId)}/csv-imports`,
      { method: 'POST', body, fetchImpl }
    );
  },

  getCsvImportJob(orgId: string, jobId: string, fetchImpl?: typeof fetch) {
    return apiRequest<{ status: 'ok'; job: CsvImportJobView }>(
      `/admin/organizations/${encodeURIComponent(orgId)}/csv-imports/${encodeURIComponent(jobId)}`,
      { method: 'GET', fetchImpl }
    );
  },

  // Content Library & Approvals
  listContentItems(
    query: {
      page?: number;
      limit?: number;
      contentType?: CanonicalContentType;
      isArchived?: 'true' | 'false';
      search?: string;
    } = {},
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<PaginatedResult<SafeContentItemView>>(
      `/admin/content-items${buildQuery(query)}`,
      { method: 'GET', fetchImpl }
    );
  },

  createContentItem(
    body: {
      slug: string;
      contentType: CanonicalContentType;
      title: string;
      summary?: string | null;
      locale: string;
      payloadJson: Record<string, unknown>;
      metadataJson?: ContentMetadataJson | null;
    },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{
      status: 'ok';
      item: SafeContentItemView;
      version: SafeContentVersionView;
    }>('/admin/content-items', { method: 'POST', body, fetchImpl });
  },

  getContentItem(itemId: string, fetchImpl?: typeof fetch) {
    return apiRequest<{
      status: 'ok';
      item: SafeContentItemView;
      versions: SafeContentVersionView[];
    }>(`/admin/content-items/${encodeURIComponent(itemId)}`, {
      method: 'GET',
      fetchImpl,
    });
  },

  updateContentItem(
    itemId: string,
    body: { slug?: string; isArchived?: boolean },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{ status: 'ok'; item: SafeContentItemView }>(
      `/admin/content-items/${encodeURIComponent(itemId)}`,
      { method: 'PATCH', body, fetchImpl }
    );
  },

  archiveContentItem(itemId: string, fetchImpl?: typeof fetch) {
    return apiRequest<{ status: 'ok'; item: SafeContentItemView }>(
      `/admin/content-items/${encodeURIComponent(itemId)}/archive`,
      { method: 'POST', body: {}, fetchImpl }
    );
  },

  createContentVersion(
    itemId: string,
    body: {
      title: string;
      summary?: string | null;
      locale: string;
      payloadJson: Record<string, unknown>;
      metadataJson?: ContentMetadataJson | null;
    },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{ status: 'ok'; version: SafeContentVersionView }>(
      `/admin/content-items/${encodeURIComponent(itemId)}/versions`,
      { method: 'POST', body, fetchImpl }
    );
  },

  updateContentVersion(
    versionId: string,
    body: {
      title?: string;
      summary?: string | null;
      locale?: string;
      payloadJson?: Record<string, unknown>;
      metadataJson?: ContentMetadataJson | null;
    },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{ status: 'ok'; version: SafeContentVersionView }>(
      `/admin/content-versions/${encodeURIComponent(versionId)}`,
      { method: 'PATCH', body, fetchImpl }
    );
  },

  submitContentVersion(versionId: string, fetchImpl?: typeof fetch) {
    return apiRequest<{
      status: 'ok';
      version: SafeContentVersionView;
      approval: SafeContentApprovalView;
    }>(`/admin/content-versions/${encodeURIComponent(versionId)}/submit`, {
      method: 'POST',
      body: {},
      fetchImpl,
    });
  },

  approveContentVersion(
    versionId: string,
    decisionNote?: string | null,
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{
      status: 'ok';
      version: SafeContentVersionView;
      approval: SafeContentApprovalView;
    }>(`/admin/content-versions/${encodeURIComponent(versionId)}/approve`, {
      method: 'POST',
      body: decisionNote ? { decisionNote } : {},
      fetchImpl,
    });
  },

  rejectContentVersion(
    versionId: string,
    decisionNote?: string | null,
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{
      status: 'ok';
      version: SafeContentVersionView;
      approval: SafeContentApprovalView;
    }>(`/admin/content-versions/${encodeURIComponent(versionId)}/reject`, {
      method: 'POST',
      body: decisionNote ? { decisionNote } : {},
      fetchImpl,
    });
  },

  publishContentVersion(versionId: string, fetchImpl?: typeof fetch) {
    return apiRequest<{
      status: 'ok';
      item: SafeContentItemView;
      version: SafeContentVersionView;
    }>(`/admin/content-versions/${encodeURIComponent(versionId)}/publish`, {
      method: 'POST',
      body: {},
      fetchImpl,
    });
  },

  // Privacy-preserving Aggregate Insights
  getInsights(
    query: {
      organizationId?: string;
      periodType: InsightPeriodType;
      snapshotDate?: string;
      contentType: InsightContentScope;
    },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{ status: 'ok'; insights: AdminInsightsResponseView }>(
      `/admin/insights${buildQuery(query)}`,
      { method: 'GET', fetchImpl }
    );
  },

  // School Student -> Guardian Link Invitations
  listStudentGuardianInvitations(
    orgId: string,
    membershipId: string,
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{ status: 'ok'; invitations: SafeInvitationStatusView[] }>(
      `/admin/organizations/${encodeURIComponent(orgId)}/students/${encodeURIComponent(membershipId)}/guardian-invitations`,
      { method: 'GET', fetchImpl }
    );
  },

  createStudentGuardianInvitation(
    orgId: string,
    membershipId: string,
    body: { expiresInHours?: number } = {},
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{
      status: 'ok';
      invitation: SafeInvitationStatusView;
      claimCode: string;
    }>(
      `/admin/organizations/${encodeURIComponent(orgId)}/students/${encodeURIComponent(membershipId)}/guardian-invitations`,
      { method: 'POST', body, fetchImpl }
    );
  },

  revokeStudentGuardianInvitation(
    orgId: string,
    invitationId: string,
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{
      status: 'ok';
      invitation: { id: string; status: 'revoked'; revokedAt: string };
    }>(
      `/admin/organizations/${encodeURIComponent(orgId)}/guardian-invitations/${encodeURIComponent(invitationId)}/revoke`,
      { method: 'POST', body: {}, fetchImpl }
    );
  },

  // Family Curriculum & Program Enrollments (P4-02)
  listFamilyPrograms(fetchImpl?: typeof fetch) {
    return apiRequest<{ status: 'ok'; programs: SafeAdminProgramSummaryView[] }>(
      '/admin/family-programs',
      { method: 'GET', fetchImpl }
    );
  },

  getFamilyProgramDetail(programId: string, fetchImpl?: typeof fetch) {
    return apiRequest<{ status: 'ok' } & SafeAdminProgramDetailResponse>(
      `/admin/family-programs/${encodeURIComponent(programId)}`,
      { method: 'GET', fetchImpl }
    );
  },

  createFamilyProgram(
    body: {
      slug: string;
      availabilityMode?: FamilyProgramAvailabilityMode;
      title: string;
      description?: string | null;
      locale?: 'vi' | 'vi-VN' | 'en' | 'en-US';
      ageBand?: string | null;
      items: Array<{
        chapterNumber: number;
        chapterTitle: string;
        contentVersionId: string;
      }>;
    },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{ status: 'ok' } & SafeAdminProgramDetailResponse>(
      '/admin/family-programs',
      { method: 'POST', body, fetchImpl }
    );
  },

  createFamilyProgramVersion(
    programId: string,
    body: {
      availabilityMode?: FamilyProgramAvailabilityMode;
      title: string;
      description?: string | null;
      locale?: 'vi' | 'vi-VN' | 'en' | 'en-US';
      ageBand?: string | null;
      items: Array<{
        chapterNumber: number;
        chapterTitle: string;
        contentVersionId: string;
      }>;
    },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<
      { status: 'ok'; createdVersionId: string } & SafeAdminProgramDetailResponse
    >(
      `/admin/family-programs/${encodeURIComponent(programId)}/versions`,
      { method: 'POST', body, fetchImpl }
    );
  },

  updateDraftFamilyProgramVersion(
    programId: string,
    versionId: string,
    body: {
      availabilityMode?: FamilyProgramAvailabilityMode;
      title: string;
      description?: string | null;
      locale?: 'vi' | 'vi-VN' | 'en' | 'en-US';
      ageBand?: string | null;
      items: Array<{
        chapterNumber: number;
        chapterTitle: string;
        contentVersionId: string;
      }>;
    },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{ status: 'ok' } & SafeAdminProgramDetailResponse>(
      `/admin/family-programs/${encodeURIComponent(programId)}/versions/${encodeURIComponent(versionId)}`,
      { method: 'PATCH', body, fetchImpl }
    );
  },

  publishFamilyProgramVersion(
    programId: string,
    versionId: string,
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{ status: 'ok' } & SafeAdminProgramDetailResponse>(
      `/admin/family-programs/${encodeURIComponent(programId)}/versions/${encodeURIComponent(versionId)}/publish`,
      { method: 'POST', body: {}, fetchImpl }
    );
  },

  retireFamilyProgram(programId: string, fetchImpl?: typeof fetch) {
    return apiRequest<{ status: 'ok' } & SafeAdminProgramDetailResponse>(
      `/admin/family-programs/${encodeURIComponent(programId)}/retire`,
      { method: 'POST', body: {}, fetchImpl }
    );
  },

  listEligibleFamilyWorkspaces(search?: string, fetchImpl?: typeof fetch) {
    return apiRequest<{
      status: 'ok';
      workspaces: AdminFamilyWorkspaceCandidate[];
    }>(`/admin/family-workspaces${buildQuery({ search })}`, {
      method: 'GET',
      fetchImpl,
    });
  },

  enrollStudentInFamilyProgram(
    programId: string,
    body: {
      familyWorkspaceId: string;
      studentUserId: string;
      programVersionId?: string;
    },
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{
      status: 'ok';
      enrollment: {
        enrollmentId: string;
        familyWorkspaceId: string;
        studentUserId: string;
        familyProgramId: string;
        familyProgramVersionId: string;
        versionNumber: number;
        activationSource: string;
        status: string;
        activatedAt: string;
      };
    }>(`/admin/family-programs/${encodeURIComponent(programId)}/enrollments`, {
      method: 'POST',
      body,
      fetchImpl,
    });
  },

  revokeFamilyProgramEnrollment(
    enrollmentId: string,
    fetchImpl?: typeof fetch
  ) {
    return apiRequest<{
      status: 'ok';
      enrollment: {
        enrollmentId: string;
        status: 'revoked';
        revokedAt: string;
      };
    }>(
      `/admin/family-enrollments/${encodeURIComponent(enrollmentId)}/revoke`,
      { method: 'POST', body: {}, fetchImpl }
    );
  },
};
