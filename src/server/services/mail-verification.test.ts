import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import test from 'node:test';
import { extractAndCleanVerifyToken } from '../../utils/verification-link.ts';
import { parseServerConfig } from '../config/env.ts';
import type { SessionScope } from '../db/schema/_shared.ts';
import { generateUuidV7 } from '../db/uuid.ts';
import { apiErrorHandler, apiNotFoundHandler } from '../http/middleware.ts';
import { createAuthMiddlewareSuite } from '../middleware/auth.ts';
import type {
  AuthCredentialUserRecord,
  AuthMembershipSummary,
  AuthRepository,
  EmailVerificationTokenRecord,
  SessionWithContextRecord,
} from '../repositories/auth.repository.ts';
import { createAuthRouter } from '../routes/auth.routes.ts';
import {
  CSRF_TOKEN_HEADER,
  CUSTOM_REQUEST_HEADER,
  createAuthenticatedCsrfMiddleware,
  createPreAuthCsrfMiddleware,
} from '../security/csrf.ts';
import { InMemoryRateLimiter } from '../security/rate-limit.ts';
import { ScryptConcurrencyLimiter } from '../security/scrypt-limiter.ts';
import { hashSessionToken } from '../security/session.ts';
import type { RecordAuditEventInput } from './audit.service.ts';
import { createAuthService } from './auth.service.ts';
import {
  RESEND_EMAILS_ENDPOINT,
  buildGuardianVerificationLink,
  createMailService,
} from './mail.service.ts';

interface InMemoryAuthStore {
  now: Date;
  inTransaction: boolean;
  users: Map<string, AuthCredentialUserRecord>;
  emailVerificationTokens: Map<string, EmailVerificationTokenRecord>;
  sessions: Map<
    string,
    {
      id: string;
      tokenHash: string;
      userId: string;
      sessionScope: SessionScope;
      activeOrganizationId: string | null;
      idleExpiresAt: Date;
      absoluteExpiresAt: Date;
      lastActivityAt: Date;
      revokedAt: Date | null;
      revokedReason: string | null;
    }
  >;
  audits: RecordAuditEventInput[];
  capturedTokens: Array<{ userId: string; rawToken: string; tokenHash: string }>;
}

function createStore(): InMemoryAuthStore {
  return {
    now: new Date('2026-11-19T12:00:00.000Z'),
    inTransaction: false,
    users: new Map(),
    emailVerificationTokens: new Map(),
    sessions: new Map(),
    audits: [],
    capturedTokens: [],
  };
}

function createFakeAuthRepo(store: InMemoryAuthStore): AuthRepository {
  return {
    async withTransaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      store.inTransaction = true;
      try {
        return await fn({} as never);
      } finally {
        store.inTransaction = false;
      }
    },
    async findUserCredentialByEmail(email) {
      for (const u of store.users.values()) {
        if (u.email === email) return { ...u };
      }
      return null;
    },
    async findUserCredentialByPlatformUsername(username) {
      for (const u of store.users.values()) {
        if (u.platformUsername === username) return { ...u };
      }
      return null;
    },
    async findUserCredentialById(userId) {
      const u = store.users.get(userId);
      return u ? { ...u } : null;
    },
    async findStudentLoginRecord() {
      return null;
    },
    async findFamilyStudentLoginRecord() {
      return null;
    },
    async createGuardianUser(params) {
      const rec: AuthCredentialUserRecord = {
        id: params.id,
        email: params.email,
        emailVerifiedAt: null,
        platformUsername: null,
        platformRole: 'guardian',
        displayName: params.displayName,
        passwordHash: params.passwordHash,
        status: 'active',
        failedLoginAttempts: 0,
        lockedUntil: null,
      };
      store.users.set(rec.id, rec);
      return { ...rec };
    },
    async createEmailVerificationToken(params) {
      store.emailVerificationTokens.set(params.id, {
        id: params.id,
        userId: params.userId,
        purpose: params.purpose,
        emailSnapshot: params.emailSnapshot,
        tokenHash: params.tokenHash,
        expiresAt: params.expiresAt,
        consumedAt: null,
        revokedAt: null,
        createdAt: params.createdAt,
      });
    },
    async revokeActiveVerificationTokensForUser(userId, purpose, now) {
      for (const tok of store.emailVerificationTokens.values()) {
        if (
          tok.userId === userId &&
          tok.purpose === purpose &&
          tok.consumedAt === null &&
          tok.revokedAt === null
        ) {
          tok.revokedAt = now;
        }
      }
    },
    async findVerificationTokenByHash(tokenHash) {
      for (const tok of store.emailVerificationTokens.values()) {
        if (tok.tokenHash === tokenHash) return { ...tok };
      }
      return null;
    },
    async consumeVerificationTokenAndVerifyUser(params) {
      const tok = store.emailVerificationTokens.get(params.tokenId);
      if (
        !tok ||
        tok.consumedAt !== null ||
        tok.revokedAt !== null ||
        tok.expiresAt <= params.now
      ) {
        return false;
      }
      tok.consumedAt = params.now;
      const u = store.users.get(params.userId);
      if (u && !u.emailVerifiedAt) {
        u.emailVerifiedAt = params.now;
      }
      return true;
    },
    async findMembershipsForUser(): Promise<AuthMembershipSummary[]> {
      return [];
    },
    async createSession(params) {
      store.sessions.set(params.id, {
        id: params.id,
        tokenHash: params.tokenHash,
        userId: params.userId,
        sessionScope: params.sessionScope,
        activeOrganizationId: params.activeOrganizationId,
        idleExpiresAt: params.idleExpiresAt,
        absoluteExpiresAt: params.absoluteExpiresAt,
        lastActivityAt: params.lastActivityAt,
        revokedAt: null,
        revokedReason: null,
      });
    },
    async findSessionWithContextByTokenHash(tokenHash): Promise<SessionWithContextRecord | null> {
      for (const s of store.sessions.values()) {
        if (s.tokenHash !== tokenHash) continue;
        const user = store.users.get(s.userId);
        if (!user) return null;
        return {
          session: { ...s },
          user: { ...user },
          activeOrganization: null,
          activeMembership: null,
          hasActiveFamilyStudentContext: false,
        };
      }
      return null;
    },
    async touchSessionActivity(sessionId, lastActivityAt, idleExpiresAt) {
      const s = store.sessions.get(sessionId);
      if (s && !s.revokedAt) {
        s.lastActivityAt = lastActivityAt;
        s.idleExpiresAt = idleExpiresAt;
      }
    },
    async rotateSession(params) {
      const s = store.sessions.get(params.sessionId);
      if (
        !s ||
        s.tokenHash !== params.expectedTokenHash ||
        s.revokedAt !== null ||
        s.absoluteExpiresAt <= params.lastActivityAt
      ) {
        return false;
      }
      s.tokenHash = params.newTokenHash;
      s.activeOrganizationId = params.newActiveOrganizationId;
      s.sessionScope = params.newSessionScope;
      s.lastActivityAt = params.lastActivityAt;
      s.idleExpiresAt = params.idleExpiresAt;
      return true;
    },
    async revokeSessionById(sessionId, reason, revokedAt) {
      const s = store.sessions.get(sessionId);
      if (s && !s.revokedAt) {
        s.revokedAt = revokedAt;
        s.revokedReason = reason;
      }
    },
    async revokeOtherActiveSessionsForUser(userId, exceptSessionId, reason, revokedAt) {
      let count = 0;
      for (const s of store.sessions.values()) {
        if (s.userId === userId && s.id !== exceptSessionId && !s.revokedAt) {
          s.revokedAt = revokedAt;
          s.revokedReason = reason;
          count += 1;
        }
      }
      return count;
    },
    async recordFailedLoginAttempt() {
      return { failedAttempts: 0, lockedUntil: null, lockedNow: false };
    },
    async recordSuccessfulLoginState() {},
    async updateUserPasswordHash() {},
  };
}

function createAuthHttpHarness(options: {
  store: InMemoryAuthStore;
  env?: Record<string, string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  logMessages?: string[];
}) {
  const { store, logMessages = [] } = options;
  const repo = createFakeAuthRepo(store);
  const config = parseServerConfig({
    NODE_ENV: 'test',
    APP_URL: 'https://mimora.test',
    TRUSTED_ORIGINS: 'https://mimora.test',
    AUTH_CSRF_SECRET: 'test-csrf-secret-key-min-16-chars',
    ...(options.env ?? {}),
  });
  const getConfig = () => config;
  const mailService = createMailService({
    getConfig,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs ?? 200,
    logger: {
      warn: (msg) => logMessages.push(msg),
      error: (msg) => logMessages.push(msg),
    },
  });

  const authService = createAuthService({
    repo,
    rateLimiter: new InMemoryRateLimiter(),
    scryptLimiter: new ScryptConcurrencyLimiter({ maxConcurrent: 4, maxQueue: 16 }),
    getConfig,
    mailService,
    now: () => store.now,
    auditFn: async (input) => {
      store.audits.push(input);
    },
    hashPasswordFn: async (pwd) => `fast$${pwd}`,
    verifyPasswordFn: async (pwd, hash) => hash === `fast$${pwd}`,
    onVerificationTokenCreatedForTest: (info) => {
      store.capturedTokens.push(info);
    },
  });

  const authMiddlewares = createAuthMiddlewareSuite({
    repo,
    getConfig,
    now: () => store.now,
  });

  const app = express();
  app.use(express.json());
  app.use(
    '/api/v1/auth',
    createAuthRouter({
      authService,
      getConfig,
      authMiddlewares,
      preAuthCsrf: createPreAuthCsrfMiddleware({ config }),
      authenticatedCsrf: createAuthenticatedCsrfMiddleware({ config }),
    })
  );
  app.use('/api', apiNotFoundHandler);
  app.use('/api', apiErrorHandler);

  return { app, mailService, config };
}

async function startTestServer(app: express.Express) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

async function httpRequest(
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    cookie?: string;
    csrfToken?: string;
    includeCustomHeader?: boolean;
    origin?: string;
  } = {}
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options.includeCustomHeader !== false) {
    headers[CUSTOM_REQUEST_HEADER] = 'XMLHttpRequest';
  }
  if (options.origin !== undefined) {
    headers.Origin = options.origin;
  } else {
    headers.Origin = 'https://mimora.test';
  }
  if (options.cookie) {
    headers.Cookie = options.cookie;
  }
  if (options.csrfToken) {
    headers[CSRF_TOKEN_HEADER] = options.csrfToken;
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'POST',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, json, text, setCookie };
}

test('MailService unconfigured provider returns explicit unconfigured status and never calls fetch', async () => {
  let fetchCalled = false;
  const config = parseServerConfig({ APP_URL: 'https://mimora.test' });
  const mailService = createMailService({
    getConfig: () => config,
    fetchImpl: async () => {
      fetchCalled = true;
      return new Response('{}', { status: 200 });
    },
  });

  assert.equal(mailService.isConfigured(), false);
  assert.equal(mailService.getProvider(), null);

  const status = await mailService.sendGuardianVerificationEmail({
    to: 'parent@example.com',
    displayName: 'Mẹ An',
    rawToken: 'raw-token-value-12345678901234567890123456',
  });

  assert.equal(fetchCalled, false);
  assert.deepEqual(status, {
    configured: false,
    provider: null,
    delivered: false,
    verificationState: 'pending_verification',
  });
});

test('MailService sends valid Resend HTTPS request with Vietnamese branded template and returns delivered=true', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;

  const config = parseServerConfig({
    APP_URL: 'https://mimora.test/login',
    MAIL_PROVIDER: 'resend',
    RESEND_API_KEY: 're_test_live_secret_key_001',
    MAIL_FROM: 'MIMORA <no-reply@mimora.vn>',
  });

  const mailService = createMailService({
    getConfig: () => config,
    fetchImpl: async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({ id: 'email_123abc' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const rawToken = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
  const status = await mailService.sendGuardianVerificationEmail({
    to: 'me.an@example.com',
    displayName: 'Nguyễn Lan Anh <script>',
    rawToken,
  });

  assert.deepEqual(status, {
    configured: true,
    provider: 'resend',
    delivered: true,
    verificationState: 'pending_verification',
  });
  assert.equal(capturedUrl, RESEND_EMAILS_ENDPOINT);
  assert.equal(capturedInit?.method, 'POST');

  const headers = capturedInit?.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer re_test_live_secret_key_001');
  assert.equal(headers['Content-Type'], 'application/json');

  const payload = JSON.parse(String(capturedInit?.body)) as {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
  };
  assert.equal(payload.from, 'MIMORA <no-reply@mimora.vn>');
  assert.equal(payload.to, 'me.an@example.com');
  assert.match(payload.subject, /MIMORA/);
  assert.match(payload.html, /MIMORA/);
  assert.match(payload.html, /Nguyễn Lan Anh &lt;script&gt;/);
  assert.match(payload.html, /24 giờ/);
  assert.match(payload.html, /bỏ qua email này/i);

  const expectedLink = buildGuardianVerificationLink(rawToken, 'https://mimora.test');
  assert.equal(expectedLink, `https://mimora.test/?verifyToken=${encodeURIComponent(rawToken)}`);
  assert.equal(payload.html.includes(expectedLink!), true);
  assert.equal(payload.html.includes(rawToken), true);
  assert.equal(payload.text.includes(expectedLink!), true);
  assert.equal(payload.text.includes(rawToken), true);
  assert.equal(payload.text.includes('24 giờ'), true);
});

test('MailService handles HTTP rejection, network timeout, malformed JSON/missing id, and sanitizes secrets from logs', async () => {
  const logs: string[] = [];
  const apiKey = 're_super_secret_api_key_99999';
  const rawToken = 'TokenShouldNeverAppearInAnyLogMessage12345678';
  const config = parseServerConfig({
    APP_URL: 'https://mimora.test',
    MAIL_PROVIDER: 'resend',
    RESEND_API_KEY: apiKey,
    MAIL_FROM: 'no-reply@mimora.vn',
  });

  // 1. Provider HTTP rejection (echoing secret-like text that must be redacted)
  const rejectService = createMailService({
    getConfig: () => config,
    logger: { warn: (m) => logs.push(m), error: (m) => logs.push(m) },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          name: 'validation_error',
          message: `Bad key ${apiKey} and verifyToken=${rawToken}`,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      ),
  });
  const rejectResult = await rejectService.sendGuardianVerificationEmail({
    to: 'parent@example.com',
    displayName: 'Phụ huynh',
    rawToken,
  });
  assert.deepEqual(rejectResult, {
    configured: true,
    provider: 'resend',
    delivered: false,
    verificationState: 'pending_verification',
  });

  // 2. Network timeout via AbortController
  const timeoutService = createMailService({
    getConfig: () => config,
    timeoutMs: 25,
    logger: { warn: (m) => logs.push(m), error: (m) => logs.push(m) },
    fetchImpl: async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortErr = new Error('The operation was aborted');
          abortErr.name = 'AbortError';
          reject(abortErr);
        });
      }),
  });
  const timeoutResult = await timeoutService.sendGuardianVerificationEmail({
    to: 'parent@example.com',
    displayName: 'Phụ huynh',
    rawToken,
  });
  assert.equal(timeoutResult.delivered, false);
  assert.equal(timeoutResult.configured, true);

  // 3. Malformed JSON response
  const malformedJsonService = createMailService({
    getConfig: () => config,
    logger: { warn: (m) => logs.push(m), error: (m) => logs.push(m) },
    fetchImpl: async () => new Response('not-json', { status: 200 }),
  });
  const malformedResult = await malformedJsonService.sendGuardianVerificationEmail({
    to: 'parent@example.com',
    displayName: 'Phụ huynh',
    rawToken,
  });
  assert.equal(malformedResult.delivered, false);

  // 4. 200 OK JSON missing email id
  const missingIdService = createMailService({
    getConfig: () => config,
    logger: { warn: (m) => logs.push(m), error: (m) => logs.push(m) },
    fetchImpl: async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  });
  const missingIdResult = await missingIdService.sendGuardianVerificationEmail({
    to: 'parent@example.com',
    displayName: 'Phụ huynh',
    rawToken,
  });
  assert.equal(missingIdResult.delivered, false);

  // Ensure neither rawToken nor API key appears anywhere in logs
  assert.equal(logs.length >= 4, true);
  const allLogs = logs.join('\n');
  assert.equal(allLogs.includes(apiKey), false);
  assert.equal(allLogs.includes(rawToken), false);
});

test('Guardian registration sends verification email outside DB transaction and preserves account even if Resend fails', async () => {
  // Part A: Successful delivery
  const storeOk = createStore();
  const logsOk: string[] = [];
  let wasInsideTxDuringFetch = true;
  let sentBodyText = '';

  const harnessOk = createAuthHttpHarness({
    store: storeOk,
    logMessages: logsOk,
    env: {
      MAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_ok_secret_key_123456',
      MAIL_FROM: 'MIMORA <no-reply@mimora.vn>',
    },
    fetchImpl: async (_url, init) => {
      wasInsideTxDuringFetch = storeOk.inTransaction;
      sentBodyText = String(init?.body ?? '');
      return new Response(JSON.stringify({ id: 'resend_msg_1' }), { status: 200 });
    },
  });
  const srvOk = await startTestServer(harnessOk.app);

  try {
    const regRes = await httpRequest(srvOk.baseUrl, '/api/v1/auth/guardian/register', {
      body: {
        displayName: 'Mẹ Bình',
        email: 'binh@example.com',
        password: 'GuardianPassword123!',
      },
    });
    assert.equal(regRes.status, 201);
    assert.equal(wasInsideTxDuringFetch, false);
    assert.deepEqual(regRes.json.mailDelivery, {
      configured: true,
      provider: 'resend',
      delivered: true,
      verificationState: 'pending_verification',
    });

    assert.equal(storeOk.capturedTokens.length, 1);
    const rawToken = storeOk.capturedTokens[0].rawToken;
    assert.equal(storeOk.capturedTokens[0].tokenHash, hashSessionToken(rawToken));
    assert.equal(regRes.text.includes(rawToken), false);
    assert.equal(regRes.text.includes('verifyToken'), false);
    assert.equal(regRes.text.includes('re_ok_secret_key_123456'), false);
    assert.equal(sentBodyText.includes(`https://mimora.test/?verifyToken=${encodeURIComponent(rawToken)}`), true);
    assert.equal((regRes.json.user as Record<string, unknown>).emailVerified, false);

    // CSRF protection checks on verify-email: GET is rejected 405, missing custom header rejected 403
    const getVerify = await httpRequest(
      srvOk.baseUrl,
      `/api/v1/auth/guardian/verify-email?token=${encodeURIComponent(rawToken)}`,
      { method: 'GET' }
    );
    assert.equal(getVerify.status, 405);

    const noCsrfVerify = await httpRequest(srvOk.baseUrl, '/api/v1/auth/guardian/verify-email', {
      method: 'POST',
      includeCustomHeader: false,
      body: { token: rawToken },
    });
    assert.equal(noCsrfVerify.status, 403);

    // Valid CSRF-protected POST verify-email verifies manual fallback or link confirmation
    const postVerify = await httpRequest(srvOk.baseUrl, '/api/v1/auth/guardian/verify-email', {
      method: 'POST',
      body: { token: rawToken },
    });
    assert.equal(postVerify.status, 200);
    assert.equal(postVerify.json.verified, true);
  } finally {
    await srvOk.close();
  }

  // Part B: Failed email delivery preserves newly created account and returns delivered: false
  const storeFail = createStore();
  const logsFail: string[] = [];
  const harnessFail = createAuthHttpHarness({
    store: storeFail,
    logMessages: logsFail,
    env: {
      MAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_fail_secret_key_654321',
      MAIL_FROM: 'MIMORA <no-reply@mimora.vn>',
    },
    fetchImpl: async () =>
      new Response(JSON.stringify({ name: 'rate_limit_exceeded', message: 'Upstream busy' }), {
        status: 429,
      }),
  });
  const srvFail = await startTestServer(harnessFail.app);

  try {
    const regFailRes = await httpRequest(srvFail.baseUrl, '/api/v1/auth/guardian/register', {
      body: {
        displayName: 'Bố Cường',
        email: 'cuong@example.com',
        password: 'GuardianPassword123!',
      },
    });
    assert.equal(regFailRes.status, 201);
    assert.deepEqual(regFailRes.json.mailDelivery, {
      configured: true,
      provider: 'resend',
      delivered: false,
      verificationState: 'pending_verification',
    });

    // Account and token persist in DB and remain unverified
    assert.equal(storeFail.users.size, 1);
    const savedUser = Array.from(storeFail.users.values())[0];
    assert.equal(savedUser.email, 'cuong@example.com');
    assert.equal(savedUser.emailVerifiedAt, null);
    assert.equal(storeFail.emailVerificationTokens.size, 1);

    const rawTok = storeFail.capturedTokens[0].rawToken;
    assert.equal(regFailRes.text.includes(rawTok), false);
    assert.equal(logsFail.join('\n').includes(rawTok), false);
    assert.equal(logsFail.join('\n').includes('re_fail_secret_key_654321'), false);
  } finally {
    await srvFail.close();
  }
});

test('Resend verification revokes old token, checks expiry, retries after failure, and returns 409 when already verified', async () => {
  const store = createStore();
  let shouldDeliver = false;
  const logs: string[] = [];

  const harness = createAuthHttpHarness({
    store,
    logMessages: logs,
    env: {
      MAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_resend_secret_abc',
      MAIL_FROM: 'MIMORA <no-reply@mimora.vn>',
    },
    fetchImpl: async () =>
      shouldDeliver
        ? new Response(JSON.stringify({ id: 'resend_retry_ok' }), { status: 200 })
        : new Response(JSON.stringify({ name: 'internal_error', message: 'Temporary error' }), {
            status: 500,
          }),
  });
  const srv = await startTestServer(harness.app);

  try {
    // 1. Register while provider is failing
    await httpRequest(srv.baseUrl, '/api/v1/auth/guardian/register', {
      body: {
        displayName: 'Mẹ Dung',
        email: 'dung@example.com',
        password: 'GuardianPassword123!',
      },
    });
    const firstToken = store.capturedTokens[0].rawToken;

    // 2. Guardian logs in to access resend
    const loginRes = await httpRequest(srv.baseUrl, '/api/v1/auth/login', {
      body: {
        mode: 'guardian',
        email: 'dung@example.com',
        password: 'GuardianPassword123!',
      },
    });
    assert.equal(loginRes.status, 200);
    const cookie = String(loginRes.setCookie ?? '').split(';')[0];
    const csrfToken = String(loginRes.json.csrfToken);

    // 3. First resend fails delivery -> still retryable and returns delivered: false
    const resendFail = await httpRequest(srv.baseUrl, '/api/v1/auth/guardian/resend-verification', {
      cookie,
      csrfToken,
      body: {},
    });
    assert.equal(resendFail.status, 200);
    assert.deepEqual(resendFail.json.mailDelivery, {
      configured: true,
      provider: 'resend',
      delivered: false,
      verificationState: 'pending_verification',
    });

    // 4. Provider recovers -> retry resend succeeds
    shouldDeliver = true;
    const resendOk = await httpRequest(srv.baseUrl, '/api/v1/auth/guardian/resend-verification', {
      cookie,
      csrfToken,
      body: {},
    });
    assert.equal(resendOk.status, 200);
    assert.deepEqual(resendOk.json.mailDelivery, {
      configured: true,
      provider: 'resend',
      delivered: true,
      verificationState: 'pending_verification',
    });
    assert.equal(store.capturedTokens.length, 3);
    const latestToken = store.capturedTokens[2].rawToken;
    assert.equal(resendOk.text.includes(latestToken), false);

    // 5. Revoked initial token cannot verify
    const verifyFirst = await httpRequest(srv.baseUrl, '/api/v1/auth/guardian/verify-email', {
      body: { token: firstToken },
    });
    assert.equal(verifyFirst.status, 400);
    assert.equal(verifyFirst.json.code, 'INVALID_VERIFICATION_TOKEN');

    // 6. Expired token cannot verify
    store.now = new Date('2026-11-21T12:00:01.000Z'); // > 24h later
    const verifyExpired = await httpRequest(srv.baseUrl, '/api/v1/auth/guardian/verify-email', {
      body: { token: latestToken },
    });
    assert.equal(verifyExpired.status, 400);
    assert.equal(verifyExpired.json.code, 'VERIFICATION_TOKEN_EXPIRED');

    // Reset clock and verify fresh resend works
    store.now = new Date('2026-11-19T12:05:00.000Z');
    // Seed a valid token manually to test 200 verification and 409 EMAIL_ALREADY_VERIFIED
    const freshToken = 'FreshValidTokenForVerification12345678901234';
    const tokId = generateUuidV7();
    const userId = Array.from(store.users.keys())[0];
    store.emailVerificationTokens.set(tokId, {
      id: tokId,
      userId,
      purpose: 'guardian_email_verify',
      emailSnapshot: 'dung@example.com',
      tokenHash: hashSessionToken(freshToken),
      expiresAt: new Date(store.now.getTime() + 60_000),
      consumedAt: null,
      revokedAt: null,
      createdAt: store.now,
    });

    const verifyFresh = await httpRequest(srv.baseUrl, '/api/v1/auth/guardian/verify-email', {
      body: { token: freshToken },
    });
    assert.equal(verifyFresh.status, 200);

    // Resend when already verified returns 409 EMAIL_ALREADY_VERIFIED
    const resendAfterVerify = await httpRequest(
      srv.baseUrl,
      '/api/v1/auth/guardian/resend-verification',
      {
        cookie,
        csrfToken,
        body: {},
      }
    );
    assert.equal(resendAfterVerify.status, 409);
    assert.equal(resendAfterVerify.json.code, 'EMAIL_ALREADY_VERIFIED');
  } finally {
    await srv.close();
  }
});

test('extractAndCleanVerifyToken extracts ?verifyToken= cleanly and strips only verifyToken from URL', () => {
  let replacedUrl: string | null = null;
  const token = extractAndCleanVerifyToken(
    'https://mimora.test/?foo=1&verifyToken=AbCdEf1234567890&bar=2#section',
    (nextUrl) => {
      replacedUrl = nextUrl;
    }
  );

  assert.equal(token, 'AbCdEf1234567890');
  assert.equal(replacedUrl, '/?foo=1&bar=2#section');

  let untouchedCalled = false;
  const none = extractAndCleanVerifyToken('https://mimora.test/?foo=1', () => {
    untouchedCalled = true;
  });
  assert.equal(none, null);
  assert.equal(untouchedCalled, false);
});
