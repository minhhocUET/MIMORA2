import crypto from 'node:crypto';
import type { Response } from 'express';
import type { CookieConfig } from '../config/env.ts';
import type { SessionScope } from '../db/schema/_shared.ts';

export interface SessionTimeoutPolicy {
  idleTimeoutMs: number;
  absoluteTimeoutMs: number;
}

export const SESSION_TIMEOUT_POLICIES: Readonly<Record<SessionScope, SessionTimeoutPolicy>> =
  Object.freeze({
    platform_admin: {
      idleTimeoutMs: 30 * 60 * 1000, // 30 minutes
      absoluteTimeoutMs: 8 * 60 * 60 * 1000, // 8 hours
    },
    teacher: {
      idleTimeoutMs: 2 * 60 * 60 * 1000, // 2 hours
      absoluteTimeoutMs: 12 * 60 * 60 * 1000, // 12 hours
    },
    student: {
      idleTimeoutMs: 4 * 60 * 60 * 1000, // 4 hours
      absoluteTimeoutMs: 12 * 60 * 60 * 1000, // 12 hours
    },
    guardian: {
      idleTimeoutMs: 2 * 60 * 60 * 1000, // 2 hours
      absoluteTimeoutMs: 12 * 60 * 60 * 1000, // 12 hours
    },
  });

const SESSION_TOKEN_BYTES = 32;
const RAW_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateSessionToken(): string {
  return crypto.randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

export function isValidSessionTokenFormat(token: string): boolean {
  return RAW_TOKEN_PATTERN.test(token);
}

export function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function constantTimeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function computeInitialSessionExpirations(
  scope: SessionScope,
  now: Date = new Date()
): { idleExpiresAt: Date; absoluteExpiresAt: Date } {
  const policy = SESSION_TIMEOUT_POLICIES[scope];
  const nowMs = now.getTime();
  return {
    idleExpiresAt: new Date(nowMs + policy.idleTimeoutMs),
    absoluteExpiresAt: new Date(nowMs + policy.absoluteTimeoutMs),
  };
}

export function computeRefreshedIdleExpiration(
  scope: SessionScope,
  absoluteExpiresAt: Date,
  now: Date = new Date()
): Date {
  const policy = SESSION_TIMEOUT_POLICIES[scope];
  const candidateMs = now.getTime() + policy.idleTimeoutMs;
  const absoluteMs = absoluteExpiresAt.getTime();
  return new Date(Math.min(candidateMs, absoluteMs));
}

export function computeRemainingSessionMs(
  idleExpiresAt: Date,
  absoluteExpiresAt: Date,
  now: Date = new Date()
): number {
  const effectiveEndMs = Math.min(idleExpiresAt.getTime(), absoluteExpiresAt.getTime());
  return Math.max(0, effectiveEndMs - now.getTime());
}

export function isSessionExpired(
  session: {
    revokedAt: Date | null;
    idleExpiresAt: Date;
    absoluteExpiresAt: Date;
  },
  now: Date = new Date()
): boolean {
  if (session.revokedAt !== null) {
    return true;
  }
  const nowMs = now.getTime();
  return (
    nowMs >= session.idleExpiresAt.getTime() ||
    nowMs >= session.absoluteExpiresAt.getTime()
  );
}

export function parseSessionCookie(
  cookieHeader: string | undefined,
  cookieName: string
): string | null {
  if (!cookieHeader) {
    return null;
  }

  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }
    const name = pair.slice(0, eqIndex).trim();
    if (name !== cookieName) {
      continue;
    }
    const rawValue = pair.slice(eqIndex + 1).trim();
    if (!rawValue) {
      return null;
    }
    try {
      const decoded = decodeURIComponent(rawValue);
      return decoded.length > 0 ? decoded : null;
    } catch {
      return rawValue.length > 0 ? rawValue : null;
    }
  }

  return null;
}

export function setSessionCookie(
  res: Response,
  rawToken: string,
  remainingMaxAgeMs: number,
  cookieConfig: CookieConfig
): void {
  res.cookie(cookieConfig.name, rawToken, {
    httpOnly: cookieConfig.httpOnly,
    secure: cookieConfig.secure,
    sameSite: cookieConfig.sameSite,
    path: cookieConfig.path,
    maxAge: Math.max(0, Math.floor(remainingMaxAgeMs)),
  });
}

export function clearSessionCookie(res: Response, cookieConfig: CookieConfig): void {
  res.clearCookie(cookieConfig.name, {
    httpOnly: cookieConfig.httpOnly,
    secure: cookieConfig.secure,
    sameSite: cookieConfig.sameSite,
    path: cookieConfig.path,
  });
}

export function extractSafeIpPrefix(ip: string | undefined): string | null {
  if (!ip) {
    return null;
  }
  const trimmed = ip.trim().replace(/^::ffff:/, '');
  if (!trimmed) {
    return null;
  }

  // IPv4 -> /24 prefix
  const ipv4Parts = trimmed.split('.');
  if (ipv4Parts.length === 4 && ipv4Parts.every((p) => /^\d{1,3}$/.test(p))) {
    return `${ipv4Parts[0]}.${ipv4Parts[1]}.${ipv4Parts[2]}.0/24`;
  }

  // IPv6 -> first 3 hextets (/48 prefix)
  if (trimmed.includes(':')) {
    const hextets = trimmed.split(':').filter((h) => h.length > 0);
    const prefix = hextets.slice(0, 3).join(':');
    return prefix ? `${prefix}::/48` : '::/48';
  }

  return null;
}

export function hashUserAgent(userAgent: string | undefined): string | null {
  if (!userAgent || userAgent.trim().length === 0) {
    return null;
  }
  return crypto.createHash('sha256').update(userAgent.trim(), 'utf8').digest('hex');
}
