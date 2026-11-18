import { Check, Eye, HelpCircle, SkipForward, Volume2 } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '../../ui/Alert.tsx';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { Tabs } from '../../ui/Tabs.tsx';
import type { ParsedSituationCardPayload } from '../../../types/student.ts';
import { isSpeechSupported, speakText } from '../../../utils/speech.ts';

export interface FactVsGuessStepProps {
  title: string;
  situationPayload?: ParsedSituationCardPayload;
  locale?: string;
  speechRate?: 'slow' | 'normal';
  readAloudEnabled?: boolean;
  readOnly?: boolean;
  saving?: boolean;
  onSaveFactVsGuess: (input: {
    stepKey: string;
    selectedChoiceKey: string | null;
    selectedEmotionKey: string | null;
    usedReadAloud?: boolean;
    responsePayloadJson: Record<string, unknown>;
  }) => void;
}

type ReflectionAngle = 'observable_fact' | 'possible_guess' | 'unsure_yet';

export function FactVsGuessStep({
  title,
  situationPayload,
  locale = 'vi-VN',
  speechRate = 'normal',
  readAloudEnabled = true,
  readOnly = false,
  saving = false,
  onSaveFactVsGuess,
}: FactVsGuessStepProps) {
  const [selectedPromptIndex, setSelectedPromptIndex] = useState(0);
  const [angleByPrompt, setAngleByPrompt] = useState<Record<number, ReflectionAngle>>({});
  const [gentleNoteShown, setGentleNoteShown] = useState(false);

  const prompts: string[] =
    situationPayload && situationPayload.discussionPrompts.length > 0
      ? situationPayload.discussionPrompts
      : [
          situationPayload?.situationText || title,
          situationPayload?.narrativeContext ||
            'Nếu chưa hỏi trực tiếp bạn hoặc thầy cô, mình có chắc chắn lý do bên trong của người khác không?',
        ].filter((p) => p.trim().length > 0);

  const activePrompt = prompts[Math.min(selectedPromptIndex, prompts.length - 1)] ?? title;
  const activeAngle = angleByPrompt[selectedPromptIndex] ?? null;

  const handleChooseAngle = (angle: ReflectionAngle) => {
    if (readOnly) {
      return;
    }
    setAngleByPrompt((prev) => ({ ...prev, [selectedPromptIndex]: angle }));
    setGentleNoteShown(true);
  };

  const handleSave = () => {
    if (readOnly || !activeAngle) {
      return;
    }
    onSaveFactVsGuess({
      stepKey: 'step_5_fact_vs_guess',
      selectedChoiceKey: `angle_${activeAngle}`,
      selectedEmotionKey: null,
      responsePayloadJson: {
        step: 5,
        promptIndex: selectedPromptIndex,
        chosenAngle: activeAngle,
      },
    });
  };

  const handleSkipOrUnsure = (choiceKey: 'unsure' | 'skip_step') => {
    if (readOnly) {
      return;
    }
    onSaveFactVsGuess({
      stepKey: 'step_5_fact_vs_guess',
      selectedChoiceKey: choiceKey,
      selectedEmotionKey: null,
      responsePayloadJson: {
        step: 5,
        choiceStatus: choiceKey,
      },
    });
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="text-xs font-semibold text-[var(--mimora-primary)]">
          Bước 5 · Quan sát khách quan (Sự việc & Suy đoán)
        </p>
        <h3 className="text-lg font-semibold text-[var(--mimora-text)]">
          Điều gì mình thật sự nhìn thấy/nghe thấy, và điều gì mình đang đoán?
        </h3>
        <p className="text-sm text-[var(--mimora-muted)] leading-relaxed">
          Đoán suy nghĩ của người khác là điều rất tự nhiên, nhưng trước khi kết luận ý định của
          ai đó, mình có thể dừng lại kiểm tra hoặc hỏi nhẹ nhàng.
        </p>
      </div>

      {situationPayload && (
        <Card tone="butter" padding="md" className="space-y-2">
          <p className="text-xs font-semibold text-[var(--mimora-warning)]">
            Tình huống đang quan sát
          </p>
          <p className="text-base font-medium text-[var(--mimora-text)] leading-relaxed">
            {situationPayload.situationText}
          </p>
          {situationPayload.accessibleDescription && (
            <p className="text-xs text-[var(--mimora-muted)]">
              Mô tả trực quan: {situationPayload.accessibleDescription}
            </p>
          )}
        </Card>
      )}

      {prompts.length > 1 && (
        <Tabs
          ariaLabel="Các câu gợi ý quan sát"
          size="student"
          value={String(Math.min(selectedPromptIndex, prompts.length - 1))}
          onChange={(next) => {
            const idx = Number(next);
            if (!Number.isNaN(idx)) {
              setSelectedPromptIndex(idx);
              setGentleNoteShown(false);
            }
          }}
          options={prompts.map((_p, idx) => ({
            value: String(idx),
            label: `Câu hỏi quan sát ${idx + 1}`,
          }))}
        />
      )}

      <Card tone="default" padding="lg" className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 flex-1 min-w-0">
            <p className="text-xs font-medium text-[var(--mimora-muted)]">
              Cùng nhìn lại câu này:
            </p>
            <p className="text-lg font-semibold text-[var(--mimora-text)] leading-relaxed">
              “{activePrompt}”
            </p>
          </div>
          {readAloudEnabled && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (isSpeechSupported()) {
                  speakText(activePrompt, { locale, speechRate });
                }
              }}
              leftIcon={<Volume2 className="h-4 w-4" aria-hidden="true" />}
            >
              Đọc to
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {(
            [
              {
                key: 'observable_fact',
                title: 'Điều nhìn thấy / nghe thấy',
                desc: 'Ai cũng có thể nhìn thấy hoặc nghe thấy sự việc này.',
              },
              {
                key: 'possible_guess',
                title: 'Điều mình đang suy đoán',
                desc: 'Mình đang đoán lý do hoặc suy nghĩ bên trong, có thể cần hỏi lại cho chắc.',
              },
              {
                key: 'unsure_yet',
                title: 'Con chưa biết',
                desc: 'Cần thêm thông tin hoặc hỏi ý kiến thầy cô.',
              },
            ] as const
          ).map((option) => {
            const active = activeAngle === option.key;
            return (
              <button
                key={option.key}
                type="button"
                disabled={readOnly}
                aria-pressed={active}
                onClick={() => handleChooseAngle(option.key)}
                className={[
                  'text-left rounded-[var(--mimora-radius-md)] border p-4 cursor-pointer space-y-1.5 transition-colors',
                  active
                    ? 'bg-[var(--mimora-surface-mint)] border-[var(--mimora-primary)]'
                    : 'bg-[var(--mimora-surface)] border-[var(--mimora-border-strong)] hover:bg-[var(--mimora-surface-subtle)]',
                ].join(' ')}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--mimora-text)]">
                    {option.title}
                  </span>
                  {active && (
                    <Check className="h-4 w-4 text-[var(--mimora-primary)] shrink-0" aria-hidden="true" />
                  )}
                </div>
                <p className="text-xs text-[var(--mimora-muted)] leading-relaxed">
                  {option.desc}
                </p>
              </button>
            );
          })}
        </div>

        {gentleNoteShown && activeAngle && (
          <Alert variant="info" title="Góc nhìn nhẹ nhàng">
            {activeAngle === 'observable_fact' &&
              'Quan sát điều nhìn thấy và nghe thấy giúp mình kể lại sự việc rõ ràng hơn trước khi vội kết luận.'}
            {activeAngle === 'possible_guess' &&
              'Suy đoán không hề xấu — chỉ là mình nhớ rằng ý định của người khác có thể khác điều mình nghĩ, nên mình có thể hỏi nhẹ để hiểu đúng.'}
            {activeAngle === 'unsure_yet' &&
              'Chưa chắc chắn là điều rất bình thường. Mình luôn có thể dừng lại quan sát thêm hoặc hỏi thầy cô.'}
          </Alert>
        )}

        {!readOnly && (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button
              type="button"
              variant="primary"
              size="student"
              loading={saving}
              disabled={!activeAngle}
              onClick={handleSave}
              leftIcon={<Eye className="h-4 w-4" aria-hidden="true" />}
            >
              Lưu góc nhìn này
            </Button>

            <Button
              type="button"
              variant="outline"
              size="md"
              disabled={saving}
              onClick={() => handleSkipOrUnsure('unsure')}
              leftIcon={<HelpCircle className="h-4 w-4" aria-hidden="true" />}
            >
              Con chưa biết
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="md"
              disabled={saving}
              onClick={() => handleSkipOrUnsure('skip_step')}
              leftIcon={<SkipForward className="h-4 w-4" aria-hidden="true" />}
            >
              Bỏ qua bước này
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
