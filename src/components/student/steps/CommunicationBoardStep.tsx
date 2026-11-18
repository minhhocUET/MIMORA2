import { Check, HandHelping, MessageSquare, Volume2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import type { SafeStudentPinnedItemView } from '../../../types/student.ts';
import {
  parseActionCardPayload,
  parseCommunicationCardPayload,
} from '../../../utils/studentContent.ts';
import { isSpeechSupported, speakText } from '../../../utils/speech.ts';

export interface AacBoardOption {
  key: string;
  intentLabel: string;
  phrase: string;
  fromAssignedContent?: boolean;
}

const CORE_BOUNDARY_AAC_OPTIONS: readonly AacBoardOption[] = [
  {
    key: 'express_need',
    intentLabel: 'Bày tỏ nhu cầu',
    phrase: 'Con cần thêm chút thời gian hoặc một chỗ yên tĩnh.',
  },
  {
    key: 'ask_help',
    intentLabel: 'Nhờ giúp đỡ',
    phrase: 'Thầy/cô ơi, con muốn nhờ thầy/cô giúp con phần này.',
  },
  {
    key: 'say_stop',
    intentLabel: 'Nói dừng lại',
    phrase: 'Dừng lại nhé, mình chưa thoải mái với việc đó.',
  },
  {
    key: 'set_boundary',
    intentLabel: 'Giữ ranh giới cá nhân',
    phrase: 'Mình muốn giữ khoảng cách một chút để thấy an toàn hơn.',
  },
  {
    key: 'borrow_turns',
    intentLabel: 'Hỏi mượn / Chờ lượt',
    phrase: 'Bạn cho mình mượn / chờ đến lượt mình với nhé.',
  },
  {
    key: 'indicate_discomfort',
    intentLabel: 'Báo khó chịu',
    phrase: 'Âm thanh hoặc tình huống này đang làm mình thấy hơi khó chịu.',
  },
  {
    key: 'choose_other_option',
    intentLabel: 'Chọn cách khác',
    phrase: 'Con muốn chọn một cách khác phù hợp hơn với con.',
  },
  {
    key: 'decline_to_answer',
    intentLabel: 'Từ chối trả lời',
    phrase: 'Con xin phép không trả lời câu hỏi này lúc này.',
  },
];

export interface CommunicationBoardStepProps {
  primaryItem: SafeStudentPinnedItemView;
  companionItems?: SafeStudentPinnedItemView[];
  speechRate?: 'slow' | 'normal';
  readAloudEnabled?: boolean;
  readOnly?: boolean;
  saving?: boolean;
  onSaveCommunicationChoice: (input: {
    stepKey: string;
    selectedChoiceKey: string | null;
    selectedEmotionKey: string | null;
    usedAac: boolean;
    usedReadAloud: boolean;
    responsePayloadJson: Record<string, unknown>;
  }) => void;
  onRequestHelp: () => void;
}

export function CommunicationBoardStep({
  primaryItem,
  companionItems = [],
  speechRate = 'normal',
  readAloudEnabled = true,
  readOnly = false,
  saving = false,
  onSaveCommunicationChoice,
  onRequestHelp,
}: CommunicationBoardStepProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [usedReadAloudLocally, setUsedReadAloudLocally] = useState(false);

  const pinnedOptions: AacBoardOption[] = [];

  for (const item of [
    primaryItem,
    ...companionItems.filter((i) => i.assignmentItemId !== primaryItem.assignmentItemId),
  ]) {
    if (item.contentType === 'communication_card') {
      const parsed = parseCommunicationCardPayload(item.payloadJson, item.title);
      pinnedOptions.push({
        key: `pinned_comm_${item.slug}`,
        intentLabel: parsed.communicationIntent,
        phrase: parsed.phrase,
        fromAssignedContent: true,
      });
      if (parsed.aacSupport?.coreVocabulary) {
        parsed.aacSupport.coreVocabulary.forEach((word, idx) => {
          pinnedOptions.push({
            key: `pinned_vocab_${item.slug}_${idx}`,
            intentLabel: 'Từ khóa AAC trong bài',
            phrase: word,
            fromAssignedContent: true,
          });
        });
      }
    } else if (item.contentType === 'action_card') {
      const parsed = parseActionCardPayload(item.payloadJson, item.title);
      pinnedOptions.push({
        key: `pinned_action_${item.slug}`,
        intentLabel: 'Giải pháp gợi ý từ bài tập',
        phrase: parsed.actionPhrase,
        fromAssignedContent: true,
      });
    }
  }

  const allBoardOptions = [...pinnedOptions, ...CORE_BOUNDARY_AAC_OPTIONS];
  const selectedOption = allBoardOptions.find((o) => o.key === selectedKey) ?? null;

  const handleTapTile = (opt: AacBoardOption) => {
    setSelectedKey(opt.key);
    if (readAloudEnabled && isSpeechSupported()) {
      setUsedReadAloudLocally(true);
      speakText(opt.phrase, { locale: primaryItem.locale, speechRate });
    }
  };

  const handleSave = () => {
    if (readOnly || !selectedOption) {
      return;
    }
    onSaveCommunicationChoice({
      stepKey: 'step_6_communication_aac',
      selectedChoiceKey: selectedOption.key,
      selectedEmotionKey: null,
      usedAac: true,
      usedReadAloud: usedReadAloudLocally,
      responsePayloadJson: {
        step: 6,
        communicationIntent: selectedOption.intentLabel,
        selectedPhraseKey: selectedOption.key,
        fromAssignedContent: Boolean(selectedOption.fromAssignedContent),
      },
    });
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="text-xs font-semibold text-[var(--mimora-primary)]">
          Bước 6 · Giải quyết tình huống & Bảng giao tiếp AAC
        </p>
        <h3 className="text-lg font-semibold text-[var(--mimora-text)]">
          Con muốn nói điều gì hoặc chọn hướng xử lý an toàn nào?
        </h3>
        <p className="text-sm text-[var(--mimora-muted)] leading-relaxed">
          Chạm vào một ô để chọn câu nói hỗ trợ. Mọi cách bày tỏ nhu cầu, đặt ranh giới an toàn
          hoặc xin phép không trả lời đều được tôn trọng.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {allBoardOptions.map((opt) => {
          const active = selectedKey === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              aria-pressed={active}
              onClick={() => handleTapTile(opt)}
              className={[
                'min-h-[76px] text-left rounded-[var(--mimora-radius-lg)] border p-4 cursor-pointer',
                'flex items-start justify-between gap-3 transition-colors duration-150',
                active
                  ? 'bg-[var(--mimora-surface-mint)] border-[var(--mimora-primary)] shadow-[var(--mimora-shadow-soft)]'
                  : opt.fromAssignedContent
                    ? 'bg-[var(--mimora-surface-peach)]/55 border-[#ecc9be] hover:bg-[var(--mimora-surface-peach)]'
                    : 'bg-[var(--mimora-surface)] border-[var(--mimora-border-strong)] hover:bg-[var(--mimora-surface-subtle)]',
              ].join(' ')}
            >
              <div className="space-y-1 min-w-0 flex-1">
                <p className="text-xs font-semibold text-[var(--mimora-primary)] flex items-center gap-1.5">
                  <MessageSquare className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {opt.intentLabel}
                    {opt.fromAssignedContent ? ' · Thẻ bài học' : ''}
                  </span>
                </p>
                <p className="text-sm sm:text-base font-medium text-[var(--mimora-text)] leading-snug">
                  “{opt.phrase}”
                </p>
              </div>
              {active && (
                <Check className="h-5 w-5 text-[var(--mimora-primary)] shrink-0 mt-0.5" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>

      {selectedOption && (
        <Card tone="mint" padding="md" className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <p className="text-xs font-medium text-[var(--mimora-primary)]">
              Câu giao tiếp con vừa chọn ({selectedOption.intentLabel})
            </p>
            <p className="text-base font-semibold text-[var(--mimora-text)]">
              “{selectedOption.phrase}”
            </p>
          </div>
          {readAloudEnabled && (
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => {
                setUsedReadAloudLocally(true);
                if (isSpeechSupported()) {
                  speakText(selectedOption.phrase, { locale: primaryItem.locale, speechRate });
                }
              }}
              leftIcon={<Volume2 className="h-4 w-4" aria-hidden="true" />}
            >
              Nghe lại câu này
            </Button>
          )}
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        {!readOnly && (
          <Button
            type="button"
            variant="primary"
            size="student"
            loading={saving}
            disabled={!selectedOption}
            onClick={handleSave}
          >
            Lưu lựa chọn giao tiếp
          </Button>
        )}

        <Button
          type="button"
          variant="outline"
          size="md"
          onClick={onRequestHelp}
          leftIcon={<HandHelping className="h-4 w-4" aria-hidden="true" />}
        >
          Nhờ thầy cô / người lớn hỗ trợ ngay
        </Button>
      </div>
    </div>
  );
}
