import { HandHelping, PauseCircle, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { isSpeechSupported, speakText, stopSpeech } from '../../utils/speech.ts';

export interface AacSupportBarProps {
  readAloudText: string;
  aacWords: string[];
  locale?: string;
  speechRate?: 'slow' | 'normal';
  aacEnabled?: boolean;
  readAloudEnabled?: boolean;
  onUsedReadAloud?: () => void;
  onUsedAac?: (phrase: string) => void;
  onRequestAdultHelp?: (reasonLabel: string) => void;
}

const CORE_AAC_PHRASES: ReadonlyArray<{ id: string; label: string; speech: string }> = [
  { id: 'need_break', label: 'Con cần nghỉ chút', speech: 'Con cần nghỉ ngơi một chút.' },
  { id: 'need_help', label: 'Nhờ thầy cô giúp', speech: 'Con muốn nhờ thầy cô hoặc người lớn giúp.' },
  { id: 'too_loud', label: 'Hơi ồn / Hơi nhiều', speech: 'Xung quanh hơi ồn hoặc hơi nhiều, con muốn dịu lại.' },
  { id: 'skip_now', label: 'Để lúc khác nhé', speech: 'Con muốn bỏ qua phần này để làm lúc khác.' },
];

export function AacSupportBar({
  readAloudText,
  aacWords,
  locale = 'vi-VN',
  speechRate = 'normal',
  aacEnabled = true,
  readAloudEnabled = true,
  onUsedReadAloud,
  onUsedAac,
  onRequestAdultHelp,
}: AacSupportBarProps) {
  const [speaking, setSpeaking] = useState(false);
  const [speechNotice, setSpeechNotice] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [lastTappedAac, setLastTappedAac] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      stopSpeech();
    };
  }, [readAloudText]);

  const handleToggleReadAloud = () => {
    if (speaking) {
      stopSpeech();
      setSpeaking(false);
      return;
    }

    setSpeechNotice(null);
    if (!isSpeechSupported()) {
      setSpeechNotice(
        'Trình duyệt hiện tại chưa bật bộ đọc giọng nói. Con vẫn có thể đọc chữ lớn hoặc nhờ người lớn đọc cùng nhé.'
      );
      onUsedReadAloud?.();
      return;
    }

    onUsedReadAloud?.();
    speakText(readAloudText, {
      locale,
      speechRate,
      onStart: () => setSpeaking(true),
      onEnd: () => setSpeaking(false),
      onUnavailable: () => {
        setSpeaking(false);
        setSpeechNotice(
          'Thiết bị chưa hỗ trợ đọc giọng nói tự động. Con hãy đọc mô tả chữ hoặc nhờ người lớn hỗ trợ nhé.'
        );
      },
    });
  };

  const handleTapAacWord = (word: string, speechPhrase?: string) => {
    setLastTappedAac(word);
    onUsedAac?.(word);
    if (readAloudEnabled && isSpeechSupported()) {
      speakText(speechPhrase ?? word, {
        locale,
        speechRate,
        onStart: () => setSpeaking(true),
        onEnd: () => setSpeaking(false),
      });
    }
  };

  const mergedAacWords = Array.from(new Set(aacWords.filter((w) => w.trim().length > 0))).slice(0, 6);

  return (
    <div
      aria-label="Thanh hỗ trợ Đọc to và Giao tiếp AAC"
      className="rounded-[var(--mimora-radius-lg)] border border-[var(--mimora-border)] bg-[var(--mimora-surface-subtle)] p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          {readAloudEnabled && (
            <Button
              type="button"
              variant={speaking ? 'secondary' : 'outline'}
              size="md"
              onClick={handleToggleReadAloud}
              leftIcon={
                speaking ? (
                  <PauseCircle className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Volume2 className="h-4 w-4" aria-hidden="true" />
                )
              }
            >
              {speaking ? 'Dừng đọc' : 'Đọc to phần này'}
            </Button>
          )}

          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={() => setHelpOpen(true)}
            leftIcon={<HandHelping className="h-4 w-4" aria-hidden="true" />}
          >
            Nhờ người lớn giúp
          </Button>
        </div>

        <p className="text-xs text-[var(--mimora-muted)]">
          Hỗ trợ tùy chọn · Tốc độ đọc: {speechRate === 'slow' ? 'Chậm rãi' : 'Bình thường'}
        </p>
      </div>

      {aacEnabled && (
        <div className="space-y-2 pt-1 border-t border-[var(--mimora-border)]">
          <p className="text-xs font-medium text-[var(--mimora-muted)]">
            Thẻ giao tiếp nhanh (AAC) — chạm để chọn hoặc nghe:
          </p>
          <div className="flex flex-wrap gap-2">
            {mergedAacWords.map((word) => (
              <button
                key={`card-aac-${word}`}
                type="button"
                onClick={() => handleTapAacWord(word)}
                aria-pressed={lastTappedAac === word}
                className={[
                  'min-h-[42px] max-w-full text-left break-words px-3.5 py-2 rounded-[var(--mimora-radius-md)] border text-sm font-medium cursor-pointer',
                  'transition-colors duration-150',
                  lastTappedAac === word
                    ? 'bg-[var(--mimora-surface-mint)] border-[var(--mimora-primary)] text-[var(--mimora-primary)]'
                    : 'bg-[var(--mimora-surface)] border-[var(--mimora-border-strong)] text-[var(--mimora-text)] hover:bg-[var(--mimora-surface-mint)]/50',
                ].join(' ')}
              >
                {word}
              </button>
            ))}

            {CORE_AAC_PHRASES.map((phrase) => (
              <button
                key={phrase.id}
                type="button"
                onClick={() => handleTapAacWord(phrase.label, phrase.speech)}
                aria-pressed={lastTappedAac === phrase.label}
                className={[
                  'min-h-[42px] max-w-full text-left break-words px-3.5 py-2 rounded-[var(--mimora-radius-md)] border text-sm font-medium cursor-pointer',
                  'transition-colors duration-150',
                  lastTappedAac === phrase.label
                    ? 'bg-[var(--mimora-surface-lavender)] border-[var(--mimora-secondary)] text-[var(--mimora-secondary)]'
                    : 'bg-[var(--mimora-surface)] border-[var(--mimora-border)] text-[var(--mimora-text)] hover:bg-[var(--mimora-surface-lavender)]/60',
                ].join(' ')}
              >
                {phrase.label}
              </button>
            ))}
          </div>
          {lastTappedAac && (
            <p className="text-xs font-medium text-[var(--mimora-primary)]" role="status" aria-live="polite">
              Con vừa chọn thẻ giao tiếp: “{lastTappedAac}”
            </p>
          )}
        </div>
      )}

      {speechNotice && (
        <p className="text-xs text-[var(--mimora-muted)] leading-relaxed" role="status">
          {speechNotice}
        </p>
      )}

      <Dialog
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="Nhờ thầy cô hoặc người lớn hỗ trợ"
        description="Con luôn có thể dừng một chút hoặc giơ thẻ này cho thầy cô, ba mẹ xem nhé."
        footer={
          <Button variant="primary" size="md" onClick={() => setHelpOpen(false)}>
            Quay lại hoạt động
          </Button>
        }
      >
        <div className="space-y-3">
          {[
            'Con chưa hiểu rõ câu chuyện hoặc từ ngữ ở bước này.',
            'Con đang thấy hơi mệt hoặc khó chịu, con muốn nghỉ giải lao.',
            'Con muốn nói chuyện riêng với thầy cô hoặc người lớn.',
          ].map((reason) => (
            <button
              key={reason}
              type="button"
              onClick={() => {
                onRequestAdultHelp?.(reason);
                setHelpOpen(false);
              }}
              className="w-full min-h-[48px] text-left px-4 py-3 rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border-strong)] bg-[var(--mimora-surface-mint)]/50 hover:bg-[var(--mimora-surface-mint)] text-sm font-medium text-[var(--mimora-text)] cursor-pointer transition-colors"
            >
              {reason}
            </button>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
