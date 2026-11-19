export type MvpRole = 'platform_admin' | 'teacher' | 'student' | 'guardian';
export type OrgRole = 'teacher' | 'student';
export type SessionScope = 'platform_admin' | 'teacher' | 'student' | 'guardian';

export interface SafeUserView {
  id: string;
  displayName: string;
  email: string | null;
  platformUsername: string | null;
  platformRole: 'platform_admin' | 'guardian' | null;
  emailVerified?: boolean;
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
  requiresEmailVerification?: boolean;
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
    }
  | {
      mode: 'guardian';
      email: string;
      password: string;
    };

export interface GuardianRegisterRequest {
  displayName: string;
  email: string;
  password: string;
}

export interface MailDeliveryStatus {
  configured: false;
  provider: null;
  delivered: false;
  verificationState: 'pending_verification';
}

export interface GuardianRegisterResponse {
  status: 'ok';
  user: SafeUserView;
  requiresEmailVerification: true;
  mailDelivery: MailDeliveryStatus;
}

export interface VerifyGuardianEmailRequest {
  token: string;
}

export interface VerifyGuardianEmailResponse {
  status: 'ok';
  verified: boolean;
  userId: string;
  emailVerifiedAt: string;
}

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
