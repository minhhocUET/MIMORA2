import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import test, { describe, it } from 'node:test';
import {
  authApi,
  clearInMemoryCsrfToken,
  getInMemoryCsrfToken,
} from '../../api/client.ts';
import { parseServerConfig, type ServerConfig } from '../config/env.ts';
import type { SessionScope } from '../db/schema/_shared.ts';
import { apiErrorHandler, apiNotFoundHandler } from '../http/middleware.ts';
import type {
  AuthCredentialUserRecord,
  AuthMembershipSummary,
  AuthRepository,
  CreateSessionParams,
  FamilyStudentLoginLookupRecord,
  RotateSessionParams,
  SessionWithContextRecord,
} from '../repositories/auth.repository.ts';
import { createDemoRouter } from '../routes/demo.routes.ts';
import { CUSTOM_REQUEST_HEADER } from '../security/csrf.ts';
import { InMemoryRateLimiter } from '../security/rate-limit.ts';
import { assertSafeAuditMetadata } from './audit.service.ts';
import { createDemoAuthService } from './demo-auth.service.ts';

interface FakeDemoStore {
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
  familyWorkspaces: Map<string, { id: string; code: string; name: string; status: string }>;
  familyStudents: Array<{
    id: string;
    familyWorkspaceId: string;
    studentUserId: string;
    familyUsername: string;
    status: string;
    hasActiveGuardianLink: boolean;
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

function createSeededDemoStore(): FakeDemoStore {
  const orgId = '01950000-0000-7000-8000-000000000101';
  const workspaceId = '01950000-0000-7000-8000-000000000201';

  const adminId = '01950000-0000-7000-8000-000000000001';
  const teacherId = '01950000-0000-7000-8000-000000000002';
  const guardianId = '01950000-0000-7000-8000-000000000003';
  const studentDualId = '01950000-0000-7000-8000-000000000004';
  const studentFamilyId = '01950000-0000-7000-8000-000000000005';
  const unverifiedGuardianId = '01950000-0000-7000-8000-000000000099';

  const verifiedAt = new Date('2026-11-18T10:00:00Z');

  return {
    organizations: new Map([
      [
        orgId,
        {
          id: orgId,
          code: 'MIMORA-DEMO',
          name: 'Trường Hòa Nhập Demo MIMORA',
          status: 'active',
        },
      ],
    ]),
    users: new Map([
      [
        adminId,
        {
          id: adminId,
          email: null,
          emailVerifiedAt: null,
          platformUsername: 'demo_admin',
          platformRole: 'platform_admin',
          displayName: 'MIMORA Demo Admin',
          passwordHash: 'scrypt$v1$dummy',
          status: 'active',
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      ],
      [
        teacherId,
        {
          id: teacherId,
          email: null,
          emailVerifiedAt: null,
          platformUsername: 'demo_teacher',
          platformRole: null,
          displayName: 'MIMORA Demo Teacher',
          passwordHash: 'scrypt$v1$dummy',
          status: 'active',
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      ],
      [
        guardianId,
        {
          id: guardianId,
          email: 'demo.guardian@example.com',
          emailVerifiedAt: verifiedAt,
          platformUsername: null,
          platformRole: 'guardian',
          displayName: 'MIMORA Demo Guardian',
          passwordHash: 'scrypt$v1$dummy',
          status: 'active',
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      ],
      [
        studentDualId,
        {
          id: studentDualId,
          email: null,
          emailVerifiedAt: null,
          platformUsername: 'demo_student_dual',
          platformRole: null,
          displayName: 'Minh Anh (Demo)',
          passwordHash: 'scrypt$v1$dummy',
          status: 'active',
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      ],
      [
        studentFamilyId,
        {
          id: studentFamilyId,
          email: null,
          emailVerifiedAt: null,
          platformUsername: 'demo_student_family',
          platformRole: null,
          displayName: 'Bảo An (Demo)',
          passwordHash: 'scrypt$v1$dummy',
          status: 'active',
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      ],
      [
        unverifiedGuardianId,
        {
          id: unverifiedGuardianId,
          email: 'other.unverified@example.com',
          emailVerifiedAt: null,
          platformUsername: null,
          platformRole: 'guardian',
          displayName: 'Other Unverified',
          passwordHash: 'scrypt$v1$dummy',
          status: 'active',
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      ],
    ]),
    memberships: [
      {
        id: '01950000-0000-7000-8000-000000000301',
        organizationId: orgId,
        userId: teacherId,
        role: 'teacher',
        orgUsername: 'demo_teacher',
        status: 'active',
      },
      {
        id: '01950000-0000-7000-8000-000000000302',
        organizationId: orgId,
        userId: studentDualId,
        role: 'student',
        orgUsername: 'demo_student_dual',
        status: 'active',
      },
    ],
    familyWorkspaces: new Map([
      [
        workspaceId,
        {
          id: workspaceId,
          code: 'FAM-DMO001',
          name: 'Gia đình Demo MIMORA',
          status: 'active',
        },
      ],
    ]),
    familyStudents: [
      {
        id: '01950000-0000-7000-8000-000000000401',
        familyWorkspaceId: workspaceId,
        studentUserId: studentFamilyId,
        familyUsername: 'demo_student_family',
        status: 'active',
        hasActiveGuardianLink: true,
      },
    ],
    sessions: new Map(),
    audits: [],
  };
}

function createFakeRepo(store: FakeDemoStore): AuthRepository {
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
      const org = Array.from(store.organizations.values()).find(
        (o) => o.code === organizationCode
      );
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
    async findFamilyStudentLoginRecord(
      workspaceCode: string,
      familyUsername: string
    ): Promise<FamilyStudentLoginLookupRecord | null> {
      const ws = Array.from(store.familyWorkspaces.values()).find(
        (w) => w.code === workspaceCode
      );
      if (!ws) return null;
      const fs = store.familyStudents.find(
        (item) =>
          item.familyWorkspaceId === ws.id &&
          item.familyUsername === familyUsername
      );
      if (!fs) return null;
      const user = store.users.get(fs.studentUserId);
      if (!user) return null;
      return {
        user: { ...user },
        familyWorkspace: { ...ws },
        familyStudent: {
          id: fs.id,
          familyWorkspaceId: fs.familyWorkspaceId,
          studentUserId: fs.studentUserId,
          familyUsername: fs.familyUsername,
          status: fs.status,
        },
        hasActiveGuardianLink: fs.hasActiveGuardianLink,
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
    async findSessionWithContextByTokenHash(): Promise<SessionWithContextRecord | null> {
      return null;
    },
    async touchSessionActivity() {},
    async rotateSession(_params: RotateSessionParams) {
      return false;
    },
    async revokeSessionById() {},
    async revokeOtherActiveSessionsForUser() {
      return 0;
    },
    async recordSuccessfulLoginState() {},
    async recordFailedLoginAttempt() {
      return { failedAttempts: 0, lockedNow: false, lockedUntil: null };
    },
    async updateUserPasswordHash() {},
  };
}

function makeTestConfig(overrides: Partial<Record<string, string>> = {}): ServerConfig {
  return parseServerConfig({
    NODE_ENV: 'test',
    COOKIE_SECURE: 'false',
    AUTH_CSRF_SECRET: 'test-csrf-secret-value-at-least-16-chars',
    TRUSTED_ORIGINS: 'http://localhost:3000',
    RATE_LIMIT_WINDOW_MS: '60000',
    RATE_LIMIT_IP_MAX: '20',
    RATE_LIMIT_IDENTIFIER_MAX: '10',
    MIMORA_DEMO_MODE: 'true',
    ...overrides,
  });
}

describe('P4-DEMO-03 Env config gate & DemoAuthService allowlist safety', () => {
  it('defaults MIMORA_DEMO_MODE to false and validates boolean values strictly', () => {
    const unsetCfg = parseServerConfig({ NODE_ENV: 'test', COOKIE_SECURE: 'false' });
    assert.equal(unsetCfg.demoMode, false);

    const falseCfg = parseServerConfig({
      NODE_ENV: 'test',
      COOKIE_SECURE: 'false',
      MIMORA_DEMO_MODE: 'false',
    });
    assert.equal(falseCfg.demoMode, false);

    const trueCfg = parseServerConfig({
      NODE_ENV: 'test',
      COOKIE_SECURE: 'false',
      MIMORA_DEMO_MODE: 'true',
    });
    assert.equal(trueCfg.demoMode, true);

    assert.throws(() =>
      parseServerConfig({
        NODE_ENV: 'test',
        COOKIE_SECURE: 'false',
        MIMORA_DEMO_MODE: 'yes_please',
      })
    );
  });

  it('rejects demo login when MIMORA_DEMO_MODE is disabled', async () => {
    const store = createSeededDemoStore();
    const service = createDemoAuthService({
      repo: createFakeRepo(store),
      getConfig: () => makeTestConfig({ MIMORA_DEMO_MODE: 'false' }),
    });

    await assert.rejects(
      () =>
        service.loginDemoPersona('admin', {
          ip: '127.0.0.1',
          ipPrefix: '127.0.0.x',
          userAgentHash: null,
        }),
      (err: unknown) => {
        assert.equal((err as { code?: string }).code, 'DEMO_MODE_DISABLED');
        assert.equal((err as { httpStatus?: number }).httpStatus, 404);
        return true;
      }
    );
    assert.equal(store.sessions.size, 0);
  });

  it('logs into all 5 allowlisted synthetic personas with exact portals and safe audit logs', async () => {
    const store = createSeededDemoStore();
    const service = createDemoAuthService({
      repo: createFakeRepo(store),
      getConfig: () => makeTestConfig({ MIMORA_DEMO_MODE: 'true' }),
      auditFn: async (input) => {
        assertSafeAuditMetadata(input.metadata ?? null, input.targetType ?? null);
        store.audits.push(input as unknown as Record<string, unknown>);
        return {};
      },
    });

    const adminRes = await service.loginDemoPersona('admin', {
      ip: '127.0.0.1',
      ipPrefix: '127.0.0.x',
      userAgentHash: null,
    });
    assert.equal(adminRes.payload.user.platformUsername, 'demo_admin');
    assert.equal(adminRes.payload.user.platformRole, 'platform_admin');
    assert.equal(adminRes.payload.session.scope, 'platform_admin');
    assert.equal(adminRes.payload.activeOrganization, null);

    const teacherRes = await service.loginDemoPersona('teacher', {
      ip: '127.0.0.1',
      ipPrefix: '127.0.0.x',
      userAgentHash: null,
    });
    assert.equal(teacherRes.payload.user.platformUsername, 'demo_teacher');
    assert.equal(teacherRes.payload.session.scope, 'teacher');
    assert.equal(teacherRes.payload.activeOrganization?.code, 'MIMORA-DEMO');
    assert.equal(teacherRes.payload.requiresOrganizationSelection, false);

    const guardianRes = await service.loginDemoPersona('guardian', {
      ip: '127.0.0.1',
      ipPrefix: '127.0.0.x',
      userAgentHash: null,
    });
    assert.equal(guardianRes.payload.user.email, 'demo.guardian@example.com');
    assert.equal(guardianRes.payload.user.platformRole, 'guardian');
    assert.equal(guardianRes.payload.user.emailVerified, true);
    assert.equal(guardianRes.payload.requiresEmailVerification, false);

    const schoolStudentRes = await service.loginDemoPersona('student_school', {
      ip: '127.0.0.1',
      ipPrefix: '127.0.0.x',
      userAgentHash: null,
    });
    assert.equal(schoolStudentRes.payload.user.platformUsername, 'demo_student_dual');
    assert.equal(schoolStudentRes.payload.session.scope, 'student');
    assert.equal(schoolStudentRes.payload.activeOrganization?.code, 'MIMORA-DEMO');

    const familyStudentRes = await service.loginDemoPersona('student_family', {
      ip: '127.0.0.1',
      ipPrefix: '127.0.0.x',
      userAgentHash: null,
    });
    assert.equal(familyStudentRes.payload.user.platformUsername, 'demo_student_family');
    assert.equal(familyStudentRes.payload.session.scope, 'student');
    assert.equal(familyStudentRes.payload.activeOrganization, null);
    assert.equal(familyStudentRes.payload.organizations.length, 0);

    assert.equal(store.sessions.size, 5);
    assert.equal(store.audits.length, 5);
    for (const audit of store.audits) {
      assert.equal(audit.eventType, 'auth.login_succeeded');
      const meta = audit.metadata as Record<string, unknown>;
      assert.equal(meta.mode, 'demo_quick_access');
      assert.ok(typeof meta.demoPersona === 'string');
    }
  });

  it('never bypasses email verification for guardian and never grants school access to student_family', async () => {
    const store = createSeededDemoStore();
    // Simulate demo guardian becoming unverified
    const guardian = Array.from(store.users.values()).find(
      (u) => u.email === 'demo.guardian@example.com'
    )!;
    guardian.emailVerifiedAt = null;

    // Simulate family-only student gaining a school membership (must fail closed)
    const famStudent = Array.from(store.users.values()).find(
      (u) => u.platformUsername === 'demo_student_family'
    )!;
    store.memberships.push({
      id: '01950000-0000-7000-8000-000000000399',
      organizationId: '01950000-0000-7000-8000-000000000101',
      userId: famStudent.id,
      role: 'student',
      orgUsername: 'tainted',
      status: 'active',
    });

    const service = createDemoAuthService({
      repo: createFakeRepo(store),
      getConfig: () => makeTestConfig({ MIMORA_DEMO_MODE: 'true' }),
    });

    await assert.rejects(
      () =>
        service.loginDemoPersona('guardian', {
          ip: '127.0.0.1',
          ipPrefix: '127.0.0.x',
          userAgentHash: null,
        }),
      (err: unknown) => {
        assert.equal((err as { code?: string }).code, 'DEMO_ACCOUNT_UNAVAILABLE');
        return true;
      }
    );

    await assert.rejects(
      () =>
        service.loginDemoPersona('student_family', {
          ip: '127.0.0.1',
          ipPrefix: '127.0.0.x',
          userAgentHash: null,
        }),
      (err: unknown) => {
        assert.equal((err as { code?: string }).code, 'DEMO_ACCOUNT_UNAVAILABLE');
        return true;
      }
    );
  });
});

describe('P4-DEMO-03 HTTP /api/v1/demo/login security, CSRF, rate limit, and frontend client', () => {
  async function startRouterServer(options: {
    demoMode: boolean;
    rateLimitIpMax?: number;
  }) {
    const store = createSeededDemoStore();
    const cfg = makeTestConfig({
      MIMORA_DEMO_MODE: options.demoMode ? 'true' : 'false',
      RATE_LIMIT_IP_MAX: String(options.rateLimitIpMax ?? 20),
    });
    const service = createDemoAuthService({
      repo: createFakeRepo(store),
      rateLimiter: new InMemoryRateLimiter(),
      getConfig: () => cfg,
      auditFn: async (input) => {
        assertSafeAuditMetadata(input.metadata ?? null, input.targetType ?? null);
        store.audits.push(input as unknown as Record<string, unknown>);
        return {};
      },
    });
    const app = express();
    app.use(express.json());
    app.use(
      '/api/v1/demo',
      createDemoRouter({
        demoAuthService: service,
        getConfig: () => cfg,
      })
    );
    app.use('/api', apiNotFoundHandler);
    app.use('/api', apiErrorHandler);

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${address.port}`;
    return {
      baseUrl,
      store,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  it('rejects POST /api/v1/demo/login with 404 when MIMORA_DEMO_MODE is false', async () => {
    const srv = await startRouterServer({ demoMode: false });
    try {
      const res = await fetch(`${srv.baseUrl}/api/v1/demo/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
          [CUSTOM_REQUEST_HEADER]: 'MIMORA-Web',
        },
        body: JSON.stringify({ persona: 'admin' }),
      });
      assert.equal(res.status, 404);
      const body = (await res.json()) as { code: string };
      assert.equal(body.code, 'NOT_FOUND');
      assert.equal(srv.store.sessions.size, 0);
    } finally {
      await srv.close();
    }
  });

  it('enforces CSRF, strict persona validation, 405 method check, cookie flags, and IP rate limit when enabled', async () => {
    const srv = await startRouterServer({ demoMode: true, rateLimitIpMax: 3 });
    try {
      // Missing X-Requested-With -> 403 CSRF_HEADER_REQUIRED
      const noHeaderRes = await fetch(`${srv.baseUrl}/api/v1/demo/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify({ persona: 'admin' }),
      });
      assert.equal(noHeaderRes.status, 403);

      // Untrusted Origin -> 403 CSRF_ORIGIN_REJECTED
      const badOriginRes = await fetch(`${srv.baseUrl}/api/v1/demo/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://evil.example.com',
          [CUSTOM_REQUEST_HEADER]: 'MIMORA-Web',
        },
        body: JSON.stringify({ persona: 'admin' }),
      });
      assert.equal(badOriginRes.status, 403);

      // Unknown persona or arbitrary userId/email rejected with 422
      const invalidPersonaRes = await fetch(`${srv.baseUrl}/api/v1/demo/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
          [CUSTOM_REQUEST_HEADER]: 'MIMORA-Web',
        },
        body: JSON.stringify({ persona: 'nonexistent' }),
      });
      assert.equal(invalidPersonaRes.status, 422);

      const extraFieldRes = await fetch(`${srv.baseUrl}/api/v1/demo/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
          [CUSTOM_REQUEST_HEADER]: 'MIMORA-Web',
        },
        body: JSON.stringify({ persona: 'guardian', email: 'victim@example.com' }),
      });
      assert.equal(extraFieldRes.status, 422);

      // GET -> 405 Method Not Allowed
      const getRes = await fetch(`${srv.baseUrl}/api/v1/demo/login`);
      assert.equal(getRes.status, 405);

      // Valid demo logins succeed and set HttpOnly cookie + csrfToken (no rawSessionToken or passwordHash leaked)
      for (const persona of ['admin', 'teacher', 'guardian'] as const) {
        const okRes = await fetch(`${srv.baseUrl}/api/v1/demo/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:3000',
            [CUSTOM_REQUEST_HEADER]: 'MIMORA-Web',
          },
          body: JSON.stringify({ persona }),
        });
        assert.equal(okRes.status, 200);
        const setCookie = okRes.headers.get('set-cookie') ?? '';
        assert.ok(setCookie.includes('mimora_session='));
        assert.ok(setCookie.toLowerCase().includes('httponly'));
        const text = await okRes.text();
        assert.equal(text.includes('rawSessionToken'), false);
        assert.equal(text.includes('passwordHash'), false);
      }

      // 4th request exceeds rateLimitIpMax=3 -> 429
      const limitedRes = await fetch(`${srv.baseUrl}/api/v1/demo/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
          [CUSTOM_REQUEST_HEADER]: 'MIMORA-Web',
        },
        body: JSON.stringify({ persona: 'student_school' }),
      });
      assert.equal(limitedRes.status, 429);
    } finally {
      await srv.close();
    }
  });

  it('frontend authApi.loginDemoPersona sends POST /api/v1/demo/login and stores csrfToken in memory only', async () => {
    clearInMemoryCsrfToken();
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    const mockFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(
        JSON.stringify({
          status: 'ok',
          user: {
            id: 'u-demo',
            displayName: 'Bảo An (Demo)',
            email: null,
            platformUsername: 'demo_student_family',
            platformRole: null,
            emailVerified: false,
          },
          session: {
            id: 's-demo',
            scope: 'student',
            activeOrganizationId: null,
            idleExpiresAt: '2026-11-20T12:00:00Z',
            absoluteExpiresAt: '2026-11-21T12:00:00Z',
          },
          activeOrganization: null,
          organizations: [],
          requiresOrganizationSelection: false,
          requiresEmailVerification: false,
          csrfToken: 'demo-csrf-token-in-memory',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };

    const payload = await authApi.loginDemoPersona('student_family', mockFetch);
    assert.equal(capturedUrl, '/api/v1/demo/login');
    assert.equal(capturedInit?.method, 'POST');
    assert.equal(capturedInit?.body, JSON.stringify({ persona: 'student_family' }));
    const headers = capturedInit?.headers as Record<string, string>;
    assert.equal(headers['X-Requested-With'], 'MIMORA-Web');
    assert.equal(getInMemoryCsrfToken(), 'demo-csrf-token-in-memory');
    assert.equal(payload.user.platformUsername, 'demo_student_family');
    clearInMemoryCsrfToken();
  });
});
