import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import {
  authApi,
  clearInMemoryCsrfToken,
  getInMemoryCsrfToken,
  setInMemoryCsrfToken,
} from './api/client.ts';
import { guardianApi } from './api/guardian.ts';
import { teacherApi } from './api/teacher.ts';
import { adminApi } from './api/admin.ts';
import { AuthContext, deriveResolvedRole, type AuthContextValue } from './auth/AuthContext.tsx';
import { LoginPage } from './components/auth/LoginPage.tsx';
import { GuardianInviteDialog } from './components/shared/GuardianInviteDialog.tsx';
import { StudentHomePage } from './components/student/StudentHomePage.tsx';
import { GuardianLayout } from './layouts/GuardianLayout.tsx';
import { StudentLayout } from './layouts/StudentLayout.tsx';
import type { AuthContextPayload } from './types/auth.ts';

function collectClientTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'server' || entry === 'node_modules' || entry === 'dist') {
      continue;
    }
    const st = statSync(full);
    if (st.isDirectory()) {
      results.push(...collectClientTsFiles(full));
    } else if ((entry.endsWith('.ts') || entry.endsWith('.tsx')) && !entry.endsWith('.test.ts')) {
      results.push(full);
    }
  }
  return results;
}

function makeAuthValue(context: AuthContextPayload | null): AuthContextValue {
  return {
    status: context ? 'authenticated' : 'unauthenticated',
    context,
    resolvedRole: deriveResolvedRole(context),
    locale: 'vi-VN',
    setLocale: () => {},
    authNotice: null,
    clearAuthNotice: () => {},
    login: async () => {
      throw new Error('not called in SSR test');
    },
    logout: async () => {},
    switchOrganization: async () => {
      throw new Error('not called in SSR test');
    },
    changePassword: async () => {},
    refreshMe: async () => context,
  };
}

describe('P4-01 Frontend Unit & SSR Tests: Guardian Portal, Verification, Invitation Dialog & Family Student', () => {
  it('calls Guardian Auth and Portal API endpoints with CSRF and X-Requested-With headers', async () => {
    const calls: Array<{ url: string; method: string; headers: Headers; body: string | null }> = [];
    const mockFetch: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        headers,
        body: init?.body ? String(init.body) : null,
      });

      if (String(input).endsWith('/auth/guardian/register')) {
        return new Response(
          JSON.stringify({
            status: 'ok',
            user: {
              id: 'u1',
              displayName: 'Mẹ Lan',
              email: 'lan@example.com',
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
          }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        );
      }

      if (String(input).endsWith('/guardian/workspaces')) {
        return new Response(
          JSON.stringify({ status: 'ok', workspaces: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ status: 'ok' }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };

    try {
      clearInMemoryCsrfToken();
      const reg = await authApi.registerGuardian(
        {
          displayName: 'Mẹ Lan',
          email: 'lan@example.com',
          password: 'GuardianPassword123!',
        },
        mockFetch
      );
      assert.equal(reg.mailDelivery.configured, false);
      assert.equal(calls[0].url, '/api/v1/auth/guardian/register');
      assert.equal(calls[0].headers.get('X-Requested-With'), 'MIMORA-Web');

      setInMemoryCsrfToken('csrf-guardian-123');
      await guardianApi.createWorkspace({ name: 'Gia đình Lan' }, mockFetch);
      await guardianApi.createFamilyStudent(
        'ws-1',
        { displayName: 'Bé Bo', familyUsername: 'bo.nho', password: 'StudentPassword1!' },
        mockFetch
      );
      await guardianApi.claimSchoolInvitation(
        { targetWorkspaceId: 'ws-1', claimCode: 'MIM-ABCD-EFGH-JKLM' },
        mockFetch
      );
      await teacherApi.createGuardianInvitation('mem-1', { expiresInHours: 72 }, mockFetch);
      await adminApi.createStudentGuardianInvitation('org-1', 'mem-1', { expiresInHours: 24 }, mockFetch);

      assert.equal(calls[1].url, '/api/v1/guardian/workspaces');
      assert.equal(calls[1].headers.get('X-CSRF-Token'), 'csrf-guardian-123');
      assert.equal(calls[2].url, '/api/v1/guardian/workspaces/ws-1/students');
      assert.equal(calls[3].url, '/api/v1/guardian/invitations/claim');
      assert.equal(calls[4].url, '/api/v1/students/mem-1/guardian-invitations');
      assert.equal(calls[5].url, '/api/v1/admin/organizations/org-1/students/mem-1/guardian-invitations');
      assert.equal(getInMemoryCsrfToken(), 'csrf-guardian-123');
    } finally {
      clearInMemoryCsrfToken();
    }
  });

  it('renders LoginPage with Guardian login/registration tab cleanly', () => {
    const html = renderToString(
      createElement(
        AuthContext.Provider,
        { value: makeAuthValue(null) },
        createElement(LoginPage)
      )
    );
    assert.ok(html.includes('Phụ huynh / Giám hộ'));
    assert.ok(html.includes('Học sinh'));
    assert.ok(html.includes('Quản trị / Giáo viên'));
  });

  it('renders GuardianLayout in unverified state (explicit verification notice) and verified state (portal nav)', () => {
    const unverifiedCtx: AuthContextPayload = {
      user: {
        id: 'g-1',
        displayName: 'Mẹ Hoa',
        email: 'hoa@example.com',
        platformUsername: null,
        platformRole: 'guardian',
        emailVerified: false,
      },
      session: {
        id: 's-1',
        scope: 'guardian',
        activeOrganizationId: null,
        idleExpiresAt: '2026-11-19T12:00:00.000Z',
        absoluteExpiresAt: '2026-11-19T20:00:00.000Z',
      },
      activeOrganization: null,
      organizations: [],
      requiresOrganizationSelection: false,
      requiresEmailVerification: true,
      csrfToken: 'csrf-1',
    };

    const unverifiedHtml = renderToString(
      createElement(
        AuthContext.Provider,
        { value: makeAuthValue(unverifiedCtx) },
        createElement(GuardianLayout)
      )
    );
    assert.ok(unverifiedHtml.includes('Chờ xác minh email'));
    assert.ok(unverifiedHtml.includes('Cổng Phụ huynh &amp; Gia đình'));

    const verifiedCtx: AuthContextPayload = {
      ...unverifiedCtx,
      user: { ...unverifiedCtx.user, emailVerified: true },
      requiresEmailVerification: false,
    };

    const verifiedHtml = renderToString(
      createElement(
        AuthContext.Provider,
        { value: makeAuthValue(verifiedCtx) },
        createElement(GuardianLayout)
      )
    );
    assert.ok(verifiedHtml.includes('Không gian Gia đình'));
    assert.ok(verifiedHtml.includes('Học sinh liên kết'));
    assert.ok(verifiedHtml.includes('Tài khoản &amp; Xác minh'));
  });

  it('renders StudentLayout and StudentHomePage cleanly for Family-only Student without activeOrganization', () => {
    const familyStudentCtx: AuthContextPayload = {
      user: {
        id: 'st-1',
        displayName: 'Bé Sóc',
        email: null,
        platformUsername: null,
        platformRole: null,
      },
      session: {
        id: 's-2',
        scope: 'student',
        activeOrganizationId: null,
        idleExpiresAt: '2026-11-19T12:00:00.000Z',
        absoluteExpiresAt: '2026-11-19T20:00:00.000Z',
      },
      activeOrganization: null,
      organizations: [],
      requiresOrganizationSelection: false,
      csrfToken: 'csrf-2',
    };

    const layoutHtml = renderToString(
      createElement(
        AuthContext.Provider,
        { value: makeAuthValue(familyStudentCtx) },
        createElement(StudentLayout)
      )
    );
    assert.ok(layoutHtml.includes('Không gian Gia đình'));

    const homeHtml = renderToString(
      createElement(StudentHomePage, {
        displayName: 'Bé Sóc',
        hasSchoolContext: false,
        profile: null,
        assignments: [],
        assignmentsLoading: false,
        assignmentsError: null,
        statusFilter: 'active',
        onChangeStatusFilter: () => {},
        onRetryLoadAssignments: () => {},
        goals: [],
        goalsLoading: false,
        onOpenAssignment: () => {},
        onOpenChaptersOverview: () => {},
        onOpenSampleCards: () => {},
        onOpenSettings: () => {},
      })
    );
    assert.ok(homeHtml.includes('Không gian học tập gia đình của con đã sẵn sàng'));
    assert.ok(homeHtml.includes('Xem bộ thẻ mẫu minh họa'));
  });

  it('renders GuardianInviteDialog header cleanly without exposing student/guardian PII or banned strings', () => {
    const html = renderToString(
      createElement(GuardianInviteDialog, {
        open: true,
        onClose: () => {},
        locale: 'vi-VN',
        mode: 'teacher',
        studentMembershipId: 'mem-1',
        studentDisplayName: 'Bé Minh An',
        onToast: () => {},
      })
    );
    assert.ok(html.includes('Mã liên kết Phụ huynh — Bé Minh An'));
    assert.ok(html.includes('Tạo mã liên kết mới'));
    assert.equal(html.includes('subscription'), false);
  });

  it('maintains client-side security & scope invariants across all P4-01 client files', () => {
    const files = collectClientTsFiles('src');
    assert.ok(files.length > 0);
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      assert.equal(
        /\b(?:window\.)?(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem|clear)\b|\bwindow\.(?:localStorage|sessionStorage)\b/.test(
          content
        ),
        false,
        `Forbidden web storage access in ${file}`
      );
      assert.equal(/window\.(alert|open)|globalThis\.alert/.test(content), false, `Forbidden alert/open in ${file}`);
      assert.equal(/ParentPortal|SubscriptionPage|CheckoutPage/.test(content), false, `Out-of-scope component in ${file}`);
    }
  });
});
