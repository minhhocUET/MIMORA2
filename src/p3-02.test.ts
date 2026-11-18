import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { adminApi } from './api/admin.ts';
import { clearInMemoryCsrfToken, setInMemoryCsrfToken } from './api/client.ts';
import { teacherApi } from './api/teacher.ts';
import {
  buildCleanMetadataForSubmit,
  buildCleanPayloadForSubmit,
} from './components/admin/ContentPayloadEditor.tsx';
import { groupAssignmentItemsIntoSessions, type SafePinnedAssignmentItemView } from './types/teacher.ts';
import {
  createDefaultPayloadForType,
  formatInsightCount,
  formatInsightPercent,
} from './utils/p302.ts';

function collectClientFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (entry === 'server' || entry === 'node_modules' || entry === 'dist') {
      continue;
    }
    const st = statSync(fullPath);
    if (st.isDirectory()) {
      results.push(...collectClientFiles(fullPath));
    } else if ((entry.endsWith('.ts') || entry.endsWith('.tsx')) && !entry.endsWith('.test.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('P3-02 Admin & Teacher API client contracts', () => {
  it('calls exact P2 Admin endpoints with CSRF & X-Requested-With on unsafe methods', async () => {
    setInMemoryCsrfToken('p302-csrf-admin');
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = [];

    const mockFetch: typeof fetch = async (input, init) => {
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      return new Response(JSON.stringify({ status: 'ok', items: [], page: 1, limit: 20, total: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    await adminApi.listOrganizations({ page: 2, limit: 10, status: 'active', search: 'MIMORA' }, mockFetch);
    await adminApi.createOrganization({ code: 'SCH01', name: 'Trường A' }, mockFetch);
    await adminApi.setClassTeachers('org-1', 'cls-1', ['tm-1'], mockFetch);
    await adminApi.runCsvImport(
      'org-1',
      {
        sourceFilename: 'students.csv',
        csvContent: 'org_username,display_name\nan,An',
        targetClassId: null,
        mode: 'preview',
      },
      mockFetch
    );
    await adminApi.approveContentVersion('ver-1', 'Tốt', mockFetch);
    await adminApi.getInsights(
      { periodType: 'weekly', organizationId: 'org-1', contentType: 'emotion_card' },
      mockFetch
    );

    assert.equal(calls[0].url, '/api/v1/admin/organizations?page=2&limit=10&status=active&search=MIMORA');
    assert.equal(calls[0].method, 'GET');

    assert.equal(calls[1].url, '/api/v1/admin/organizations');
    assert.equal(calls[1].method, 'POST');
    assert.equal(calls[1].headers['X-CSRF-Token'], 'p302-csrf-admin');
    assert.equal(calls[1].headers['X-Requested-With'], 'MIMORA-Web');

    assert.equal(calls[2].url, '/api/v1/admin/organizations/org-1/classes/cls-1/teachers');
    assert.equal(calls[2].method, 'PUT');

    assert.equal(calls[3].url, '/api/v1/admin/organizations/org-1/csv-imports');
    assert.equal(JSON.parse(calls[3].body!).mode, 'preview');

    assert.equal(calls[4].url, '/api/v1/admin/content-versions/ver-1/approve');
    assert.equal(JSON.parse(calls[4].body!).decisionNote, 'Tốt');

    assert.equal(
      calls[5].url,
      '/api/v1/admin/insights?periodType=weekly&organizationId=org-1&contentType=emotion_card'
    );

    clearInMemoryCsrfToken();
  });

  it('calls exact P2 Teacher endpoints for classes, library, assignments, profiles, goals, and observations', async () => {
    setInMemoryCsrfToken('p302-csrf-teacher');
    const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];

    const mockFetch: typeof fetch = async (input, init) => {
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return new Response(JSON.stringify({ status: 'ok', items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    await teacherApi.listMyClasses({ status: 'active' }, mockFetch);
    await teacherApi.runClassCsvImport(
      'cls-1',
      { sourceFilename: 'class.csv', csvContent: 'org_username,display_name', mode: 'preview' },
      mockFetch
    );
    await teacherApi.listPublishedLibrary({ contentType: 'action_card' }, mockFetch);
    await teacherApi.closeAssignment('asg-1', mockFetch);
    await teacherApi.getAssignmentProgress('asg-1', mockFetch);
    await teacherApi.listAssignmentAttempts('asg-1', { status: undefined }, mockFetch);
    await teacherApi.updateStudentProfile(
      'stu-1',
      { preferredName: 'Bé An', supportPreferencesJson: { aacEnabled: true, speechRate: 'slow' } },
      mockFetch
    );
    await teacherApi.archiveGoal('goal-1', mockFetch);
    await teacherApi.createObservation(
      { studentMembershipId: 'stu-1', noteBody: 'Em thích hình minh họa nhẹ nhàng.' },
      mockFetch
    );
    await teacherApi.deleteObservation('obs-1', mockFetch);

    assert.equal(calls[0].url, '/api/v1/classes?status=active');
    assert.equal(calls[1].url, '/api/v1/classes/cls-1/csv-imports');
    assert.equal(calls[2].url, '/api/v1/library/content?contentType=action_card');
    assert.equal(calls[3].url, '/api/v1/assignments/asg-1/close');
    assert.equal(calls[3].method, 'POST');
    assert.equal(calls[4].url, '/api/v1/assignments/asg-1/progress');
    assert.equal(calls[5].url, '/api/v1/assignments/asg-1/attempts');
    assert.equal(calls[6].url, '/api/v1/students/stu-1/profile');
    assert.equal(calls[6].method, 'PATCH');
    assert.equal(calls[7].url, '/api/v1/goals/goal-1');
    assert.equal(calls[7].method, 'DELETE');
    assert.equal(calls[8].url, '/api/v1/observations');
    assert.equal(calls[8].method, 'POST');
    assert.equal(calls[9].url, '/api/v1/observations/obs-1');
    assert.equal(calls[9].method, 'DELETE');

    clearInMemoryCsrfToken();
  });
});

describe('P3-02 Privacy, Payload & Chapter Grouping helpers', () => {
  it('never converts suppressed or null Insights values into 0', () => {
    assert.equal(formatInsightCount(null, true), 'Ẩn (k < 5)');
    assert.equal(formatInsightCount(0, true), 'Ẩn (k < 5)');
    assert.equal(formatInsightCount(null, false), 'Ẩn (k < 5)');
    assert.equal(formatInsightCount(12, false), '12');

    assert.equal(formatInsightPercent(null, true), 'Ẩn (k < 5)');
    assert.equal(formatInsightPercent(0, true), 'Ẩn (k < 5)');
    assert.equal(formatInsightPercent(85.5, false), '85.5%');
  });

  it('cleans optional empty fields from 5 canonical SEL payload builders', () => {
    const baseEmotion = createDefaultPayloadForType('emotion_card') as unknown as Record<string, unknown>;
    baseEmotion.displayTitle = 'Bình yên';
    baseEmotion.childText = 'Hít thở chậm rãi';
    baseEmotion.emotionKey = 'CALM';
    baseEmotion.emotionLabel = 'Bình yên';
    baseEmotion.accessibleDescription = 'Lá xanh nhẹ nhàng';

    const cleaned = buildCleanPayloadForSubmit('emotion_card', baseEmotion);
    assert.equal(cleaned.emotionKey, 'calm');
    assert.equal('readAloud' in cleaned, false);
    assert.equal('aacSupport' in cleaned, false);
    assert.equal('supportiveBodyCue' in cleaned, false);

    const emptyMeta = buildCleanMetadataForSubmit({ ageBand: '  ', selThemes: [] });
    assert.equal(emptyMeta, null);
  });

  it('adapts pinned assignment items into gentle 3-session / 6-step Chapter grouping', () => {
    const makeItem = (idx: number, themes?: string[]): SafePinnedAssignmentItemView => ({
      assignmentItemId: `ai-${idx}`,
      sortOrder: idx,
      contentItemId: `ci-${idx}`,
      contentVersionId: `cv-${idx}`,
      slug: `slug-${idx}`,
      contentType: 'emotion_card',
      versionNumber: 1,
      versionStatus: 'published',
      title: `Card ${idx + 1}`,
      summary: null,
      locale: 'vi-VN',
      payloadJson: {},
      metadataJson: themes ? { selThemes: themes } : null,
      publishedAt: null,
    });

    const items = [0, 1, 2, 3, 4, 5].map((i) => makeItem(i));
    const sessions = groupAssignmentItemsIntoSessions(items);
    assert.equal(sessions.length, 3);
    assert.equal(sessions[0].sessionNumber, 1);
    assert.equal(sessions[0].items.length, 2);
    assert.equal(sessions[1].sessionNumber, 2);
    assert.equal(sessions[2].sessionNumber, 3);
    assert.equal(sessions[2].items[1].stepNumber, 6);
  });

  it('enforces client security & architectural hygiene across all frontend files', () => {
    const files = collectClientFiles(join(process.cwd(), 'src'));
    assert.ok(files.length > 0);
    for (const file of files) {
      const contents = readFileSync(file, 'utf8');
      const codeOnly = contents
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      assert.equal(
        /\b(window\.alert|window\.open|localStorage|sessionStorage)\b/.test(codeOnly),
        false,
        `Forbidden browser API found in ${file}`
      );
    }
  });
});
