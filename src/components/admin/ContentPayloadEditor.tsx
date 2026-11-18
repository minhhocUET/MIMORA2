import { Plus, Trash2 } from 'lucide-react';
import type { CanonicalContentType } from '../../types/chapter.ts';
import type { ContentMetadataJson, SocialStoryScenePayload } from '../../types/admin.ts';
import type { AppLocale } from '../../i18n/index.ts';
import {
  EMOTION_TIERS,
  STRATEGY_CATEGORIES_7,
  getContentTypeLabel,
} from '../../utils/p302.ts';
import { Alert, Button, FormField, Input, Select } from '../ui/index.ts';

export interface ContentEditorValues {
  slug: string;
  contentType: CanonicalContentType;
  title: string;
  summary: string;
  locale: string;
  payloadJson: Record<string, unknown>;
  metadataJson: ContentMetadataJson;
}

export interface ContentPayloadEditorProps {
  mode: 'create_item' | 'create_version' | 'edit_version';
  locale: AppLocale;
  values: ContentEditorValues;
  onChange: (next: ContentEditorValues) => void;
  slugDisabled?: boolean;
}

function getStr(obj: Record<string, unknown>, key: string): string {
  const val = obj[key];
  return typeof val === 'string' ? val : '';
}

function getNestedStr(obj: Record<string, unknown>, parent: string, key: string): string {
  const p = obj[parent];
  if (!p || typeof p !== 'object' || Array.isArray(p)) return '';
  const val = (p as Record<string, unknown>)[key];
  return typeof val === 'string' ? val : '';
}

function getLines(obj: Record<string, unknown>, key: string): string {
  const arr = obj[key];
  if (!Array.isArray(arr)) return '';
  return arr.filter((x): x is string => typeof x === 'string').join('\n');
}

function getCoreVocabCsv(obj: Record<string, unknown>): string {
  const aac = obj.aacSupport;
  if (!aac || typeof aac !== 'object' || Array.isArray(aac)) return '';
  const vocab = (aac as Record<string, unknown>).coreVocabulary;
  if (!Array.isArray(vocab)) return '';
  return vocab.filter((x): x is string => typeof x === 'string').join(', ');
}

/**
 * Strips empty optional strings/objects before sending to strict Zod .strict() endpoints.
 */
export function buildCleanPayloadForSubmit(
  contentType: CanonicalContentType,
  raw: Record<string, unknown>
): Record<string, unknown> {
  const cleanMedia = (key: 'illustration' | 'visualSupport') => {
    const m = raw[key];
    if (!m || typeof m !== 'object' || Array.isArray(m)) return undefined;
    const rec = m as Record<string, unknown>;
    const assetRef = typeof rec.assetRef === 'string' ? rec.assetRef.trim() : '';
    const altText = typeof rec.altText === 'string' ? rec.altText.trim() : '';
    const visualDescription =
      typeof rec.visualDescription === 'string' ? rec.visualDescription.trim() : '';
    if (!assetRef && !altText) return undefined;
    return {
      assetRef,
      altText,
      ...(visualDescription ? { visualDescription } : {}),
    };
  };

  const cleanReadAloud = () => {
    const r = raw.readAloud;
    if (!r || typeof r !== 'object' || Array.isArray(r)) return undefined;
    const rec = r as Record<string, unknown>;
    const text = typeof rec.text === 'string' ? rec.text.trim() : '';
    if (!text) return undefined;
    const audioAssetRef =
      typeof rec.audioAssetRef === 'string' ? rec.audioAssetRef.trim() : '';
    const speechRateHint =
      rec.speechRateHint === 'slow' || rec.speechRateHint === 'normal'
        ? rec.speechRateHint
        : undefined;
    return {
      text,
      ...(audioAssetRef ? { audioAssetRef } : {}),
      ...(speechRateHint ? { speechRateHint } : {}),
    };
  };

  const cleanAac = () => {
    const a = raw.aacSupport;
    if (!a || typeof a !== 'object' || Array.isArray(a)) return undefined;
    const rec = a as Record<string, unknown>;
    const symbolRef = typeof rec.symbolRef === 'string' ? rec.symbolRef.trim() : '';
    const symbolLabel = typeof rec.symbolLabel === 'string' ? rec.symbolLabel.trim() : '';
    const vocab = Array.isArray(rec.coreVocabulary)
      ? rec.coreVocabulary.map((s) => String(s).trim()).filter(Boolean)
      : [];
    if (!symbolRef && !symbolLabel && vocab.length === 0) return undefined;
    return {
      ...(symbolRef ? { symbolRef } : {}),
      ...(symbolLabel ? { symbolLabel } : {}),
      ...(vocab.length > 0 ? { coreVocabulary: vocab } : {}),
    };
  };

  const cleanLines = (key: string) => {
    const arr = raw[key];
    if (!Array.isArray(arr)) return undefined;
    const list = arr.map((s) => String(s).trim()).filter(Boolean);
    return list.length > 0 ? list : undefined;
  };

  const illustration = cleanMedia('illustration');
  const visualSupport = cleanMedia('visualSupport');
  const readAloud = cleanReadAloud();
  const aacSupport = cleanAac();

  if (contentType === 'emotion_card') {
    const supportiveBodyCue = getStr(raw, 'supportiveBodyCue').trim();
    const reflectionPrompts = cleanLines('reflectionPrompts');
    return {
      displayTitle: getStr(raw, 'displayTitle').trim(),
      childText: getStr(raw, 'childText').trim(),
      emotionKey: getStr(raw, 'emotionKey').trim().toLowerCase(),
      emotionLabel: getStr(raw, 'emotionLabel').trim(),
      accessibleDescription: getStr(raw, 'accessibleDescription').trim(),
      ...(illustration ? { illustration } : {}),
      ...(supportiveBodyCue ? { supportiveBodyCue } : {}),
      ...(reflectionPrompts ? { reflectionPrompts } : {}),
      ...(readAloud ? { readAloud } : {}),
      ...(aacSupport ? { aacSupport } : {}),
    };
  }

  if (contentType === 'situation_card') {
    const discussionPrompts = cleanLines('discussionPrompts');
    return {
      displayTitle: getStr(raw, 'displayTitle').trim(),
      situationText: getStr(raw, 'situationText').trim(),
      narrativeContext: getStr(raw, 'narrativeContext').trim(),
      accessibleDescription: getStr(raw, 'accessibleDescription').trim(),
      ...(illustration ? { illustration } : {}),
      ...(discussionPrompts ? { discussionPrompts } : {}),
      ...(readAloud ? { readAloud } : {}),
      ...(aacSupport ? { aacSupport } : {}),
    };
  }

  if (contentType === 'action_card') {
    const contextExplanation = getStr(raw, 'contextExplanation').trim();
    const possibleOutcomes = cleanLines('possibleOutcomes');
    return {
      displayTitle: getStr(raw, 'displayTitle').trim(),
      actionPhrase: getStr(raw, 'actionPhrase').trim(),
      accessibleDescription: getStr(raw, 'accessibleDescription').trim(),
      ...(visualSupport ? { visualSupport } : {}),
      ...(contextExplanation ? { contextExplanation } : {}),
      ...(possibleOutcomes ? { possibleOutcomes } : {}),
      ...(readAloud ? { readAloud } : {}),
      ...(aacSupport ? { aacSupport } : {}),
    };
  }

  if (contentType === 'social_story_card') {
    const storyIntro = getStr(raw, 'storyIntro').trim();
    const closingReflection = getStr(raw, 'closingReflection').trim();
    const rawScenes = Array.isArray(raw.scenes) ? raw.scenes : [];
    const scenes = rawScenes.map((s, idx) => {
      const sc = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
      return {
        sceneNumber: idx + 1,
        text: typeof sc.text === 'string' ? sc.text.trim() : '',
        accessibleDescription:
          typeof sc.accessibleDescription === 'string' ? sc.accessibleDescription.trim() : '',
      };
    });
    return {
      displayTitle: getStr(raw, 'displayTitle').trim(),
      ...(storyIntro ? { storyIntro } : {}),
      scenes,
      ...(closingReflection ? { closingReflection } : {}),
      ...(readAloud ? { readAloud } : {}),
    };
  }

  // communication_card
  return {
    displayTitle: getStr(raw, 'displayTitle').trim(),
    communicationIntent: getStr(raw, 'communicationIntent').trim(),
    phrase: getStr(raw, 'phrase').trim(),
    accessibleDescription: getStr(raw, 'accessibleDescription').trim(),
    ...(aacSupport ? { aacSupport } : {}),
    ...(visualSupport ? { visualSupport } : {}),
    ...(readAloud ? { readAloud } : {}),
  };
}

export function buildCleanMetadataForSubmit(meta: ContentMetadataJson): ContentMetadataJson | null {
  const ageBand = meta.ageBand?.trim();
  const selThemes = (meta.selThemes ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 10);
  const assetAttributionNote = meta.assetAttributionNote?.trim();
  const localizationNotes = meta.localizationNotes?.trim();
  const cleaned: ContentMetadataJson = {
    ...(ageBand ? { ageBand } : {}),
    ...(selThemes.length > 0 ? { selThemes } : {}),
    ...(assetAttributionNote ? { assetAttributionNote } : {}),
    ...(localizationNotes ? { localizationNotes } : {}),
  };
  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

export function ContentPayloadEditor({
  mode,
  locale,
  values,
  onChange,
  slugDisabled = false,
}: ContentPayloadEditorProps) {
  const p = values.payloadJson;

  const setPayloadField = (key: string, val: unknown) => {
    onChange({
      ...values,
      payloadJson: { ...p, [key]: val },
    });
  };

  const setNestedPayloadField = (parent: string, key: string, val: unknown) => {
    const existing =
      p[parent] && typeof p[parent] === 'object' && !Array.isArray(p[parent])
        ? (p[parent] as Record<string, unknown>)
        : {};
    onChange({
      ...values,
      payloadJson: {
        ...p,
        [parent]: { ...existing, [key]: val },
      },
    });
  };

  const toggleSelThemeTag = (tag: string) => {
    const current = values.metadataJson.selThemes ?? [];
    const exists = current.includes(tag);
    const next = exists
      ? current.filter((t) => t !== tag)
      : [...current, tag].slice(0, 10);
    onChange({
      ...values,
      metadataJson: { ...values.metadataJson, selThemes: next },
    });
  };

  const scenes: SocialStoryScenePayload[] = Array.isArray(p.scenes)
    ? (p.scenes as SocialStoryScenePayload[])
    : [
        { sceneNumber: 1, text: '', accessibleDescription: '' },
        { sceneNumber: 2, text: '', accessibleDescription: '' },
      ];

  const mediaKey: 'illustration' | 'visualSupport' =
    values.contentType === 'action_card' || values.contentType === 'communication_card'
      ? 'visualSupport'
      : 'illustration';

  return (
    <div className="space-y-5">
      {/* Core Item + Version Fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {mode === 'create_item' && (
          <FormField
            label="Slug định danh (slug)"
            htmlFor="content-slug"
            required
            hint="Chữ thường, số, dấu gạch ngang (ví dụ: emotion-binh-yen)"
          >
            <Input
              id="content-slug"
              value={values.slug}
              disabled={slugDisabled}
              onChange={(e) => onChange({ ...values, slug: e.target.value.toLowerCase() })}
              placeholder="emotion-binh-yen"
              required
            />
          </FormField>
        )}

        <FormField label="Loại thẻ SEL chuẩn hóa" htmlFor="content-type" required>
          <Select
            id="content-type"
            value={values.contentType}
            disabled={mode !== 'create_item'}
            onChange={(e) =>
              onChange({
                ...values,
                contentType: e.target.value as CanonicalContentType,
              })
            }
            options={[
              { value: 'emotion_card', label: getContentTypeLabel('emotion_card', locale) },
              { value: 'situation_card', label: getContentTypeLabel('situation_card', locale) },
              { value: 'action_card', label: getContentTypeLabel('action_card', locale) },
              { value: 'social_story_card', label: getContentTypeLabel('social_story_card', locale) },
              { value: 'communication_card', label: getContentTypeLabel('communication_card', locale) },
            ]}
          />
        </FormField>

        <FormField label="Tiêu đề phiên bản (title)" htmlFor="content-title" required>
          <Input
            id="content-title"
            value={values.title}
            onChange={(e) => onChange({ ...values, title: e.target.value })}
            placeholder="Ví dụ: Thẻ Cảm xúc - Bình yên"
            required
          />
        </FormField>

        <FormField label="Ngôn ngữ (locale)" htmlFor="content-locale" required>
          <Select
            id="content-locale"
            value={values.locale}
            onChange={(e) => onChange({ ...values, locale: e.target.value })}
            options={[
              { value: 'vi-VN', label: 'Tiếng Việt (vi-VN)' },
              { value: 'vi', label: 'Tiếng Việt (vi)' },
              { value: 'en', label: 'English (en)' },
            ]}
          />
        </FormField>
      </div>

      <FormField label="Tóm tắt cho giáo viên (summary)" htmlFor="content-summary">
        <Input
          id="content-summary"
          value={values.summary}
          onChange={(e) => onChange({ ...values, summary: e.target.value })}
          placeholder="Mô tả ngắn mục đích sử dụng thẻ này..."
        />
      </FormField>

      <Alert variant="info" title="Quy chuẩn an toàn nội dung trẻ em (Child-safe SEL)">
        Biểu mẫu chỉ chấp nhận các trường chuẩn hóa theo từng loại thẻ. Tránh dùng từ ngữ chẩn đoán y khoa, chấm điểm, đồng hồ đếm ngược hay phạt khi trẻ thử lại.
      </Alert>

      {/* Type-Specific Payload Builder */}
      <div className="rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)] bg-[var(--mimora-surface-subtle)]/40 p-4 space-y-4">
        <h3 className="text-sm font-semibold text-[var(--mimora-text)]">
          Nội dung thẻ: {getContentTypeLabel(values.contentType, locale)}
        </h3>

        <FormField label="Tiêu đề hiển thị cho trẻ (displayTitle)" htmlFor="payload-display-title" required>
          <Input
            id="payload-display-title"
            value={getStr(p, 'displayTitle')}
            onChange={(e) => setPayloadField('displayTitle', e.target.value)}
            placeholder="Mình đang cảm thấy bình yên"
            required
          />
        </FormField>

        {values.contentType === 'emotion_card' && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                label="Mã cảm xúc (emotionKey)"
                htmlFor="payload-emotion-key"
                required
                hint="chữ thường, số, _ hoặc - (ví dụ: calm, worried)"
              >
                <Input
                  id="payload-emotion-key"
                  value={getStr(p, 'emotionKey')}
                  onChange={(e) => setPayloadField('emotionKey', e.target.value.toLowerCase())}
                  placeholder="calm"
                  required
                />
              </FormField>

              <FormField label="Nhãn cảm xúc (emotionLabel)" htmlFor="payload-emotion-label" required>
                <Input
                  id="payload-emotion-label"
                  value={getStr(p, 'emotionLabel')}
                  onChange={(e) => setPayloadField('emotionLabel', e.target.value)}
                  placeholder="Bình yên"
                  required
                />
              </FormField>
            </div>

            <FormField label="Lời thân thiện dành cho trẻ (childText)" htmlFor="payload-child-text" required>
              <textarea
                id="payload-child-text"
                rows={3}
                value={getStr(p, 'childText')}
                onChange={(e) => setPayloadField('childText', e.target.value)}
                placeholder="Khi lòng thấy bình yên, nhịp thở của mình chậm rãi và dễ chịu."
                className="w-full rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border-strong)] bg-[var(--mimora-surface)] p-3 text-sm"
                required
              />
            </FormField>

            <FormField label="Gợi ý cảm nhận cơ thể (tùy chọn)" htmlFor="payload-body-cue">
              <Input
                id="payload-body-cue"
                value={getStr(p, 'supportiveBodyCue')}
                onChange={(e) => setPayloadField('supportiveBodyCue', e.target.value)}
                placeholder="Hai vai thả lỏng, bàn tay ấm áp..."
              />
            </FormField>

            <FormField
              label="Câu hỏi gợi mở (mỗi dòng 1 câu, tùy chọn)"
              htmlFor="payload-reflection-prompts"
            >
              <textarea
                id="payload-reflection-prompts"
                rows={2}
                value={getLines(p, 'reflectionPrompts')}
                onChange={(e) =>
                  setPayloadField('reflectionPrompts', e.target.value.split('\n'))
                }
                placeholder="Điều gì giúp bạn cảm thấy dễ chịu như thế?"
                className="w-full rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border-strong)] bg-[var(--mimora-surface)] p-3 text-sm"
              />
            </FormField>
          </>
        )}

        {values.contentType === 'situation_card' && (
          <>
            <FormField label="Mô tả tình huống (situationText)" htmlFor="payload-situation-text" required>
              <textarea
                id="payload-situation-text"
                rows={3}
                value={getStr(p, 'situationText')}
                onChange={(e) => setPayloadField('situationText', e.target.value)}
                placeholder="Ở góc đọc sách hôm nay có tiếng ồn lớn từ hành lang..."
                className="w-full rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border-strong)] bg-[var(--mimora-surface)] p-3 text-sm"
                required
              />
            </FormField>

            <FormField label="Bối cảnh câu chuyện (narrativeContext)" htmlFor="payload-narrative-ctx" required>
              <textarea
                id="payload-narrative-ctx"
                rows={2}
                value={getStr(p, 'narrativeContext')}
                onChange={(e) => setPayloadField('narrativeContext', e.target.value)}
                placeholder="Giờ ra chơi vừa kết thúc và lớp chuẩn bị vào hoạt động nhóm."
                className="w-full rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border-strong)] bg-[var(--mimora-surface)] p-3 text-sm"
                required
              />
            </FormField>

            <FormField label="Gợi ý trao đổi (mỗi dòng 1 câu, tùy chọn)" htmlFor="payload-discussion">
              <textarea
                id="payload-discussion"
                rows={2}
                value={getLines(p, 'discussionPrompts')}
                onChange={(e) =>
                  setPayloadField('discussionPrompts', e.target.value.split('\n'))
                }
                className="w-full rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border-strong)] bg-[var(--mimora-surface)] p-3 text-sm"
              />
            </FormField>
          </>
        )}

        {values.contentType === 'action_card' && (
          <>
            <FormField label="Cụm hành động / Chiến lược (actionPhrase)" htmlFor="payload-action-phrase" required>
              <Input
                id="payload-action-phrase"
                value={getStr(p, 'actionPhrase')}
                onChange={(e) => setPayloadField('actionPhrase', e.target.value)}
                placeholder="Hít vào nhẹ nhàng 3 nhịp như ngửi một bông hoa"
                required
              />
            </FormField>

            <FormField label="Giải thích bối cảnh áp dụng (tùy chọn)" htmlFor="payload-ctx-exp">
              <Input
                id="payload-ctx-exp"
                value={getStr(p, 'contextExplanation')}
                onChange={(e) => setPayloadField('contextExplanation', e.target.value)}
                placeholder="Có thể dùng bất cứ khi nào bạn thấy tim đập nhanh."
              />
            </FormField>

            <FormField label="Kết quả có thể xảy ra (mỗi dòng 1 ý, tùy chọn)" htmlFor="payload-outcomes">
              <textarea
                id="payload-outcomes"
                rows={2}
                value={getLines(p, 'possibleOutcomes')}
                onChange={(e) =>
                  setPayloadField('possibleOutcomes', e.target.value.split('\n'))
                }
                className="w-full rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border-strong)] bg-[var(--mimora-surface)] p-3 text-sm"
              />
            </FormField>
          </>
        )}

        {values.contentType === 'communication_card' && (
          <>
            <FormField label="Mục đích giao tiếp (communicationIntent)" htmlFor="payload-comm-intent" required>
              <Input
                id="payload-comm-intent"
                value={getStr(p, 'communicationIntent')}
                onChange={(e) => setPayloadField('communicationIntent', e.target.value)}
                placeholder="Xin nghỉ ngơi yên tĩnh một lát"
                required
              />
            </FormField>

            <FormField label="Câu nói / Thông điệp hỗ trợ (phrase)" htmlFor="payload-comm-phrase" required>
              <Input
                id="payload-comm-phrase"
                value={getStr(p, 'phrase')}
                onChange={(e) => setPayloadField('phrase', e.target.value)}
                placeholder="Con cần nghỉ ở góc yên tĩnh một lát ạ."
                required
              />
            </FormField>
          </>
        )}

        {values.contentType === 'social_story_card' && (
          <div className="space-y-4">
            <FormField label="Lời mở đầu truyện (storyIntro, tùy chọn)" htmlFor="payload-story-intro">
              <Input
                id="payload-story-intro"
                value={getStr(p, 'storyIntro')}
                onChange={(e) => setPayloadField('storyIntro', e.target.value)}
                placeholder="Hôm nay lớp mình cùng chuẩn bị cho giờ ra chơi thật vui."
              />
            </FormField>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">
                  Các cảnh truyện tuần tự ({scenes.length}/12 · Tối thiểu 2 cảnh, khuyến nghị Chương 1 gồm 5 cảnh)
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={scenes.length >= 12}
                  leftIcon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
                  onClick={() =>
                    setPayloadField('scenes', [
                      ...scenes,
                      {
                        sceneNumber: scenes.length + 1,
                        text: '',
                        accessibleDescription: '',
                      },
                    ])
                  }
                >
                  Thêm cảnh
                </Button>
              </div>

              {scenes.map((sc, idx) => (
                <div
                  key={idx}
                  className="rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)] bg-[var(--mimora-surface)] p-3 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[var(--mimora-primary)]">
                      Cảnh {idx + 1}
                    </span>
                    {scenes.length > 2 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Xóa cảnh ${idx + 1}`}
                        onClick={() =>
                          setPayloadField(
                            'scenes',
                            scenes
                              .filter((_, i) => i !== idx)
                              .map((s, newIdx) => ({ ...s, sceneNumber: newIdx + 1 }))
                          )
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5 text-[var(--mimora-danger)]" aria-hidden="true" />
                      </Button>
                    )}
                  </div>

                  <FormField label="Lời truyện cảnh này" required>
                    <textarea
                      rows={2}
                      value={sc.text}
                      onChange={(e) => {
                        const updated = scenes.map((s, i) =>
                          i === idx ? { ...s, sceneNumber: idx + 1, text: e.target.value } : s
                        );
                        setPayloadField('scenes', updated);
                      }}
                      className="w-full rounded-[var(--mimora-radius-sm)] border border-[var(--mimora-border-strong)] p-2 text-sm"
                      required
                    />
                  </FormField>

                  <FormField label="Mô tả tiếp cận cảnh này" required>
                    <Input
                      value={sc.accessibleDescription}
                      onChange={(e) => {
                        const updated = scenes.map((s, i) =>
                          i === idx
                            ? { ...s, sceneNumber: idx + 1, accessibleDescription: e.target.value }
                            : s
                        );
                        setPayloadField('scenes', updated);
                      }}
                      placeholder="Tranh minh họa hai bạn nhỏ mỉm cười chào nhau..."
                      required
                    />
                  </FormField>
                </div>
              ))}
            </div>

            <FormField label="Lời kết nhẹ nhàng (closingReflection, tùy chọn)" htmlFor="payload-story-closing">
              <Input
                id="payload-story-closing"
                value={getStr(p, 'closingReflection')}
                onChange={(e) => setPayloadField('closingReflection', e.target.value)}
              />
            </FormField>
          </div>
        )}

        {values.contentType !== 'social_story_card' && (
          <FormField
            label="Mô tả tiếp cận / Alt cho trình đọc màn hình (accessibleDescription)"
            htmlFor="payload-accessible-desc"
            required
          >
            <textarea
              id="payload-accessible-desc"
              rows={2}
              value={getStr(p, 'accessibleDescription')}
              onChange={(e) => setPayloadField('accessibleDescription', e.target.value)}
              placeholder="Mô tả rõ ràng hình ảnh hoặc thông điệp hỗ trợ trình đọc màn hình..."
              className="w-full rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border-strong)] bg-[var(--mimora-surface)] p-3 text-sm"
              required
            />
          </FormField>
        )}
      </div>

      {/* Accessibility Support Blocks (Read-Aloud, AAC, Optional Media) */}
      <div className="rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)] p-4 space-y-4">
        <h3 className="text-sm font-semibold text-[var(--mimora-text)]">
          Hỗ trợ tiếp cận (Đọc to, AAC & Hình ảnh tùy chọn)
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <FormField label="Lời đọc to (readAloud.text)" htmlFor="payload-read-aloud" className="sm:col-span-2">
            <Input
              id="payload-read-aloud"
              value={getNestedStr(p, 'readAloud', 'text')}
              onChange={(e) => setNestedPayloadField('readAloud', 'text', e.target.value)}
              placeholder="Nội dung đọc to dịu nhẹ..."
            />
          </FormField>
          <FormField label="Tốc độ đọc gợi ý" htmlFor="payload-read-rate">
            <Select
              id="payload-read-rate"
              value={getNestedStr(p, 'readAloud', 'speechRateHint') || 'normal'}
              onChange={(e) => setNestedPayloadField('readAloud', 'speechRateHint', e.target.value)}
              options={[
                { value: 'normal', label: 'Bình thường (normal)' },
                { value: 'slow', label: 'Chậm dịu (slow)' },
              ]}
            />
          </FormField>
        </div>

        {values.contentType !== 'social_story_card' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Nhãn biểu tượng AAC (aacSupport.symbolLabel)" htmlFor="payload-aac-label">
              <Input
                id="payload-aac-label"
                value={getNestedStr(p, 'aacSupport', 'symbolLabel')}
                onChange={(e) => setNestedPayloadField('aacSupport', 'symbolLabel', e.target.value)}
                placeholder="Ví dụ: Thở chậm / Nghỉ ngơi"
              />
            </FormField>
            <FormField
              label="Từ vựng lõi AAC (cách nhau bằng dấu phẩy)"
              htmlFor="payload-aac-vocab"
            >
              <Input
                id="payload-aac-vocab"
                value={getCoreVocabCsv(p)}
                onChange={(e) =>
                  setNestedPayloadField(
                    'aacSupport',
                    'coreVocabulary',
                    e.target.value.split(',').map((s) => s.trim())
                  )
                }
                placeholder="tôi, cần, nghỉ ngơi"
              />
            </FormField>
          </div>
        )}

        {values.contentType !== 'social_story_card' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Đường dẫn tài nguyên ảnh (assetRef, tùy chọn)" htmlFor="payload-media-ref">
              <Input
                id="payload-media-ref"
                value={getNestedStr(p, mediaKey, 'assetRef')}
                onChange={(e) => setNestedPayloadField(mediaKey, 'assetRef', e.target.value)}
                placeholder="/assets/sel/calm-leaf.svg"
              />
            </FormField>
            <FormField label="Văn bản thay thế ảnh (altText)" htmlFor="payload-media-alt">
              <Input
                id="payload-media-alt"
                value={getNestedStr(p, mediaKey, 'altText')}
                onChange={(e) => setNestedPayloadField(mediaKey, 'altText', e.target.value)}
                placeholder="Chiếc lá xanh nhẹ nhàng trên nền kem"
              />
            </FormField>
          </div>
        )}
      </div>

      {/* Metadata & Catalog Convention Helper */}
      <div className="rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)] p-4 space-y-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-[var(--mimora-text)]">
            Siêu dữ liệu & Nhãn danh mục (metadataJson)
          </h3>
          <p className="text-xs text-[var(--mimora-muted)]">
            Hỗ trợ gắn nhãn theo bộ học liệu đề xuất (16 Thẻ Cảm xúc, 21 Thẻ Chiến lược / 7 nhóm, Truyện Chương 1 5 cảnh, Bảng giao tiếp AAC) mà không làm sai lệch schema chuẩn.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Nhóm tuổi gợi ý (ageBand)" htmlFor="meta-age-band">
            <Input
              id="meta-age-band"
              value={values.metadataJson.ageBand ?? ''}
              onChange={(e) =>
                onChange({
                  ...values,
                  metadataJson: { ...values.metadataJson, ageBand: e.target.value },
                })
              }
              placeholder="6-10"
            />
          </FormField>

          <FormField
            label="Nhãn selThemes (tối đa 10, cách nhau dấu phẩy)"
            htmlFor="meta-sel-themes"
          >
            <Input
              id="meta-sel-themes"
              value={(values.metadataJson.selThemes ?? []).join(', ')}
              onChange={(e) =>
                onChange({
                  ...values,
                  metadataJson: {
                    ...values.metadataJson,
                    selThemes: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .slice(0, 10),
                  },
                })
              }
              placeholder="chapter:chapter_1, session:1, step:1"
            />
          </FormField>
        </div>

        {/* Helpful non-invasive quick-tag pills */}
        {values.contentType === 'emotion_card' && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[var(--mimora-muted)]">Phân tầng 16 thẻ cảm xúc:</span>
            {EMOTION_TIERS.map((tier) => {
              const tag = `emotion_tier:${tier.key}`;
              const active = (values.metadataJson.selThemes ?? []).includes(tag);
              return (
                <Button
                  key={tag}
                  type="button"
                  size="sm"
                  variant={active ? 'secondary' : 'outline'}
                  onClick={() => toggleSelThemeTag(tag)}
                >
                  {locale === 'en' ? tier.en : tier.vi}
                </Button>
              );
            })}
          </div>
        )}

        {values.contentType === 'action_card' && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[var(--mimora-muted)]">7 nhóm chiến lược (21 thẻ):</span>
            {STRATEGY_CATEGORIES_7.map((cat) => {
              const tag = `strategy_cat:${cat.key}`;
              const active = (values.metadataJson.selThemes ?? []).includes(tag);
              return (
                <Button
                  key={tag}
                  type="button"
                  size="sm"
                  variant={active ? 'secondary' : 'outline'}
                  onClick={() => toggleSelThemeTag(tag)}
                >
                  {locale === 'en' ? cat.en : cat.vi}
                </Button>
              );
            })}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Ghi chú nguồn học liệu (assetAttributionNote)" htmlFor="meta-attr">
            <Input
              id="meta-attr"
              value={values.metadataJson.assetAttributionNote ?? ''}
              onChange={(e) =>
                onChange({
                  ...values,
                  metadataJson: {
                    ...values.metadataJson,
                    assetAttributionNote: e.target.value,
                  },
                })
              }
            />
          </FormField>
          <FormField label="Ghi chú bản địa hóa (localizationNotes)" htmlFor="meta-loc">
            <Input
              id="meta-loc"
              value={values.metadataJson.localizationNotes ?? ''}
              onChange={(e) =>
                onChange({
                  ...values,
                  metadataJson: {
                    ...values.metadataJson,
                    localizationNotes: e.target.value,
                  },
                })
              }
            />
          </FormField>
        </div>
      </div>
    </div>
  );
}
