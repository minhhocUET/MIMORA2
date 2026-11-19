import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getServerConfig, type ServerConfig } from '../config/env.ts';
import { AppError } from '../http/errors.ts';
import { recordAuditEvent, type AuditInsertExecutor } from '../services/audit.service.ts';
import { constantTimeEqualStrings, extractSafeIpPrefix } from './session.ts';

export const CSRF_TOKEN_HEADER = 'x-csrf-token' as const;
export const CUSTOM_REQUEST_HEADER = 'x-requested-with' as const;

const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function deriveSessionCsrfToken(
  rawSessionToken: string,
  sessionId: string,
  csrfSecret?: string
): string {
  return crypto
    .createHmac('sha256', rawSessionToken)
    .update(`mimora-csrf-v1|${sessionId}|${csrfSecret ?? ''}`, 'utf8')
    .digest('base64url');
}

export function verifySessionCsrfToken(
  candidateToken: string | undefined,
  rawSessionToken: string,
  sessionId: string,
  csrfSecret?: string
): boolean {
  if (!candidateToken || candidateToken.trim().length === 0) {
    return false;
  }
  const expected = deriveSessionCsrfToken(rawSessionToken, sessionId, csrfSecret);
  return constantTimeEqualStrings(candidateToken.trim(), expected);
}

export function extractRequestOrigin(req: Pick<Request, 'get'>): string | null {
  const originHeader = req.get('origin')?.trim();
  if (originHeader) {
    if (originHeader === 'null') {
      return null;
    }
    try {
      const parsed = new URL(originHeader);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null;
      }
      return parsed.origin;
    } catch {
      return null;
    }
  }

  const refererHeader = req.get('referer')?.trim();
  if (refererHeader) {
    try {
      const parsed = new URL(refererHeader);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null;
      }
      return parsed.origin;
    } catch {
      return null;
    }
  }

  return null;
}

export function buildTrustedOrigins(
  config: ServerConfig,
  req?: Pick<Request, 'hostname' | 'get'>
): Set<string> {
  const trusted = new Set<string>(config.auth.trustedOrigins);

  // In non-production environments, permit exact local loopback origins only for local dev/test
  if (config.nodeEnv !== 'production' && req) {
    const rawHostHeader = req.get('host')?.trim() ?? '';
    const hostname = req.hostname?.toLowerCase() ?? '';
    if (LOOPBACK_HOSTS.has(hostname)) {
      if (rawHostHeader === `localhost:${config.port}` || rawHostHeader === 'localhost:8080') {
        trusted.add(`http://${rawHostHeader}`);
      }
      if (rawHostHeader === `127.0.0.1:${config.port}` || rawHostHeader === '127.0.0.1:8080') {
        trusted.add(`http://${rawHostHeader}`);
      }
    } else if (
      trusted.size === 0 &&
      rawHostHeader &&
      /^[a-z0-9.-]+(:\d{1,5})?$/i.test(rawHostHeader)
    ) {
      trusted.add(`https://${rawHostHeader}`);
      trusted.add(`http://${rawHostHeader}`);
    }
  }

  return trusted;
}

export function isTrustedRequestOrigin(
  req: Pick<Request, 'get' | 'hostname'>,
  config: ServerConfig
): { trusted: boolean; origin: string | null } {
  const origin = extractRequestOrigin(req);
  if (!origin) {
    return { trusted: false, origin: null };
  }

  const trustedOrigins = buildTrustedOrigins(config, req);
  if (trustedOrigins.size === 0) {
    return { trusted: false, origin };
  }

  return {
    trusted: trustedOrigins.has(origin),
    origin,
  };
}

export function hasCustomRequestHeader(req: Pick<Request, 'get'>): boolean {
  const headerVal = req.get(CUSTOM_REQUEST_HEADER)?.trim();
  return Boolean(headerVal && headerVal.length > 0 && headerVal.length <= 64);
}

function createCsrfForbiddenError(reason: string): AppError {
  return new AppError({
    httpStatus: 403,
    code: reason,
    messageKey: 'error.security.csrf_rejected',
    message: 'Yêu cầu bị từ chối do không vượt qua kiểm tra bảo mật nguồn gốc hoặc CSRF.',
  });
}

async function emitCsrfRejectedAudit(
  req: Request,
  reason: string,
  auditExecutor?: AuditInsertExecutor
): Promise<void> {
  try {
    await recordAuditEvent(
      {
        organizationId: req.auth?.activeOrganizationId ?? null,
        actorUserId: req.auth?.userId ?? null,
        actorRole:
          req.auth?.platformRole === 'platform_admin'
            ? 'platform_admin'
            : req.auth?.platformRole === 'guardian'
              ? 'guardian'
              : (req.auth?.organizationRole ?? null),
        eventType: 'security.csrf_rejected',
        targetType: 'http_request',
        ipPrefix: extractSafeIpPrefix(req.ip),
        metadata: {
          reason,
          method: req.method,
          path: req.path,
        },
      },
      auditExecutor
    );
  } catch (err) {
    // Do not mask the 403 CSRF rejection if audit logging fails or DB is unavailable in isolated unit tests
    console.error('[mimora-security] Failed to record security.csrf_rejected audit event', err instanceof Error ? err.name : 'unknown');
  }
}

export function createPreAuthCsrfMiddleware(options?: {
  config?: ServerConfig;
  auditExecutor?: AuditInsertExecutor;
}) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (SAFE_HTTP_METHODS.has(req.method.toUpperCase())) {
      next();
      return;
    }

    const config = options?.config ?? getServerConfig();
    const originCheck = isTrustedRequestOrigin(req, config);
    if (!originCheck.trusted) {
      await emitCsrfRejectedAudit(req, 'UNTRUSTED_ORIGIN', options?.auditExecutor);
      next(createCsrfForbiddenError('CSRF_ORIGIN_REJECTED'));
      return;
    }

    if (!hasCustomRequestHeader(req)) {
      await emitCsrfRejectedAudit(req, 'MISSING_CUSTOM_HEADER', options?.auditExecutor);
      next(createCsrfForbiddenError('CSRF_HEADER_REQUIRED'));
      return;
    }

    next();
  };
}

export function createAuthenticatedCsrfMiddleware(options?: {
  config?: ServerConfig;
  auditExecutor?: AuditInsertExecutor;
}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (SAFE_HTTP_METHODS.has(req.method.toUpperCase())) {
      next();
      return;
    }

    const config = options?.config ?? getServerConfig();
    const originCheck = isTrustedRequestOrigin(req, config);
    if (!originCheck.trusted) {
      await emitCsrfRejectedAudit(req, 'UNTRUSTED_ORIGIN', options?.auditExecutor);
      next(createCsrfForbiddenError('CSRF_ORIGIN_REJECTED'));
      return;
    }

    if (!hasCustomRequestHeader(req)) {
      await emitCsrfRejectedAudit(req, 'MISSING_CUSTOM_HEADER', options?.auditExecutor);
      next(createCsrfForbiddenError('CSRF_HEADER_REQUIRED'));
      return;
    }

    const rawSessionToken =
      typeof res.locals.rawSessionToken === 'string' ? res.locals.rawSessionToken : undefined;
    const sessionId = req.auth?.sessionId;
    const candidateCsrf = req.get(CSRF_TOKEN_HEADER);

    if (
      !rawSessionToken ||
      !sessionId ||
      !verifySessionCsrfToken(
        candidateCsrf,
        rawSessionToken,
        sessionId,
        config.auth.csrfSecret
      )
    ) {
      await emitCsrfRejectedAudit(req, 'INVALID_CSRF_TOKEN', options?.auditExecutor);
      next(createCsrfForbiddenError('CSRF_TOKEN_INVALID'));
      return;
    }

    next();
  };
}
