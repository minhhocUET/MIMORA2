import { z } from 'zod';
import {
  CANONICAL_CONTENT_TYPES,
  type CanonicalContentType,
} from '../db/schema/_shared.ts';
import { ApiErrors, type ApiErrorDetail } from '../http/errors.ts';

export const SUPPORTED_CONTENT_LOCALES = ['vi', 'vi-VN', 'en', 'en-US'] as const;
export type SupportedContentLocale = (typeof SUPPORTED_CONTENT_LOCALES)[number];

/**
 * Explicit forbidden keys in payloadJson / metadataJson to block gamification,
 * forced timers, hidden scoring, shaming, or psychological profiling.
 */
const FORBIDDEN_MECHANIC_KEYS = new Set([
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
  'punishment',
  'penalty',
  'penalties',
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

/**
 * Narrow text patterns targeting explicit shaming, forced competition, or
 * psychological diagnosis while preserving harmless SEL educational wording.
 */
const UNSAFE_TEXT_PATTERNS: ReadonlyArray<{
  code: string;
  pattern: RegExp;
  message: string;
}> = [
  {
    code: 'UNSAFE_DIAGNOSIS_CLAIM',
    pattern:
      /\b(chẩn đoán rối loạn|bệnh lý tâm thần|clinical diagnosis|psychiatric disorder|personality disorder)\b/i,
    message: 'Nội dung không được gắn nhãn chẩn đoán tâm lý hoặc bệnh lý cho trẻ.',
  },
  {
    code: 'UNSAFE_SHAMING_FEEDBACK',
    pattern:
      /\b(đồ ngốc|thật đáng xấu hổ|bạn quá tệ|bạn thật kém|you failed|shame on you|loser)\b/i,
    message: 'Nội dung không được chứa phản hồi mang tính xấu hổ hoặc chỉ trích trẻ.',
  },
  {
    code: 'UNSAFE_FORCED_COMPETITION',
    pattern:
      /\b(bảng xếp hạng|đứng hạng nhất|trừ điểm nếu sai|hết giờ sẽ bị phạt|leaderboard|countdown penalty)\b/i,
    message: 'Nội dung không được áp dụng xếp hạng cạnh tranh hoặc trừ điểm phạt.',
  },
];

const SAFE_ASSET_REF_REGEX = /^(?!\s*(?:javascript:|data:|vbscript:))[^\s]{1,500}$/i;

const mediaRefSchema = z
  .object({
    assetRef: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .regex(SAFE_ASSET_REF_REGEX, 'Tham chiếu tài nguyên media không hợp lệ.'),
    altText: z.string().trim().min(1).max(500),
    visualDescription: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();

const readAloudSchema = z
  .object({
    text: z.string().trim().min(1).max(2000),
    audioAssetRef: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .regex(SAFE_ASSET_REF_REGEX, 'Tham chiếu âm thanh không hợp lệ.')
      .optional(),
    speechRateHint: z.enum(['slow', 'normal']).optional(),
  })
  .strict();

const aacSupportSchema = z
  .object({
    symbolRef: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .regex(SAFE_ASSET_REF_REGEX, 'Tham chiếu ký hiệu AAC không hợp lệ.')
      .optional(),
    symbolLabel: z.string().trim().min(1).max(160).optional(),
    coreVocabulary: z.array(z.string().trim().min(1).max(64)).max(12).optional(),
  })
  .strict();

export const emotionCardPayloadSchema = z
  .object({
    displayTitle: z.string().trim().min(1).max(160),
    childText: z.string().trim().min(1).max(600),
    emotionKey: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    emotionLabel: z.string().trim().min(1).max(120),
    accessibleDescription: z.string().trim().min(1).max(1000),
    illustration: mediaRefSchema.optional(),
    supportiveBodyCue: z.string().trim().min(1).max(400).optional(),
    reflectionPrompts: z.array(z.string().trim().min(1).max(300)).max(6).optional(),
    readAloud: readAloudSchema.optional(),
    aacSupport: aacSupportSchema.optional(),
  })
  .strict();

export const situationCardPayloadSchema = z
  .object({
    displayTitle: z.string().trim().min(1).max(160),
    situationText: z.string().trim().min(1).max(1500),
    narrativeContext: z.string().trim().min(1).max(1000),
    accessibleDescription: z.string().trim().min(1).max(1000),
    illustration: mediaRefSchema.optional(),
    discussionPrompts: z.array(z.string().trim().min(1).max(300)).max(6).optional(),
    readAloud: readAloudSchema.optional(),
    aacSupport: aacSupportSchema.optional(),
  })
  .strict();

export const actionCardPayloadSchema = z
  .object({
    displayTitle: z.string().trim().min(1).max(160),
    actionPhrase: z.string().trim().min(1).max(400),
    accessibleDescription: z.string().trim().min(1).max(1000),
    visualSupport: mediaRefSchema.optional(),
    contextExplanation: z.string().trim().min(1).max(1000).optional(),
    possibleOutcomes: z.array(z.string().trim().min(1).max(300)).max(5).optional(),
    readAloud: readAloudSchema.optional(),
    aacSupport: aacSupportSchema.optional(),
  })
  .strict();

const socialStorySceneSchema = z
  .object({
    sceneNumber: z.number().int().min(1).max(12),
    text: z.string().trim().min(1).max(1000),
    accessibleDescription: z.string().trim().min(1).max(1000),
    illustration: mediaRefSchema.optional(),
    readAloud: readAloudSchema.optional(),
    aacSupport: aacSupportSchema.optional(),
  })
  .strict();

export const socialStoryCardPayloadSchema = z
  .object({
    displayTitle: z.string().trim().min(1).max(160),
    storyIntro: z.string().trim().min(1).max(600).optional(),
    scenes: z.array(socialStorySceneSchema).min(2).max(12),
    closingReflection: z.string().trim().min(1).max(500).optional(),
    readAloud: readAloudSchema.optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    for (let i = 0; i < val.scenes.length; i += 1) {
      if (val.scenes[i].sceneNumber !== i + 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['scenes', i, 'sceneNumber'],
          message: `Thứ tự cảnh phải liên tiếp bắt đầu từ 1 (kỳ vọng ${i + 1}).`,
        });
      }
    }
  });

export const communicationCardPayloadSchema = z
  .object({
    displayTitle: z.string().trim().min(1).max(160),
    communicationIntent: z.string().trim().min(1).max(160),
    phrase: z.string().trim().min(1).max(400),
    accessibleDescription: z.string().trim().min(1).max(1000),
    aacSupport: aacSupportSchema.optional(),
    visualSupport: mediaRefSchema.optional(),
    readAloud: readAloudSchema.optional(),
  })
  .strict();

export const CONTENT_METADATA_SCHEMA = z
  .object({
    ageBand: z.string().trim().min(1).max(64).optional(),
    selThemes: z.array(z.string().trim().min(1).max(64)).max(10).optional(),
    assetAttributionNote: z.string().trim().min(1).max(500).optional(),
    localizationNotes: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

const SCHEMA_BY_TYPE: Record<CanonicalContentType, z.ZodType<Record<string, unknown>>> = {
  emotion_card: emotionCardPayloadSchema as unknown as z.ZodType<Record<string, unknown>>,
  situation_card: situationCardPayloadSchema as unknown as z.ZodType<Record<string, unknown>>,
  action_card: actionCardPayloadSchema as unknown as z.ZodType<Record<string, unknown>>,
  social_story_card: socialStoryCardPayloadSchema as unknown as z.ZodType<Record<string, unknown>>,
  communication_card: communicationCardPayloadSchema as unknown as z.ZodType<Record<string, unknown>>,
};

export function scanUnsafeSelText(
  text: string,
  field: string
): ApiErrorDetail[] {
  const details: ApiErrorDetail[] = [];
  for (const rule of UNSAFE_TEXT_PATTERNS) {
    if (rule.pattern.test(text)) {
      details.push({
        field,
        code: rule.code,
        messageKey: 'error.content.unsafe_text',
        message: rule.message,
      });
    }
  }
  return details;
}

function scanForbiddenMechanicsAndText(
  value: unknown,
  path: string,
  details: ApiErrorDetail[]
): void {
  if (typeof value === 'string') {
    details.push(...scanUnsafeSelText(value, path));
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      scanForbiddenMechanicsAndText(value[i], `${path}[${i}]`, details);
    }
    return;
  }

  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (FORBIDDEN_MECHANIC_KEYS.has(normalizedKey)) {
        details.push({
          field: `${path}.${key}`,
          code: 'FORBIDDEN_MECHANIC_FIELD',
          messageKey: 'error.content.forbidden_mechanic',
          message: `Trường "${key}" không được phép vì vi phạm nguyên tắc an toàn SEL cho trẻ.`,
        });
        continue;
      }
      scanForbiddenMechanicsAndText(child, `${path}.${key}`, details);
    }
  }
}

export function isCanonicalContentType(val: string): val is CanonicalContentType {
  return (CANONICAL_CONTENT_TYPES as readonly string[]).includes(val);
}

export function validateContentPayloadAndMetadata(params: {
  contentType: CanonicalContentType;
  locale: string;
  payloadJson: unknown;
  metadataJson?: unknown;
}): {
  locale: SupportedContentLocale;
  payloadJson: Record<string, unknown>;
  metadataJson: Record<string, unknown> | null;
} {
  const details: ApiErrorDetail[] = [];

  // Locale validation
  const localeCheck = z.enum(SUPPORTED_CONTENT_LOCALES).safeParse(params.locale.trim());
  if (!localeCheck.success) {
    details.push({
      field: 'body.locale',
      code: 'INVALID_LOCALE',
      messageKey: 'error.content.invalid_locale',
      message: `Ngôn ngữ không được hỗ trợ. Chỉ chấp nhận: ${SUPPORTED_CONTENT_LOCALES.join(', ')}.`,
    });
  }

  // Deep scan raw inputs BEFORE strict Zod stripping so forbidden fields give explicit safety errors
  scanForbiddenMechanicsAndText(params.payloadJson, 'body.payloadJson', details);
  if (params.metadataJson !== undefined && params.metadataJson !== null) {
    scanForbiddenMechanicsAndText(params.metadataJson, 'body.metadataJson', details);
  }

  if (details.length > 0) {
    throw ApiErrors.validation(details);
  }

  const schema = SCHEMA_BY_TYPE[params.contentType];
  const payloadParsed = schema.safeParse(params.payloadJson);
  if (!payloadParsed.success) {
    throw ApiErrors.validation(
      payloadParsed.error.issues.map((issue) => ({
        field: `body.payloadJson.${issue.path.map(String).join('.') || '_root'}`,
        code: `INVALID_${issue.code.toUpperCase()}`,
        messageKey: 'error.content.invalid_payload',
        message: issue.message || 'Cấu trúc payloadJson không hợp lệ cho loại nội dung này.',
      }))
    );
  }

  let validatedMetadata: Record<string, unknown> | null = null;
  if (params.metadataJson !== undefined && params.metadataJson !== null) {
    const metaParsed = CONTENT_METADATA_SCHEMA.safeParse(params.metadataJson);
    if (!metaParsed.success) {
      throw ApiErrors.validation(
        metaParsed.error.issues.map((issue) => ({
          field: `body.metadataJson.${issue.path.map(String).join('.') || '_root'}`,
          code: `INVALID_${issue.code.toUpperCase()}`,
          messageKey: 'error.content.invalid_metadata',
          message: 'Cấu trúc metadataJson không hợp lệ.',
        }))
      );
    }
    validatedMetadata = metaParsed.data as Record<string, unknown>;
  }

  return {
    locale: localeCheck.data!,
    payloadJson: payloadParsed.data,
    metadataJson: validatedMetadata,
  };
}
