import { BookOpen, HandHeart, Volume2 } from 'lucide-react';
import {
  PROPOSAL_V1_SESSIONS,
  type EmotionCardPresentation,
  type StrategyCardPresentation,
} from '../../types/chapter.ts';
import { Card } from '../ui/Card.tsx';
import { EmotionVisual, StoryBookIllustration } from '../illustrations/SelIllustrations.tsx';

/**
 * Sample presentation fixtures strictly used inside P3-01 UI visual component previews.
 * Clearly labeled in the UI as local visual samples (not real backend records).
 */
export const SAMPLE_EMOTION_CARDS: readonly EmotionCardPresentation[] = [
  {
    key: 'calm',
    label: 'Bình yên',
    tier: 'basic',
    bodyCue: 'Vai thả lỏng, nhịp thở chậm',
    motifs: 'ripple',
    tone: 'mint',
    readAloudText: 'Mình cảm thấy bình yên như mặt hồ phẳng lặng.',
    aacVocabulary: ['Bình yên', 'Thoải mái', 'An toàn'],
  },
  {
    key: 'joyful',
    label: 'Hào hứng',
    tier: 'basic',
    bodyCue: 'Cơ thể nhẹ nhàng, muốn mỉm cười',
    motifs: 'sunbeam',
    tone: 'butter',
    readAloudText: 'Mình thấy vui và hào hứng như tia nắng ấm.',
    aacVocabulary: ['Vui', 'Hào hứng', 'Thích'],
  },
  {
    key: 'nervous',
    label: 'Hồi hộp',
    tier: 'extended',
    bodyCue: 'Tim đập nhanh hơn một chút',
    motifs: 'breeze',
    tone: 'lavender',
    readAloudText: 'Lồng ngực hơi rộn ràng như có làn gió thổi qua.',
    aacVocabulary: ['Hồi hộp', 'Cần chút thời gian'],
  },
  {
    key: 'overwhelmed',
    label: 'Choáng ngợp',
    tier: 'extended',
    bodyCue: 'Muốn tìm một góc yên tĩnh hơn',
    motifs: 'cloud',
    tone: 'peach',
    readAloudText: 'Mọi thứ xung quanh hơi nhiều, mình có thể nghỉ một chút.',
    aacVocabulary: ['Nghỉ giải lao', 'Yên tĩnh'],
  },
];

export const SAMPLE_STRATEGY_CARDS: readonly StrategyCardPresentation[] = [
  {
    key: 'slow_breath',
    title: 'Thở chậm cùng sóng nước',
    category: 'breathing_grounding',
    categoryLabel: 'Nhóm: Hít thở & Tiếp đất',
    actionPhrase: 'Hít vào nhẹ nhàng trong 3 nhịp, thở ra thật êm.',
    tone: 'mint',
    readAloudText: 'Hít vào nhẹ nhàng, rồi thở ra thật êm.',
  },
  {
    key: 'quiet_corner',
    title: 'Góc nhỏ dịu êm',
    category: 'sensory_comfort',
    categoryLabel: 'Nhóm: Không gian giác quan',
    actionPhrase: 'Ngồi ở góc yên tĩnh và ôm gối mềm nếu thấy ồn.',
    tone: 'lavender',
    readAloudText: 'Tìm một góc yên tĩnh giúp mắt và tai được nghỉ ngơi.',
  },
  {
    key: 'ask_support',
    title: 'Ra hiệu nhờ người lớn',
    category: 'ask_for_help',
    categoryLabel: 'Nhóm: Tìm sự hỗ trợ',
    actionPhrase: 'Giơ thẻ AAC hoặc nói với thầy cô khi mình cần giúp.',
    tone: 'peach',
    readAloudText: 'Mình có thể nhờ thầy cô hoặc bạn bè hỗ trợ bất cứ lúc nào.',
  },
];

export function EmotionCardPreview({
  card,
  selected = false,
  onSelect,
}: {
  card: EmotionCardPresentation;
  selected?: boolean;
  onSelect?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={[
        'w-full text-left rounded-[var(--mimora-radius-lg)] border p-4 cursor-pointer',
        'transition-[border-color,box-shadow,transform] duration-150 ease-out',
        'flex items-center gap-4',
        selected
          ? 'border-[var(--mimora-primary)] bg-[var(--mimora-surface-mint)] shadow-[var(--mimora-shadow-soft)]'
          : 'border-[var(--mimora-border)] bg-[var(--mimora-surface)] hover:border-[var(--mimora-primary)]/60',
      ].join(' ')}
    >
      <EmotionVisual motif={card.motifs} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-xs font-medium text-[var(--mimora-muted)]">
          {card.tier === 'basic' ? 'Cảm xúc cơ bản' : 'Cảm xúc mở rộng'}
        </p>
        <p className="text-base font-semibold text-[var(--mimora-text)]">{card.label}</p>
        <p className="text-xs text-[var(--mimora-muted)] leading-relaxed">{card.bodyCue}</p>
        <p className="text-xs text-[var(--mimora-primary)] inline-flex items-center gap-1 pt-0.5">
          <Volume2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Sẵn sàng đọc to · AAC</span>
        </p>
      </div>
    </button>
  );
}

export function StrategyCardPreview({
  card,
  selected = false,
  onSelect,
}: {
  card: StrategyCardPresentation;
  selected?: boolean;
  onSelect?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={[
        'w-full text-left rounded-[var(--mimora-radius-lg)] border p-5 cursor-pointer space-y-2.5',
        'transition-[border-color,box-shadow,transform] duration-150 ease-out',
        selected
          ? 'border-[var(--mimora-secondary)] bg-[var(--mimora-surface-lavender)] shadow-[var(--mimora-shadow-soft)]'
          : 'border-[var(--mimora-border)] bg-[var(--mimora-surface)] hover:border-[var(--mimora-secondary)]/60',
      ].join(' ')}
    >
      <div className="flex items-center gap-2 text-xs font-medium text-[var(--mimora-secondary)]">
        <HandHeart className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{card.categoryLabel}</span>
      </div>
      <p className="text-base font-semibold text-[var(--mimora-text)]">{card.title}</p>
      <p className="text-sm text-[var(--mimora-muted)] leading-relaxed">{card.actionPhrase}</p>
    </button>
  );
}

export function ActivityCardPreview({
  title,
  chapterLabel,
  sceneSummary,
}: {
  title: string;
  chapterLabel: string;
  sceneSummary: string;
}) {
  return (
    <Card tone="lavender" padding="md" className="flex flex-col sm:flex-row sm:items-center gap-5">
      <StoryBookIllustration />
      <div className="space-y-1.5 flex-1 min-w-0">
        <p className="text-xs font-medium text-[var(--mimora-secondary)] flex items-center gap-1.5">
          <BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{chapterLabel} · Minh họa thành phần P3-03</span>
        </p>
        <h3 className="text-lg font-semibold text-[var(--mimora-text)]">{title}</h3>
        <p className="text-sm text-[var(--mimora-muted)] leading-relaxed">{sceneSummary}</p>
      </div>
    </Card>
  );
}

export function ChapterPathOutline() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {PROPOSAL_V1_SESSIONS.map((session) => (
        <Card key={session.sessionNumber} tone="default" padding="md" className="space-y-3">
          <p className="text-xs font-semibold text-[var(--mimora-primary)]">
            Buổi {session.sessionNumber} / 3
          </p>
          <h3 className="text-base font-semibold text-[var(--mimora-text)]">
            {session.titleVi.replace(/^Buổi \d+: /, '')}
          </h3>
          <ol className="space-y-2.5 pt-1 border-t border-[var(--mimora-border)]">
            {session.steps.map((step) => (
              <li key={step.stepNumber} className="space-y-0.5">
                <p className="text-sm font-medium text-[var(--mimora-text)]">
                  {step.defaultTitleVi}
                </p>
                <p className="text-xs text-[var(--mimora-muted)] leading-relaxed">
                  {step.summaryVi}
                </p>
              </li>
            ))}
          </ol>
        </Card>
      ))}
    </div>
  );
}
