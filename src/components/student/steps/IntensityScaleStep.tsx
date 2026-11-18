import { Check, SkipForward, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../ui/Button.tsx';
import type { IntensityLevel } from '../../../types/chapter.ts';

export const GENTLE_INTENSITY_LEVELS: readonly IntensityLevel[] = [
  {
    level: 1,
    labelVi: 'Nhẹ nhàng như làn gió thoảng',
    visualCueVi: 'Lòng khá êm, vẫn thoải mái tiếp tục',
  },
  {
    level: 2,
    labelVi: 'Hơi xao động như gợn sóng nhỏ',
    visualCueVi: 'Có một chút cảm giác đang xuất hiện',
  },
  {
    level: 3,
    labelVi: 'Rõ ràng hơn như sóng vỗ bờ',
    visualCueVi: 'Cảm xúc đang hiện lên khá rõ bên trong',
  },
  {
    level: 4,
    labelVi: 'Mạnh mẽ như cơn gió lớn',
    visualCueVi: 'Có thể con cần thở chậm hoặc tìm góc yên tĩnh',
  },
  {
    level: 5,
    labelVi: 'Rất đầy · Cần tạm nghỉ ngơi',
    visualCueVi: 'Con nên dừng lại nghỉ ngơi hoặc nhờ người lớn bên cạnh',
  },
];

export interface IntensityScaleStepProps {
  initialLevel?: number | null;
  readOnly?: boolean;
  saving?: boolean;
  onSaveIntensity: (input: {
    stepKey: string;
    selectedChoiceKey: string | null;
    selectedEmotionKey: string | null;
    responsePayloadJson: Record<string, unknown>;
  }) => void;
}

export function IntensityScaleStep({
  initialLevel = null,
  readOnly = false,
  saving = false,
  onSaveIntensity,
}: IntensityScaleStepProps) {
  const [selectedLevel, setSelectedLevel] = useState<number | null>(initialLevel);

  const handleSave = () => {
    if (readOnly || selectedLevel === null) {
      return;
    }
    const chosen = GENTLE_INTENSITY_LEVELS.find((l) => l.level === selectedLevel);
    onSaveIntensity({
      stepKey: 'step_3_intensity_scale',
      selectedChoiceKey: `intensity_level_${selectedLevel}`,
      selectedEmotionKey: null,
      responsePayloadJson: {
        step: 3,
        gentleLevelKey: `level_${selectedLevel}`,
        labelVi: chosen?.labelVi ?? '',
        nonDiagnostic: true,
      },
    });
  };

  const handleSkipOrUnsure = (choiceKey: 'unsure' | 'skip_step') => {
    if (readOnly) {
      return;
    }
    setSelectedLevel(null);
    onSaveIntensity({
      stepKey: 'step_3_intensity_scale',
      selectedChoiceKey: choiceKey,
      selectedEmotionKey: null,
      responsePayloadJson: {
        step: 3,
        choiceStatus: choiceKey,
      },
    });
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="text-xs font-semibold text-[var(--mimora-primary)]">
          Bước 3 (Tùy chọn) · Mức độ cảm xúc hiện tại
        </p>
        <h3 className="text-lg font-semibold text-[var(--mimora-text)]">
          Cảm xúc bên trong con lúc này đang ở độ nhẹ hay mạnh?
        </h3>
        <p className="text-sm text-[var(--mimora-muted)] leading-relaxed">
          Không cần chấm điểm hay con số bắt buộc — mọi mức độ đều bình thường và con có thể bỏ qua.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3" role="radiogroup" aria-label="Thang mức độ cảm xúc dịu nhẹ">
        {GENTLE_INTENSITY_LEVELS.map((item) => {
          const active = selectedLevel === item.level;
          return (
            <button
              key={item.level}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={readOnly}
              onClick={() => setSelectedLevel(item.level)}
              className={[
                'w-full text-left rounded-[var(--mimora-radius-lg)] border p-4 cursor-pointer',
                'flex items-center gap-4 transition-colors duration-150',
                active
                  ? 'bg-[var(--mimora-surface-mint)] border-[var(--mimora-primary)] shadow-[var(--mimora-shadow-soft)]'
                  : 'bg-[var(--mimora-surface)] border-[var(--mimora-border)] hover:bg-[var(--mimora-surface-subtle)]',
              ].join(' ')}
            >
              {/* Visual ripple wave bars (size grows gently, zero clinical/grade colors) */}
              <div className="w-16 h-12 rounded-[var(--mimora-radius-md)] bg-[var(--mimora-surface-butter)] border border-[#eadba9] flex items-end justify-center gap-1 p-2 shrink-0" aria-hidden="true">
                {[1, 2, 3, 4, 5].map((bar) => (
                  <span
                    key={bar}
                    className={[
                      'w-1.5 rounded-full',
                      bar <= item.level ? 'bg-[var(--mimora-primary)]' : 'bg-[var(--mimora-border)]',
                    ].join(' ')}
                    style={{ height: `${bar * 5 + 4}px` }}
                  />
                ))}
              </div>

              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-base font-semibold text-[var(--mimora-text)] flex items-center gap-2">
                  <span>{item.labelVi}</span>
                  {active && (
                    <Check className="h-4 w-4 text-[var(--mimora-primary)] shrink-0" aria-hidden="true" />
                  )}
                </p>
                <p className="text-sm text-[var(--mimora-muted)]">{item.visualCueVi}</p>
              </div>
            </button>
          );
        })}
      </div>

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button
            type="button"
            variant="primary"
            size="student"
            loading={saving}
            disabled={selectedLevel === null}
            onClick={handleSave}
            leftIcon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
          >
            Ghi nhận mức độ cảm giác
          </Button>

          <Button
            type="button"
            variant="outline"
            size="md"
            disabled={saving}
            onClick={() => handleSkipOrUnsure('unsure')}
          >
            Con chưa rõ mức độ
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
    </div>
  );
}
