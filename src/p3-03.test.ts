import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { clearInMemoryCsrfToken, setInMemoryCsrfToken } from './api/client.ts';
import { studentApi } from './api/student.ts';
import { BODY_MAP_REGIONS } from './components/student/steps/BodyMapStep.tsx';
import { GENTLE_INTENSITY_LEVELS } from './components/student/steps/IntensityScaleStep.tsx';
import type { SafeStudentPinnedItemView } from './types/student.ts';
import {
  extractAacCoreVocabulary,
  extractPrimaryReadAloudText,
  extractStrategyCategory,
  isSafeRenderableImageSrc,
  parseActionCardPayload,
  parseCommunicationCardPayload,
  parseEmotionCardPayload,
  parseSituationCardPayload,
  parseSocialStoryPayload,
  resolveItemChapterPlacement,
  sanitizeTurnPayloadObject,
  translateStudentProgressStatusVi,
} from './utils/studentContent.ts';

function collectStudentSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      results.push(...collectStudentSourceFiles(full));
    } else if ((entry.endsWith('.ts') || entry.endsWith('.tsx')) && !entry.endsWith('.test.ts')) {
      results.push(full);
    }
  }
  return results;
}

describe('P3-03 Student API client contracts & security headers', () => {
  it('calls exact P2 Student endpoints with CSRF, X-Requested-With, and Idempotency-Key', async () => {
    setInMemoryCsrfToken('p303-csrf-student');
    const calls: Array<{
      url: string;
      method: string;
      headers: Record<string, string>;
      body?: Record<string, unknown>;
    }> = [];

    const mockFetch: typeof fetch = async (input, init) => {
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
        body:
          typeof init?.body === 'string'
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : undefined,
      });
      return new Response(JSON.stringify({ status: 'ok', items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    await studentApi.listAssignments({ status: 'active', page: 1, limit: 20 }, mockFetch);
    await studentApi.getAssignmentDetail('assign-1', mockFetch);
    await studentApi.startOrResumeAttempt(
      'target-1',
      'item-1',
      {
        intent: 'start_or_resume',
        expectedContentVersionId: 'cv-1',
        idempotencyKey: 'idem_key_001',
      },
      mockFetch
    );
    await studentApi.getAttempt('attempt-1', mockFetch);
    await studentApi.saveTurn(
      'attempt-1',
      {
        turnIndex: 0,
        stepKey: 'step_1_situation_emotion',
        selectedChoiceKey: 'emotions_explored',
        selectedEmotionKey: 'calm',
        usedAac: true,
        usedReadAloud: false,
        responsePayloadJson: { step: 1, selectedEmotionKeys: ['calm'] },
      },
      mockFetch
    );
    await studentApi.completeAttempt('attempt-1', { durationSeconds: 42 }, mockFetch);
    await studentApi.abandonAttempt(
      'attempt-1',
      { confirmed: true, reason: 'paused_for_later', durationSeconds: 18 },
      mockFetch
    );
    await studentApi.getProfile(mockFetch);
    await studentApi.listGoals({ status: 'active', page: 1, limit: 10 }, mockFetch);

    assert.equal(calls[0].url, '/api/v1/student/assignments?status=active&page=1&limit=20');
    assert.equal(calls[0].method, 'GET');

    assert.equal(calls[1].url, '/api/v1/student/assignments/assign-1');
    assert.equal(calls[1].method, 'GET');

    assert.equal(
      calls[2].url,
      '/api/v1/student/assignments/target-1/items/item-1/start-or-resume'
    );
    assert.equal(calls[2].method, 'POST');
    assert.equal(calls[2].headers['Idempotency-Key'], 'idem_key_001');
    assert.equal(calls[2].headers['X-CSRF-Token'], 'p303-csrf-student');
    assert.equal(calls[2].headers['X-Requested-With'], 'MIMORA-Web');
    assert.equal(calls[2].body?.intent, 'start_or_resume');

    assert.equal(calls[3].url, '/api/v1/student/attempts/attempt-1');
    assert.equal(calls[3].method, 'GET');

    assert.equal(calls[4].url, '/api/v1/student/attempts/attempt-1/turns');
    assert.equal(calls[4].method, 'POST');
    assert.equal(calls[4].body?.turnIndex, 0);
    assert.equal(calls[4].body?.stepKey, 'step_1_situation_emotion');

    assert.equal(calls[5].url, '/api/v1/student/attempts/attempt-1/complete');
    assert.equal(calls[5].method, 'POST');

    assert.equal(calls[6].url, '/api/v1/student/attempts/attempt-1/abandon');
    assert.equal(calls[6].method, 'POST');
    assert.equal(calls[6].body?.confirmed, true);
    assert.equal(calls[6].body?.reason, 'paused_for_later');

    assert.equal(calls[7].url, '/api/v1/student/profile');
    assert.equal(calls[7].method, 'GET');

    assert.equal(calls[8].url, '/api/v1/student/goals?status=active&page=1&limit=10');
    assert.equal(calls[8].method, 'GET');

    clearInMemoryCsrfToken();
  });
});

describe('P3-03 Content parsing, 3-session/6-step mapping, and child-safety sanitization', () => {
  it('parses social story scenes sequentially and preserves accessible descriptions', () => {
    const parsed = parseSocialStoryPayload(
      {
        displayTitle: 'Chờ đến lượt ở cầu trượt',
        storyIntro: 'Giờ ra chơi hôm nay có rất nhiều bạn.',
        scenes: [
          { sceneNumber: 3, text: 'Cảnh 3', accessibleDescription: 'Mô tả 3' },
          { sceneNumber: 1, text: 'Cảnh 1', accessibleDescription: 'Mô tả 1' },
          { sceneNumber: 2, text: 'Cảnh 2', accessibleDescription: 'Mô tả 2' },
          { sceneNumber: 5, text: 'Cảnh 5', accessibleDescription: 'Mô tả 5' },
          { sceneNumber: 4, text: 'Cảnh 4', accessibleDescription: 'Mô tả 4' },
        ],
        closingReflection: 'Cả hai bạn đều vui khi chờ lượt.',
      },
      'Fallback'
    );

    assert.equal(parsed.scenes.length, 5);
    assert.deepEqual(
      parsed.scenes.map((s) => s.sceneNumber),
      [1, 2, 3, 4, 5]
    );
    assert.equal(parsed.closingReflection, 'Cả hai bạn đều vui khi chờ lượt.');
  });

  it('parses emotion, situation, action, and communication payloads cleanly', () => {
    const emo = parseEmotionCardPayload(
      {
        displayTitle: 'Bình yên',
        childText: 'Hơi thở nhẹ nhàng.',
        emotionKey: 'calm',
        emotionLabel: 'Bình yên',
        accessibleDescription: 'Mặt hồ tĩnh lặng',
        aacSupport: { symbolLabel: 'Bình yên', coreVocabulary: ['Nghỉ ngơi', 'Êm dịu'] },
      },
      'Title'
    );
    assert.equal(emo.emotionKey, 'calm');
    assert.deepEqual(emo.aacSupport?.coreVocabulary, ['Nghỉ ngơi', 'Êm dịu']);

    const sit = parseSituationCardPayload(
      {
        displayTitle: 'Bạn làm rơi hộp bút',
        situationText: 'Hộp bút rơi xuống sàn.',
        narrativeContext: 'Lớp học đang yên tĩnh.',
        accessibleDescription: 'Hộp bút rơi',
        discussionPrompts: ['Điều gì vừa xảy ra?'],
      },
      'Fallback'
    );
    assert.equal(sit.discussionPrompts.length, 1);

    const act = parseActionCardPayload(
      {
        displayTitle: 'Thở chậm',
        actionPhrase: 'Hít vào 3 nhịp.',
        accessibleDescription: 'Thở chậm',
        possibleOutcomes: ['Lòng dịu lại'],
      },
      'Fallback'
    );
    assert.deepEqual(act.possibleOutcomes, ['Lòng dịu lại']);

    const comm = parseCommunicationCardPayload(
      {
        displayTitle: 'Xin nghỉ chút',
        communicationIntent: 'Bày tỏ nhu cầu',
        phrase: 'Con xin phép nghỉ 2 phút.',
        accessibleDescription: 'Thẻ xin nghỉ',
      },
      'Fallback'
    );
    assert.equal(comm.communicationIntent, 'Bày tỏ nhu cầu');
  });

  it('maps metadataJson.selThemes tags and canonical content types into 3 sessions / 6 steps', () => {
    const taggedAction: SafeStudentPinnedItemView = {
      assignmentItemId: 'ai-1',
      sortOrder: 1,
      contentItemId: 'ci-1',
      contentVersionId: 'cv-1',
      slug: 'slow-breath',
      contentType: 'action_card',
      versionNumber: 1,
      title: 'Thở chậm',
      summary: null,
      locale: 'vi-VN',
      payloadJson: {
        displayTitle: 'Thở chậm',
        actionPhrase: 'Hít vào nhẹ nhàng.',
        accessibleDescription: 'Thở chậm',
        readAloud: { text: 'Hít vào thật êm.' },
        aacSupport: { symbolLabel: 'Thở chậm', coreVocabulary: ['Nghỉ', 'Thở'] },
      },
      metadataJson: {
        selThemes: ['chapter:choi_cung_ban', 'session:2', 'step:4', 'strategy_cat:breathing_grounding'],
      },
      publishedAt: '2026-11-18T00:00:00Z',
    };

    const placed = resolveItemChapterPlacement(taggedAction);
    assert.equal(placed.sessionNumber, 2);
    assert.equal(placed.stepNumber, 4);
    assert.equal(placed.componentType, 'strategy_deck');
    assert.equal(placed.strategyCategory, 'breathing_grounding');
    assert.equal(placed.groupingSource, 'sel_theme_convention');
    assert.equal(extractPrimaryReadAloudText(taggedAction), 'Hít vào thật êm.');
    assert.deepEqual(extractAacCoreVocabulary(taggedAction), ['Thở chậm', 'Nghỉ', 'Thở']);

    const untaggedComm: SafeStudentPinnedItemView = {
      ...taggedAction,
      assignmentItemId: 'ai-2',
      contentType: 'communication_card',
      metadataJson: null,
    };
    const fallbackPlaced = resolveItemChapterPlacement(untaggedComm);
    assert.equal(fallbackPlaced.sessionNumber, 3);
    assert.equal(fallbackPlaced.stepNumber, 6);
    assert.equal(fallbackPlaced.groupingSource, 'content_type_fallback');
    assert.equal(extractStrategyCategory(null), null);
  });

  it('strips forbidden mechanic/scoring/clinical keys from turn responsePayloadJson', () => {
    const sanitized = sanitizeTurnPayloadObject({
      step: 2,
      regionId: 'chest',
      score: 100,
      isCorrect: true,
      timerSeconds: 30,
      clinicalDiagnosis: 'none',
      ranking: 1,
    });
    assert.deepEqual(sanitized, { step: 2, regionId: 'chest' });
  });

  it('blocks unsafe image URI schemes and formats progress labels without grades', () => {
    assert.equal(isSafeRenderableImageSrc('/assets/story/1.png'), true);
    assert.equal(isSafeRenderableImageSrc('https://cdn.example.com/1.png'), true);
    assert.equal(isSafeRenderableImageSrc('javascript:alert(1)'), false);
    assert.equal(isSafeRenderableImageSrc('data:text/html,<script>'), false);

    assert.equal(translateStudentProgressStatusVi('not_started'), 'Chưa bắt đầu');
    assert.equal(translateStudentProgressStatusVi('in_progress'), 'Đang thực hành');
    assert.equal(translateStudentProgressStatusVi('completed'), 'Đã hoàn thành');
    assert.equal(translateStudentProgressStatusVi('abandoned'), 'Đã tạm dừng');
  });

  it('provides 5 non-clinical body regions and 5 non-diagnostic intensity levels', () => {
    assert.equal(BODY_MAP_REGIONS.length, 5);
    assert.equal(GENTLE_INTENSITY_LEVELS.length, 5);
  });
});

describe('P3-03 Client hygiene & student role boundary checks', () => {
  it('never references localStorage, sessionStorage, window.alert, window.open, teacher/admin APIs, or scoring strings', () => {
    const files = [
      join(process.cwd(), 'src/api/student.ts'),
      join(process.cwd(), 'src/types/student.ts'),
      join(process.cwd(), 'src/utils/speech.ts'),
      join(process.cwd(), 'src/utils/studentContent.ts'),
      join(process.cwd(), 'src/layouts/StudentLayout.tsx'),
      ...collectStudentSourceFiles(join(process.cwd(), 'src/components/student')),
    ];

    for (const file of files) {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      assert.equal(
        /\b(localStorage|sessionStorage|alert|open)\b/.test(
          code.replace(/window\.speechSynthesis/g, '').replace(/set.*Open/g, '').replace(/onOpen/g, '')
        ) && /\bwindow\.(alert|open)\b|\b(localStorage|sessionStorage)\b/.test(code),
        false,
        `Prohibited browser storage/popup API in ${file}`
      );
      assert.equal(
        /\/admin\/|\/library\/content|\/observations/.test(code),
        false,
        `Unauthorized teacher/admin API path referenced inside student file ${file}`
      );
    }
  });
});
