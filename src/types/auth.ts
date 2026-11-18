export type MvpRole = 'platform_admin' | 'teacher' | 'student';
export type OrgRole = 'teacher' | 'student';
export type SessionScope = 'platform_admin' | 'teacher' | 'student';

export interface SafeUserView {
  id: string;
  displayName: string;
  email: string | null;
  platformUsername: string | null;
  platformRole: 'platform_admin' | null;
}

export interface SafeOrganizationChoice {
  organizationId: string;
  code: string;
  name: string;
  membershipId: string;
  role: OrgRole;
}

export interface AuthSessionSummary {
  id: string;
  scope: SessionScope;
  activeOrganizationId: string | null;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}

export interface AuthContextPayload {
  user: SafeUserView;
  session: AuthSessionSummary;
  activeOrganization: SafeOrganizationChoice | null;
  organizations: SafeOrganizationChoice[];
  requiresOrganizationSelection: boolean;
  csrfToken: string;
}

export type LoginRequest =
  | {
      mode: 'admin_teacher';
      identifier: string;
      password: string;
    }
  | {
      mode: 'student';
      organizationCode: string;
      orgUsername: string;
      password: string;
    };

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface ApiErrorDetail {
  field: string;
  code: string;
  messageKey: string;
  message: string;
}

export interface ApiErrorEnvelope {
  status: 'error';
  code: string;
  messageKey: string;
  message: string;
  locale: string;
  details?: ApiErrorDetail[];
  requestId?: string;
}

export interface ApiErrorInfo {
  httpStatus: number;
  code: string;
  messageKey: string;
  message: string;
  locale: string;
  details?: ApiErrorDetail[];
  requestId?: string;
  isForbiddenProxyHtml?: boolean;
  isNetworkError?: boolean;
}
