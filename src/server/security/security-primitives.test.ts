import assert from 'node:assert/strict';
import express, { type Request } from 'express';
import http from 'node:http';
import test from 'node:test';
import { parseServerConfig } from '../config/env.ts';
import { apiErrorHandler } from '../http/middleware.ts';
import {
  CSRF_TOKEN_HEADER,
  CUSTOM_REQUEST_HEADER,
  createAuthenticatedCsrfMiddleware,
  createPreAuthCsrfMiddleware,
  deriveSessionCsrfToken,
  isTrustedRequestOrigin,
  verifySessionCsrfToken,
} from './csrf.ts';
import { InMemoryRateLimiter } from './rate-limit.ts';
import { ScryptBusyError, ScryptConcurrencyLimiter } from './scrypt-limiter.ts';
import {
  SESSION_TIMEOUT_POLICIES,
  computeInitialSessionExpirations,
  computeRefreshedIdleExpiration,
  extractSafeIpPrefix,
  generateSessionToken,
  hashSessionToken,
  isSessionExpired,
  parseSessionCookie,
} from './session.ts';

test('session tokens are 256-bit CSPRNG, SHA-256 hashed, and enforce role idle/absolute timeouts', () => {
  const tokenA = generateSessionToken();
  const tokenB = generateSessionToken();
  assert.notEqual(tokenA, tokenB);
  assert.equal(tokenA.length, 43);

  const hashA = hashSessionToken(tokenA);
  assert.match(hashA, /^[0-9a-f]{64}$/);
  assert.notEqual(hashA, tokenA);

  assert.equal(SESSION_TIMEOUT_POLICIES.platform_admin.idleTimeoutMs, 30 * 60 * 1000);
  assert.equal(SESSION_TIMEOUT_POLICIES.platform_admin.absoluteTimeoutMs, 8 * 60 * 60 * 1000);
  assert.equal(SESSION_TIMEOUT_POLICIES.teacher.idleTimeoutMs, 2 * 60 * 60 * 1000);
  assert.equal(SESSION_TIMEOUT_POLICIES.teacher.absoluteTimeoutMs, 12 * 60 * 60 * 1000);
  assert.equal(SESSION_TIMEOUT_POLICIES.student.idleTimeoutMs, 4 * 60 * 60 * 1000);
  assert.equal(SESSION_TIMEOUT_POLICIES.student.absoluteTimeoutMs, 12 * 60 * 60 * 1000);

  const start = new Date('2026-11-16T00:00:00.000Z');
  const adminExp = computeInitialSessionExpirations('platform_admin', start);
  assert.equal(adminExp.idleExpiresAt.toISOString(), '2026-11-16T00:30:00.000Z');
  assert.equal(adminExp.absoluteExpiresAt.toISOString(), '2026-11-16T08:00:00.000Z');

  // Refresh near absolute expiry must clamp idle <= absolute
  const nearEnd = new Date('2026-11-16T07:50:00.000Z');
  const refreshed = computeRefreshedIdleExpiration(
    'platform_admin',
    adminExp.absoluteExpiresAt,
    nearEnd
  );
  assert.equal(refreshed.toISOString(), adminExp.absoluteExpiresAt.toISOString());

  assert.equal(
    isSessionExpired(
      { revokedAt: null, ...adminExp },
      new Date('2026-11-16T00:30:00.000Z')
    ),
    true
  );
  assert.equal(
    isSessionExpired(
      { revokedAt: start, ...adminExp },
      new Date('2026-11-16T00:01:00.000Z')
    ),
    true
  );

  assert.equal(parseSessionCookie('other=1; mimora_session=' + tokenA, 'mimora_session'), tokenA);
  assert.equal(extractSafeIpPrefix('203.0.113.45'), '203.0.113.0/24');
});

test('CSRF derives stateless session-bound HMAC tokens and enforces strict Origin/Referer without wildcards or X-Forwarded-Proto', async () => {
  const rawToken = generateSessionToken();
  const sessionId = '01950000-0000-7000-8000-000000000100';
  const csrf = deriveSessionCsrfToken(rawToken, sessionId, 'csrf-test-secret-123456');

  assert.notEqual(csrf, rawToken);
  assert.equal(csrf.includes(rawToken), false);
  assert.equal(verifySessionCsrfToken(csrf, rawToken, sessionId, 'csrf-test-secret-123456'), true);
  assert.equal(verifySessionCsrfToken(csrf, rawToken, 'other-session', 'csrf-test-secret-123456'), false);

  const previewOrigin = 'https://ais-dev-preview.asia-southeast1.run.app';
  const cfg = parseServerConfig({
    NODE_ENV: 'production',
    APP_URL: previewOrigin,
    COOKIE_SECURE: 'true',
    COOKIE_SAMESITE: 'none',
    AUTH_CSRF_SECRET: 'csrf-test-secret-123456',
  });

  // Strict origin match even when X-Forwarded-Proto was rewritten to http (KI-02)
  assert.equal(
    isTrustedRequestOrigin(
      {
        hostname: 'ais-dev-preview.asia-southeast1.run.app',
        get: ((h: string) =>
          h.toLowerCase() === 'origin'
            ? previewOrigin
            : h.toLowerCase() === 'x-forwarded-proto'
              ? 'http'
              : undefined) as Request['get'],
      },
      cfg
    ).trusted,
    true
  );

  // Suffix spoof must fail closed
  assert.equal(
    isTrustedRequestOrigin(
      {
        hostname: 'ais-dev-preview.asia-southeast1.run.app',
        get: ((h: string) =>
          h.toLowerCase() === 'origin'
            ? 'https://evil-ais-dev-preview.asia-southeast1.run.app'
            : undefined) as Request['get'],
      },
      cfg
    ).trusted,
    false
  );

  // Express HTTP integration checks for pre-auth & authenticated CSRF middlewares
  const app = express();
  app.post('/pre', createPreAuthCsrfMiddleware({ config: cfg }), (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.post(
    '/authed',
    (req, res, next) => {
      req.auth = {
        userId: 'u1',
        platformRole: null,
        activeOrganizationId: null,
        organizationMembershipId: null,
        organizationRole: null,
        sessionId,
        sessionScope: 'teacher',
        displayName: 'GV',
        email: 'gv@example.com',
        platformUsername: null,
      };
      res.locals.rawSessionToken = rawToken;
      next();
    },
    createAuthenticatedCsrfMiddleware({ config: cfg }),
    (_req, res) => res.status(200).json({ ok: true })
  );
  app.get('/safe', createAuthenticatedCsrfMiddleware({ config: cfg }), (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.use(apiErrorHandler);

  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const addr = server.address() as { port: number };
    const base = `http://127.0.0.1:${addr.port}`;

    // Missing origin -> 403
    const noOrigin = await fetch(`${base}/pre`, { method: 'POST' });
    assert.equal(noOrigin.status, 403);

    // Untrusted origin -> 403
    const badOrigin = await fetch(`${base}/pre`, {
      method: 'POST',
      headers: { Origin: 'https://attacker.example', [CUSTOM_REQUEST_HEADER]: 'MIMORA' },
    });
    assert.equal(badOrigin.status, 403);

    // Trusted origin but missing custom header -> 403
    const noHeader = await fetch(`${base}/pre`, {
      method: 'POST',
      headers: { Origin: previewOrigin },
    });
    assert.equal(noHeader.status, 403);

    // Trusted origin + custom header -> 200
    const okPre = await fetch(`${base}/pre`, {
      method: 'POST',
      headers: { Origin: previewOrigin, [CUSTOM_REQUEST_HEADER]: 'MIMORA' },
    });
    assert.equal(okPre.status, 200);

    // Authenticated without CSRF token -> 403
    const missingToken = await fetch(`${base}/authed`, {
      method: 'POST',
      headers: { Origin: previewOrigin, [CUSTOM_REQUEST_HEADER]: 'MIMORA' },
    });
    assert.equal(missingToken.status, 403);

    // Authenticated with valid session-bound CSRF token -> 200
    const okAuthed = await fetch(`${base}/authed`, {
      method: 'POST',
      headers: {
        Origin: previewOrigin,
        [CUSTOM_REQUEST_HEADER]: 'MIMORA',
        [CSRF_TOKEN_HEADER]: csrf,
      },
    });
    assert.equal(okAuthed.status, 200);

    // Safe GET bypasses CSRF
    const okSafeGet = await fetch(`${base}/safe`);
    assert.equal(okSafeGet.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve()))
    );
  }
});

test('InMemoryRateLimiter hashes bucket keys and enforces bounded window limits', () => {
  const limiter = new InMemoryRateLimiter({ maxEntries: 3 });
  const rawIdentifier = 'secret-student@school';
  const derivedKey = limiter.deriveBucketKey('auth_id', rawIdentifier);
  assert.equal(derivedKey.includes('secret-student'), false);
  assert.match(derivedKey, /^[0-9a-f]{64}$/);

  const t0 = 1_700_000_000_000;
  assert.equal(limiter.consume('ip', '1.2.3.4', 2, 10_000, t0).allowed, true);
  assert.equal(limiter.consume('ip', '1.2.3.4', 2, 10_000, t0 + 100).allowed, true);
  const blocked = limiter.consume('ip', '1.2.3.4', 2, 10_000, t0 + 200);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);

  // Window reset
  assert.equal(limiter.consume('ip', '1.2.3.4', 2, 10_000, t0 + 10_001).allowed, true);

  // Bounded size
  limiter.consume('ip', '2.2.2.2', 2, 10_000, t0 + 10_001);
  limiter.consume('ip', '3.3.3.3', 2, 10_000, t0 + 10_001);
  limiter.consume('ip', '4.4.4.4', 2, 10_000, t0 + 10_001);
  assert.ok(limiter.size <= 3);
});

test('ScryptConcurrencyLimiter caps concurrency at <= 4 and rejects excess queued work with 503', async () => {
  const limiter = new ScryptConcurrencyLimiter({ maxConcurrent: 4, maxQueue: 2 });
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });

  // Launch 4 active + 2 queued = 6 total accepted; 7th must reject immediately with ScryptBusyError (503)
  const tasks = Array.from({ length: 6 }, () => limiter.run(() => gate));
  await assert.rejects(
    () => limiter.run(() => Promise.resolve('overflow')),
    (err: unknown) => {
      assert.ok(err instanceof ScryptBusyError);
      assert.equal(err.httpStatus, 503);
      return true;
    }
  );

  assert.equal(limiter.stats.peakConcurrent, 4);
  assert.equal(limiter.stats.activeCount, 4);
  assert.equal(limiter.stats.queuedCount, 2);

  releaseGate();
  await Promise.all(tasks);
  assert.equal(limiter.stats.activeCount, 0);
  assert.equal(limiter.stats.queuedCount, 0);
});
