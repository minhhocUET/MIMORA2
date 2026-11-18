import { Check, SkipForward } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import type { BodyMapRegion } from '../../../types/chapter.ts';

export const BODY_MAP_REGIONS: readonly BodyMapRegion[] = [
  {
    id: 'head',
    labelVi: 'Vùng Đầu & Trán',
    neutralSensationsVi: ['Ấm lên', 'Nặng đầu', 'Quay cuồng nhẹ', 'Thoải mái'],
  },
  {
    id: 'shoulders',
    labelVi: 'Vùng Vai & Cổ',
    neutralSensationsVi: ['Hơi gồng', 'Nâng vai cao', 'Thả lỏng', 'Mỏi nhẹ'],
  },
  {
    id: 'chest',
    labelVi: 'Vùng Ngực & Nhịp thở',
    neutralSensationsVi: ['Thở nhanh', 'Rộn ràng', 'Hơi chặt', 'Êm dịu'],
  },
  {
    id: 'stomach',
    labelVi: 'Vùng Bụng',
    neutralSensationsVi: ['Bồn chồn như cánh bướm', 'Co nhẹ', 'Ấm áp', 'Bình thường'],
  },
  {
    id: 'hands',
    labelVi: 'Hai Tay & Bàn tay',
    neutralSensationsVi: ['Muốn nắm chặt', 'Muốn cử động', 'Ấm / Lạnh nhẹ', 'Thả lỏng'],
  },
];

export interface BodyMapStepProps {
  initialRegionId?: BodyMapRegion['id'] | null;
  initialSensation?: string | null;
  readOnly?: boolean;
  saving?: boolean;
  onSaveBodyMap: (input: {
    stepKey: string;
    selectedChoiceKey: string | null;
    selectedEmotionKey: string | null;
    responsePayloadJson: Record<string, unknown>;
  }) => void;
}

export function BodyMapStep({
  initialRegionId = null,
  initialSensation = null,
  readOnly = false,
  saving = false,
  onSaveBodyMap,
}: BodyMapStepProps) {
  const [selectedRegion, setSelectedRegion] = useState<BodyMapRegion['id'] | null>(
    initialRegionId
  );
  const [selectedSensation, setSelectedSensation] = useState<string | null>(initialSensation);

  const activeRegionSpec = BODY_MAP_REGIONS.find((r) => r.id === selectedRegion) ?? null;

  const handleSaveRegion = () => {
    if (readOnly || !selectedRegion) {
      return;
    }
    onSaveBodyMap({
      stepKey: 'step_2_body_map',
      selectedChoiceKey: `body_region_${selectedRegion}`,
      selectedEmotionKey: null,
      responsePayloadJson: {
        step: 2,
        regionId: selectedRegion,
        sensationLabel: selectedSensation ?? 'wordless_tap',
      },
    });
  };

  const handleOptionalOutcome = (
    choiceKey: 'decline_to_share' | 'unsure' | 'skip_step'
  ) => {
    if (readOnly) {
      return;
    }
    setSelectedRegion(null);
    setSelectedSensation(null);
    onSaveBodyMap({
      stepKey: 'step_2_body_map',
      selectedChoiceKey: choiceKey,
      selectedEmotionKey: null,
      responsePayloadJson: {
        step: 2,
        choiceStatus: choiceKey,
      },
    });
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="text-xs font-semibold text-[var(--mimora-primary)]">
          Bước 2 (Tùy chọn) · Bản đồ Cơ thể nhẹ nhàng
        </p>
        <h3 className="text-lg font-semibold text-[var(--mimora-text)]">
          Cơ thể con có đang cảm thấy điều gì đặc biệt không?
        </h3>
        <p className="text-sm text-[var(--mimora-muted)] leading-relaxed">
          Con có thể chạm vào một vùng trên hình minh họa (không cần giải thích bằng lời nếu không
          muốn), hoặc chọn không chia sẻ bất cứ lúc nào.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Friendly original non-clinical SVG silhouette */}
        <Card tone="mint" padding="md" className="lg:col-span-5 flex flex-col items-center gap-3">
          <svg
            viewBox="0 0 240 300"
            fill="none"
            role="img"
            aria-label="Hình minh họa cơ thể thân thiện với 5 vùng chạm chọn: Đầu, Vai, Ngực, Bụng, Hai tay"
            className="w-full max-w-[240px] h-auto"
          >
            <rect width="240" height="300" rx="24" fill="#FFFFFF" />
            {/* Soft aura base */}
            <ellipse cx="120" cy="272" rx="68" ry="12" fill="#E8F4F1" />

            {/* Head target */}
            <g
              role="button"
              tabIndex={readOnly ? -1 : 0}
              aria-label="Chọn Vùng Đầu & Trán"
              aria-pressed={selectedRegion === 'head'}
              onClick={() => {
                if (!readOnly) {
                  setSelectedRegion('head');
                  setSelectedSensation(null);
                }
              }}
              onKeyDown={(e) => {
                if (!readOnly && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  setSelectedRegion('head');
                  setSelectedSensation(null);
                }
              }}
              className="cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--mimora-focus)]"
            >
              <circle
                cx="120"
                cy="58"
                r="32"
                fill={selectedRegion === 'head' ? '#B9E3D8' : '#FAF6ED'}
                stroke={selectedRegion === 'head' ? '#1A6F6B' : '#C5DFD8'}
                strokeWidth={selectedRegion === 'head' ? '3.5' : '2'}
              />
              <circle cx="110" cy="54" r="3" fill="#526165" />
              <circle cx="130" cy="54" r="3" fill="#526165" />
              <path
                d="M113 65C117 68 123 68 127 65"
                stroke="#526165"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </g>

            {/* Shoulders target */}
            <g
              role="button"
              tabIndex={readOnly ? -1 : 0}
              aria-label="Chọn Vùng Vai & Cổ"
              aria-pressed={selectedRegion === 'shoulders'}
              onClick={() => {
                if (!readOnly) {
                  setSelectedRegion('shoulders');
                  setSelectedSensation(null);
                }
              }}
              onKeyDown={(e) => {
                if (!readOnly && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  setSelectedRegion('shoulders');
                  setSelectedSensation(null);
                }
              }}
              className="cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--mimora-focus)]"
            >
              <rect
                x="62"
                y="96"
                width="116"
                height="32"
                rx="16"
                fill={selectedRegion === 'shoulders' ? '#DFD8F3' : '#F1EEF9'}
                stroke={selectedRegion === 'shoulders' ? '#5A4C8C' : '#D3CBE9'}
                strokeWidth={selectedRegion === 'shoulders' ? '3.5' : '2'}
              />
            </g>

            {/* Chest target */}
            <g
              role="button"
              tabIndex={readOnly ? -1 : 0}
              aria-label="Chọn Vùng Ngực & Nhịp thở"
              aria-pressed={selectedRegion === 'chest'}
              onClick={() => {
                if (!readOnly) {
                  setSelectedRegion('chest');
                  setSelectedSensation(null);
                }
              }}
              onKeyDown={(e) => {
                if (!readOnly && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  setSelectedRegion('chest');
                  setSelectedSensation(null);
                }
              }}
              className="cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--mimora-focus)]"
            >
              <rect
                x="76"
                y="132"
                width="88"
                height="48"
                rx="18"
                fill={selectedRegion === 'chest' ? '#FCE5DC' : '#FDF0EB'}
                stroke={selectedRegion === 'chest' ? '#B84F3B' : '#ECC9BE'}
                strokeWidth={selectedRegion === 'chest' ? '3.5' : '2'}
              />
              <circle cx="120" cy="156" r="10" fill="#DF856F" fillOpacity="0.45" />
            </g>

            {/* Stomach target */}
            <g
              role="button"
              tabIndex={readOnly ? -1 : 0}
              aria-label="Chọn Vùng Bụng"
              aria-pressed={selectedRegion === 'stomach'}
              onClick={() => {
                if (!readOnly) {
                  setSelectedRegion('stomach');
                  setSelectedSensation(null);
                }
              }}
              onKeyDown={(e) => {
                if (!readOnly && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  setSelectedRegion('stomach');
                  setSelectedSensation(null);
                }
              }}
              className="cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--mimora-focus)]"
            >
              <rect
                x="80"
                y="186"
                width="80"
                height="50"
                rx="20"
                fill={selectedRegion === 'stomach' ? '#F8E19C' : '#FDF6DE'}
                stroke={selectedRegion === 'stomach' ? '#8F5C0C' : '#EADBA9'}
                strokeWidth={selectedRegion === 'stomach' ? '3.5' : '2'}
              />
            </g>

            {/* Left & Right Hands/Arms target */}
            <g
              role="button"
              tabIndex={readOnly ? -1 : 0}
              aria-label="Chọn Hai Tay & Bàn tay"
              aria-pressed={selectedRegion === 'hands'}
              onClick={() => {
                if (!readOnly) {
                  setSelectedRegion('hands');
                  setSelectedSensation(null);
                }
              }}
              onKeyDown={(e) => {
                if (!readOnly && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  setSelectedRegion('hands');
                  setSelectedSensation(null);
                }
              }}
              className="cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--mimora-focus)]"
            >
              <rect
                x="28"
                y="112"
                width="26"
                height="96"
                rx="13"
                fill={selectedRegion === 'hands' ? '#B9E3D8' : '#E8F4F1'}
                stroke={selectedRegion === 'hands' ? '#1A6F6B' : '#C3DFD8'}
                strokeWidth={selectedRegion === 'hands' ? '3.5' : '2'}
              />
              <rect
                x="186"
                y="112"
                width="26"
                height="96"
                rx="13"
                fill={selectedRegion === 'hands' ? '#B9E3D8' : '#E8F4F1'}
                stroke={selectedRegion === 'hands' ? '#1A6F6B' : '#C3DFD8'}
                strokeWidth={selectedRegion === 'hands' ? '3.5' : '2'}
              />
            </g>
          </svg>
          <p className="text-xs text-[var(--mimora-muted)] text-center">
            Chạm trực tiếp vào hình hoặc chọn nút bên cạnh
          </p>
        </Card>

        {/* Accessible large region buttons + optional wordless/descriptor selector */}
        <div className="lg:col-span-7 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {BODY_MAP_REGIONS.map((region) => {
              const active = selectedRegion === region.id;
              return (
                <button
                  key={region.id}
                  type="button"
                  disabled={readOnly}
                  aria-pressed={active}
                  onClick={() => {
                    setSelectedRegion(region.id);
                    setSelectedSensation(null);
                  }}
                  className={[
                    'min-h-[48px] px-4 py-3 rounded-[var(--mimora-radius-md)] border text-left font-medium text-sm cursor-pointer',
                    'flex items-center justify-between gap-2 transition-colors duration-150',
                    active
                      ? 'bg-[var(--mimora-surface-mint)] border-[var(--mimora-primary)] text-[var(--mimora-primary)]'
                      : 'bg-[var(--mimora-surface)] border-[var(--mimora-border-strong)] text-[var(--mimora-text)] hover:bg-[var(--mimora-surface-subtle)]',
                  ].join(' ')}
                >
                  <span>{region.labelVi}</span>
                  {active && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
                </button>
              );
            })}
          </div>

          {activeRegionSpec && (
            <div className="rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)] bg-[var(--mimora-surface)] p-4 space-y-3">
              <p className="text-sm font-medium text-[var(--mimora-text)]">
                Nếu muốn, con có thể chọn thêm cảm giác ở{' '}
                <span className="font-semibold">{activeRegionSpec.labelVi}</span> (hoặc bỏ trống):
              </p>
              <div className="flex flex-wrap gap-2">
                {activeRegionSpec.neutralSensationsVi.map((word) => {
                  const chosen = selectedSensation === word;
                  return (
                    <button
                      key={word}
                      type="button"
                      disabled={readOnly}
                      aria-pressed={chosen}
                      onClick={() => setSelectedSensation(chosen ? null : word)}
                      className={[
                        'min-h-[40px] px-3.5 py-2 rounded-[var(--mimora-radius-sm)] border text-sm cursor-pointer whitespace-nowrap shrink-0',
                        chosen
                          ? 'bg-[var(--mimora-surface-lavender)] border-[var(--mimora-secondary)] text-[var(--mimora-secondary)] font-semibold'
                          : 'bg-[var(--mimora-surface-subtle)] border-[var(--mimora-border)] text-[var(--mimora-text)] hover:bg-[var(--mimora-surface-lavender)]/40',
                      ].join(' ')}
                    >
                      {word}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {!readOnly && (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button
                type="button"
                variant="primary"
                size="student"
                loading={saving}
                disabled={!selectedRegion}
                onClick={handleSaveRegion}
              >
                {selectedRegion ? 'Lưu cảm nhận cơ thể' : 'Hãy chạm một vùng hoặc bỏ qua'}
              </Button>

              <Button
                type="button"
                variant="outline"
                size="md"
                disabled={saving}
                onClick={() => handleOptionalOutcome('decline_to_share')}
              >
                Không muốn chia sẻ
              </Button>

              <Button
                type="button"
                variant="outline"
                size="md"
                disabled={saving}
                onClick={() => handleOptionalOutcome('unsure')}
              >
                Con không biết
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="md"
                disabled={saving}
                onClick={() => handleOptionalOutcome('skip_step')}
                leftIcon={<SkipForward className="h-4 w-4" aria-hidden="true" />}
              >
                Bỏ qua
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
