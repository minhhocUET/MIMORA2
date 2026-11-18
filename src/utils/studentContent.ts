import {
  PROPOSAL_V1_SESSIONS,
  mapContentVersionToUiDescriptor,
  type CanonicalContentType,
  type SessionNumber,
  type StepComponentType,
  type StepNumber,
  type StrategyCategory,
} from '../types/chapter.ts';
import type {
  ParsedAacSupport,
  ParsedActionCardPayload,
  ParsedCommunicationCardPayload,
  ParsedEmotionCardPayload,
  ParsedMediaRef,
  ParsedReadAloud,
  ParsedSituationCardPayload,
  ParsedSocialStoryCardPayload,
  ParsedSocialStoryScene,
  ResolvedChapterItemPlacement,
  SafeStudentPinnedItemView,
} from '../types/student.ts';

function asRecord(val: unknown): Record<string, unknown> | null {
  return val && typeof val === 'object' && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : null;
}

function asNonEmptyString(val: unknown): string | undefined {
  return typeof val === 'string' && val.trim().length > 0 ? val.trim() : undefined;
}

function asStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) {
    return [];
  }
  return val
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
}

function parseMediaRef(val: unknown): ParsedMediaRef | undefined {
  const rec = asRecord(val);
  if (!rec) {
    return undefined;
  }
  const assetRef = asNonEmptyString(rec.assetRef);
  const altText = asNonEmptyString(rec.altText);
  if (!assetRef || !altText) {
    return undefined;
  }
  return {
    assetRef,
    altText,
    visualDescription: asNonEmptyString(rec.visualDescription),
  };
}

function parseReadAloud(val: unknown): ParsedReadAloud | undefined {
  const rec = asRecord(val);
  if (!rec) {
    return undefined;
  }
  const text = asNonEmptyString(rec.text);
  if (!text) {
    return undefined;
  }
  return {
    text,
    audioAssetRef: asNonEmptyString(rec.audioAssetRef),
    speechRateHint:
      rec.speechRateHint === 'slow' || rec.speechRateHint === 'normal'
        ? rec.speechRateHint
        : undefined,
  };
}

function parseAacSupport(val: unknown): ParsedAacSupport | undefined {
  const rec = asRecord(val);
  if (!rec) {
    return undefined;
  }
  const symbolRef = asNonEmptyString(rec.symbolRef);
  const symbolLabel = asNonEmptyString(rec.symbolLabel);
  const coreVocabulary = asStringArray(rec.coreVocabulary);
  if (!symbolRef && !symbolLabel && coreVocabulary.length === 0) {
    return undefined;
  }
  return {
    symbolRef,
    symbolLabel,
    coreVocabulary,
  };
}

export function parseEmotionCardPayload(
  payloadJson: Record<string, unknown>,
  fallbackTitle: string
): ParsedEmotionCardPayload {
  return {
    displayTitle: asNonEmptyString(payloadJson.displayTitle) ?? fallbackTitle,
    childText: asNonEmptyString(payloadJson.childText) ?? '',
    emotionKey: asNonEmptyString(payloadJson.emotionKey) ?? 'feeling',
    emotionLabel: asNonEmptyString(payloadJson.emotionLabel) ?? fallbackTitle,
    accessibleDescription: asNonEmptyString(payloadJson.accessibleDescription) ?? fallbackTitle,
    illustration: parseMediaRef(payloadJson.illustration),
    supportiveBodyCue: asNonEmptyString(payloadJson.supportiveBodyCue),
    reflectionPrompts: asStringArray(payloadJson.reflectionPrompts),
    readAloud: parseReadAloud(payloadJson.readAloud),
    aacSupport: parseAacSupport(payloadJson.aacSupport),
  };
}

export function parseSituationCardPayload(
  payloadJson: Record<string, unknown>,
  fallbackTitle: string
): ParsedSituationCardPayload {
  return {
    displayTitle: asNonEmptyString(payloadJson.displayTitle) ?? fallbackTitle,
    situationText: asNonEmptyString(payloadJson.situationText) ?? '',
    narrativeContext: asNonEmptyString(payloadJson.narrativeContext) ?? '',
    accessibleDescription: asNonEmptyString(payloadJson.accessibleDescription) ?? fallbackTitle,
    illustration: parseMediaRef(payloadJson.illustration),
    discussionPrompts: asStringArray(payloadJson.discussionPrompts),
    readAloud: parseReadAloud(payloadJson.readAloud),
    aacSupport: parseAacSupport(payloadJson.aacSupport),
  };
}

export function parseActionCardPayload(
  payloadJson: Record<string, unknown>,
  fallbackTitle: string
): ParsedActionCardPayload {
  return {
    displayTitle: asNonEmptyString(payloadJson.displayTitle) ?? fallbackTitle,
    actionPhrase: asNonEmptyString(payloadJson.actionPhrase) ?? '',
    accessibleDescription: asNonEmptyString(payloadJson.accessibleDescription) ?? fallbackTitle,
    visualSupport: parseMediaRef(payloadJson.visualSupport),
    contextExplanation: asNonEmptyString(payloadJson.contextExplanation),
    possibleOutcomes: asStringArray(payloadJson.possibleOutcomes),
    readAloud: parseReadAloud(payloadJson.readAloud),
    aacSupport: parseAacSupport(payloadJson.aacSupport),
  };
}

export function parseSocialStoryPayload(
  payloadJson: Record<string, unknown>,
  fallbackTitle: string
): ParsedSocialStoryCardPayload {
  const rawScenes = Array.isArray(payloadJson.scenes) ? payloadJson.scenes : [];
  const scenes: ParsedSocialStoryScene[] = rawScenes
    .map((entry, idx): ParsedSocialStoryScene | null => {
      const rec = asRecord(entry);
      if (!rec) {
        return null;
      }
      const sceneNumber =
        typeof rec.sceneNumber === 'number' && Number.isInteger(rec.sceneNumber)
          ? rec.sceneNumber
          : idx + 1;
      const text = asNonEmptyString(rec.text);
      const accessibleDescription = asNonEmptyString(rec.accessibleDescription) ?? text ?? '';
      if (!text) {
        return null;
      }
      return {
        sceneNumber,
        text,
        accessibleDescription,
        illustration: parseMediaRef(rec.illustration),
        readAloud: parseReadAloud(rec.readAloud),
        aacSupport: parseAacSupport(rec.aacSupport),
      };
    })
    .filter((s): s is ParsedSocialStoryScene => s !== null)
    .sort((a, b) => a.sceneNumber - b.sceneNumber);

  return {
    displayTitle: asNonEmptyString(payloadJson.displayTitle) ?? fallbackTitle,
    storyIntro: asNonEmptyString(payloadJson.storyIntro),
    scenes,
    closingReflection: asNonEmptyString(payloadJson.closingReflection),
    readAloud: parseReadAloud(payloadJson.readAloud),
  };
}

export function parseCommunicationCardPayload(
  payloadJson: Record<string, unknown>,
  fallbackTitle: string
): ParsedCommunicationCardPayload {
  return {
    displayTitle: asNonEmptyString(payloadJson.displayTitle) ?? fallbackTitle,
    communicationIntent: asNonEmptyString(payloadJson.communicationIntent) ?? 'Giao tiếp nhu cầu',
    phrase: asNonEmptyString(payloadJson.phrase) ?? fallbackTitle,
    accessibleDescription: asNonEmptyString(payloadJson.accessibleDescription) ?? fallbackTitle,
    aacSupport: parseAacSupport(payloadJson.aacSupport),
    visualSupport: parseMediaRef(payloadJson.visualSupport),
    readAloud: parseReadAloud(payloadJson.readAloud),
  };
}

const VALID_STRATEGY_CATEGORIES: ReadonlySet<StrategyCategory> = new Set([
  'breathing_grounding',
  'sensory_comfort',
  'movement_pause',
  'self_talk',
  'ask_for_help',
  'creative_expression',
  'social_repair',
]);

export const STRATEGY_CATEGORY_LABELS_VI: Record<StrategyCategory, string> = {
  breathing_grounding: 'Hít thở & Tiếp đất',
  sensory_comfort: 'Không gian giác quan',
  movement_pause: 'Vận động nhẹ & Tạm nghỉ',
  self_talk: 'Tự nhủ dịu dàng',
  ask_for_help: 'Nhờ thầy cô / người lớn',
  creative_expression: 'Diễn đạt sáng tạo',
  social_repair: 'Kết nối & Làm hòa an toàn',
};

export function extractStrategyCategory(
  metadataJson: Record<string, unknown> | null
): StrategyCategory | null {
  const themes = asStringArray(metadataJson?.selThemes);
  for (const tag of themes) {
    if (tag.startsWith('strategy_cat:')) {
      const cat = tag.slice('strategy_cat:'.length).trim() as StrategyCategory;
      if (VALID_STRATEGY_CATEGORIES.has(cat)) {
        return cat;
      }
    }
    if (tag.startsWith('category:')) {
      const cat = tag.slice('category:'.length).trim() as StrategyCategory;
      if (VALID_STRATEGY_CATEGORIES.has(cat)) {
        return cat;
      }
    }
    if (VALID_STRATEGY_CATEGORIES.has(tag as StrategyCategory)) {
      return tag as StrategyCategory;
    }
  }
  return null;
}

const STEP_TO_SESSION: Record<StepNumber, SessionNumber> = {
  1: 1,
  2: 1,
  3: 2,
  4: 2,
  5: 3,
  6: 3,
};

const STEP_TO_COMPONENT: Record<StepNumber, StepComponentType> = {
  1: 'situation_observe',
  2: 'body_map',
  3: 'intensity_scale',
  4: 'strategy_deck',
  5: 'fact_vs_guess',
  6: 'social_problem_solving',
};

const FALLBACK_STEP_BY_CONTENT_TYPE: Record<CanonicalContentType, StepNumber> = {
  social_story_card: 1,
  situation_card: 1,
  emotion_card: 1,
  action_card: 4,
  communication_card: 6,
};

export function resolveItemChapterPlacement(
  item: SafeStudentPinnedItemView
): ResolvedChapterItemPlacement {
  const descriptor = mapContentVersionToUiDescriptor({
    id: item.contentVersionId,
    contentItemId: item.contentItemId,
    contentType: item.contentType,
    title: item.title,
    locale: item.locale,
    payloadJson: item.payloadJson,
    metadataJson: item.metadataJson,
  });

  const stepNumber: StepNumber =
    descriptor.stepNumber ?? FALLBACK_STEP_BY_CONTENT_TYPE[item.contentType] ?? 1;
  const sessionNumber: SessionNumber =
    descriptor.sessionNumber ?? STEP_TO_SESSION[stepNumber];

  return {
    item,
    sessionNumber,
    stepNumber,
    componentType: STEP_TO_COMPONENT[stepNumber],
    chapterKey: descriptor.chapterKey,
    strategyCategory: extractStrategyCategory(item.metadataJson),
    groupingSource:
      descriptor.stepNumber !== null || descriptor.sessionNumber !== null
        ? 'sel_theme_convention'
        : 'content_type_fallback',
  };
}

export function getStepMeta(stepNumber: StepNumber) {
  for (const session of PROPOSAL_V1_SESSIONS) {
    for (const step of session.steps) {
      if (step.stepNumber === stepNumber) {
        return { session, step };
      }
    }
  }
  return {
    session: PROPOSAL_V1_SESSIONS[0],
    step: PROPOSAL_V1_SESSIONS[0].steps[0],
  };
}

export function formatDueDateVi(isoDate: string | null): string {
  if (!isoDate) {
    return 'Không giới hạn ngày hoàn thành';
  }
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) {
    return 'Theo nhịp độ của con';
  }
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

export function formatTimeVi(isoDate: string | null): string {
  if (!isoDate) {
    return '—';
  }
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  }).format(d);
}

export function translateStudentProgressStatusVi(status: string): string {
  switch (status) {
    case 'completed':
      return 'Đã hoàn thành';
    case 'in_progress':
      return 'Đang thực hành';
    case 'abandoned':
      return 'Đã tạm dừng';
    case 'not_started':
    default:
      return 'Chưa bắt đầu';
  }
}

export function translateContentTypeChildLabelVi(type: CanonicalContentType): string {
  switch (type) {
    case 'social_story_card':
      return 'Câu chuyện xã hội';
    case 'situation_card':
      return 'Tình huống quan sát';
    case 'emotion_card':
      return 'Thẻ cảm xúc';
    case 'action_card':
      return 'Thẻ chiến lược';
    case 'communication_card':
      return 'Thẻ giao tiếp AAC';
  }
}

/**
 * Defense-in-depth client guard matching backend P2-06 FORBIDDEN_ATTEMPT_PAYLOAD_KEYS
 * so no gamification, timer, score, correctness, or clinical fields are ever emitted.
 */
const FORBIDDEN_CLIENT_TURN_KEYS = new Set([
  'timer',
  'timerseconds',
  'countdown',
  'countdownseconds',
  'timelimit',
  'timelimitseconds',
  'maxseconds',
  'leaderboard',
  'leaderboards',
  'ranking',
  'rankings',
  'rank',
  'score',
  'scores',
  'points',
  'maxscore',
  'passingscore',
  'streak',
  'streaks',
  'streakpenalty',
  'penalty',
  'penalties',
  'punishment',
  'shame',
  'shamingfeedback',
  'wronganswerfeedback',
  'iscorrect',
  'correctanswer',
  'correctoption',
  'correctchoice',
  'correctemotion',
  'correctexpression',
  'correctfacialexpression',
  'mandatoryexpression',
  'diagnosis',
  'clinicaldiagnosis',
  'disorder',
  'personalitylabel',
  'personalitytype',
  'psychologicalprofile',
  'profiling',
  'assessmentscore',
]);

export function sanitizeTurnPayloadObject(
  input: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!input) {
    return null;
  }
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    const norm = k.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (FORBIDDEN_CLIENT_TURN_KEYS.has(norm)) {
      continue;
    }
    clean[k] = v;
  }
  return Object.keys(clean).length > 0 ? clean : null;
}

export function extractPrimaryReadAloudText(item: SafeStudentPinnedItemView): string {
  const payload = item.payloadJson;
  switch (item.contentType) {
    case 'emotion_card': {
      const parsed = parseEmotionCardPayload(payload, item.title);
      return parsed.readAloud?.text ?? `${parsed.emotionLabel}. ${parsed.childText}`.trim();
    }
    case 'situation_card': {
      const parsed = parseSituationCardPayload(payload, item.title);
      return parsed.readAloud?.text ?? `${parsed.displayTitle}. ${parsed.situationText}`.trim();
    }
    case 'action_card': {
      const parsed = parseActionCardPayload(payload, item.title);
      return parsed.readAloud?.text ?? `${parsed.displayTitle}. ${parsed.actionPhrase}`.trim();
    }
    case 'social_story_card': {
      const parsed = parseSocialStoryPayload(payload, item.title);
      return (
        parsed.readAloud?.text ??
        parsed.storyIntro ??
        parsed.scenes[0]?.readAloud?.text ??
        parsed.scenes[0]?.text ??
        parsed.displayTitle
      );
    }
    case 'communication_card': {
      const parsed = parseCommunicationCardPayload(payload, item.title);
      return parsed.readAloud?.text ?? parsed.phrase;
    }
  }
}

export function extractAacCoreVocabulary(item: SafeStudentPinnedItemView): string[] {
  const aac = parseAacSupport(item.payloadJson.aacSupport);
  const words: string[] = [];
  if (aac?.symbolLabel) {
    words.push(aac.symbolLabel);
  }
  if (aac?.coreVocabulary) {
    words.push(...aac.coreVocabulary);
  }
  return Array.from(new Set(words)).slice(0, 8);
}

/**
 * Builds an honest URL check for illustration assetRefs. Rejects dangerous URIs,
 * preserves relative/http paths, and lets components fall back cleanly if load fails.
 */
export function isSafeRenderableImageSrc(assetRef: string | undefined): boolean {
  if (!assetRef) {
    return false;
  }
  const trimmed = assetRef.trim();
  return (
    trimmed.startsWith('/') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://')
  );
}
