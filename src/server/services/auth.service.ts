import { getServerConfig, type ServerConfig } from '../config/env.ts';
import type { OrgRole, SessionScope } from '../db/schema/_shared.ts';
import { generateUuidV7 } from '../db/uuid.ts';
import { ApiErrors, AppError } from '../http/errors.ts';
import {
  createAuthRepository,
  type AuthCredentialUserRecord,
  type AuthMembershipSummary,
  type AuthRepository,
  type DbOrTx,
} from '../repositories/auth.repository.ts';
import { deriveSessionCsrfToken } from '../security/csrf.ts';
import {
  hashPassword,
  validatePasswordInput,
  verifyPassword,
} from '../security/password-hash.ts';
import { InMemoryRateLimiter, RateLimitExceededError } from '../security/rate-limit.ts';
import { ScryptConcurrencyLimiter } from '../security/scrypt-limiter.ts';
import {
  computeInitialSessionExpirations,
  computeRefreshedIdleExpiration,
  computeRemainingSessionMs,
  generateSessionToken,
  hashSessionToken,
} from '../security/session.ts';
import {
  recordAuditEvent,
  type AuditActorRole,
  type AuditInsertExecutor,
} from './audit.service.ts';

/**
 * Valid dummy scrypt$v1$ hash used solely to equalize password-verification timing
 * when a login identifier does not exist, preventing user enumeration via response latency.
 */
const DUMMY_SCRYPT_HASH =
  'scrypt$v1$N=65536,r=8,p=2,dkLen=32$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const GUARDIAN_EMAIL_VERIFY_PURPOSE = 'guardian_email_verify' as const;
const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_GUARDIAN_PASSWORD_LENGTH = 8;

export type LoginInput =
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

export interface LoginRequestContext {
  ip?: string;
  ipPrefix: string | null;
  userAgentHash: string | null;
}

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

export interface AuthContextPayload {
  user: SafeUserView;
  session: {
    id: string;
    scope: SessionScope;
    activeOrganizationId: string | null;
    idleExpiresAt: string;
    absoluteExpiresAt: string;
  };
  activeOrganization: SafeOrganizationChoice | null;
  organizations: SafeOrganizationChoice[];
  requiresOrganizationSelection: boolean;
  requiresEmailVerification?: boolean;
  csrfToken: string;
}

export interface AuthSessionResult {
  payload: AuthContextPayload;
  rawSessionToken: string;
  cookieMaxAgeMs: number;
}

export interface AuthenticatedPrincipal {
  userId: string;
  platformRole: 'platform_admin' | 'guardian' | null;
  emailVerified?: boolean;
  hasFamilyContext?: boolean;
  activeOrganizationId: string | null;
  organizationMembershipId: string | null;
  organizationRole: OrgRole | null;
  sessionId: string;
  sessionScope: SessionScope;
  displayName: string;
  email: string | null;
  platformUsername: string | null;
}

export interface MailDeliveryStatus {
  configured: false;
  provider: null;
  delivered: false;
  verificationState: 'pending_verification';
}

export interface GuardianRegistrationResult {
  user: SafeUserView;
  requiresEmailVerification: true;
  mailDelivery: MailDeliveryStatus;
}

function invalidCredentialsError(): AppError {
  return new AppError({
    httpStatus: 401,
    code: 'INVALID_CREDENTIALS',
    messageKey: 'error.auth.invalid_credentials',
    message: 'Thông tin đăng nhập không chính xác hoặc tài khoản không khả dụng.',
  });
}

function isUserActiveAndUnlocked(user: AuthCredentialUserRecord, now: Date): boolean {
  if (user.status !== 'active') {
    return false;
  }
  if (user.lockedUntil !== null && user.lockedUntil > now) {
    return false;
  }
  return true;
}

function toSafeOrganizationChoice(m: AuthMembershipSummary): SafeOrganizationChoice | null {
  if (m.role !== 'teacher' && m.role !== 'student') {
    return null;
  }
  return {
    organizationId: m.organizationId,
    code: m.organizationCode,
    name: m.organizationName,
    membershipId: m.membershipId,
    role: m.role,
  };
}

function resolveAuditActorRole(principal: AuthenticatedPrincipal): AuditActorRole {
  if (principal.platformRole === 'platform_admin') {
    return 'platform_admin';
  }
  if (principal.platformRole === 'guardian' || principal.sessionScope === 'guardian') {
    return 'guardian';
  }
  if (principal.organizationRole === 'teacher' || principal.sessionScope === 'teacher') {
    return 'teacher';
  }
  return 'student';
}

function buildUnsupportedStorageError(): AppError {
  return new AppError({
    httpStatus: 500,
    code: 'AUTH_STORAGE_NOT_CONFIGURED',
    messageKey: 'error.auth.storage_not_configured',
    message: 'Bộ lưu trữ xác thực người giám hộ chưa được cấu hình đầy đủ.',
    expose: false,
  });
}

export interface AuthServiceDeps {
  repo?: AuthRepository;
  rateLimiter?: InMemoryRateLimiter;
  scryptLimiter?: ScryptConcurrencyLimiter;
  getConfig?: () => ServerConfig;
  now?: () => Date;
  auditFn?: (
    input: Parameters<typeof recordAuditEvent>[0],
    executor?: AuditInsertExecutor
  ) => Promise<unknown>;
  verifyPasswordFn?: typeof verifyPassword;
  hashPasswordFn?: typeof hashPassword;
  onVerificationTokenCreatedForTest?: (info: {
    userId: string;
    rawToken: string;
    tokenHash: string;
  }) => void;
}

export function createAuthService(deps?: AuthServiceDeps) {
  const repo = deps?.repo ?? createAuthRepository();
  const rateLimiter = deps?.rateLimiter ?? new InMemoryRateLimiter();
  const getConfig = deps?.getConfig ?? getServerConfig;
  const scryptLimiter =
    deps?.scryptLimiter ??
    new ScryptConcurrencyLimiter({
      maxConcurrent: getConfig().auth.scryptMaxConcurrent,
      maxQueue: getConfig().auth.scryptMaxQueue,
    });
  const nowFn = deps?.now ?? (() => new Date());
  const emitAudit = deps?.auditFn ?? recordAuditEvent;
  const verifyPwd = deps?.verifyPasswordFn ?? verifyPassword;
  const hashPwd = deps?.hashPasswordFn ?? hashPassword;

  async function safeAudit(
    input: Parameters<typeof recordAuditEvent>[0],
    executor?: DbOrTx
  ): Promise<void> {
    await emitAudit(input, executor as AuditInsertExecutor | undefined);
  }

  async function enforcePreAuthRateLimit(
    ip: string | undefined,
    identifierKey: string,
    ipPrefix: string | null,
    targetType: string = 'auth_login'
  ): Promise<void> {
    const config = getConfig();
    const nowMs = nowFn().getTime();

    const ipCheck = rateLimiter.consume(
      'auth_ip',
      ip?.trim() || 'unknown',
      config.auth.rateLimitIpMax,
      config.auth.rateLimitWindowMs,
      nowMs
    );
    if (!ipCheck.allowed) {
      await safeAudit({
        eventType: 'security.rate_limit_triggered',
        targetType,
        ipPrefix,
        metadata: { bucket: 'ip' },
      }).catch(() => undefined);
      throw new RateLimitExceededError(ipCheck.retryAfterSeconds);
    }

    const idCheck = rateLimiter.consume(
      'auth_id',
      identifierKey,
      config.auth.rateLimitIdentifierMax,
      config.auth.rateLimitWindowMs,
      nowMs
    );
    if (!idCheck.allowed) {
      await safeAudit({
        eventType: 'security.rate_limit_triggered',
        targetType,
        ipPrefix,
        metadata: { bucket: 'identifier' },
      }).catch(() => undefined);
      throw new RateLimitExceededError(idCheck.retryAfterSeconds);
    }
  }

  function getLockoutPolicy(config: ServerConfig) {
    if (
      config.auth.lockoutMaxFailedAttempts !== undefined &&
      config.auth.lockoutDurationMinutes !== undefined
    ) {
      return {
        maxFailedAttempts: config.auth.lockoutMaxFailedAttempts,
        lockoutDurationMinutes: config.auth.lockoutDurationMinutes,
      };
    }
    return undefined;
  }

  async function recordFailedAttemptAuditAndState(
    user: AuthCredentialUserRecord | null,
    mode: LoginInput['mode'],
    reason: string,
    ctx: LoginRequestContext,
    organizationId: string | null = null
  ): Promise<void> {
    const now = nowFn();
    const config = getConfig();
    const lockoutPolicy = getLockoutPolicy(config);
    const failedActorRole: AuditActorRole | null =
      user?.platformRole === 'platform_admin'
        ? 'platform_admin'
        : user?.platformRole === 'guardian'
          ? 'guardian'
          : null;

    if (user) {
      const outcome = await repo.recordFailedLoginAttempt(user.id, now, lockoutPolicy);
      if (outcome.lockedNow) {
        await safeAudit({
          organizationId,
          actorUserId: user.id,
          actorRole: failedActorRole,
          eventType: 'auth.account_locked',
          targetType: 'user',
          targetId: user.id,
          ipPrefix: ctx.ipPrefix,
          metadata: {
            reason: 'failed_login_threshold',
            mode,
          },
        }).catch(() => undefined);
      }
    }

    await safeAudit({
      organizationId,
      actorUserId: user?.id ?? null,
      actorRole: failedActorRole,
      eventType: 'auth.login_failed',
      targetType: 'user',
      targetId: user?.id ?? null,
      ipPrefix: ctx.ipPrefix,
      metadata: {
        mode,
        reason,
      },
    }).catch(() => undefined);
  }

  return {
    scryptLimiter,
    rateLimiter,

    async registerGuardian(
      input: {
        displayName: string;
        email: string;
        password: string;
      },
      ctx: LoginRequestContext
    ): Promise<GuardianRegistrationResult> {
      const normalizedDisplayName = input.displayName.trim();
      const normalizedEmail = input.email.trim().toLowerCase();

      if (!normalizedDisplayName || normalizedDisplayName.length > 255) {
        throw ApiErrors.validation([
          {
            field: 'body.displayName',
            code: 'INVALID_DISPLAY_NAME',
            messageKey: 'error.account.invalid_display_name',
            message: 'Tên hiển thị phải từ 1 đến 255 ký tự.',
          },
        ]);
      }

      if (
        !normalizedEmail ||
        normalizedEmail.length > 255 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
      ) {
        throw ApiErrors.validation([
          {
            field: 'body.email',
            code: 'INVALID_EMAIL',
            messageKey: 'error.account.invalid_email',
            message: 'Địa chỉ email không hợp lệ.',
          },
        ]);
      }

      if (input.password.length < MIN_GUARDIAN_PASSWORD_LENGTH) {
        throw ApiErrors.validation([
          {
            field: 'body.password',
            code: 'PASSWORD_TOO_SHORT',
            messageKey: 'error.account.password_too_short',
            message: `Mật khẩu phải có ít nhất ${MIN_GUARDIAN_PASSWORD_LENGTH} ký tự.`,
          },
        ]);
      }

      try {
        validatePasswordInput(input.password);
      } catch {
        throw ApiErrors.validation([
          {
            field: 'body.password',
            code: 'INVALID_PASSWORD_LENGTH',
            messageKey: 'error.account.invalid_password',
            message: 'Mật khẩu không hợp lệ hoặc vượt quá độ dài cho phép.',
          },
        ]);
      }

      await enforcePreAuthRateLimit(
        ctx.ip,
        `guardian_register:${normalizedEmail}`,
        ctx.ipPrefix,
        'guardian_register'
      );

      if (
        !repo.createGuardianUser ||
        !repo.createEmailVerificationToken
      ) {
        throw buildUnsupportedStorageError();
      }

      const existing = await repo.findUserCredentialByEmail(normalizedEmail);
      if (existing) {
        throw ApiErrors.conflict(
          'EMAIL_ALREADY_EXISTS',
          'error.account.email_exists',
          'Địa chỉ email này đã được đăng ký tài khoản trên hệ thống.'
        );
      }

      const now = nowFn();
      const passwordHash = await scryptLimiter.run(() => hashPwd(input.password));
      const userId = generateUuidV7();
      const rawToken = generateSessionToken();
      const tokenHash = hashSessionToken(rawToken);
      const tokenId = generateUuidV7();
      const expiresAt = new Date(now.getTime() + EMAIL_VERIFY_TTL_MS);

      const createdUser = await repo.withTransaction(async (tx) => {
        const user = await repo.createGuardianUser!(
          {
            id: userId,
            email: normalizedEmail,
            displayName: normalizedDisplayName,
            passwordHash,
            now,
          },
          tx
        );

        await repo.createEmailVerificationToken!(
          {
            id: tokenId,
            userId,
            purpose: GUARDIAN_EMAIL_VERIFY_PURPOSE,
            emailSnapshot: normalizedEmail,
            tokenHash,
            expiresAt,
            createdAt: now,
          },
          tx
        );

        await safeAudit(
          {
            organizationId: null,
            actorUserId: userId,
            actorRole: 'guardian',
            eventType: 'guardian.registered',
            targetType: 'user',
            targetId: userId,
            ipPrefix: ctx.ipPrefix,
            metadata: {
              verificationState: 'pending_verification',
              mailDeliveryConfigured: false,
            },
          },
          tx
        );

        return user;
      });

      deps?.onVerificationTokenCreatedForTest?.({
        userId: createdUser.id,
        rawToken,
        tokenHash,
      });

      return {
        user: {
          id: createdUser.id,
          displayName: createdUser.displayName,
          email: createdUser.email,
          platformUsername: null,
          platformRole: 'guardian',
          emailVerified: false,
        },
        requiresEmailVerification: true,
        mailDelivery: {
          configured: false,
          provider: null,
          delivered: false,
          verificationState: 'pending_verification',
        },
      };
    },

    async verifyGuardianEmail(
      input: { token: string },
      ctx: LoginRequestContext
    ): Promise<{ verified: true; emailVerifiedAt: string }> {
      const trimmedToken = input.token.trim();
      await enforcePreAuthRateLimit(
        ctx.ip,
        'guardian_verify_email',
        ctx.ipPrefix,
        'guardian_verify_email'
      );

      if (trimmedToken.length < 8 || trimmedToken.length > 512) {
        throw ApiErrors.validation([
          {
            field: 'body.token',
            code: 'INVALID_VERIFICATION_TOKEN',
            messageKey: 'error.auth.invalid_verification_token',
            message: 'Mã xác minh email không hợp lệ.',
          },
        ]);
      }

      if (!repo.findVerificationTokenByHash || !repo.consumeVerificationTokenAndVerifyUser) {
        throw buildUnsupportedStorageError();
      }

      const now = nowFn();
      const tokenHash = hashSessionToken(trimmedToken);
      const tokenRecord = await repo.findVerificationTokenByHash(tokenHash);

      if (
        !tokenRecord ||
        tokenRecord.purpose !== GUARDIAN_EMAIL_VERIFY_PURPOSE ||
        tokenRecord.revokedAt !== null
      ) {
        throw new AppError({
          httpStatus: 400,
          code: 'INVALID_VERIFICATION_TOKEN',
          messageKey: 'error.auth.invalid_verification_token',
          message: 'Mã xác minh email không hợp lệ hoặc đã bị thu hồi.',
        });
      }

      if (tokenRecord.consumedAt !== null) {
        throw ApiErrors.conflict(
          'VERIFICATION_TOKEN_ALREADY_USED',
          'error.auth.verification_token_used',
          'Mã xác minh email này đã được sử dụng trước đó.'
        );
      }

      if (tokenRecord.expiresAt <= now) {
        throw new AppError({
          httpStatus: 400,
          code: 'VERIFICATION_TOKEN_EXPIRED',
          messageKey: 'error.auth.verification_token_expired',
          message: 'Mã xác minh email đã hết hạn. Vui lòng yêu cầu gửi lại mã mới.',
        });
      }

      const user = await repo.findUserCredentialById(tokenRecord.userId);
      if (
        !user ||
        user.platformRole !== 'guardian' ||
        !isUserActiveAndUnlocked(user, now)
      ) {
        throw new AppError({
          httpStatus: 400,
          code: 'INVALID_VERIFICATION_TOKEN',
          messageKey: 'error.auth.invalid_verification_token',
          message: 'Tài khoản người giám hộ không khả dụng để xác minh.',
        });
      }

      await repo.withTransaction(async (tx) => {
        const consumed = await repo.consumeVerificationTokenAndVerifyUser!(
          {
            tokenId: tokenRecord.id,
            userId: user.id,
            now,
          },
          tx
        );

        if (!consumed) {
          throw ApiErrors.conflict(
            'VERIFICATION_TOKEN_ALREADY_USED',
            'error.auth.verification_token_used',
            'Mã xác minh email không còn hợp lệ hoặc đã được sử dụng.'
          );
        }

        await safeAudit(
          {
            organizationId: null,
            actorUserId: user.id,
            actorRole: 'guardian',
            eventType: 'guardian.email_verified',
            targetType: 'user',
            targetId: user.id,
            ipPrefix: ctx.ipPrefix,
            metadata: {
              verificationMethod: 'email_token',
            },
          },
          tx
        );
      });

      return {
        verified: true,
        emailVerifiedAt: now.toISOString(),
      };
    },

    async resendGuardianVerification(
      principal: AuthenticatedPrincipal,
      ctx: { ip?: string; ipPrefix: string | null }
    ): Promise<{ mailDelivery: MailDeliveryStatus }> {
      if (principal.platformRole !== 'guardian' || principal.sessionScope !== 'guardian') {
        throw ApiErrors.forbidden('Chỉ tài khoản người giám hộ mới có thể yêu cầu xác minh email.');
      }

      await enforcePreAuthRateLimit(
        ctx.ip,
        `guardian_resend:${principal.userId}`,
        ctx.ipPrefix,
        'guardian_resend_verification'
      );

      if (
        !repo.revokeActiveVerificationTokensForUser ||
        !repo.createEmailVerificationToken
      ) {
        throw buildUnsupportedStorageError();
      }

      const user = await repo.findUserCredentialById(principal.userId);
      const now = nowFn();
      if (!user || !isUserActiveAndUnlocked(user, now) || !user.email) {
        throw ApiErrors.unauthorized();
      }

      if (user.emailVerifiedAt !== null && user.emailVerifiedAt !== undefined) {
        throw ApiErrors.conflict(
          'EMAIL_ALREADY_VERIFIED',
          'error.auth.email_already_verified',
          'Địa chỉ email người giám hộ đã được xác minh.'
        );
      }

      const rawToken = generateSessionToken();
      const tokenHash = hashSessionToken(rawToken);
      const tokenId = generateUuidV7();
      const expiresAt = new Date(now.getTime() + EMAIL_VERIFY_TTL_MS);

      await repo.withTransaction(async (tx) => {
        await repo.revokeActiveVerificationTokensForUser!(
          user.id,
          GUARDIAN_EMAIL_VERIFY_PURPOSE,
          now,
          tx
        );

        await repo.createEmailVerificationToken!(
          {
            id: tokenId,
            userId: user.id,
            purpose: GUARDIAN_EMAIL_VERIFY_PURPOSE,
            emailSnapshot: user.email!,
            tokenHash,
            expiresAt,
            createdAt: now,
          },
          tx
        );

        await safeAudit(
          {
            organizationId: null,
            actorUserId: user.id,
            actorRole: 'guardian',
            eventType: 'guardian.verification_requested',
            targetType: 'user',
            targetId: user.id,
            ipPrefix: ctx.ipPrefix,
            metadata: {
              mailDeliveryConfigured: false,
            },
          },
          tx
        );
      });

      deps?.onVerificationTokenCreatedForTest?.({
        userId: user.id,
        rawToken,
        tokenHash,
      });

      return {
        mailDelivery: {
          configured: false,
          provider: null,
          delivered: false,
          verificationState: 'pending_verification',
        },
      };
    },

    async login(
      input: LoginInput,
      ctx: LoginRequestContext
    ): Promise<AuthSessionResult> {
      const config = getConfig();
      const now = nowFn();

      if (input.mode === 'admin_teacher') {
        const trimmedIdentifier = input.identifier.trim().toLowerCase();
        const isEmail = trimmedIdentifier.includes('@');

        await enforcePreAuthRateLimit(
          ctx.ip,
          `admin_teacher:${isEmail ? 'email' : 'username'}:${trimmedIdentifier}`,
          ctx.ipPrefix
        );

        const user = isEmail
          ? await repo.findUserCredentialByEmail(trimmedIdentifier)
          : await repo.findUserCredentialByPlatformUsername(trimmedIdentifier);

        const candidateHash = user?.passwordHash ?? DUMMY_SCRYPT_HASH;
        const passwordValid = await scryptLimiter.run(() =>
          verifyPwd(input.password, candidateHash)
        );

        if (!user || !passwordValid) {
          await recordFailedAttemptAuditAndState(
            user,
            'admin_teacher',
            user ? 'invalid_password' : 'account_not_found',
            ctx
          );
          throw invalidCredentialsError();
        }

        if (!isUserActiveAndUnlocked(user, now)) {
          await recordFailedAttemptAuditAndState(
            user,
            'admin_teacher',
            'account_inactive_or_locked',
            ctx
          );
          throw invalidCredentialsError();
        }

        // Reject unsupported platform roles including 'guardian' on school/admin login
        if (user.platformRole !== null && user.platformRole !== 'platform_admin') {
          await recordFailedAttemptAuditAndState(
            user,
            'admin_teacher',
            'unsupported_platform_role',
            ctx
          );
          throw invalidCredentialsError();
        }

        let sessionScope: SessionScope;
        let activeOrg: SafeOrganizationChoice | null = null;
        let orgChoices: SafeOrganizationChoice[] = [];

        if (user.platformRole === 'platform_admin') {
          sessionScope = 'platform_admin';
        } else {
          const allMemberships = await repo.findMembershipsForUser(user.id, 'teacher');
          const eligibleMemberships = allMemberships.filter(
            (m) =>
              m.role === 'teacher' &&
              m.membershipStatus === 'active' &&
              m.organizationStatus === 'active'
          );

          if (eligibleMemberships.length === 0) {
            await recordFailedAttemptAuditAndState(
              user,
              'admin_teacher',
              'no_active_teacher_membership',
              ctx
            );
            throw invalidCredentialsError();
          }

          sessionScope = 'teacher';
          orgChoices = eligibleMemberships
            .map(toSafeOrganizationChoice)
            .filter((item): item is SafeOrganizationChoice => item !== null);

          if (orgChoices.length === 1) {
            activeOrg = orgChoices[0];
          }
        }

        const rawToken = generateSessionToken();
        const tokenHash = hashSessionToken(rawToken);
        const sessionId = generateUuidV7();
        const { idleExpiresAt, absoluteExpiresAt } = computeInitialSessionExpirations(
          sessionScope,
          now
        );

        await repo.withTransaction(async (tx) => {
          await repo.recordSuccessfulLoginState(user.id, now, tx);
          await repo.createSession(
            {
              id: sessionId,
              tokenHash,
              userId: user.id,
              sessionScope,
              activeOrganizationId: activeOrg?.organizationId ?? null,
              idleExpiresAt,
              absoluteExpiresAt,
              lastActivityAt: now,
              ipPrefix: ctx.ipPrefix,
              userAgentHash: ctx.userAgentHash,
              createdAt: now,
            },
            tx
          );
          await safeAudit(
            {
              organizationId: activeOrg?.organizationId ?? null,
              actorUserId: user.id,
              actorRole: sessionScope,
              eventType: 'auth.login_succeeded',
              targetType: 'session',
              targetId: sessionId,
              ipPrefix: ctx.ipPrefix,
              metadata: {
                mode: 'admin_teacher',
                requiresOrganizationSelection:
                  sessionScope === 'teacher' && activeOrg === null,
              },
            },
            tx
          );
        });

        const csrfToken = deriveSessionCsrfToken(
          rawToken,
          sessionId,
          config.auth.csrfSecret
        );

        return {
          rawSessionToken: rawToken,
          cookieMaxAgeMs: computeRemainingSessionMs(idleExpiresAt, absoluteExpiresAt, now),
          payload: {
            user: {
              id: user.id,
              displayName: user.displayName,
              email: user.email,
              platformUsername: user.platformUsername,
              platformRole:
                user.platformRole === 'platform_admin' ? 'platform_admin' : null,
              emailVerified: Boolean(user.emailVerifiedAt),
            },
            session: {
              id: sessionId,
              scope: sessionScope,
              activeOrganizationId: activeOrg?.organizationId ?? null,
              idleExpiresAt: idleExpiresAt.toISOString(),
              absoluteExpiresAt: absoluteExpiresAt.toISOString(),
            },
            activeOrganization: activeOrg,
            organizations: orgChoices,
            requiresOrganizationSelection:
              sessionScope === 'teacher' && activeOrg === null,
            requiresEmailVerification: false,
            csrfToken,
          },
        };
      }

      if (input.mode === 'guardian') {
        const normalizedEmail = input.email.trim().toLowerCase();

        await enforcePreAuthRateLimit(
          ctx.ip,
          `guardian:${normalizedEmail}`,
          ctx.ipPrefix
        );

        const user = await repo.findUserCredentialByEmail(normalizedEmail);
        const candidateHash = user?.passwordHash ?? DUMMY_SCRYPT_HASH;
        const passwordValid = await scryptLimiter.run(() =>
          verifyPwd(input.password, candidateHash)
        );

        if (!user || !passwordValid) {
          await recordFailedAttemptAuditAndState(
            user,
            'guardian',
            user ? 'invalid_password' : 'account_not_found',
            ctx
          );
          throw invalidCredentialsError();
        }

        if (!isUserActiveAndUnlocked(user, now) || user.platformRole !== 'guardian') {
          await recordFailedAttemptAuditAndState(
            user,
            'guardian',
            user.platformRole !== 'guardian'
              ? 'not_guardian_account'
              : 'account_inactive_or_locked',
            ctx
          );
          throw invalidCredentialsError();
        }

        const rawToken = generateSessionToken();
        const tokenHash = hashSessionToken(rawToken);
        const sessionId = generateUuidV7();
        const { idleExpiresAt, absoluteExpiresAt } = computeInitialSessionExpirations(
          'guardian',
          now
        );

        await repo.withTransaction(async (tx) => {
          await repo.recordSuccessfulLoginState(user.id, now, tx);
          await repo.createSession(
            {
              id: sessionId,
              tokenHash,
              userId: user.id,
              sessionScope: 'guardian',
              activeOrganizationId: null,
              idleExpiresAt,
              absoluteExpiresAt,
              lastActivityAt: now,
              ipPrefix: ctx.ipPrefix,
              userAgentHash: ctx.userAgentHash,
              createdAt: now,
            },
            tx
          );
          await safeAudit(
            {
              organizationId: null,
              actorUserId: user.id,
              actorRole: 'guardian',
              eventType: 'auth.login_succeeded',
              targetType: 'session',
              targetId: sessionId,
              ipPrefix: ctx.ipPrefix,
              metadata: {
                mode: 'guardian',
                emailVerified: Boolean(user.emailVerifiedAt),
              },
            },
            tx
          );
        });

        const csrfToken = deriveSessionCsrfToken(
          rawToken,
          sessionId,
          config.auth.csrfSecret
        );
        const emailVerified = Boolean(user.emailVerifiedAt);

        return {
          rawSessionToken: rawToken,
          cookieMaxAgeMs: computeRemainingSessionMs(idleExpiresAt, absoluteExpiresAt, now),
          payload: {
            user: {
              id: user.id,
              displayName: user.displayName,
              email: user.email,
              platformUsername: user.platformUsername,
              platformRole: 'guardian',
              emailVerified,
            },
            session: {
              id: sessionId,
              scope: 'guardian',
              activeOrganizationId: null,
              idleExpiresAt: idleExpiresAt.toISOString(),
              absoluteExpiresAt: absoluteExpiresAt.toISOString(),
            },
            activeOrganization: null,
            organizations: [],
            requiresOrganizationSelection: false,
            requiresEmailVerification: !emailVerified,
            csrfToken,
          },
        };
      }

      // Mode 3: Email-less Student login (School Code OR Family Workspace Code + username + Password)
      const normalizedOrgCode = input.organizationCode.trim().toUpperCase();
      const normalizedOrgUsername = input.orgUsername.trim().toLowerCase();

      await enforcePreAuthRateLimit(
        ctx.ip,
        `student:${normalizedOrgCode}:${normalizedOrgUsername}`,
        ctx.ipPrefix
      );

      if (normalizedOrgUsername.includes('@')) {
        await scryptLimiter.run(() => verifyPwd(input.password, DUMMY_SCRYPT_HASH));
        await recordFailedAttemptAuditAndState(
          null,
          'student',
          'invalid_username_format',
          ctx
        );
        throw invalidCredentialsError();
      }

      const studentMatch = await repo.findStudentLoginRecord(
        normalizedOrgCode,
        normalizedOrgUsername
      );

      if (studentMatch) {
        const passwordValid = await scryptLimiter.run(() =>
          verifyPwd(input.password, studentMatch.user.passwordHash)
        );

        if (!passwordValid) {
          await recordFailedAttemptAuditAndState(
            studentMatch.user,
            'student',
            'invalid_password',
            ctx,
            studentMatch.membership.organizationId
          );
          throw invalidCredentialsError();
        }

        const { user, membership } = studentMatch;
        const eligible =
          isUserActiveAndUnlocked(user, now) &&
          user.platformRole === null &&
          membership.role === 'student' &&
          membership.membershipStatus === 'active' &&
          membership.organizationStatus === 'active';

        if (!eligible) {
          await recordFailedAttemptAuditAndState(
            user,
            'student',
            'ineligible_student_or_org_status',
            ctx,
            membership.organizationId
          );
          throw invalidCredentialsError();
        }

        const activeOrg: SafeOrganizationChoice = {
          organizationId: membership.organizationId,
          code: membership.organizationCode,
          name: membership.organizationName,
          membershipId: membership.membershipId,
          role: 'student',
        };

        const rawToken = generateSessionToken();
        const tokenHash = hashSessionToken(rawToken);
        const sessionId = generateUuidV7();
        const { idleExpiresAt, absoluteExpiresAt } = computeInitialSessionExpirations(
          'student',
          now
        );

        await repo.withTransaction(async (tx) => {
          await repo.recordSuccessfulLoginState(user.id, now, tx);
          await repo.createSession(
            {
              id: sessionId,
              tokenHash,
              userId: user.id,
              sessionScope: 'student',
              activeOrganizationId: membership.organizationId,
              idleExpiresAt,
              absoluteExpiresAt,
              lastActivityAt: now,
              ipPrefix: ctx.ipPrefix,
              userAgentHash: ctx.userAgentHash,
              createdAt: now,
            },
            tx
          );
          await safeAudit(
            {
              organizationId: membership.organizationId,
              actorUserId: user.id,
              actorRole: 'student',
              eventType: 'auth.login_succeeded',
              targetType: 'session',
              targetId: sessionId,
              ipPrefix: ctx.ipPrefix,
              metadata: { mode: 'student', context: 'school' },
            },
            tx
          );
        });

        const csrfToken = deriveSessionCsrfToken(
          rawToken,
          sessionId,
          config.auth.csrfSecret
        );

        return {
          rawSessionToken: rawToken,
          cookieMaxAgeMs: computeRemainingSessionMs(idleExpiresAt, absoluteExpiresAt, now),
          payload: {
            user: {
              id: user.id,
              displayName: user.displayName,
              email: user.email,
              platformUsername: user.platformUsername,
              platformRole: null,
              emailVerified: false,
            },
            session: {
              id: sessionId,
              scope: 'student',
              activeOrganizationId: membership.organizationId,
              idleExpiresAt: idleExpiresAt.toISOString(),
              absoluteExpiresAt: absoluteExpiresAt.toISOString(),
            },
            activeOrganization: activeOrg,
            organizations: [activeOrg],
            requiresOrganizationSelection: false,
            requiresEmailVerification: false,
            csrfToken,
          },
        };
      }

      // Fallback: check Family Workspace Student credentials (Family Code + familyUsername)
      const familyMatch = repo.findFamilyStudentLoginRecord
        ? await repo.findFamilyStudentLoginRecord(
            normalizedOrgCode,
            normalizedOrgUsername
          )
        : null;

      const candidateHash = familyMatch?.user.passwordHash ?? DUMMY_SCRYPT_HASH;
      const passwordValid = await scryptLimiter.run(() =>
        verifyPwd(input.password, candidateHash)
      );

      if (!familyMatch || !passwordValid) {
        await recordFailedAttemptAuditAndState(
          familyMatch?.user ?? null,
          'student',
          familyMatch ? 'invalid_password' : 'account_not_found',
          ctx,
          null
        );
        throw invalidCredentialsError();
      }

      const familyEligible =
        isUserActiveAndUnlocked(familyMatch.user, now) &&
        familyMatch.user.platformRole === null &&
        familyMatch.familyWorkspace.status === 'active' &&
        familyMatch.familyStudent.status === 'active' &&
        familyMatch.hasActiveGuardianLink;

      if (!familyEligible) {
        await recordFailedAttemptAuditAndState(
          familyMatch.user,
          'student',
          'ineligible_family_student',
          ctx,
          null
        );
        throw invalidCredentialsError();
      }

      const rawToken = generateSessionToken();
      const tokenHash = hashSessionToken(rawToken);
      const sessionId = generateUuidV7();
      const { idleExpiresAt, absoluteExpiresAt } = computeInitialSessionExpirations(
        'student',
        now
      );

      await repo.withTransaction(async (tx) => {
        await repo.recordSuccessfulLoginState(familyMatch.user.id, now, tx);
        await repo.createSession(
          {
            id: sessionId,
            tokenHash,
            userId: familyMatch.user.id,
            sessionScope: 'student',
            activeOrganizationId: null,
            idleExpiresAt,
            absoluteExpiresAt,
            lastActivityAt: now,
            ipPrefix: ctx.ipPrefix,
            userAgentHash: ctx.userAgentHash,
            createdAt: now,
          },
          tx
        );
        await safeAudit(
          {
            organizationId: null,
            actorUserId: familyMatch.user.id,
            actorRole: 'student',
            eventType: 'auth.login_succeeded',
            targetType: 'session',
            targetId: sessionId,
            ipPrefix: ctx.ipPrefix,
            metadata: {
              mode: 'student',
              context: 'family_workspace',
              familyWorkspaceId: familyMatch.familyWorkspace.id,
            },
          },
          tx
        );
      });

      const csrfToken = deriveSessionCsrfToken(
        rawToken,
        sessionId,
        config.auth.csrfSecret
      );

      return {
        rawSessionToken: rawToken,
        cookieMaxAgeMs: computeRemainingSessionMs(idleExpiresAt, absoluteExpiresAt, now),
        payload: {
          user: {
            id: familyMatch.user.id,
            displayName: familyMatch.user.displayName,
            email: familyMatch.user.email,
            platformUsername: familyMatch.user.platformUsername,
            platformRole: null,
            emailVerified: false,
          },
          session: {
            id: sessionId,
            scope: 'student',
            activeOrganizationId: null,
            idleExpiresAt: idleExpiresAt.toISOString(),
            absoluteExpiresAt: absoluteExpiresAt.toISOString(),
          },
          activeOrganization: null,
          organizations: [],
          requiresOrganizationSelection: false,
          requiresEmailVerification: false,
          csrfToken,
        },
      };
    },

    async getMe(
      principal: AuthenticatedPrincipal,
      rawSessionToken: string,
      sessionTiming: { idleExpiresAt: Date; absoluteExpiresAt: Date }
    ): Promise<AuthContextPayload> {
      const config = getConfig();
      let orgChoices: SafeOrganizationChoice[] = [];
      let activeOrg: SafeOrganizationChoice | null = null;

      if (principal.sessionScope === 'teacher' || principal.sessionScope === 'student') {
        const expectedRole: OrgRole =
          principal.sessionScope === 'teacher' ? 'teacher' : 'student';
        const memberships = await repo.findMembershipsForUser(
          principal.userId,
          expectedRole
        );
        orgChoices = memberships
          .filter(
            (m) =>
              m.role === expectedRole &&
              m.membershipStatus === 'active' &&
              m.organizationStatus === 'active'
          )
          .map(toSafeOrganizationChoice)
          .filter((item): item is SafeOrganizationChoice => item !== null);

        if (principal.activeOrganizationId) {
          activeOrg =
            orgChoices.find(
              (o) => o.organizationId === principal.activeOrganizationId
            ) ?? null;
        }
      }

      const isGuardian = principal.platformRole === 'guardian';
      const emailVerified = Boolean(principal.emailVerified);

      return {
        user: {
          id: principal.userId,
          displayName: principal.displayName,
          email: principal.email,
          platformUsername: principal.platformUsername,
          platformRole: principal.platformRole,
          emailVerified,
        },
        session: {
          id: principal.sessionId,
          scope: principal.sessionScope,
          activeOrganizationId: principal.activeOrganizationId,
          idleExpiresAt: sessionTiming.idleExpiresAt.toISOString(),
          absoluteExpiresAt: sessionTiming.absoluteExpiresAt.toISOString(),
        },
        activeOrganization: activeOrg,
        organizations: orgChoices,
        requiresOrganizationSelection:
          principal.sessionScope === 'teacher' &&
          principal.activeOrganizationId === null,
        requiresEmailVerification: isGuardian && !emailVerified,
        csrfToken: deriveSessionCsrfToken(
          rawSessionToken,
          principal.sessionId,
          config.auth.csrfSecret
        ),
      };
    },

    async logout(
      principal: AuthenticatedPrincipal,
      ctx: { ipPrefix: string | null }
    ): Promise<void> {
      const now = nowFn();
      const actorRole = resolveAuditActorRole(principal);

      await repo.withTransaction(async (tx) => {
        await repo.revokeSessionById(principal.sessionId, 'user_logout', now, tx);
        await safeAudit(
          {
            organizationId: principal.activeOrganizationId,
            actorUserId: principal.userId,
            actorRole,
            eventType: 'auth.logout',
            targetType: 'session',
            targetId: principal.sessionId,
            ipPrefix: ctx.ipPrefix,
          },
          tx
        );
      });
    },

    async switchOrganization(
      principal: AuthenticatedPrincipal,
      currentRawToken: string,
      sessionAbsoluteExpiresAt: Date,
      targetOrganizationId: string,
      ctx: { ipPrefix: string | null }
    ): Promise<AuthSessionResult> {
      if (principal.sessionScope !== 'teacher' || principal.platformRole !== null) {
        await safeAudit({
          organizationId: principal.activeOrganizationId,
          actorUserId: principal.userId,
          actorRole: resolveAuditActorRole(principal),
          eventType: 'security.unauthorized_access_denied',
          targetType: 'organization',
          targetId: targetOrganizationId,
          ipPrefix: ctx.ipPrefix,
          metadata: { reason: 'only_teacher_may_switch_org' },
        }).catch(() => undefined);
        throw new AppError({
          httpStatus: 403,
          code: 'FORBIDDEN',
          messageKey: 'error.auth.switch_org_forbidden',
          message: 'Chỉ tài khoản giáo viên mới được chuyển đổi trường học.',
        });
      }

      const config = getConfig();
      const now = nowFn();
      const expectedTokenHash = hashSessionToken(currentRawToken);
      const newRawToken = generateSessionToken();
      const newTokenHash = hashSessionToken(newRawToken);
      const nextIdleExpiresAt = computeRefreshedIdleExpiration(
        'teacher',
        sessionAbsoluteExpiresAt,
        now
      );

      const memberships = await repo.findMembershipsForUser(principal.userId, 'teacher');
      const eligibleChoices = memberships
        .filter(
          (m) =>
            m.role === 'teacher' &&
            m.membershipStatus === 'active' &&
            m.organizationStatus === 'active'
        )
        .map(toSafeOrganizationChoice)
        .filter((item): item is SafeOrganizationChoice => item !== null);

      const targetOrg = eligibleChoices.find(
        (m) => m.organizationId === targetOrganizationId
      );
      if (!targetOrg) {
        await safeAudit({
          organizationId: principal.activeOrganizationId,
          actorUserId: principal.userId,
          actorRole: 'teacher',
          eventType: 'security.cross_tenant_attempt_blocked',
          targetType: 'organization',
          targetId: targetOrganizationId,
          ipPrefix: ctx.ipPrefix,
          metadata: { reason: 'no_active_teacher_membership_in_target_org' },
        }).catch(() => undefined);
        throw new AppError({
          httpStatus: 403,
          code: 'FORBIDDEN_ORGANIZATION_ACCESS',
          messageKey: 'error.auth.organization_access_denied',
          message: 'Bạn không có quyền truy cập vào trường học được chọn.',
        });
      }

      await repo.withTransaction(async (tx) => {
        const rotated = await repo.rotateSession(
          {
            sessionId: principal.sessionId,
            expectedTokenHash,
            newTokenHash,
            newActiveOrganizationId: targetOrg.organizationId,
            newSessionScope: 'teacher',
            lastActivityAt: now,
            idleExpiresAt: nextIdleExpiresAt,
          },
          tx
        );

        if (!rotated) {
          throw new AppError({
            httpStatus: 401,
            code: 'UNAUTHORIZED',
            messageKey: 'error.auth.session_invalid',
            message: 'Phiên đăng nhập không còn hiệu lực. Vui lòng đăng nhập lại.',
          });
        }

        await safeAudit(
          {
            organizationId: targetOrg.organizationId,
            actorUserId: principal.userId,
            actorRole: 'teacher',
            eventType: 'auth.org_switched',
            targetType: 'organization',
            targetId: targetOrg.organizationId,
            ipPrefix: ctx.ipPrefix,
            metadata: {
              previousOrganizationId: principal.activeOrganizationId,
              sessionRotated: true,
            },
          },
          tx
        );
      });

      const csrfToken = deriveSessionCsrfToken(
        newRawToken,
        principal.sessionId,
        config.auth.csrfSecret
      );

      return {
        rawSessionToken: newRawToken,
        cookieMaxAgeMs: computeRemainingSessionMs(
          nextIdleExpiresAt,
          sessionAbsoluteExpiresAt,
          now
        ),
        payload: {
          user: {
            id: principal.userId,
            displayName: principal.displayName,
            email: principal.email,
            platformUsername: principal.platformUsername,
            platformRole: null,
            emailVerified: false,
          },
          session: {
            id: principal.sessionId,
            scope: 'teacher',
            activeOrganizationId: targetOrg.organizationId,
            idleExpiresAt: nextIdleExpiresAt.toISOString(),
            absoluteExpiresAt: sessionAbsoluteExpiresAt.toISOString(),
          },
          activeOrganization: targetOrg,
          organizations: eligibleChoices,
          requiresOrganizationSelection: false,
          requiresEmailVerification: false,
          csrfToken,
        },
      };
    },

    async changePassword(
      principal: AuthenticatedPrincipal,
      currentRawToken: string,
      sessionAbsoluteExpiresAt: Date,
      input: { currentPassword: string; newPassword: string },
      ctx: { ipPrefix: string | null }
    ): Promise<{ rawSessionToken: string; cookieMaxAgeMs: number; csrfToken: string }> {
      if (input.currentPassword === input.newPassword) {
        throw new AppError({
          httpStatus: 422,
          code: 'VALIDATION_ERROR',
          messageKey: 'error.auth.password_must_differ',
          message: 'Mật khẩu mới phải khác mật khẩu hiện tại.',
        });
      }

      const userCred = await repo.findUserCredentialById(principal.userId);
      const now = nowFn();
      if (!userCred || !isUserActiveAndUnlocked(userCred, now)) {
        throw new AppError({
          httpStatus: 401,
          code: 'UNAUTHORIZED',
          messageKey: 'error.auth.unauthorized',
          message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.',
        });
      }

      const currentValid = await scryptLimiter.run(() =>
        verifyPwd(input.currentPassword, userCred.passwordHash)
      );
      if (!currentValid) {
        throw new AppError({
          httpStatus: 401,
          code: 'INVALID_CURRENT_PASSWORD',
          messageKey: 'error.auth.invalid_current_password',
          message: 'Mật khẩu hiện tại không chính xác.',
        });
      }

      const newPasswordHash = await scryptLimiter.run(() => hashPwd(input.newPassword));
      const config = getConfig();
      const expectedTokenHash = hashSessionToken(currentRawToken);
      const newRawToken = generateSessionToken();
      const newTokenHash = hashSessionToken(newRawToken);
      const nextIdleExpiresAt = computeRefreshedIdleExpiration(
        principal.sessionScope,
        sessionAbsoluteExpiresAt,
        now
      );

      const actorRole = resolveAuditActorRole(principal);

      await repo.withTransaction(async (tx) => {
        await repo.updateUserPasswordHash(principal.userId, newPasswordHash, now, tx);
        const revokedOtherCount = await repo.revokeOtherActiveSessionsForUser(
          principal.userId,
          principal.sessionId,
          'password_changed',
          now,
          tx
        );
        const rotated = await repo.rotateSession(
          {
            sessionId: principal.sessionId,
            expectedTokenHash,
            newTokenHash,
            newActiveOrganizationId: principal.activeOrganizationId,
            newSessionScope: principal.sessionScope,
            lastActivityAt: now,
            idleExpiresAt: nextIdleExpiresAt,
          },
          tx
        );

        if (!rotated) {
          throw new AppError({
            httpStatus: 401,
            code: 'UNAUTHORIZED',
            messageKey: 'error.auth.session_invalid',
            message: 'Phiên đăng nhập không còn hiệu lực. Vui lòng đăng nhập lại.',
          });
        }

        await safeAudit(
          {
            organizationId: principal.activeOrganizationId,
            actorUserId: principal.userId,
            actorRole,
            eventType: 'auth.session_revoked',
            targetType: 'user',
            targetId: principal.userId,
            ipPrefix: ctx.ipPrefix,
            metadata: {
              reason: 'password_changed',
              revokedOtherSessionsCount: revokedOtherCount,
              currentSessionRotated: true,
            },
          },
          tx
        );
      });

      const csrfToken = deriveSessionCsrfToken(
        newRawToken,
        principal.sessionId,
        config.auth.csrfSecret
      );

      return {
        rawSessionToken: newRawToken,
        cookieMaxAgeMs: computeRemainingSessionMs(
          nextIdleExpiresAt,
          sessionAbsoluteExpiresAt,
          now
        ),
        csrfToken,
      };
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
