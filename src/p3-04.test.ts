import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { adminApi } from './api/admin.ts';
import {
  ApiClientError,
  apiRequest,
  authApi,
  clearInMemoryCsrfToken,
  getInMemoryCsrfToken,
  setInMemoryCsrfToken,
  subscribeUnauthorized,
} from './api/client.ts';
import { studentApi } from './api/student.ts';
import { teacherApi } from './api/teacher.ts';
import { deriveResolvedRole } from './auth/AuthContext.tsx';
import { AdminInsightsPage } from './components/admin/AdminInsightsPage.tsx';
import { AacSupportBar } from './components/student/AacSupportBar.tsx';
import { StudentAssignmentDetailPage } from './components/student/StudentAssignmentDetailPage.tsx';
import { StudentHomePage } from './components/student/StudentHomePage.tsx';
import { BodyMapStep } from './components/student/steps/BodyMapStep.tsx';
import { CommunicationBoardStep } from './components/student/steps/CommunicationBoardStep.tsx';
import { FactVsGuessStep } from './components/student/steps/FactVsGuessStep.tsx';
import { IntensityScaleStep } from './components/student/steps/IntensityScaleStep.tsx';
import { Dialog } from './components/ui/Dialog.tsx';
import { ResponsiveShell } from './components/ui/Navigation.tsx';
import { Tabs } from './components/ui/Tabs.tsx';
import { resolveLocalizedErrorMessage } from './i18n/index.ts';
import type { AuthContextPayload } from './types/auth.ts';
import type {
  SafeStudentAssignmentDetailView,
  SafeStudentAssignmentListItemView,
  SafeStudentGoalView,
  SafeStudentPinnedItemView,
} from './types/student.ts';
import { formatInsightCount, formatInsightPercent } from './utils/p302.ts';

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

describe('P3-04 Unit Tests: Auth Session Expiry, Error Handling & Privacy Boundaries', () => {
  it('notifies mid-session 401 subscribers for portal APIs while excluding /auth/login, /auth/me, and /auth/logout', async () => {
    const events: Array<{ code: string; path: string }> = [];
    const unsubscribe = subscribeUnauthorized((info, path) => {
      events.push({ code: info.code, path });
    });

    const unauthorizedFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          status: 'error',
          code: 'UNAUTHORIZED',
          messageKey: 'error.auth.unauthorized',
          message: 'Phiên đăng nhập đã hết hạn.',
          locale: 'vi-VN',
        }),
        { status: 401, headers: { 'content-type': 'application/json' } }
      );

    try {
      setInMemoryCsrfToken('active-token');
      await assert.rejects(() => apiRequest('/auth/me', { fetchImpl: unauthorizedFetch }), ApiClientError);
      await assert.rejects(
        () => apiRequest('/auth/login', { method: 'POST', body: {}, fetchImpl: unauthorizedFetch }),
        ApiClientError
      );
      await assert.rejects(
        () => apiRequest('/auth/logout', { method: 'POST', body: {}, fetchImpl: unauthorizedFetch }),
        ApiClientError
      );
      assert.equal(events.length, 0);

      setInMemoryCsrfToken('active-token-2');
      await assert.rejects(
        () => apiRequest('/student/assignments', { fetchImpl: unauthorizedFetch }),
        ApiClientError
      );
      assert.equal(events.length, 1);
      assert.deepEqual(events[0], { code: 'UNAUTHORIZED', path: '/student/assignments' });
      assert.equal(getInMemoryCsrfToken(), null);
    } finally {
      unsubscribe();
      clearInMemoryCsrfToken();
    }
  });

  it('preserves 409, 422, 429, malformed JSON, unexpected HTML 200, and network failures safely', async () => {
    const conflictFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          status: 'error',
          code: 'TURN_INDEX_CONFLICT',
          messageKey: 'error.attempt.turn_conflict',
          message: 'Thứ tự bước không đồng bộ.',
          locale: 'vi-VN',
        }),
        { status: 409, headers: { 'content-type': 'application/json' } }
      );

    await assert.rejects(
      () => apiRequest('/student/attempts/a1/turns', { method: 'POST', body: {}, fetchImpl: conflictFetch }),
      (err: unknown) => {
        assert.ok(err instanceof ApiClientError);
        assert.equal(err.info.httpStatus, 409);
        assert.equal(err.info.code, 'TURN_INDEX_CONFLICT');
        assert.equal(resolveLocalizedErrorMessage(err.info, 'vi-VN'), 'Thứ tự bước không đồng bộ.');
        return true;
      }
    );

    const rateLimitFetch: typeof fetch = async () =>
      new Response('Too many requests', { status: 429, headers: { 'content-type': 'text/plain' } });

    await assert.rejects(
      () => apiRequest('/auth/login', { method: 'POST', body: {}, fetchImpl: rateLimitFetch }),
      (err: unknown) => {
        assert.ok(err instanceof ApiClientError);
        assert.equal(err.info.httpStatus, 429);
        assert.equal(err.info.code, 'RATE_LIMIT_EXCEEDED');
        return true;
      }
    );

    const html200Fetch: typeof fetch = async () =>
      new Response('<!doctype html><html><body>Login proxy page</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });

    await assert.rejects(
      () => apiRequest('/admin/insights', { fetchImpl: html200Fetch }),
      (err: unknown) => {
        assert.ok(err instanceof ApiClientError);
        assert.equal(err.info.code, 'UNEXPECTED_HTML_RESPONSE');
        return true;
      }
    );

    const badJsonFetch: typeof fetch = async () =>
      new Response('{not valid json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    await assert.rejects(
      () => apiRequest('/admin/users', { fetchImpl: badJsonFetch }),
      (err: unknown) => {
        assert.ok(err instanceof ApiClientError);
        assert.equal(err.info.code, 'INVALID_JSON_RESPONSE');
        return true;
      }
    );

    const offlineFetch: typeof fetch = async () => {
      throw new TypeError('Failed to fetch');
    };

    await assert.rejects(
      () => apiRequest('/health', { fetchImpl: offlineFetch }),
      (err: unknown) => {
        assert.ok(err instanceof ApiClientError);
        assert.equal(err.info.httpStatus, 0);
        assert.equal(err.info.code, 'NETWORK_ERROR');
        assert.equal(err.info.isNetworkError, true);
        return true;
      }
    );
  });

  it('rejects unsupported non-MVP role shapes in deriveResolvedRole', () => {
    const weirdPayload = {
      user: {
        id: 'u-x',
        displayName: 'Future Guardian',
        email: 'parent@example.com',
        platformUsername: null,
        platformRole: null,
      },
      session: {
        id: 's-x',
        scope: 'guardian' as unknown as 'student',
        activeOrganizationId: null,
        idleExpiresAt: '2026-11-18T12:00:00Z',
        absoluteExpiresAt: '2026-11-19T12:00:00Z',
      },
      activeOrganization: null,
      organizations: [],
      requiresOrganizationSelection: false,
      csrfToken: 'x',
    } satisfies AuthContextPayload;

    assert.equal(deriveResolvedRole(weirdPayload), null);
  });

  it('never leaks suppressed k<5 Insights metrics as zero', () => {
    assert.equal(formatInsightCount(null, true), 'Ẩn (k < 5)');
    assert.equal(formatInsightCount(4, true), 'Ẩn (k < 5)');
    assert.equal(formatInsightPercent(null, true), 'Ẩn (k < 5)');
    assert.equal(formatInsightPercent(0, false), '0%');
    assert.equal(formatInsightCount(0, false), '0');
  });
});

describe('P3-04 Mock API Integration Tests: Cross-Portal Workflows & Org Switching', () => {
  it('simulates Admin publish -> Teacher pin assignment -> Student turns/complete/retry -> Teacher read-only review', async () => {
    setInMemoryCsrfToken('admin-csrf-01');
    const calls: string[] = [];

    const samplePayloadJson = {
      displayTitle: 'Hít thở chậm rãi',
      actionPhrase: 'Hít vào 3 nhịp và thở ra nhẹ nhàng.',
      accessibleDescription: 'Thẻ hướng dẫn hít thở dịu nhẹ',
      aacSupport: { symbolLabel: 'Thở chậm', coreVocabulary: ['Hít vào', 'Nghỉ chút'] },
    };

    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push(`${method} ${url}`);

      if (url === '/api/v1/admin/content-items' && method === 'POST') {
        assert.equal(headers['X-CSRF-Token'], 'admin-csrf-01');
        return new Response(
          JSON.stringify({
            status: 'ok',
            item: {
              id: 'ci-1',
              slug: 'tho-cham',
              contentType: 'action_card',
              isArchived: false,
              currentVersionId: 'cv-1',
              publishedVersionId: null,
              createdByUserId: 'admin-1',
              createdAt: '2026-11-18T00:00:00Z',
              updatedAt: '2026-11-18T00:00:00Z',
            },
            version: {
              id: 'cv-1',
              contentItemId: 'ci-1',
              versionNumber: 1,
              status: 'draft',
              title: 'Hít thở chậm rãi',
              summary: 'Giúp dịu lại',
              locale: 'vi-VN',
              payloadJson: samplePayloadJson,
              metadataJson: { selThemes: ['session:2', 'step:4'] },
              createdByUserId: 'admin-1',
              submittedAt: null,
              publishedAt: null,
              createdAt: '2026-11-18T00:00:00Z',
            },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        );
      }

      if (url === '/api/v1/admin/content-versions/cv-1/publish' && method === 'POST') {
        return new Response(
          JSON.stringify({
            status: 'ok',
            item: { id: 'ci-1', publishedVersionId: 'cv-1' },
            version: { id: 'cv-1', status: 'published' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (url.startsWith('/api/v1/library/content') && method === 'GET') {
        return new Response(
          JSON.stringify({
            status: 'ok',
            items: [
              {
                itemId: 'ci-1',
                slug: 'tho-cham',
                contentType: 'action_card',
                versionId: 'cv-1',
                versionNumber: 1,
                title: 'Hít thở chậm rãi',
                summary: 'Giúp dịu lại',
                locale: 'vi-VN',
                payloadJson: samplePayloadJson,
                metadataJson: { selThemes: ['session:2', 'step:4'] },
                publishedAt: '2026-11-18T01:00:00Z',
              },
            ],
            page: 1,
            limit: 50,
            total: 1,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (url === '/api/v1/assignments' && method === 'POST') {
        assert.equal(headers['X-CSRF-Token'], 'teacher-csrf-01');
        const body = JSON.parse(String(init?.body)) as {
          items: Array<{ contentVersionId: string }>;
        };
        assert.equal(body.items[0].contentVersionId, 'cv-1');
        return new Response(
          JSON.stringify({
            status: 'ok',
            assignment: {
              id: 'asg-1',
              organizationId: 'org-1',
              classId: 'cls-1',
              createdByTeacherMembershipId: 'tm-1',
              title: 'Bài tập Tuần 1',
              homePracticeInstructions: 'Hít thở cùng con 3 phút.',
              status: 'active',
              dueAt: null,
              closedAt: null,
              createdAt: '2026-11-18T02:00:00Z',
              updatedAt: '2026-11-18T02:00:00Z',
              canEdit: true,
            },
            items: [{ assignmentItemId: 'ai-1', contentVersionId: 'cv-1', sortOrder: 0 }],
            targets: [{ id: 'tgt-1', studentMembershipId: 'stu-m-1' }],
          }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        );
      }

      if (url === '/api/v1/student/assignments/tgt-1/items/ai-1/start-or-resume' && method === 'POST') {
        assert.equal(headers['X-CSRF-Token'], 'student-csrf-01');
        assert.ok(headers['Idempotency-Key']);
        const body = JSON.parse(String(init?.body)) as { intent?: string };
        if (body.intent === 'start_or_resume') {
          return new Response(
            JSON.stringify({
              status: 'error',
              code: 'RETRY_INTENT_REQUIRED',
              messageKey: 'error.attempt.retry_required',
              message: 'Hoạt động đã hoàn thành trước đó.',
              locale: 'vi-VN',
            }),
            { status: 409, headers: { 'content-type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            status: 'ok',
            action: 'retried',
            attempt: {
              attemptId: 'att-2',
              attemptNumber: 2,
              state: 'in_progress',
              startedAt: '2026-11-18T03:00:00Z',
              completedAt: null,
              abandonedAt: null,
              lastActivityAt: '2026-11-18T03:00:00Z',
              elapsedSeconds: 0,
              usedAacSupport: false,
              usedReadAloud: false,
              aacTapCount: 0,
              readAloudCount: 0,
              turnCount: 0,
              pinnedContentVersionId: 'cv-1',
              resumePosition: { nextTurnIndex: 0, lastStepKey: null },
              availableActions: { canSaveTurn: true, canComplete: true, canAbandon: true, canRetry: false },
              turns: [],
            },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        );
      }

      if (url === '/api/v1/student/attempts/att-2/turns' && method === 'POST') {
        return new Response(
          JSON.stringify({
            status: 'ok',
            idempotentReplay: false,
            savedTurn: {
              id: 't-1',
              turnIndex: 0,
              stepKey: 'step_4_strategy_deck',
              selectedChoiceKey: 'strategy_slow_breath',
              selectedEmotionKey: null,
              usedAac: true,
              usedReadAloud: false,
              durationSeconds: 12,
              respondedAt: '2026-11-18T03:00:12Z',
              responsePayloadJson: { step: 4 },
            },
            attempt: {
              attemptId: 'att-2',
              attemptNumber: 2,
              state: 'in_progress',
              turnCount: 1,
              resumePosition: { nextTurnIndex: 1, lastStepKey: 'step_4_strategy_deck' },
              turns: [{ id: 't-1', turnIndex: 0, stepKey: 'step_4_strategy_deck' }],
            },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        );
      }

      if (url === '/api/v1/student/attempts/att-2/complete' && method === 'POST') {
        return new Response(
          JSON.stringify({
            status: 'ok',
            idempotentReplay: false,
            attempt: {
              attemptId: 'att-2',
              attemptNumber: 2,
              state: 'completed',
              availableActions: { canSaveTurn: false, canComplete: false, canAbandon: false, canRetry: true },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (url === '/api/v1/assignments/asg-1/progress' && method === 'GET') {
        return new Response(
          JSON.stringify({
            status: 'ok',
            totalItems: 1,
            targets: [
              {
                assignmentTargetId: 'tgt-1',
                studentMembershipId: 'stu-m-1',
                displayName: 'Nguyễn Minh An',
                orgUsername: 'minh.an',
                status: 'completed',
                completedItems: 1,
                totalItems: 1,
                attemptCount: 2,
                lastActivityAt: '2026-11-18T03:00:30Z',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      throw new Error(`Unexpected mock call: ${method} ${url}`);
    };

    const created = await adminApi.createContentItem(
      {
        slug: 'tho-cham',
        contentType: 'action_card',
        title: 'Hít thở chậm rãi',
        locale: 'vi-VN',
        payloadJson: samplePayloadJson,
      },
      mockFetch
    );
    await adminApi.publishContentVersion(created.version.id, mockFetch);

    setInMemoryCsrfToken('teacher-csrf-01');
    const lib = await teacherApi.listPublishedLibrary({}, mockFetch);
    const createdAsg = await teacherApi.createAssignment(
      {
        classId: 'cls-1',
        title: 'Bài tập Tuần 1',
        items: [{ contentVersionId: lib.items[0].versionId, sortOrder: 0 }],
        targetStudentMembershipIds: ['stu-m-1'],
      },
      mockFetch
    );
    assert.equal(createdAsg.items[0].contentVersionId, 'cv-1');

    setInMemoryCsrfToken('student-csrf-01');
    await assert.rejects(
      () =>
        studentApi.startOrResumeAttempt(
          'tgt-1',
          'ai-1',
          { intent: 'start_or_resume', idempotencyKey: 'k1' },
          mockFetch
        ),
      (err: unknown) => err instanceof ApiClientError && err.info.code === 'RETRY_INTENT_REQUIRED'
    );

    const retried = await studentApi.startOrResumeAttempt(
      'tgt-1',
      'ai-1',
      { intent: 'retry', idempotencyKey: 'k2' },
      mockFetch
    );
    assert.equal(retried.attempt.attemptNumber, 2);

    const saved = await studentApi.saveTurn(
      retried.attempt.attemptId,
      {
        turnIndex: 0,
        stepKey: 'step_4_strategy_deck',
        selectedChoiceKey: 'strategy_slow_breath',
        usedAac: true,
      },
      mockFetch
    );
    assert.equal(saved.attempt.resumePosition.nextTurnIndex, 1);

    const completed = await studentApi.completeAttempt(retried.attempt.attemptId, { durationSeconds: 20 }, mockFetch);
    assert.equal(completed.attempt.state, 'completed');

    const progress = await teacherApi.getAssignmentProgress('asg-1', mockFetch);
    assert.equal(progress.targets[0].status, 'completed');
    assert.equal(calls.length, 9);
    clearInMemoryCsrfToken();
  });

  it('rotates in-memory CSRF token cleanly when switching Teacher active organization', async () => {
    setInMemoryCsrfToken('teacher-org1-csrf');
    const mockFetch: typeof fetch = async (_input, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      assert.equal(headers['X-CSRF-Token'], 'teacher-org1-csrf');
      return new Response(
        JSON.stringify({
          status: 'ok',
          user: {
            id: 't1',
            displayName: 'Thầy Nam',
            email: 'nam@school.edu.vn',
            platformUsername: null,
            platformRole: null,
          },
          session: {
            id: 'sess-1',
            scope: 'teacher',
            activeOrganizationId: 'org-2',
            idleExpiresAt: '2026-11-18T12:00:00Z',
            absoluteExpiresAt: '2026-11-19T12:00:00Z',
          },
          activeOrganization: {
            organizationId: 'org-2',
            code: 'MIMORA02',
            name: 'Trường Ánh Dương',
            membershipId: 'tm-2',
            role: 'teacher',
          },
          organizations: [],
          requiresOrganizationSelection: false,
          csrfToken: 'teacher-org2-csrf',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };

    const switched = await authApi.switchOrganization('org-2', mockFetch);
    assert.equal(switched.activeOrganization?.organizationId, 'org-2');
    assert.equal(getInMemoryCsrfToken(), 'teacher-org2-csrf');
    clearInMemoryCsrfToken();
  });
});

describe('P3-04 SSR & Semantic Accessibility Rendering Verification', () => {
  it('renders ResponsiveShell, Tabs, and Dialog with required ARIA landmarks and attributes', () => {
    const shellHtml = renderToString(
      createElement(ResponsiveShell, {
        studentFriendly: true,
        brandLogo: createElement('span', null, 'M'),
        brandTitle: 'MIMORA',
        portalLabel: 'Không gian Học sinh',
        skipLabel: 'Chuyển tới nội dung chính',
        navItems: [{ id: 'home', label: 'Trang chính', icon: createElement('span', null, '*') }],
        activeNavId: 'home',
        onSelectNav: () => undefined,
        headerRightAction: createElement('span', null, 'Minh An'),
        children: createElement('p', null, 'Nội dung bài học'),
      })
    );
    assert.ok(shellHtml.includes('href="#mimora-main-content"'));
    assert.ok(shellHtml.includes('id="mimora-main-content"'));
    assert.ok(shellHtml.includes('tabindex="-1"') || shellHtml.includes('tabIndex="-1"'));

    const tabsHtml = renderToString(
      createElement(Tabs, {
        ariaLabel: 'Bộ lọc trạng thái',
        value: 'active',
        onChange: () => undefined,
        options: [
          { value: 'active', label: 'Đang mở' },
          { value: 'closed', label: 'Đã đóng' },
        ],
      })
    );
    assert.ok(tabsHtml.includes('role="tablist"'));
    assert.ok(tabsHtml.includes('aria-selected="true"'));
    assert.ok(tabsHtml.includes('aria-selected="false"'));
    assert.ok(tabsHtml.includes('tabindex="0"') || tabsHtml.includes('tabIndex="0"'));
    assert.ok(tabsHtml.includes('overflow-x-auto'));

    const dialogHtml = renderToString(
      createElement(Dialog, {
        open: true,
        onClose: () => undefined,
        title: 'Xác nhận tạm dừng',
        description: 'Không có điểm trừ nào.',
        children: createElement('p', null, 'Nội dung hộp thoại'),
      })
    );
    assert.ok(dialogHtml.includes('role="dialog"'));
    assert.ok(dialogHtml.includes('aria-modal="true"'));
    assert.ok(dialogHtml.includes('Xác nhận tạm dừng'));
  });

  it('renders Student Home, Assignment Detail, BodyMap, Intensity, FactVsGuess, Communication, and AAC cleanly without scoring or focus-suppressed SVGs', () => {
    const sampleAssignment: SafeStudentAssignmentListItemView = {
      id: 'asg-1',
      organizationId: 'org-1',
      targetId: 'tgt-1',
      classId: 'cls-1',
      className: 'Lớp 1A',
      title: 'Khám phá cảm xúc buổi sáng',
      status: 'active',
      dueAt: null,
      isPastDue: false,
      isReadOnly: false,
      itemCount: 2,
      homePracticeInstructions: 'Cả nhà cùng đọc nhẹ nhàng.',
      homePractice: { hasInstructions: true, instructions: 'Cả nhà cùng đọc nhẹ nhàng.' },
      assignedAt: '2026-11-18T07:00:00Z',
      createdAt: '2026-11-18T07:00:00Z',
      updatedAt: '2026-11-18T08:00:00Z',
      progress: {
        hasProgressRecord: true,
        status: 'in_progress',
        completedItems: 1,
        totalItems: 2,
        attemptCount: 1,
        lastActivityAt: '2026-11-18T08:00:00Z',
        completedAt: null,
      },
    };

    const sampleGoal: SafeStudentGoalView = {
      id: 'g-1',
      organizationId: 'org-1',
      studentMembershipId: 'stu-m-1',
      classId: 'cls-1',
      createdByTeacherMembershipId: 'tm-1',
      title: 'Thực hành giơ thẻ xin nghỉ khi lớp ồn',
      description: null,
      focusArea: 'Tự điều chỉnh',
      status: 'active',
      targetDate: null,
      achievedAt: null,
      createdAt: '2026-11-18T08:00:00Z',
      updatedAt: '2026-11-18T08:00:00Z',
    };

    const homeHtml = renderToString(
      createElement(StudentHomePage, {
        displayName: 'Minh An',
        profile: null,
        assignments: [sampleAssignment],
        assignmentsLoading: false,
        assignmentsError: null,
        statusFilter: 'active',
        onChangeStatusFilter: () => undefined,
        onRetryLoadAssignments: () => undefined,
        goals: [sampleGoal],
        goalsLoading: false,
        goalsError: 'Mạng tạm gián đoạn',
        onRetryLoadGoals: () => undefined,
        onOpenAssignment: () => undefined,
        onOpenChaptersOverview: () => undefined,
        onOpenSampleCards: () => undefined,
        onOpenSettings: () => undefined,
      })
    );
    const homeText = homeHtml.replace(/<!--[\s\S]*?-->/g, '');
    assert.ok(homeText.includes('Chào Minh An'));
    assert.ok(homeHtml.includes('role="tablist"'));
    assert.ok(homeText.includes('Chưa tải được mục tiêu đồng hành'));
    assert.equal(homeText.includes('Chưa có mục tiêu cá nhân nào được thêm'), false);

    const homeHtmlWithoutReassurance = homeText
      .replace(/không chấm điểm/gi, '')
      .replace(/không xếp hạng/gi, '');
    const forbiddenStudentPattern = /\b(leaderboard|streak|xp|diagnostic|autism)\b|xếp hạng|chấm điểm|điểm số|chẩn đoán y khoa/i;
    assert.equal(forbiddenStudentPattern.test(homeHtmlWithoutReassurance), false);

    const pinnedItem: SafeStudentPinnedItemView = {
      assignmentItemId: 'ai-1',
      sortOrder: 0,
      contentItemId: 'ci-1',
      contentVersionId: 'cv-1',
      slug: 'comm-1',
      contentType: 'communication_card',
      versionNumber: 1,
      title: 'Xin nghỉ 2 phút',
      summary: 'Thẻ giao tiếp',
      locale: 'vi-VN',
      payloadJson: {
        displayTitle: 'Xin nghỉ 2 phút',
        communicationIntent: 'Bày tỏ nhu cầu',
        phrase: 'Con muốn nghỉ ngơi một chút ạ.',
        accessibleDescription: 'Hình bạn nhỏ ngồi yên tĩnh',
      },
      metadataJson: null,
      publishedAt: '2026-11-18T08:00:00Z',
    };

    const detail: SafeStudentAssignmentDetailView = {
      ...sampleAssignment,
      isReadOnly: true,
      isPastDue: true,
      status: 'closed',
      assignedAt: '2026-11-18T07:00:00Z',
      createdAt: '2026-11-18T07:00:00Z',
      updatedAt: '2026-11-18T09:00:00Z',
      items: [pinnedItem, { ...pinnedItem, assignmentItemId: 'ai-2' }],
      homePractice: {
        hasInstructions: true,
        instructions: 'Ba mẹ đọc cùng con.',
        printableGuide: {
          assignmentTitle: sampleAssignment.title,
          className: sampleAssignment.className,
          dueAt: null,
          instructions: 'Ba mẹ đọc cùng con.',
          activityTitles: ['Xin nghỉ 2 phút', 'Xin nghỉ 2 phút'],
        },
      },
    };

    const detailHtml = renderToString(
      createElement(StudentAssignmentDetailPage, {
        assignment: detail,
        loading: false,
        error: null,
        onRetryLoad: () => undefined,
        onBackHome: () => undefined,
        onStartWorkspace: () => undefined,
      })
    );
    assert.ok(detailHtml.includes('Đã đóng (Chỉ xem lại)'));
    assert.ok(detailHtml.includes('Xem thẻ này'));

    const bodyMapHtml = renderToString(
      createElement(BodyMapStep, { onSaveBodyMap: () => undefined })
    );
    assert.ok(bodyMapHtml.includes('role="img"'));
    assert.ok(bodyMapHtml.includes('role="button"'));
    assert.equal(bodyMapHtml.includes('outline-none'), false);

    const intensityHtml = renderToString(
      createElement(IntensityScaleStep, { onSaveIntensity: () => undefined })
    );
    assert.ok(intensityHtml.includes('role="radiogroup"'));
    const intensityWithoutReassurance = intensityHtml
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/không cần chấm điểm/gi, '')
      .replace(/không chấm điểm/gi, '');
    assert.equal(forbiddenStudentPattern.test(intensityWithoutReassurance), false);

    const factGuessHtml = renderToString(
      createElement(FactVsGuessStep, {
        title: 'Giờ ra chơi',
        situationPayload: {
          displayTitle: 'Giờ ra chơi',
          situationText: 'Bạn đi ngang qua chưa chào.',
          narrativeContext: 'Sân trường lúc ra chơi khá đông.',
          accessibleDescription: 'Sân trường',
          discussionPrompts: ['Điều gì nhìn thấy?', 'Điều gì đang đoán?'],
        },
        onSaveFactVsGuess: () => undefined,
      })
    );
    assert.ok(factGuessHtml.includes('role="tablist"'));

    const commHtml = renderToString(
      createElement(CommunicationBoardStep, {
        primaryItem: pinnedItem,
        onSaveCommunicationChoice: () => undefined,
        onRequestHelp: () => undefined,
      })
    );
    assert.ok(commHtml.includes('Con muốn nghỉ ngơi một chút ạ.'));

    const aacHtml = renderToString(
      createElement(AacSupportBar, {
        readAloudText: 'Hít thở nhẹ nhàng',
        aacWords: ['Nghỉ ngơi'],
      })
    );
    assert.ok(aacHtml.includes('Con cần nghỉ chút'));
    assert.equal(aacHtml.includes('whitespace-nowrap shrink-0'), false);
  });

  it('renders AdminInsightsPage with accurate org_insight_daily_snapshots table copy', () => {
    const insightsHtml = renderToString(
      createElement(AdminInsightsPage, { locale: 'vi-VN' })
    );
    assert.ok(insightsHtml.includes('org_insight_daily_snapshots'));
    assert.equal(/\borg_insight_snapshots\b/.test(insightsHtml), false);
  });

  it('confirms zero unsupported portal code, zero browser storage, and zero popup calls across all client files', () => {
    const files = collectClientTsFiles(join(process.cwd(), 'src'));
    assert.ok(files.length > 0);
    for (const file of files) {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      assert.equal(
        /\b(window\.alert|window\.open|localStorage|sessionStorage)\b/.test(code),
        false,
        `Prohibited browser API in ${file}`
      );
      assert.equal(
        /\b(GuardianLayout|ParentPortal|SubscriptionPage|CheckoutPage)\b/.test(code),
        false,
        `Out-of-scope P4 component detected in ${file}`
      );
    }
  });
});
