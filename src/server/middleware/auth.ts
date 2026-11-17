import type { NextFunction, Request, Response } from 'express';
import { getServerConfig, type ServerConfig } from '../config/env.ts';
import type { OrgRole } from '../db/schema/_shared.ts';
import { ApiErrors, AppError } from '../http/errors.ts';
import {
  createAuthRepository,
  type AuthRepository,
  type SessionWithContextRecord,
} from '../repositories/auth.repository.ts';
import {
  computeRefreshedIdleExpiration,
  extractSafeIpPrefix,
  hashSessionToken,
  isSessionExpired,
  isValidSessionTokenFormat,
  parseSessionCookie,
} from '../security/session.ts';
import { recordAuditEvent, type AuditInsertExecutor } from '../services/audit.service.ts';
import type { AuthenticatedPrincipal } from '../services/auth.service.ts';

export type MvpRole = 'platform_admin' | OrgRole;

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedPrincipal;
    }
  }
}

export interface SessionTimingContext {
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

function resolveValidatedPrincipal(
  record: SessionWithContextRecord,
  now: Date
): AuthenticatedPrincipal | null {
  const { session, user, activeOrganization, activeMembership } = record;

  if (isSessionExpired(session, now)) {
    return null;
  }

  if (user.status !== 'active') {
    return null;
  }
  if (user.lockedUntil !== null && user.lockedUntil > now) {
    return null;
  }

  if (user.platformRole !== null && user.platformRole !== 'platform_admin') {
    return null;
  }

  if (session.sessionScope === 'platform_admin') {
    if (user.platformRole !== 'platform_admin' || session.activeOrganizationId !== null) {
      return null;
    }
    return {
      userId: user.id,
      platformRole: 'platform_admin',
      activeOrganizationId: null,
      organizationMembershipId: null,
      organizationRole: null,
      sessionId: session.id,
      sessionScope: 'platform_admin',
      displayName: user.displayName,
      email: user.email,
      platformUsername: user.platformUsername,
    };
  }

  // Teacher or Student must NOT have a platform_admin role
  if (user.platformRole !== null) {
    return null;
  }

  if (session.sessionScope === 'teacher') {
    if (session.activeOrganizationId === null) {
      return {
        userId: user.id,
        platformRole: null,
        activeOrganizationId: null,
        organizationMembershipId: null,
        organizationRole: null,
        sessionId: session.id,
        sessionScope: 'teacher',
        displayName: user.displayName,
        email: user.email,
        platformUsername: user.platformUsername,
      };
    }

    if (
      !activeOrganization ||
      activeOrganization.status !== 'active' ||
      !activeMembership ||
      activeMembership.status !== 'active' ||
      activeMembership.role !== 'teacher'
    ) {
      return null;
    }

    return {
      userId: user.id,
      platformRole: null,
      activeOrganizationId: activeOrganization.id,
      organizationMembershipId: activeMembership.id,
      organizationRole: 'teacher',
      sessionId: session.id,
      sessionScope: 'teacher',
      displayName: user.displayName,
      email: user.email,
      platformUsername: user.platformUsername,
    };
  }

  if (session.sessionScope === 'student') {
    if (
      session.activeOrganizationId === null ||
      !activeOrganization ||
      activeOrganization.status !== 'active' ||
      !activeMembership ||
      activeMembership.status !== 'active' ||
      activeMembership.role !== 'student'
    ) {
      return null;
    }

    return {
      userId: user.id,
      platformRole: null,
      activeOrganizationId: activeOrganization.id,
      organizationMembershipId: activeMembership.id,
      organizationRole: 'student',
      sessionId: session.id,
      sessionScope: 'student',
      displayName: user.displayName,
      email: user.email,
      platformUsername: user.platformUsername,
    };
  }

  return null;
}

export function createAuthMiddlewareSuite(options?: {
  repo?: AuthRepository;
  getConfig?: () => ServerConfig;
  now?: () => Date;
  auditExecutor?: AuditInsertExecutor;
}) {
  const repo = options?.repo ?? createAuthRepository();
  const getConfig = options?.getConfig ?? getServerConfig;
  const nowFn = options?.now ?? (() => new Date());

  const requireAuth = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const config = getConfig();
      const rawToken = parseSessionCookie(req.headers.cookie, config.cookie.name);
      if (!rawToken || !isValidSessionTokenFormat(rawToken)) {
        next(ApiErrors.unauthorized());
        return;
      }

      const tokenHash = hashSessionToken(rawToken);
      const record = await repo.findSessionWithContextByTokenHash(tokenHash);
      if (!record) {
        next(ApiErrors.unauthorized());
        return;
      }

      const now = nowFn();
      const principal = resolveValidatedPrincipal(record, now);
      if (!principal) {
        if (record.session.revokedAt === null && isSessionExpired(record.session, now)) {
          await repo
            .revokeSessionById(record.session.id, 'expired', now)
            .catch(() => undefined);
        }
        next(ApiErrors.unauthorized());
        return;
      }

      const nextIdleExpiresAt = computeRefreshedIdleExpiration(
        record.session.sessionScope,
        record.session.absoluteExpiresAt,
        now
      );

      await repo.touchSessionActivity(record.session.id, now, nextIdleExpiresAt);

      req.auth = principal;
      res.locals.rawSessionToken = rawToken;
      res.locals.sessionTiming = {
        idleExpiresAt: nextIdleExpiresAt,
        absoluteExpiresAt: record.session.absoluteExpiresAt,
      } satisfies SessionTimingContext;

      next();
    } catch (err: unknown) {
      next(err);
    }
  };

  const requireOrgContext = (
    req: Request,
    _res: Response,
    next: NextFunction
  ): void => {
    if (!req.auth) {
      next(ApiErrors.unauthorized());
      return;
    }

    if (
      req.auth.activeOrganizationId === null ||
      req.auth.organizationMembershipId === null ||
      req.auth.organizationRole === null
    ) {
      next(
        new AppError({
          httpStatus: 403,
          code: 'ORGANIZATION_CONTEXT_REQUIRED',
          messageKey: 'error.auth.organization_context_required',
          message: 'Vui lòng chọn trường học đang làm việc trước khi thực hiện thao tác này.',
        })
      );
      return;
    }

    next();
  };

  const requireRole = (...allowedRoles: MvpRole[]) => {
    const allowedSet = new Set<MvpRole>(allowedRoles);

    return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
      const auth = req.auth;
      if (!auth) {
        next(ApiErrors.unauthorized());
        return;
      }

      let effectiveRole: MvpRole | null = null;
      if (auth.platformRole === 'platform_admin' && auth.sessionScope === 'platform_admin') {
        effectiveRole = 'platform_admin';
      } else if (
        auth.platformRole === null &&
        auth.organizationRole !== null &&
        auth.organizationRole === auth.sessionScope
      ) {
        effectiveRole = auth.organizationRole;
      } else if (
        auth.platformRole === null &&
        auth.sessionScope === 'teacher' &&
        auth.activeOrganizationId === null
      ) {
        effectiveRole = 'teacher';
      }

      if (!effectiveRole || !allowedSet.has(effectiveRole)) {
        await recordAuditEvent(
          {
            organizationId: auth.activeOrganizationId,
            actorUserId: auth.userId,
            actorRole:
              auth.platformRole === 'platform_admin'
                ? 'platform_admin'
                : (auth.organizationRole ?? null),
            eventType: 'security.unauthorized_access_denied',
            targetType: 'http_route',
            ipPrefix: extractSafeIpPrefix(req.ip),
            metadata: {
              method: req.method,
              path: req.path,
            },
          },
          options?.auditExecutor
        ).catch(() => undefined);

        next(ApiErrors.forbidden());
        return;
      }

      next();
    };
  };

  return {
    requireAuth,
    requireOrgContext,
    requireRole,
  };
}

const defaultSuite = createAuthMiddlewareSuite();

export const requireAuth = defaultSuite.requireAuth;
export const requireOrgContext = defaultSuite.requireOrgContext;
export const requireRole = defaultSuite.requireRole;
