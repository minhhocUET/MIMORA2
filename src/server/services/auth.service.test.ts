import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import test from 'node:test';
import { parseServerConfig, type ServerConfig } from '../config/env.ts';
import { apiErrorHandler, apiNotFoundHandler } from '../http/middleware.ts';
import { createAuthMiddlewareSuite } from '../middleware/auth.ts';
import type { SessionScope } from '../db/schema/_shared.ts';
import type {
  AuthCredentialUserRecord,
  AuthMembershipSummary,
  AuthRepository,
  CreateSessionParams,
  RotateSessionParams,
  SessionWithContextRecord,
} from '../repositories/auth.repository.ts';
import { createAuthRouter } from '../routes/auth.routes.ts';
import {
  CSRF_TOKEN_HEADER,
  CUSTOM_REQUEST_HEADER,
  createAuthenticatedCsrfMiddleware,
  createPreAuthCsrfMiddleware,
} from '../security/csrf.ts';
import { hashPassword, parseStoredHash } from '../security/password-hash.ts';
import { InMemoryRateLimiter } from '../security/rate-limit.ts';
import { ScryptConcurrencyLimiter } from '../security/scrypt-limiter.ts';
import { hashSessionToken } from '../security/session.ts';
import { createAuthService } from './auth.service.ts';

interface InMemoryAuthStore {
  organizations: Map<string, { id: string; code: string; name: string; status: string }>;
  users: Map<string, AuthCredentialUserRecord>;
  memberships: Array<{
    id: string;
    organizationId: string;
    userId: string;
    role: string;
    orgUsername: string | null;
    status: string;
  }>;
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
  audits: Array<Record<string, unknown>>;
}

function createFakeAuthRepo(store: InMemoryAuthStore): AuthRepository {
  return {
    async withTransaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      return fn({} as never);
    },
    async findUserCredentialByEmail(email: string) {
      for (const u of store.users.values()) {
        if (u.email?.toLowerCase() === email.toLowerCase()) return { ...u };
      }
      return null;
    },
    async findUserCredentialByPlatformUsername(username: string) {
      for (const u of store.users.values()) {
        if (u.platformUsername === username) return { ...u };
      }
      return null;
    },
    async findUserCredentialById(userId: string) {
      const u = store.users.get(userId);
      return u ? { ...u } : null;
    },
    async findStudentLoginRecord(organizationCode: string, orgUsername: string) {
      let org: { id: string; code: string; name: string; status: string } | undefined;
      for (const o of store.organizations.values()) {
        if (o.code === organizationCode) org = o;
      }
      if (!org) return null;
      const membership = store.memberships.find(
        (m) => m.organizationId === org.id && m.orgUsername === orgUsername
      );
      if (!membership) return null;
      const user = store.users.get(membership.userId);
      if (!user) return null;
      return {
        user: { ...user },
        membership: {
          membershipId: membership.id,
          organizationId: org.id,
          organizationCode: org.code,
          organizationName: org.name,
          organizationStatus: org.status,
          role: membership.role,
          membershipStatus: membership.status,
          orgUsername: membership.orgUsername,
        },
      };
    },
    async findMembershipsForUser(userId: string, roleFilter?: string) {
      const result: AuthMembershipSummary[] = [];
      for (const m of store.memberships) {
        if (m.userId !== userId) continue;
        if (roleFilter && m.role !== roleFilter) continue;
        const org = store.organizations.get(m.organizationId);
        if (!org) continue;
        result.push({
          membershipId: m.id,
          organizationId: org.id,
          organizationCode: org.code,
          organizationName: org.name,
          organizationStatus: org.status,
          role: m.role,
          membershipStatus: m.status,
          orgUsername: m.orgUsername,
        });
      }
      return result;
    },
    async createSession(params: CreateSessionParams) {
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
    async findSessionWithContextByTokenHash(tokenHash: string): Promise<SessionWithContextRecord | null> {
      for (const s of store.sessions.values()) {
        if (s.tokenHash !== tokenHash) continue;
        const user = store.users.get(s.userId);
        if (!user) return null;
        const org = s.activeOrganizationId
          ? (store.organizations.get(s.activeOrganizationId) ?? null)
          : null;
        const membership = s.activeOrganizationId
          ? (store.memberships.find(
              (m) => m.organizationId === s.activeOrganizationId && m.userId === s.userId
            ) ?? null)
          : null;

        return {
          session: { ...s },
          user: {
            id: user.id,
            email: user.email,
            platformUsername: user.platformUsername,
            platformRole: user.platformRole,
            displayName: user.displayName,
            status: user.status,
            lockedUntil: user.lockedUntil,
          },
          activeOrganization: org ? { ...org } : null,
          activeMembership: membership
            ? {
                id: membership.id,
                organizationId: membership.organizationId,
                role: membership.role,
                orgUsername: membership.orgUsername,
                status: membership.status,
              }
            : null,
        };
      }
      return null;
    },
    async touchSessionActivity(sessionId: string, lastActivityAt: Date, idleExpiresAt: Date) {
      const s = store.sessions.get(sessionId);
      if (s && s.revokedAt === null) {
        s.lastActivityAt = lastActivityAt;
        s.idleExpiresAt = idleExpiresAt;
      }
    },
    async rotateSession(params: RotateSessionParams) {
      const s = store.sessions.get(params.sessionId);
      if (!s || s.tokenHash !== params.expectedTokenHash || s.revokedAt !== null) {
        return false;
      }
      if (params.lastActivityAt >= s.absoluteExpiresAt) return false;
      s.tokenHash = params.newTokenHash;
      s.activeOrganizationId = params.newActiveOrganizationId;
      s.sessionScope = params.newSessionScope;
      s.lastActivityAt = params.lastActivityAt;
      s.idleExpiresAt = params.idleExpiresAt;
      return true;
    },
    async revokeSessionById(sessionId: string, reason: string, revokedAt: Date) {
      const s = store.sessions.get(sessionId);
      if (s && s.revokedAt === null) {
        s.revokedAt = revokedAt;
        s.revokedReason = reason;
      }
    },
    async revokeOtherActiveSessionsForUser(userId: string, exceptSessionId: string, reason: string, revokedAt: Date) {
      let count = 0;
      for (const s of store.sessions.values()) {
        if (s.userId === userId && s.id !== exceptSessionId && s.revokedAt === null) {
          s.revokedAt = revokedAt;
          s.revokedReason = reason;
          count += 1;
        }
      }
      return count;
    },
    async recordFailedLoginAttempt(userId: string, now: Date, lockoutPolicy) {
      const u = store.users.get(userId)!;
      u.failedLoginAttempts += 1;
      let lockedNow = false;
      if (lockoutPolicy && u.failedLoginAttempts >= lockoutPolicy.maxFailedAttempts) {
        u.lockedUntil = new Date(now.getTime() + lockoutPolicy.lockoutDurationMinutes * 60_000);
        lockedNow = true;
      }
      return { lockedNow, failedAttempts: u.failedLoginAttempts, lockedUntil: u.lockedUntil };
    },
    async recordSuccessfulLoginState(userId: string) {
      const u = store.users.get(userId)!;
      u.failedLoginAttempts = 0;
      u.lockedUntil = null;
    },
    async updateUserPasswordHash(userId: string, newPasswordHash: string) {
      const u = store.users.get(userId)!;
      u.passwordHash = newPasswordHash;
    },
  };
}

const TRUSTED_TEST_ORIGIN = 'https://mimora-test.local';

function extractCookieValue(setCookieHeaders: string[], name: string): string | null {
  for (const header of setCookieHeaders) {
    if (header.startsWith(`${name}=`)) {
      const semi = header.indexOf(';');
      return header.slice(name.length + 1, semi === -1 ? undefined : semi);
    }
  }
  return null;
}

async function buildTestApp(overrides?: {
  config?: ServerConfig;
  now?: () => Date;
  rateLimiter?: InMemoryRateLimiter;
}) {
  const pwdHash = await hashPassword('MimoraPass!2026');
  const org1 = '01950000-0000-7000-8000-000000000001';
  const org2 = '01950000-0000-7000-8000-000000000002';
  const orgSuspended = '01950000-0000-7000-8000-000000000003';
  const adminId = '01950000-0000-7000-8000-000000000011';
  const multiTeacherId = '01950000-0000-7000-8000-000000000012';
  const singleTeacherId = '01950000-0000-7000-8000-000000000013';
  const studentId = '01950000-0000-7000-8000-000000000014';
  const disabledUserId = '01950000-0000-7000-8000-000000000015';
  const unsupportedRoleUserId = '01950000-0000-7000-8000-000000000016';

  const store: InMemoryAuthStore = {
    organizations: new Map([
      [org1, { id: org1, code: 'THCS01', name: 'THCS 01', status: 'active' }],
      [org2, { id: org2, code: 'THCS02', name: 'THCS 02', status: 'active' }],
      [orgSuspended, { id: orgSuspended, code: 'THCS99', name: 'Suspended', status: 'suspended' }],
    ]),
    users: new Map([
      [
        adminId,
        {
          id: adminId,
          email: 'admin@mimora.local',
          platformUsername: 'root_admin',
          platformRole: 'platform_admin',
          displayName: 'Platform Admin',
          passwordHash: pwdHash,
          status: 'active',
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      ],
      [
        multiTeacherId,
        {
          id: multiTeacherId,
          email: 'teacher.multi@mimora.local',
          platformUsername: 'gv_multi',
          platformRole: null,
          displayName: 'Co Lan',
          passwordHash: pwdHash,
          status: 'active',
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      ],
      [
        singleTeacherId,
        {
          id: singleTeacherId,
          email: 'teacher.one@mimora.local',
          platformUsername: 'gv_one',
          platformRole: null,
          displayName: 'Thay Minh',
          passwordHash: pwdHash,
          status: 'active',
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      ],
      [
        studentId,
        {
          id: studentId,
          email: null, // Email-less student
          platformUsername: null,
          platformRole: null,
          displayName: 'Be An',
          passwordHash: pwdHash,
          status: 'active',
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      ],
      [
        disabledUserId,
        {
          id: disabledUserId,
          email: 'disabled@mimora.local',
          platformUsername: 'disabled_user',
          platformRole: 'platform_admin',
          displayName: 'Disabled',
          passwordHash: pwdHash,
          status: 'disabled',
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      ],
      [
        unsupportedRoleUserId,
        {
          id: unsupportedRoleUserId,
          email: 'orgadmin@mimora.local',
          platformUsername: 'fake_org_admin',
          platformRole: null,
          displayName: 'Unsupported Role',
          passwordHash: pwdHash,
          status: 'active',
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      ],
    ]),
    memberships: [
      { id: '01950000-0000-7000-8000-000000000101', organizationId: org1, userId: multiTeacherId, role: 'teacher', orgUsername: null, status: 'active' },
      { id: '01950000-0000-7000-8000-000000000102', organizationId: org2, userId: multiTeacherId, role: 'teacher', orgUsername: null, status: 'active' },
      { id: '01950000-0000-7000-8000-000000000103', organizationId: org1, userId: singleTeacherId, role: 'teacher', orgUsername: null, status: 'active' },
      { id: '01950000-0000-7000-8000-000000000104', organizationId: org1, userId: studentId, role: 'student', orgUsername: 'an_lop5a', status: 'active' },
      { id: '01950000-0000-7000-8000-000000000105', organizationId: org1, userId: unsupportedRoleUserId, role: 'org_admin', orgUsername: null, status: 'active' },
    ],
    sessions: new Map(),
    audits: [],
  };

  let currentNow = new Date('2026-11-16T08:00:00.000Z');
  const nowFn = overrides?.now ?? (() => currentNow);
  const config =
    overrides?.config ??
    parseServerConfig({
      NODE_ENV: 'test',
      APP_URL: TRUSTED_TEST_ORIGIN,
      COOKIE_SECURE: 'true',
      COOKIE_SAMESITE: 'none',
      AUTH_CSRF_SECRET: 'test-csrf-hmac-secret-1234',
    });

  const repo = createFakeAuthRepo(store);
  const rateLimiter = overrides?.rateLimiter ?? new InMemoryRateLimiter();
  const scryptLimiter = new ScryptConcurrencyLimiter({ maxConcurrent: 4, maxQueue: 8 });
  const authService = createAuthService({
    repo,
    rateLimiter,
    scryptLimiter,
    getConfig: () => config,
    now: nowFn,
    auditFn: async (input) => {
      store.audits.push(input as unknown as Record<string, unknown>);
    },
  });

  const authMiddlewares = createAuthMiddlewareSuite({
    repo,
    getConfig: () => config,
    now: nowFn,
  });

  const app = express();
  app.use(express.json());
  app.use(
    '/api/v1/auth',
    createAuthRouter({
      authService,
      getConfig: () => config,
      authMiddlewares,
      preAuthCsrf: createPreAuthCsrfMiddleware({ config }),
      authenticatedCsrf: createAuthenticatedCsrfMiddleware({ config }),
    })
  );

  // Guarded test routes to demonstrate requireAuth + requireOrgContext + requireRole behavior
  app.get(
    '/api/v1/test/admin-only',
    authMiddlewares.requireAuth,
    authMiddlewares.requireRole('platform_admin'),
    (_req, res) => res.status(200).json({ scope: 'admin' })
  );
  app.get(
    '/api/v1/test/teacher-org-scoped',
    authMiddlewares.requireAuth,
    authMiddlewares.requireOrgContext,
    authMiddlewares.requireRole('teacher'),
    (req, res) => res.status(200).json({ orgId: req.auth!.activeOrganizationId })
  );
  app.get(
    '/api/v1/test/student-only',
    authMiddlewares.requireAuth,
    authMiddlewares.requireOrgContext,
    authMiddlewares.requireRole('student'),
    (req, res) => res.status(200).json({ membershipId: req.auth!.organizationMembershipId })
  );

  app.use('/api', apiNotFoundHandler);
  app.use('/api', apiErrorHandler);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    store,
    ids: { org1, org2, orgSuspended, adminId, multiTeacherId, singleTeacherId, studentId },
    advanceTimeMs(ms: number) {
      currentNow = new Date(currentNow.getTime() + ms);
    },
    close() {
      return new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve()))
      );
    },
  };
}

test('Admin, multi-org Teacher, and email-less Student login flows, org switching, rotation, logout, and RBAC enforcement', async () => {
  const ctx = await buildTestApp();
  try {
    // 1. Generic failure equality: unknown user vs wrong password vs disabled vs unsupported role (org_admin)
    const loginHeaders = {
      'Content-Type': 'application/json',
      Origin: TRUSTED_TEST_ORIGIN,
      [CUSTOM_REQUEST_HEADER]: 'MIMORA',
    };

    const failPayloads = [
      { mode: 'admin_teacher', identifier: 'nobody@mimora.local', password: 'MimoraPass!2026' },
      { mode: 'admin_teacher', identifier: 'admin@mimora.local', password: 'WrongPassword!' },
      { mode: 'admin_teacher', identifier: 'disabled@mimora.local', password: 'MimoraPass!2026' },
      { mode: 'admin_teacher', identifier: 'orgadmin@mimora.local', password: 'MimoraPass!2026' },
      { mode: 'student', organizationCode: 'NOORG', orgUsername: 'an_lop5a', password: 'MimoraPass!2026' },
      { mode: 'student', organizationCode: 'THCS01', orgUsername: 'an_lop5a', password: 'WrongPassword!' },
    ];

    const failBodies = [];
    for (const payload of failPayloads) {
      const res = await fetch(`${ctx.baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: loginHeaders,
        body: JSON.stringify(payload),
      });
      assert.equal(res.status, 401);
      const body = (await res.json()) as { code: string; messageKey: string; message: string };
      failBodies.push({ code: body.code, messageKey: body.messageKey, message: body.message });
    }
    for (const item of failBodies) {
      assert.deepEqual(item, failBodies[0], 'All login failures must return identical generic contract');
    }

    // 2. Email-less Student login (case-insensitive orgCode & orgUsername normalization)
    const studentLoginRes = await fetch(`${ctx.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: loginHeaders,
      body: JSON.stringify({
        mode: 'student',
        organizationCode: 'thcs01',
        orgUsername: 'AN_LOP5A',
        password: 'MimoraPass!2026',
      }),
    });
    assert.equal(studentLoginRes.status, 200);
    const studentCookies = studentLoginRes.headers.getSetCookie();
    assert.ok(studentCookies.some((c) => c.includes('HttpOnly') && c.includes('Secure') && c.includes('SameSite=None')));
    const studentToken = extractCookieValue(studentCookies, 'mimora_session')!;
    assert.ok(studentToken && studentToken.length === 43);

    const studentBody = (await studentLoginRes.json()) as {
      user: Record<string, unknown>;
      session: { id: string; scope: string; activeOrganizationId: string };
      csrfToken: string;
    };
    assert.equal(studentBody.session.scope, 'student');
    assert.equal(studentBody.session.activeOrganizationId, ctx.ids.org1);
    assert.equal('passwordHash' in studentBody.user, false);

    // Confirm raw token is NOT stored in DB session record (only SHA-256 hash)
    const storedStudentSession = ctx.store.sessions.get(studentBody.session.id)!;
    assert.notEqual(storedStudentSession.tokenHash, studentToken);
    assert.equal(storedStudentSession.tokenHash, hashSessionToken(studentToken));

    // Student RBAC: allowed on student route, 403 on teacher/admin routes
    const studentAllowed = await fetch(`${ctx.baseUrl}/api/v1/test/student-only`, {
      headers: { Cookie: `mimora_session=${studentToken}` },
    });
    assert.equal(studentAllowed.status, 200);

    const studentDeniedAdmin = await fetch(`${ctx.baseUrl}/api/v1/test/admin-only`, {
      headers: { Cookie: `mimora_session=${studentToken}` },
    });
    assert.equal(studentDeniedAdmin.status, 403);

    // 3. Multi-org Teacher login -> requires organization selection before org-scoped access
    const teacherLoginRes = await fetch(`${ctx.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: loginHeaders,
      body: JSON.stringify({
        mode: 'admin_teacher',
        identifier: 'gv_multi',
        password: 'MimoraPass!2026',
      }),
    });
    assert.equal(teacherLoginRes.status, 200);
    const teacherToken1 = extractCookieValue(teacherLoginRes.headers.getSetCookie(), 'mimora_session')!;
    const teacherBody1 = (await teacherLoginRes.json()) as {
      requiresOrganizationSelection: boolean;
      organizations: Array<{ organizationId: string }>;
      session: { activeOrganizationId: string | null };
      csrfToken: string;
    };
    assert.equal(teacherBody1.requiresOrganizationSelection, true);
    assert.equal(teacherBody1.session.activeOrganizationId, null);
    assert.equal(teacherBody1.organizations.length, 2);

    // Teacher without active org is blocked from org-scoped route (403 ORGANIZATION_CONTEXT_REQUIRED)
    const missingOrgRes = await fetch(`${ctx.baseUrl}/api/v1/test/teacher-org-scoped`, {
      headers: { Cookie: `mimora_session=${teacherToken1}` },
    });
    assert.equal(missingOrgRes.status, 403);
    assert.equal(((await missingOrgRes.json()) as { code: string }).code, 'ORGANIZATION_CONTEXT_REQUIRED');

    // Cross-tenant switch to suspended/unassigned org fails 403
    const badSwitchRes = await fetch(`${ctx.baseUrl}/api/v1/auth/switch-organization`, {
      method: 'POST',
      headers: {
        ...loginHeaders,
        Cookie: `mimora_session=${teacherToken1}`,
        [CSRF_TOKEN_HEADER]: teacherBody1.csrfToken,
      },
      body: JSON.stringify({ organizationId: ctx.ids.orgSuspended }),
    });
    assert.equal(badSwitchRes.status, 403);

    // Valid switch organization rotates raw token and updates activeOrganizationId
    const switchRes = await fetch(`${ctx.baseUrl}/api/v1/auth/switch-organization`, {
      method: 'POST',
      headers: {
        ...loginHeaders,
        Cookie: `mimora_session=${teacherToken1}`,
        [CSRF_TOKEN_HEADER]: teacherBody1.csrfToken,
      },
      body: JSON.stringify({ organizationId: ctx.ids.org2 }),
    });
    assert.equal(switchRes.status, 200);
    const teacherToken2 = extractCookieValue(switchRes.headers.getSetCookie(), 'mimora_session')!;
    assert.notEqual(teacherToken2, teacherToken1);
    const switchBody = (await switchRes.json()) as {
      session: { activeOrganizationId: string };
      requiresOrganizationSelection: boolean;
      csrfToken: string;
    };
    assert.equal(switchBody.session.activeOrganizationId, ctx.ids.org2);
    assert.equal(switchBody.requiresOrganizationSelection, false);

    // Old token immediately invalid!
    const oldTokenCheck = await fetch(`${ctx.baseUrl}/api/v1/auth/me`, {
      headers: { Cookie: `mimora_session=${teacherToken1}` },
    });
    assert.equal(oldTokenCheck.status, 401);

    // New token passes org-scoped route with server-derived org2
    const orgRouteRes = await fetch(`${ctx.baseUrl}/api/v1/test/teacher-org-scoped`, {
      headers: { Cookie: `mimora_session=${teacherToken2}` },
    });
    assert.equal(orgRouteRes.status, 200);
    assert.equal(((await orgRouteRes.json()) as { orgId: string }).orgId, ctx.ids.org2);

    // 4. Logout revokes session and clears cookie
    const logoutRes = await fetch(`${ctx.baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: {
        ...loginHeaders,
        Cookie: `mimora_session=${teacherToken2}`,
        [CSRF_TOKEN_HEADER]: switchBody.csrfToken,
      },
    });
    assert.equal(logoutRes.status, 200);
    const afterLogoutMe = await fetch(`${ctx.baseUrl}/api/v1/auth/me`, {
      headers: { Cookie: `mimora_session=${teacherToken2}` },
    });
    assert.equal(afterLogoutMe.status, 401);

    // 5. Admin login + active-status re-verification + password change
    const adminLoginRes = await fetch(`${ctx.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: loginHeaders,
      body: JSON.stringify({
        mode: 'admin_teacher',
        identifier: 'ADMIN@MIMORA.LOCAL',
        password: 'MimoraPass!2026',
      }),
    });
    assert.equal(adminLoginRes.status, 200);
    const adminToken1 = extractCookieValue(adminLoginRes.headers.getSetCookie(), 'mimora_session')!;
    const adminBody = (await adminLoginRes.json()) as {
      session: { scope: string };
      csrfToken: string;
    };
    assert.equal(adminBody.session.scope, 'platform_admin');

    // Change password revokes other sessions and rotates current session
    const pwdChangeRes = await fetch(`${ctx.baseUrl}/api/v1/auth/change-password`, {
      method: 'POST',
      headers: {
        ...loginHeaders,
        Cookie: `mimora_session=${adminToken1}`,
        [CSRF_TOKEN_HEADER]: adminBody.csrfToken,
      },
      body: JSON.stringify({
        currentPassword: 'MimoraPass!2026',
        newPassword: 'NewMimoraPass!2026',
      }),
    });
    assert.equal(pwdChangeRes.status, 200);
    const adminToken2 = extractCookieValue(pwdChangeRes.headers.getSetCookie(), 'mimora_session')!;
    assert.notEqual(adminToken2, adminToken1);

    // Old token invalidated after password change
    assert.equal(
      (await fetch(`${ctx.baseUrl}/api/v1/auth/me`, { headers: { Cookie: `mimora_session=${adminToken1}` } })).status,
      401
    );

    // New token works; disabling user immediately invalidates active session on next request
    assert.equal(
      (await fetch(`${ctx.baseUrl}/api/v1/test/admin-only`, { headers: { Cookie: `mimora_session=${adminToken2}` } })).status,
      200
    );
    ctx.store.users.get(ctx.ids.adminId)!.status = 'disabled';
    assert.equal(
      (await fetch(`${ctx.baseUrl}/api/v1/auth/me`, { headers: { Cookie: `mimora_session=${adminToken2}` } })).status,
      401
    );

    // Audit hygiene: no raw passwords, password hashes, or raw tokens in audit entries
    const serializedAudits = JSON.stringify(ctx.store.audits);
    assert.equal(serializedAudits.includes('MimoraPass!2026'), false);
    assert.equal(serializedAudits.includes('NewMimoraPass!2026'), false);
    assert.equal(serializedAudits.includes(studentToken), false);
    assert.equal(serializedAudits.includes(teacherToken1), false);
    assert.equal(serializedAudits.includes('scrypt$v1$'), false);
  } finally {
    await ctx.close();
  }
});

test('Rate limiting runs BEFORE scrypt verification and optional lockout config enforces threshold', async () => {
  let verifyCalls = 0;
  const config = parseServerConfig({
    NODE_ENV: 'test',
    APP_URL: TRUSTED_TEST_ORIGIN,
    RATE_LIMIT_WINDOW_MS: '60000',
    RATE_LIMIT_IP_MAX: '2',
    RATE_LIMIT_IDENTIFIER_MAX: '10',
    LOCKOUT_MAX_FAILED_ATTEMPTS: '2',
    LOCKOUT_DURATION_MINUTES: '15',
  });

  const ctx = await buildTestApp({ config });
  const rateLimiter = new InMemoryRateLimiter();
  const repo = {
    async withTransaction<T>(fn: (tx: never) => Promise<T>) {
      return fn({} as never);
    },
    async findUserCredentialByEmail() {
      return {
        id: 'u1',
        email: 'admin@mimora.local',
        platformUsername: 'admin',
        platformRole: 'platform_admin',
        displayName: 'Admin',
        passwordHash: await hashPassword('CorrectPass123!'),
        status: 'active',
        failedLoginAttempts: 0,
        lockedUntil: null,
      };
    },
    async findUserCredentialByPlatformUsername() {
      return null;
    },
    async findUserCredentialById() {
      return null;
    },
    async findStudentLoginRecord() {
      return null;
    },
    async findMembershipsForUser() {
      return [];
    },
    async createSession() {},
    async findSessionWithContextByTokenHash() {
      return null;
    },
    async touchSessionActivity() {},
    async rotateSession() {
      return true;
    },
    async revokeSessionById() {},
    async revokeOtherActiveSessionsForUser() {
      return 0;
    },
    async recordFailedLoginAttempt() {
      return { lockedNow: true, failedAttempts: 2, lockedUntil: new Date(Date.now() + 900_000) };
    },
    async recordSuccessfulLoginState() {},
    async updateUserPasswordHash() {},
  } satisfies AuthRepository;

  const service = createAuthService({
    repo,
    rateLimiter,
    getConfig: () => config,
    auditFn: async () => undefined,
    verifyPasswordFn: async () => {
      verifyCalls += 1;
      return false;
    },
  });

  try {
    // First 2 attempts invoke scrypt verifyPassword and fail 401
    for (let i = 0; i < 2; i += 1) {
      await assert.rejects(
        () =>
          service.login(
            { mode: 'admin_teacher', identifier: 'admin@mimora.local', password: 'wrong' },
            { ip: '198.51.100.10', ipPrefix: '198.51.100.0/24', userAgentHash: null }
          ),
        /INVALID_CREDENTIALS|Thông tin đăng nhập/
      );
    }
    assert.equal(verifyCalls, 2);

    // 3rd attempt must fail 429 BEFORE verifyPassword is called
    await assert.rejects(
      () =>
        service.login(
          { mode: 'admin_teacher', identifier: 'admin@mimora.local', password: 'wrong' },
          { ip: '198.51.100.10', ipPrefix: '198.51.100.0/24', userAgentHash: null }
        ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal((err as { httpStatus?: number }).httpStatus, 429);
        return true;
      }
    );
    assert.equal(verifyCalls, 2, 'verifyPassword must NOT run when pre-auth rate limited');
  } finally {
    await ctx.close();
  }
});

test('requireAuth refreshes idle timeout on activity and enforces absolute timeout for platform_admin (30m / 8h)', async () => {
  const ctx = await buildTestApp();
  try {
    const loginRes = await fetch(`${ctx.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: TRUSTED_TEST_ORIGIN,
        [CUSTOM_REQUEST_HEADER]: 'MIMORA',
      },
      body: JSON.stringify({
        mode: 'admin_teacher',
        identifier: 'root_admin',
        password: 'MimoraPass!2026',
      }),
    });
    assert.equal(loginRes.status, 200);
    const token = extractCookieValue(loginRes.headers.getSetCookie(), 'mimora_session')!;

    // At +20 minutes (within 30m idle), /me succeeds and refreshes idle expiry
    ctx.advanceTimeMs(20 * 60 * 1000);
    const res20 = await fetch(`${ctx.baseUrl}/api/v1/auth/me`, {
      headers: { Cookie: `mimora_session=${token}` },
    });
    assert.equal(res20.status, 200);
    const body20 = (await res20.json()) as {
      session: { idleExpiresAt: string; absoluteExpiresAt: string };
    };
    assert.equal(body20.session.idleExpiresAt, '2026-11-16T08:50:00.000Z');
    assert.equal(body20.session.absoluteExpiresAt, '2026-11-16T16:00:00.000Z');

    // At +7h 50m from start? Wait: first jump across 30m idle gap on a fresh check -> test idle expiry
    // Advance +31 minutes -> exceeds idleExpiresAt (08:50) -> 401 and session revoked
    ctx.advanceTimeMs(31 * 60 * 1000);
    const expiredRes = await fetch(`${ctx.baseUrl}/api/v1/auth/me`, {
      headers: { Cookie: `mimora_session=${token}` },
    });
    assert.equal(expiredRes.status, 401);

    // Absolute timeout enforcement (platform_admin 8h, regardless of activity)
    const loginRes2 = await fetch(`${ctx.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: TRUSTED_TEST_ORIGIN,
        [CUSTOM_REQUEST_HEADER]: 'MIMORA',
      },
      body: JSON.stringify({
        mode: 'admin_teacher',
        identifier: 'root_admin',
        password: 'MimoraPass!2026',
      }),
    });
    assert.equal(loginRes2.status, 200);
    const token2 = extractCookieValue(loginRes2.headers.getSetCookie(), 'mimora_session')!;

    // Keep session alive through 7h55m via periodic touches (never idle >= 30m)
    for (let step = 0; step < 19; step += 1) {
      ctx.advanceTimeMs(25 * 60 * 1000);
      const keepAlive = await fetch(`${ctx.baseUrl}/api/v1/auth/me`, {
        headers: { Cookie: `mimora_session=${token2}` },
      });
      assert.equal(keepAlive.status, 200);
    }

    // Advance +10m -> crosses 8h00m absoluteExpiresAt even though idle was just refreshed
    ctx.advanceTimeMs(10 * 60 * 1000);
    const absExpired = await fetch(`${ctx.baseUrl}/api/v1/auth/me`, {
      headers: { Cookie: `mimora_session=${token2}` },
    });
    assert.equal(absExpired.status, 401);

    // Teacher 2h/12h and Student 4h/12h policy check
    const teacherLogin = await fetch(`${ctx.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: TRUSTED_TEST_ORIGIN,
        [CUSTOM_REQUEST_HEADER]: 'MIMORA',
      },
      body: JSON.stringify({
        mode: 'admin_teacher',
        identifier: 'gv_one',
        password: 'MimoraPass!2026',
      }),
    });
    assert.equal(teacherLogin.status, 200);
    const teacherResBody = (await teacherLogin.json()) as {
      session: { idleExpiresAt: string; absoluteExpiresAt: string };
    };
    const tIdleDiff =
      new Date(teacherResBody.session.idleExpiresAt).getTime() -
      (new Date(teacherResBody.session.absoluteExpiresAt).getTime() - 10 * 60 * 60 * 1000);
    assert.equal(tIdleDiff, 0);

    const studentLogin = await fetch(`${ctx.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: TRUSTED_TEST_ORIGIN,
        [CUSTOM_REQUEST_HEADER]: 'MIMORA',
      },
      body: JSON.stringify({
        mode: 'student',
        organizationCode: 'THCS01',
        orgUsername: 'an_lop5a',
        password: 'MimoraPass!2026',
      }),
    });
    assert.equal(studentLogin.status, 200);
    const studentResBody = (await studentLogin.json()) as {
      session: { idleExpiresAt: string; absoluteExpiresAt: string };
    };
    const sIdleDiff =
      new Date(studentResBody.session.idleExpiresAt).getTime() -
      (new Date(studentResBody.session.absoluteExpiresAt).getTime() - 8 * 60 * 60 * 1000);
    assert.equal(sIdleDiff, 0);
  } finally {
    await ctx.close();
  }
});

test('Unknown user login runs dummy scrypt hash compatible with strict parseStoredHash', async () => {
  const seenHashes: string[] = [];
  const config = parseServerConfig({
    NODE_ENV: 'test',
    APP_URL: TRUSTED_TEST_ORIGIN,
  });
  const repo = {
    async withTransaction<T>(fn: (tx: never) => Promise<T>) {
      return fn({} as never);
    },
    async findUserCredentialByEmail() {
      return null;
    },
    async findUserCredentialByPlatformUsername() {
      return null;
    },
    async findUserCredentialById() {
      return null;
    },
    async findStudentLoginRecord() {
      return null;
    },
    async findMembershipsForUser() {
      return [];
    },
    async createSession() {},
    async findSessionWithContextByTokenHash() {
      return null;
    },
    async touchSessionActivity() {},
    async rotateSession() {
      return true;
    },
    async revokeSessionById() {},
    async revokeOtherActiveSessionsForUser() {
      return 0;
    },
    async recordFailedLoginAttempt() {
      return { lockedNow: false, failedAttempts: 0, lockedUntil: null };
    },
    async recordSuccessfulLoginState() {},
    async updateUserPasswordHash() {},
  } satisfies AuthRepository;

  const service = createAuthService({
    repo,
    rateLimiter: new InMemoryRateLimiter(),
    getConfig: () => config,
    auditFn: async () => undefined,
    verifyPasswordFn: async (_pw, storedHash) => {
      seenHashes.push(storedHash);
      return false;
    },
  });

  await assert.rejects(
    () =>
      service.login(
        { mode: 'admin_teacher', identifier: 'unknown@mimora.local', password: 'AnyPassword!123' },
        { ip: '198.51.100.20', ipPrefix: '198.51.100.0/24', userAgentHash: null }
      ),
    /INVALID_CREDENTIALS|Thông tin đăng nhập/
  );
  assert.equal(seenHashes.length, 1);
  assert.ok(parseStoredHash(seenHashes[0]) !== null, 'DUMMY_SCRYPT_HASH must be valid canonical scrypt$v1 format');
});
