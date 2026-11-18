/**
 * Frontend structure & compatibility layer for MIMORA Product Proposal V1.0.
 * Prepared for P3-03 Student Chapter UI without altering backend P2-04 schemas or DB migrations.
 */

export type CanonicalContentType =
  | 'emotion_card'
  | 'situation_card'
  | 'action_card'
  | 'social_story_card'
  | 'communication_card';

export type SessionNumber = 1 | 2 | 3;
export type StepNumber = 1 | 2 | 3 | 4 | 5 | 6;

export type EmotionTier = 'basic' | 'extended';

export type StrategyCategory =
  | 'breathing_grounding'
  | 'sensory_comfort'
  | 'movement_pause'
  | 'self_talk'
  | 'ask_for_help'
  | 'creative_expression'
  | 'social_repair';

export type StepComponentType =
  | 'situation_observe'
  | 'body_map'
  | 'intensity_scale'
  | 'strategy_deck'
  | 'fact_vs_guess'
  | 'social_problem_solving';

export interface LearningStepSpec {
  stepNumber: StepNumber;
  sessionNumber: SessionNumber;
  componentType: StepComponentType;
  titleKey: string;
  defaultTitleVi: string;
  summaryVi: string;
}

export interface SessionSpec {
  sessionNumber: SessionNumber;
  titleVi: string;
  steps: readonly [LearningStepSpec, LearningStepSpec];
}

export interface ChapterSpec {
  chapterKey: string;
  title: string;
  ageBand: string | null;
  locale: 'vi' | 'vi-VN' | 'en' | 'en-US';
  sessions: readonly [SessionSpec, SessionSpec, SessionSpec];
}

/**
 * Canonical 3-session / 6-step educational structure from MIMORA Product Proposal V1.0.
 */
export const PROPOSAL_V1_SESSIONS: readonly [SessionSpec, SessionSpec, SessionSpec] = [
  {
    sessionNumber: 1,
    titleVi: 'Buổi 1: Nhận diện tình huống & Tín hiệu cơ thể',
    steps: [
      {
        stepNumber: 1,
        sessionNumber: 1,
        componentType: 'situation_observe',
        titleKey: 'chapter.step.1',
        defaultTitleVi: 'Bước 1: Quan sát tình huống & cảm xúc nhân vật',
        summaryVi: 'Khám phá bối cảnh câu chuyện và những cảm xúc có thể xuất hiện.',
      },
      {
        stepNumber: 2,
        sessionNumber: 1,
        componentType: 'body_map',
        titleKey: 'chapter.step.2',
        defaultTitleVi: 'Bước 2: Kết nối tín hiệu cơ thể (tùy chọn)',
        summaryVi: 'Lắng nghe cảm giác trên cơ thể mà không phán xét đúng hay sai.',
      },
    ],
  },
  {
    sessionNumber: 2,
    titleVi: 'Buổi 2: Mức độ cảm xúc & Chiến lược hỗ trợ',
    steps: [
      {
        stepNumber: 3,
        sessionNumber: 2,
        componentType: 'intensity_scale',
        titleKey: 'chapter.step.3',
        defaultTitleVi: 'Bước 3: Khám phá mức độ cảm xúc',
        summaryVi: 'Nhận biết cảm xúc nhẹ nhàng hay mạnh mẽ qua thang đo trực quan.',
      },
      {
        stepNumber: 4,
        sessionNumber: 2,
        componentType: 'strategy_deck',
        titleKey: 'chapter.step.4',
        defaultTitleVi: 'Bước 4: Chọn chiến lược điều hòa phù hợp',
        summaryVi: 'Thử nghiệm các thẻ chiến lược an toàn giúp bản thân dễ chịu hơn.',
      },
    ],
  },
  {
    sessionNumber: 3,
    titleVi: 'Buổi 3: Quan sát khách quan & Giải pháp tôn trọng',
    steps: [
      {
        stepNumber: 5,
        sessionNumber: 3,
        componentType: 'fact_vs_guess',
        titleKey: 'chapter.step.5',
        defaultTitleVi: 'Bước 5: Phân biệt điều quan sát được và suy đoán',
        summaryVi: 'Tách bạch sự kiện nhìn thấy/nghe thấy với điều mình đang đoán.',
      },
      {
        stepNumber: 6,
        sessionNumber: 3,
        componentType: 'social_problem_solving',
        titleKey: 'chapter.step.6',
        defaultTitleVi: 'Bước 6: Tìm cách ứng xử an toàn & tôn trọng',
        summaryVi: 'Lựa chọn hướng giải quyết nhẹ nhàng cho mình và bạn bè.',
      },
    ],
  },
] as const;

export interface EmotionCardPresentation {
  key: string;
  label: string;
  tier: EmotionTier;
  bodyCue: string;
  motifs: 'sunbeam' | 'ripple' | 'breeze' | 'cloud' | 'spark' | 'shelter';
  tone: 'mint' | 'peach' | 'lavender' | 'butter';
  readAloudText: string;
  aacVocabulary: string[];
}

export interface StrategyCardPresentation {
  key: string;
  title: string;
  category: StrategyCategory;
  categoryLabel: string;
  actionPhrase: string;
  tone: 'mint' | 'peach' | 'lavender' | 'butter';
  readAloudText: string;
}

export interface CommunicationBoardItem {
  key: string;
  label: string;
  phrase: string;
  intent: string;
}

export interface BodyMapRegion {
  id: 'head' | 'chest' | 'stomach' | 'hands' | 'shoulders';
  labelVi: string;
  neutralSensationsVi: string[];
}

export interface IntensityLevel {
  level: 1 | 2 | 3 | 4 | 5;
  labelVi: string;
  visualCueVi: string;
}

export interface FactVsGuessPrompt {
  id: string;
  statementVi: string;
  kindHint: 'observable_fact' | 'interpretation_guess';
}

/**
 * Backend P2-04 content_version shape (read-only mirror of validated API responses).
 */
export interface BackendContentVersionInput {
  id: string;
  contentItemId: string;
  contentType: CanonicalContentType;
  title: string;
  locale: string;
  payloadJson: Record<string, unknown>;
  metadataJson: Record<string, unknown> | null;
}

export interface MappedContentGroupingDescriptor {
  contentVersionId: string;
  contentType: CanonicalContentType;
  title: string;
  locale: string;
  ageBand: string | null;
  chapterKey: string | null;
  sessionNumber: SessionNumber | null;
  stepNumber: StepNumber | null;
  storySceneCount: number | null;
  hasReadAloud: boolean;
  hasAacSupport: boolean;
  /**
   * Explicit marker when grouping relied on metadataJson.selThemes string-tag convention
   * because P2-04 CONTENT_METADATA_SCHEMA enforces .strict() without typed chapter/session/step fields.
   */
  groupingSource: 'sel_theme_convention' | 'unscoped_library_item';
}

/**
 * Safely maps existing P2-04 content_versions rows into UI-ready Chapter/Session/Step descriptors
 * without mutating backend validators or requiring a DB migration in P3-01.
 * Recognizes optional tag conventions in metadataJson.selThemes:
 *   "chapter:<key>", "session:<1|2|3>", "step:<1..6>".
 */
export function mapContentVersionToUiDescriptor(
  version: BackendContentVersionInput
): MappedContentGroupingDescriptor {
  const meta = version.metadataJson ?? {};
  const payload = version.payloadJson ?? {};
  const ageBand = typeof meta.ageBand === 'string' ? meta.ageBand : null;
  const themes = Array.isArray(meta.selThemes)
    ? meta.selThemes.filter((t): t is string => typeof t === 'string')
    : [];

  let chapterKey: string | null = null;
  let sessionNumber: SessionNumber | null = null;
  let stepNumber: StepNumber | null = null;

  for (const tag of themes) {
    if (tag.startsWith('chapter:') && tag.length > 'chapter:'.length) {
      chapterKey = tag.slice('chapter:'.length).trim();
    } else if (tag.startsWith('session:')) {
      const n = Number(tag.slice('session:'.length));
      if (n === 1 || n === 2 || n === 3) {
        sessionNumber = n;
      }
    } else if (tag.startsWith('step:')) {
      const n = Number(tag.slice('step:'.length));
      if (n >= 1 && n <= 6 && Number.isInteger(n)) {
        stepNumber = n as StepNumber;
      }
    }
  }

  const storySceneCount =
    version.contentType === 'social_story_card' && Array.isArray(payload.scenes)
      ? payload.scenes.length
      : null;

  const hasReadAloud = Boolean(payload.readAloud && typeof payload.readAloud === 'object');
  const hasAacSupport = Boolean(payload.aacSupport && typeof payload.aacSupport === 'object');

  return {
    contentVersionId: version.id,
    contentType: version.contentType,
    title: version.title,
    locale: version.locale,
    ageBand,
    chapterKey,
    sessionNumber,
    stepNumber,
    storySceneCount,
    hasReadAloud,
    hasAacSupport,
    groupingSource:
      chapterKey || sessionNumber !== null || stepNumber !== null
        ? 'sel_theme_convention'
        : 'unscoped_library_item',
  };
}
