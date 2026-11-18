import { Check, HelpCircle, SkipForward, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { EmotionVisual } from '../../illustrations/SelIllustrations.tsx';
import { SAMPLE_EMOTION_CARDS } from '../../sel-preview/SelResourceCards.tsx';
import type { EmotionCardPresentation } from '../../../types/chapter.ts';
import type {
  ParsedEmotionCardPayload,
  ParsedSituationCardPayload,
} from '../../../types/student.ts';

export interface SituationEmotionStepProps {
  mode: 'emotion_card' | 'situation_card' | 'story_followup';
  emotionPayload?: ParsedEmotionCardPayload;
  situationPayload?: ParsedSituationCardPayload;
  storyClosingPrompt?: string;
  initialSelectedEmotions?: string[];
  initialChoiceKey?: string | null;
  readOnly?: boolean;
  saving?: boolean;
  onSaveResponse: (input: {
    stepKey: string;
    selectedChoiceKey: string | null;
    selectedEmotionKey: string | null;
    responsePayloadJson: Record<string, unknown>;
  }) => void;
  onRequestHelp: () => void;
}

const NON_PUNITIVE_EMOTION_CHOICES: ReadonlyArray<{
  key: string;
  label: string;
  motifs: EmotionCardPresentation['motifs'];
  tone: EmotionCardPresentation['tone'];
  cue: string;
}> = [
  ...SAMPLE_EMOTION_CARDS.map((c) => ({
    key: c.key,
    label: c.label,
    motifs: c.motifs,
    tone: c.tone,
    cue: c.bodyCue,
  })),
  {
    key: 'curious',
    label: 'Tò mò / Muốn tìm hiểu',
    motifs: 'spark',
    tone: 'butter',
    cue: 'Đôi mắt chú ý và muốn hỏi thêm',
  },
  {
    key: 'need_shelter',
    label: 'Muốn thu mình an toàn',
    motifs: 'shelter',
    tone: 'mint',
    cue: 'Muốn có không gian riêng yên tĩnh một lúc',
  },
];

export function SituationEmotionStep({
  mode,
  emotionPayload,
  situationPayload,
  storyClosingPrompt,
  initialSelectedEmotions = [],
  initialChoiceKey = null,
  readOnly = false,
  saving = false,
  onSaveResponse,
  onRequestHelp,
}: SituationEmotionStepProps) {
  const [selectedEmotions, setSelectedEmotions] = useState<string[]>(initialSelectedEmotions);
  const [specialChoice, setSpecialChoice] = useState<string | null>(initialChoiceKey);

  const primaryEmotionOption =
    mode === 'emotion_card' && emotionPayload
      ? {
          key: emotionPayload.emotionKey,
          label: emotionPayload.emotionLabel,
          motifs: 'sunbeam' as const,
          tone: 'mint' as const,
          cue: emotionPayload.supportiveBodyCue ?? emotionPayload.childText,
        }
      : null;

  const emotionOptions = primaryEmotionOption
    ? [
        primaryEmotionOption,
        ...NON_PUNITIVE_EMOTION_CHOICES.filter((c) => c.key !== primaryEmotionOption.key),
      ]
    : NON_PUNITIVE_EMOTION_CHOICES;

  const toggleEmotion = (key: string) => {
    if (readOnly) {
      return;
    }
    setSpecialChoice(null);
    setSelectedEmotions((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleSaveSelected = () => {
    if (readOnly) {
      return;
    }
    const primary = selectedEmotions[0] ?? null;
    onSaveResponse({
      stepKey: 'step_1_situation_emotion',
      selectedChoiceKey: selectedEmotions.length > 0 ? 'emotions_explored' : 'viewed_without_selection',
      selectedEmotionKey: primary,
      responsePayloadJson: {
        step: 1,
        selectedEmotionKeys: selectedEmotions,
        explicitNote: 'non_prescriptive_reflection',
      },
    });
  };

  const handleNonDisclosureOrSkip = (
    choiceKey: 'unsure' | 'decline_to_answer' | 'skip_step'
  ) => {
    if (readOnly) {
      return;
    }
    setSelectedEmotions([]);
    setSpecialChoice(choiceKey);
    onSaveResponse({
      stepKey: 'step_1_situation_emotion',
      selectedChoiceKey: choiceKey,
      selectedEmotionKey: choiceKey === 'unsure' ? 'unsure' : null,
      responsePayloadJson: {
        step: 1,
        selectedEmotionKeys: [],
        choiceStatus: choiceKey,
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* Separate Story Facts vs Feelings */}
      {mode === 'situation_card' && situationPayload && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card tone="butter" padding="md" className="space-y-2">
            <p className="text-xs font-semibold text-[var(--mimora-warning)]">
              Điều xảy ra trong tình huống (Sự việc)
            </p>
            <h3 className="text-lg font-semibold text-[var(--mimora-text)]">
              {situationPayload.displayTitle}
            </h3>
            <p className="text-base text-[var(--mimora-text)] leading-relaxed">
              {situationPayload.situationText}
            </p>
          </Card>

          <Card tone="lavender" padding="md" className="space-y-2">
            <p className="text-xs font-semibold text-[var(--mimora-secondary)]">
              Bối cảnh & Gợi ý trò chuyện (Có thể hiểu theo nhiều cách)
            </p>
            <p className="text-sm text-[var(--mimora-text)] leading-relaxed">
              {situationPayload.narrativeContext}
            </p>
            {situationPayload.discussionPrompts.length > 0 && (
              <ul className="pt-2 space-y-1.5 text-sm text-[var(--mimora-muted)] list-disc pl-5">
                {situationPayload.discussionPrompts.map((prompt) => (
                  <li key={prompt}>{prompt}</li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {mode === 'emotion_card' && emotionPayload && (
        <Card tone="mint" padding="md" className="space-y-3">
          <p className="text-xs font-semibold text-[var(--mimora-primary)]">
            Thẻ cảm xúc từ bài tập · Không ép buộc biểu cảm
          </p>
          <h3 className="text-xl font-semibold text-[var(--mimora-text)]">
            {emotionPayload.displayTitle} — {emotionPayload.emotionLabel}
          </h3>
          <p className="text-base text-[var(--mimora-text)] leading-relaxed">
            {emotionPayload.childText}
          </p>
          {emotionPayload.supportiveBodyCue && (
            <p className="text-sm text-[var(--mimora-muted)]">
              Tín hiệu cơ thể gợi ý: {emotionPayload.supportiveBodyCue}
            </p>
          )}
          {emotionPayload.reflectionPrompts.length > 0 && (
            <ul className="pt-1 space-y-1 text-sm text-[var(--mimora-muted)] list-disc pl-5">
              {emotionPayload.reflectionPrompts.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {mode === 'story_followup' && storyClosingPrompt && (
        <Card tone="lavender" padding="md" className="space-y-2">
          <p className="text-xs font-semibold text-[var(--mimora-secondary)]">
            Bước 1 · Cảm xúc có thể xuất hiện sau câu chuyện
          </p>
          <p className="text-base text-[var(--mimora-text)] leading-relaxed">
            {storyClosingPrompt}
          </p>
        </Card>
      )}

      {/* Multi-select Emotion Exploration */}
      <div className="space-y-3">
        <div className="space-y-1">
          <h4 className="text-base font-semibold text-[var(--mimora-text)] flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[var(--mimora-primary)] shrink-0" aria-hidden="true" />
            <span>Nhân vật (hoặc con) có thể đang cảm thấy điều gì?</span>
          </h4>
          <p className="text-sm text-[var(--mimora-muted)]">
            Có thể chọn một hoặc nhiều cảm xúc — không có đáp án duy nhất nào đúng hay sai.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {emotionOptions.map((option) => {
            const selected = selectedEmotions.includes(option.key);
            return (
              <button
                key={option.key}
                type="button"
                disabled={readOnly}
                aria-pressed={selected}
                onClick={() => toggleEmotion(option.key)}
                className={[
                  'w-full text-left rounded-[var(--mimora-radius-lg)] border p-4 cursor-pointer flex items-center gap-4',
                  'transition-colors duration-150 disabled:cursor-default',
                  selected
                    ? 'border-[var(--mimora-primary)] bg-[var(--mimora-surface-mint)] shadow-[var(--mimora-shadow-soft)]'
                    : 'border-[var(--mimora-border)] bg-[var(--mimora-surface)] hover:border-[var(--mimora-primary)]/60',
                ].join(' ')}
              >
                <EmotionVisual motif={option.motifs} />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-base font-semibold text-[var(--mimora-text)]">
                      {option.label}
                    </span>
                    {selected && (
                      <Check className="h-5 w-5 text-[var(--mimora-primary)] shrink-0" aria-hidden="true" />
                    )}
                  </div>
                  <p className="text-xs text-[var(--mimora-muted)] leading-relaxed">
                    {option.cue}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {!readOnly && (
          <div className="pt-2 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="primary"
              size="student"
              loading={saving}
              disabled={selectedEmotions.length === 0}
              onClick={handleSaveSelected}
            >
              Lưu cảm xúc đã chọn ({selectedEmotions.length})
            </Button>

            <Button
              type="button"
              variant={specialChoice === 'unsure' ? 'secondary' : 'outline'}
              size="md"
              disabled={saving}
              onClick={() => handleNonDisclosureOrSkip('unsure')}
            >
              Con không chắc
            </Button>

            <Button
              type="button"
              variant={specialChoice === 'decline_to_answer' ? 'secondary' : 'outline'}
              size="md"
              disabled={saving}
              onClick={() => handleNonDisclosureOrSkip('decline_to_answer')}
            >
              Con không muốn trả lời
            </Button>

            <Button
              type="button"
              variant={specialChoice === 'skip_step' ? 'secondary' : 'ghost'}
              size="md"
              disabled={saving}
              onClick={() => handleNonDisclosureOrSkip('skip_step')}
              leftIcon={<SkipForward className="h-4 w-4" aria-hidden="true" />}
            >
              Bỏ qua bước này
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={onRequestHelp}
              leftIcon={<HelpCircle className="h-4 w-4" aria-hidden="true" />}
            >
              Nhờ thầy cô
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
