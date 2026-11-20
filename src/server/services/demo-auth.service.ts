import { getServerConfig, type ServerConfig } from '../config/env.ts';
import type { OrgRole, SessionScope } from '../db/schema/_shared.ts';
import { generateUuidV7 } from '../db/uuid.ts';
import { AppError } from '../http/errors.ts';
import {
  createAuthRepository,
  type AuthCredentialUserRecord,
  type AuthMembershipSummary,
  type AuthRepository,
  type DbOrTx,
} from '../repositories/auth.repository.ts';
import { deriveSessionCsrfToken } from '../security/csrf.ts';
import { InMemoryRateLimiter, RateLimitExceededError } from '../security/rate-limit.ts';
import {
  computeInitialSessionExpirations,
  computeRemainingSessionMs,
  generateSessionToken,
  hashSessionToken,
} from '../security/session.ts';
import {
  recordAuditEvent,
  type AuditActorRole,
  type AuditInsertExecutor,
} from './audit.service.ts';
import type {
  AuthSessionResult,
  LoginRequestContext,
  SafeOrganizationChoice,
} from './auth.service.ts';

export const DEMO_PERSONAS = [
  'admin',
  'teacher',
  'guardian',
  'student_school',
  'student_family',
] as const;

export type DemoPersona = (typeof DEMO_PERSONAS)[number];

export const DEMO_ACCOUNT_ALLOWLIST = {
  admin: {
    platformUsername: 'demo_admin',
    expectedScope: 'platform_admin' as const,
  },
  teacher: {
    platformUsername: 'demo_teacher',
    organizationCode: 'MIMORA-DEMO',
    expectedScope: 'teacher' as const,
  },
  guardian: {
    email: 'demo.guardian@example.com',
    expectedScope: 'guardian' as const,
  },
  student_school: {
    organizationCode: 'MIMORA-DEMO',
    orgUsername: 'demo_student_dual',
    expectedScope: 'student' as const,
  },
  student_family: {
    workspaceCode: 'FAM-DMO001',
    familyUsername: 'demo_student_family',
    expectedScope: 'student' as const,
  },
} as const;

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

function demoAccountUnavailableError(message?: string): AppError {
  return new AppError({
    httpStatus: 404,
    code: 'DEMO_ACCOUNT_UNAVAILABLE',
    messageKey: 'error.demo.account_unavailable',
    message:
      message ??
      'Tài khoản trải nghiệm cho vai trò này hiện chưa sẵn sàng hoặc đã bị thay đổi.',
  });
}

function demoDisabledError(): AppError {
  return new AppError({
    httpStatus: 404,
    code: 'DEMO_MODE_DISABLED',
    messageKey: 'error.demo.disabled',
    message: 'Tính năng trải nghiệm nhanh hiện không được bật trên môi trường này.',
  });
}

export interface DemoAuthServiceDeps {
  repo?: AuthRepository;
  rateLimiter?: InMemoryRateLimiter;
  getConfig?: () => ServerConfig;
  now?: () => Date;
  auditFn?: (
    input: Parameters<typeof recordAuditEvent>[0],
    executor?: AuditInsertExecutor
  ) => Promise<unknown>;
}

export function createDemoAuthService(deps?: DemoAuthServiceDeps) {
  const repo = deps?.repo ?? createAuthRepository();
  const rateLimiter = deps?.rateLimiter ?? new InMemoryRateLimiter();
  const getConfig = deps?.getConfig ?? getServerConfig;
  const nowFn = deps?.now ?? (() => new Date());
  const emitAudit = deps?.auditFn ?? recordAuditEvent;

  async function safeAudit(
    input: Parameters<typeof recordAuditEvent>[0],
    executor?: DbOrTx
  ): Promise<void> {
    await emitAudit(input, executor as AuditInsertExecutor | undefined);
  }

  async function enforceDemoRateLimit(
    ip: string | undefined,
    ipPrefix: string | null
  ): Promise<void> {
    const config = getConfig();
    const nowMs = nowFn().getTime();
    const ipCheck = rateLimiter.consume(
      'demo_auth_ip',
      ip?.trim() || 'unknown',
      config.auth.rateLimitIpMax,
      config.auth.rateLimitWindowMs,
      nowMs
    );
    if (!ipCheck.allowed) {
      await safeAudit({
        eventType: 'security.rate_limit_triggered',
        targetType: 'demo_login',
        ipPrefix,
        metadata: { bucket: 'ip', mode: 'demo_quick_access' },
      }).catch(() => undefined);
      throw new RateLimitExceededError(ipCheck.retryAfterSeconds);
    }
  }

  async function issueDemoSession(params: {
    user: AuthCredentialUserRecord;
    sessionScope: SessionScope;
    actorRole: AuditActorRole;
    activeOrg: SafeOrganizationChoice | null;
    orgChoices: SafeOrganizationChoice[];
    platformRole: 'platform_admin' | 'guardian' | null;
    emailVerified: boolean;
    persona: DemoPersona;
    extraAuditMetadata?: Record<string, unknown>;
    ctx: LoginRequestContext;
    now: Date;
    config: ServerConfig;
  }): Promise<AuthSessionResult> {
    const rawToken = generateSessionToken();
    const tokenHash = hashSessionToken(rawToken);
    const sessionId = generateUuidV7();
    const { idleExpiresAt, absoluteExpiresAt } = computeInitialSessionExpirations(
      params.sessionScope,
      params.now
    );

    await repo.withTransaction(async (tx) => {
      await repo.recordSuccessfulLoginState(params.user.id, params.now, tx);
      await repo.createSession(
        {
          id: sessionId,
          tokenHash,
          userId: params.user.id,
          sessionScope: params.sessionScope,
          activeOrganizationId: params.activeOrg?.organizationId ?? null,
          idleExpiresAt,
          absoluteExpiresAt,
          lastActivityAt: params.now,
          ipPrefix: params.ctx.ipPrefix,
          userAgentHash: params.ctx.userAgentHash,
          createdAt: params.now,
        },
        tx
      );
      await safeAudit(
        {
          organizationId: params.activeOrg?.organizationId ?? null,
          actorUserId: params.user.id,
          actorRole: params.actorRole,
          eventType: 'auth.login_succeeded',
          targetType: 'session',
          targetId: sessionId,
          ipPrefix: params.ctx.ipPrefix,
          metadata: {
            mode: 'demo_quick_access',
            demoPersona: params.persona,
            ...params.extraAuditMetadata,
          },
        },
        tx
      );
    });

    const csrfToken = deriveSessionCsrfToken(
      rawToken,
      sessionId,
      params.config.auth.csrfSecret
    );

    return {
      rawSessionToken: rawToken,
      cookieMaxAgeMs: computeRemainingSessionMs(idleExpiresAt, absoluteExpiresAt, params.now),
      payload: {
        user: {
          id: params.user.id,
          displayName: params.user.displayName,
          email: params.user.email,
          platformUsername: params.user.platformUsername,
          platformRole: params.platformRole,
          emailVerified: params.emailVerified,
        },
        session: {
          id: sessionId,
          scope: params.sessionScope,
          activeOrganizationId: params.activeOrg?.organizationId ?? null,
          idleExpiresAt: idleExpiresAt.toISOString(),
          absoluteExpiresAt: absoluteExpiresAt.toISOString(),
        },
        activeOrganization: params.activeOrg,
        organizations: params.orgChoices,
        requiresOrganizationSelection: false,
        requiresEmailVerification: false,
        csrfToken,
      },
    };
  }

  return {
    rateLimiter,

    async loginDemoPersona(
      persona: DemoPersona,
      ctx: LoginRequestContext
    ): Promise<AuthSessionResult> {
      const config = getConfig();
      if (!config.demoMode) {
        throw demoDisabledError();
      }

      if (!DEMO_PERSONAS.includes(persona)) {
        throw new AppError({
          httpStatus: 422,
          code: 'VALIDATION_ERROR',
          messageKey: 'error.validation.failed',
          message: 'Vai trò trải nghiệm được chọn không hợp lệ.',
        });
      }

      await enforceDemoRateLimit(ctx.ip, ctx.ipPrefix);

      const now = nowFn();

      if (persona === 'admin') {
        const spec = DEMO_ACCOUNT_ALLOWLIST.admin;
        const user = await repo.findUserCredentialByPlatformUsername(spec.platformUsername);
        if (
          !user ||
          !isUserActiveAndUnlocked(user, now) ||
          user.platformRole !== 'platform_admin'
        ) {
          throw demoAccountUnavailableError();
        }

        return issueDemoSession({
          user,
          sessionScope: 'platform_admin',
          actorRole: 'platform_admin',
          activeOrg: null,
          orgChoices: [],
          platformRole: 'platform_admin',
          emailVerified: Boolean(user.emailVerifiedAt),
          persona,
          ctx,
          now,
          config,
        });
      }

      if (persona === 'teacher') {
        const spec = DEMO_ACCOUNT_ALLOWLIST.teacher;
        const user = await repo.findUserCredentialByPlatformUsername(spec.platformUsername);
        if (!user || !isUserActiveAndUnlocked(user, now) || user.platformRole !== null) {
          throw demoAccountUnavailableError();
        }

        const memberships = await repo.findMembershipsForUser(user.id, 'teacher');
        const eligibleChoices = memberships
          .filter(
            (m) =>
              m.role === 'teacher' &&
              m.membershipStatus === 'active' &&
              m.organizationStatus === 'active'
          )
          .map(toSafeOrganizationChoice)
          .filter((item): item is SafeOrganizationChoice => item !== null);

        const targetOrg = eligibleChoices.find((m) => m.code === spec.organizationCode);
        if (!targetOrg) {
          throw demoAccountUnavailableError();
        }

        return issueDemoSession({
          user,
          sessionScope: 'teacher',
          actorRole: 'teacher',
          activeOrg: targetOrg,
          orgChoices: eligibleChoices,
          platformRole: null,
          emailVerified: Boolean(user.emailVerifiedAt),
          persona,
          extraAuditMetadata: {
            organizationCode: targetOrg.code,
          },
          ctx,
          now,
          config,
        });
      }

      if (persona === 'guardian') {
        const spec = DEMO_ACCOUNT_ALLOWLIST.guardian;
        const user = await repo.findUserCredentialByEmail(spec.email);
        if (
          !user ||
          !isUserActiveAndUnlocked(user, now) ||
          user.platformRole !== 'guardian' ||
          user.emailVerifiedAt === null ||
          user.emailVerifiedAt === undefined
        ) {
          throw demoAccountUnavailableError();
        }

        return issueDemoSession({
          user,
          sessionScope: 'guardian',
          actorRole: 'guardian',
          activeOrg: null,
          orgChoices: [],
          platformRole: 'guardian',
          emailVerified: true,
          persona,
          ctx,
          now,
          config,
        });
      }

      if (persona === 'student_school') {
        const spec = DEMO_ACCOUNT_ALLOWLIST.student_school;
        const studentMatch = await repo.findStudentLoginRecord(
          spec.organizationCode,
          spec.orgUsername
        );
        if (!studentMatch) {
          throw demoAccountUnavailableError();
        }

        const { user, membership } = studentMatch;
        if (
          !isUserActiveAndUnlocked(user, now) ||
          user.platformRole !== null ||
          membership.role !== 'student' ||
          membership.membershipStatus !== 'active' ||
          membership.organizationStatus !== 'active'
        ) {
          throw demoAccountUnavailableError();
        }

        const activeOrg: SafeOrganizationChoice = {
          organizationId: membership.organizationId,
          code: membership.organizationCode,
          name: membership.organizationName,
          membershipId: membership.membershipId,
          role: 'student' as OrgRole,
        };

        return issueDemoSession({
          user,
          sessionScope: 'student',
          actorRole: 'student',
          activeOrg,
          orgChoices: [activeOrg],
          platformRole: null,
          emailVerified: false,
          persona,
          extraAuditMetadata: {
            context: 'school',
            organizationCode: activeOrg.code,
          },
          ctx,
          now,
          config,
        });
      }

      // student_family (strictly family-only student context, zero school memberships)
      const spec = DEMO_ACCOUNT_ALLOWLIST.student_family;
      if (!repo.findFamilyStudentLoginRecord) {
        throw demoAccountUnavailableError();
      }

      const familyMatch = await repo.findFamilyStudentLoginRecord(
        spec.workspaceCode,
        spec.familyUsername
      );
      if (
        !familyMatch ||
        !isUserActiveAndUnlocked(familyMatch.user, now) ||
        familyMatch.user.platformRole !== null ||
        familyMatch.familyWorkspace.status !== 'active' ||
        familyMatch.familyStudent.status !== 'active' ||
        !familyMatch.hasActiveGuardianLink
      ) {
        throw demoAccountUnavailableError();
      }

      const schoolMemberships = await repo.findMembershipsForUser(familyMatch.user.id);
      if (schoolMemberships.length > 0) {
        throw demoAccountUnavailableError();
      }

      return issueDemoSession({
        user: familyMatch.user,
        sessionScope: 'student',
        actorRole: 'student',
        activeOrg: null,
        orgChoices: [],
        platformRole: null,
        emailVerified: false,
        persona,
        extraAuditMetadata: {
          context: 'family_workspace',
          familyWorkspaceId: familyMatch.familyWorkspace.id,
        },
        ctx,
        now,
        config,
      });
    },
  };
}

export type DemoAuthService = ReturnType<typeof createDemoAuthService>;
