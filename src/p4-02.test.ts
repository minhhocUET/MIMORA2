import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { adminApi } from './api/admin.ts';
import {
  clearInMemoryCsrfToken,
  setInMemoryCsrfToken,
} from './api/client.ts';
import { guardianApi } from './api/guardian.ts';
import { studentApi } from './api/student.ts';
import { AuthContext, deriveResolvedRole, type AuthContextValue } from './auth/AuthContext.tsx';
import { AdminFamilyProgramsPage } from './components/admin/AdminFamilyProgramsPage.tsx';
import { GuardianProgressPage } from './components/guardian/GuardianProgressPage.tsx';
import { GuardianWorkspacesPage } from './components/guardian/GuardianWorkspacesPage.tsx';
import { StudentAssignmentDetailPage } from './components/student/StudentAssignmentDetailPage.tsx';
import { StudentHomePage } from './components/student/StudentHomePage.tsx';
import { StudentSettingsPage } from './components/student/StudentSettingsPage.tsx';
import { AdminLayout } from './layouts/AdminLayout.tsx';
import { GuardianLayout } from './layouts/GuardianLayout.tsx';
import { StudentLayout } from './layouts/StudentLayout.tsx';
import type { AuthContextPayload } from './types/auth.ts';
import type {
  SafeStudentAssignmentDetailView,
  SafeStudentFamilyProgramSummaryView,
  StudentAccessibilityRuntime,
} from './types/student.ts';

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
      throw new Error('not called in SSR');
    },
    logout: async () => {},
    switchOrganization: async () => {
      throw new Error('not called in SSR');
    },
    changePassword: async () => {},
    refreshMe: async () => context,
  };
}

const DEFAULT_ACCESSIBILITY: StudentAccessibilityRuntime = {
  aacEnabled: true,
  readAloudEnabled: true,
  speechRate: 'normal',
  highContrast: false,
  reducedMotion: false,
  largeText: false,
};

describe('P4-02 Frontend Unit, API Client, SSR & Ethics Static Checks', () => {
  it('calls P4-02 Guardian, Admin & Student Family API endpoints with CSRF and X-Requested-With headers', async () => {
    const calls: Array<{ url: string; method: string; headers: Headers; body: string | null }> = [];
    const mockFetch: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        headers,
        body: init?.body ? String(init.body) : null,
      });
      return new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    try {
      setInMemoryCsrfToken('csrf-p402-xyz');

      // Co-guardian scoped invite includes studentUserIds
      await guardianApi.createCoGuardianInvitation(
        'ws-1',
        { expiresInHours: 48, studentUserIds: ['stu-1', 'stu-2'] },
        mockFetch
      );
      await guardianApi.listFreePrograms(mockFetch);
      await guardianApi.getStudentProgress('stu-1', mockFetch);
      await guardianApi.enrollFreeProgram(
        'stu-1',
        { familyWorkspaceId: 'ws-1', familyProgramId: 'prog-1' },
        mockFetch
      );

      // Admin Family Curriculum & Enrollments
      await adminApi.listFamilyPrograms(mockFetch);
      await adminApi.listEligibleFamilyWorkspaces('Gia', mockFetch);
      await adminApi.createFamilyProgram(
        {
          slug: 'an-toan-o-nha',
          availabilityMode: 'free_family',
          title: 'An toàn ở nhà',
          locale: 'vi',
          items: [{ chapterNumber: 1, chapterTitle: 'Chương 1', contentVersionId: 'cv-1' }],
        },
        mockFetch
      );
      await adminApi.enrollStudentInFamilyProgram(
        'prog-1',
        { familyWorkspaceId: 'ws-1', studentUserId: 'stu-1' },
        mockFetch
      );
      await adminApi.revokeFamilyProgramEnrollment('enr-1', mockFetch);

      // Student Teacher-Free Learning & Preferences
      await studentApi.getFamilyPreferences(mockFetch);
      await studentApi.updateFamilyPreferences(
        { preferredName: 'Bé Sóc', supportPreferencesJson: { aacEnabled: true } },
        mockFetch
      );
      await studentApi.listFamilyPrograms(mockFetch);
      await studentApi.getFamilyProgramDetail('enr-1', mockFetch);
      await studentApi.startOrResumeFamilyAttempt(
        'enr-1',
        'item-1',
        { idempotencyKey: 'idem-1' },
        mockFetch
      );
      await studentApi.saveFamilyTurn(
        'att-1',
        { turnIndex: 0, stepKey: 'emotion_select', selectedEmotionKey: 'calm' },
        mockFetch
      );
      await studentApi.completeFamilyAttempt('att-1', { durationSeconds: 20 }, mockFetch);
      await studentApi.abandonFamilyAttempt(
        'att-1',
        { confirmed: true, reason: 'paused_for_later' },
        mockFetch
      );

      assert.equal(calls[0].url, '/api/v1/guardian/workspaces/ws-1/co-guardian-invitations');
      assert.ok(calls[0].body?.includes('"studentUserIds":["stu-1","stu-2"]'));
      assert.equal(calls[1].url, '/api/v1/guardian/free-programs');
      assert.equal(calls[2].url, '/api/v1/guardian/students/stu-1/progress');
      assert.equal(calls[3].url, '/api/v1/guardian/students/stu-1/programs/enroll');
      assert.equal(calls[4].url, '/api/v1/admin/family-programs');
      assert.equal(calls[5].url, '/api/v1/admin/family-workspaces?search=Gia');
      assert.equal(calls[6].url, '/api/v1/admin/family-programs');
      assert.equal(calls[7].url, '/api/v1/admin/family-programs/prog-1/enrollments');
      assert.equal(calls[8].url, '/api/v1/admin/family-enrollments/enr-1/revoke');
      assert.equal(calls[9].url, '/api/v1/student/family-preferences');
      assert.equal(calls[10].url, '/api/v1/student/family-preferences');
      assert.equal(calls[10].method, 'PATCH');
      assert.equal(calls[11].url, '/api/v1/student/family-programs');
      assert.equal(calls[12].url, '/api/v1/student/family-programs/enr-1');
      assert.equal(
        calls[13].url,
        '/api/v1/student/family-programs/enr-1/items/item-1/start-or-resume'
      );
      assert.equal(calls[13].headers.get('Idempotency-Key'), 'idem-1');
      assert.equal(calls[14].url, '/api/v1/student/family-attempts/att-1/turns');
      assert.equal(calls[15].url, '/api/v1/student/family-attempts/att-1/complete');
      assert.equal(calls[16].url, '/api/v1/student/family-attempts/att-1/abandon');

      for (const call of calls) {
        if (call.method !== 'GET') {
          assert.equal(call.headers.get('X-Requested-With'), 'MIMORA-Web');
          assert.equal(call.headers.get('X-CSRF-Token'), 'csrf-p402-xyz');
        }
      }
    } finally {
      clearInMemoryCsrfToken();
    }
  });

  it('renders GuardianLayout, GuardianProgressPage, GuardianWorkspacesPage & AdminFamilyProgramsPage cleanly', () => {
    const guardianCtx: AuthContextPayload = {
      user: {
        id: 'g-1',
        displayName: 'Mẹ Lan',
        email: 'lan@example.com',
        platformUsername: null,
        platformRole: 'guardian',
        emailVerified: true,
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
      requiresEmailVerification: false,
      csrfToken: 'csrf-g',
    };

    const gLayoutHtml = renderToString(
      createElement(
        AuthContext.Provider,
        { value: makeAuthValue(guardianCtx) },
        createElement(GuardianLayout)
      )
    );
    assert.ok(gLayoutHtml.includes('Tiến độ học tập'));

    const gProgressHtml = renderToString(
      createElement(GuardianProgressPage, { locale: 'vi-VN', onToast: () => {} })
    );
    assert.ok(gProgressHtml.includes('Tóm tắt tiến độ mô tả'));
    assert.ok(gProgressHtml.includes('Chính sách bảo vệ trẻ em (Option B)'));

    const gWsHtml = renderToString(
      createElement(GuardianWorkspacesPage, {
        locale: 'vi-VN',
        onToast: () => {},
        onNavigateToStudents: () => {},
      })
    );
    assert.ok(gWsHtml.includes('Không gian Gia đình'));

    const adminCtx: AuthContextPayload = {
      user: {
        id: 'a-1',
        displayName: 'SysAdmin',
        email: 'admin@mimora.edu.vn',
        platformUsername: 'sysadmin',
        platformRole: 'platform_admin',
      },
      session: {
        id: 's-a',
        scope: 'platform_admin',
        activeOrganizationId: null,
        idleExpiresAt: '2026-11-19T12:00:00.000Z',
        absoluteExpiresAt: '2026-11-19T20:00:00.000Z',
      },
      activeOrganization: null,
      organizations: [],
      requiresOrganizationSelection: false,
      csrfToken: 'csrf-a',
    };
    const adminLayoutHtml = renderToString(
      createElement(
        AuthContext.Provider,
        { value: makeAuthValue(adminCtx) },
        createElement(AdminLayout)
      )
    );
    assert.ok(adminLayoutHtml.includes('Chương trình Gia đình'));

    const adminFamilyHtml = renderToString(
      createElement(AdminFamilyProgramsPage, { locale: 'vi-VN', onToast: () => {} })
    );
    assert.ok(adminFamilyHtml.includes('Chương trình Gia đình'));
  });

  it('renders Student Family-only & Dual-context views without Teacher/School leakage', () => {
    const familyStudentCtx: AuthContextPayload = {
      user: {
        id: 'st-1',
        displayName: 'Bé Sóc',
        email: null,
        platformUsername: null,
        platformRole: null,
      },
      session: {
        id: 's-st',
        scope: 'student',
        activeOrganizationId: null,
        idleExpiresAt: '2026-11-19T12:00:00.000Z',
        absoluteExpiresAt: '2026-11-19T20:00:00.000Z',
      },
      activeOrganization: null,
      organizations: [],
      requiresOrganizationSelection: false,
      csrfToken: 'csrf-st',
    };

    const layoutHtml = renderToString(
      createElement(
        AuthContext.Provider,
        { value: makeAuthValue(familyStudentCtx) },
        createElement(StudentLayout)
      )
    );
    assert.ok(layoutHtml.includes('Không gian Gia đình'));

    const sampleProgram: SafeStudentFamilyProgramSummaryView = {
      enrollmentId: 'enr-1',
      familyWorkspaceId: 'ws-1',
      workspaceCode: 'FAM-1234',
      workspaceName: 'Gia đình Bé Sóc',
      familyProgramId: 'prog-1',
      familyProgramVersionId: 'ver-1',
      versionNumber: 1,
      programSlug: 'binh-an',
      title: 'Bình an ở nhà',
      description: 'Học nhẹ nhàng cùng gia đình.',
      locale: 'vi',
      ageBand: '6-9',
      activationSource: 'free_program',
      learningStatus: 'in_progress',
      statusLabelVi: 'Đang học',
      totalActivities: 2,
      completedActivities: 1,
      startedAt: '2026-11-19T10:00:00.000Z',
      lastActivityAt: '2026-11-19T10:05:00.000Z',
      completedAt: null,
      activatedAt: '2026-11-19T09:00:00.000Z',
    };

    const homeWithFamilyHtml = renderToString(
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
        familyPrograms: [sampleProgram],
        familyProgramsLoading: false,
        familyProgramsError: null,
        onOpenFamilyProgram: () => {},
        goals: [],
        goalsLoading: false,
        onOpenAssignment: () => {},
        onOpenChaptersOverview: () => {},
        onOpenSampleCards: () => {},
        onOpenSettings: () => {},
      })
    );
    assert.ok(homeWithFamilyHtml.includes('Chương trình Gia đình của con'));
    assert.ok(homeWithFamilyHtml.includes('Bình an ở nhà'));
    const normalizedHomeText = homeWithFamilyHtml.replace(/<!--.*?-->/g, '');
    assert.ok(normalizedHomeText.includes('Đang học'));
    assert.ok(normalizedHomeText.includes('1/2 hoạt động'));

    const familyDetailView: SafeStudentAssignmentDetailView = {
      id: 'enr-1',
      organizationId: '',
      classId: 'ws-1',
      className: 'Gia đình Bé Sóc',
      targetId: 'enr-1',
      title: 'Bình an ở nhà',
      status: 'active',
      isReadOnly: false,
      dueAt: null,
      isPastDue: false,
      homePracticeInstructions: 'Không có áp lực.',
      homePractice: {
        hasInstructions: true,
        instructions: 'Không có áp lực.',
        printableGuide: {
          assignmentTitle: 'Bình an ở nhà',
          className: 'Gia đình Bé Sóc',
          dueAt: null,
          instructions: 'Không có áp lực.',
          activityTitles: ['Thẻ 1', 'Thẻ 2'],
        },
      },
      assignedAt: '2026-11-19T09:00:00.000Z',
      createdAt: '2026-11-19T09:00:00.000Z',
      updatedAt: '2026-11-19T09:00:00.000Z',
      progress: {
        hasProgressRecord: true,
        status: 'in_progress',
        totalItems: 2,
        completedItems: 1,
        attemptCount: 1,
        lastActivityAt: null,
        completedAt: null,
      },
      items: [],
    };
    const detailHtml = renderToString(
      createElement(StudentAssignmentDetailPage, {
        sourceContext: 'family',
        assignment: familyDetailView,
        loading: false,
        error: null,
        onRetryLoad: () => {},
        onBackHome: () => {},
        onStartWorkspace: () => {},
      })
    );
    assert.ok(detailHtml.includes('Chương trình Gia đình'));
    assert.equal(detailHtml.includes('Hạn nhẹ nhàng:'), false);

    // Settings in Family-only context hides Teacher profile card while showing comfort form
    const settingsHtml = renderToString(
      createElement(StudentSettingsPage, {
        hasSchoolContext: false,
        profile: null,
        profileLoading: false,
        profileError: null,
        familyPreferences: {
          studentUserId: 'st-1',
          preferredName: 'Bé Sóc Nhỏ',
          supportPreferencesJson: { aacEnabled: true },
          updatedAt: '2026-11-19T10:00:00.000Z',
        },
        onSaveFamilyPreferences: async () => {},
        accessibility: DEFAULT_ACCESSIBILITY,
        onChangeAccessibility: () => {},
      })
    );
    assert.equal(settingsHtml.includes('Hồ sơ hỗ trợ học tập từ thầy cô'), false);
    assert.ok(settingsHtml.includes('Lưu cài đặt thoải mái'));
  });

  it('enforces P4-02 zero-commerce, zero-diagnosis, zero-storage client invariants across all src files', () => {
    const files = collectClientTsFiles('src');
    assert.ok(files.length > 0);
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      assert.equal(
        /\b(?:window\.)?(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem|clear)\b|\bwindow\.(?:localStorage|sessionStorage)\b/.test(
          content
        ),
        false,
        `Forbidden storage usage in ${file}`
      );
      assert.equal(/window\.(alert|open)|globalThis\.alert/.test(content), false, `Forbidden alert/open in ${file}`);
      assert.equal(
        /\b(stripe|paypal|vnpay|momoPay|checkoutSession|creditCard|billingPlan|subscriptionTier)\b/i.test(
          content
        ),
        false,
        `Forbidden payment/subscription code in ${file}`
      );
    }
  });
});
