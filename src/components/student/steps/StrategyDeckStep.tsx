import { Check, HandHeart, HelpCircle, RefreshCw, Volume2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import type { SafeStudentPinnedItemView } from '../../../types/student.ts';
import {
  STRATEGY_CATEGORY_LABELS_VI,
  extractStrategyCategory,
  parseActionCardPayload,
} from '../../../utils/studentContent.ts';
import { isSpeechSupported, speakText } from '../../../utils/speech.ts';

export interface StrategyDeckStepProps {
  primaryItem: SafeStudentPinnedItemView;
  companionStrategyItems?: SafeStudentPinnedItemView[];
  speechRate?: 'slow' | 'normal';
  readAloudEnabled?: boolean;
  readOnly?: boolean;
  saving?: boolean;
  onSaveStrategy: (input: {
    stepKey: string;
    selectedChoiceKey: string | null;
    selectedEmotionKey: string | null;
    usedReadAloud?: boolean;
    responsePayloadJson: Record<string, unknown>;
  }) => void;
  onRequestHelp: () => void;
}

export function StrategyDeckStep({
  primaryItem,
  companionStrategyItems = [],
  speechRate = 'normal',
  readAloudEnabled = true,
  readOnly = false,
  saving = false,
  onSaveStrategy,
  onRequestHelp,
}: StrategyDeckStepProps) {
  const allActionItems = [
    primaryItem,
    ...companionStrategyItems.filter((item) => item.assignmentItemId !== primaryItem.assignmentItemId),
  ];

  const [selectedSlug, setSelectedSlug] = useState<string | null>(allActionItems[0]?.slug ?? null);
  const [usedReadAloudLocally, setUsedReadAloudLocally] = useState(false);

  const parsedStrategies = allActionItems.map((item) => {
    const parsed = parseActionCardPayload(item.payloadJson, item.title);
    const category = extractStrategyCategory(item.metadataJson);
    return {
      item,
      parsed,
      category,
      categoryLabel: category
        ? STRATEGY_CATEGORY_LABELS_VI[category]
        : 'Chiến lược hỗ trợ từ bài tập',
    };
  });

  // Group into metadata category sections when metadata exists (no ranking or ordering algorithms)
  const grouped = new Map<string, typeof parsedStrategies>();
  for (const entry of parsedStrategies) {
    const groupName = entry.categoryLabel;
    const list = grouped.get(groupName) ?? [];
    list.push(entry);
    grouped.set(groupName, list);
  }

  const handleSaveChosenStrategy = () => {
    if (readOnly || !selectedSlug) {
      return;
    }
    const chosen = parsedStrategies.find((s) => s.item.slug === selectedSlug);
    onSaveStrategy({
      stepKey: 'step_4_strategy_deck',
      selectedChoiceKey: `strategy_${selectedSlug}`,
      selectedEmotionKey: null,
      usedReadAloud: usedReadAloudLocally,
      responsePayloadJson: {
        step: 4,
        selectedStrategySlug: selectedSlug,
        selectedCategory: chosen?.category ?? 'untagged',
      },
    });
  };

  const handleOpenChoice = (choiceKey: 'try_another_way' | 'ask_adult_help') => {
    if (readOnly) {
      return;
    }
    if (choiceKey === 'ask_adult_help') {
      onRequestHelp();
    }
    onSaveStrategy({
      stepKey: 'step_4_strategy_deck',
      selectedChoiceKey: choiceKey,
      selectedEmotionKey: null,
      usedReadAloud: usedReadAloudLocally,
      responsePayloadJson: {
        step: 4,
        choiceStatus: choiceKey,
      },
    });
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="text-xs font-semibold text-[var(--mimora-secondary)]">
          Bước 4 · Khám phá Thẻ Chiến lược điều hòa
        </p>
        <h3 className="text-lg font-semibold text-[var(--mimora-text)]">
          Con muốn thử cách nào giúp bản thân dễ chịu hơn?
        </h3>
        <p className="text-sm text-[var(--mimora-muted)] leading-relaxed">
          Đây là các thẻ chiến lược thầy cô đã gắn cho bài tập này. Con có thể chọn thử một cách,
          chọn “Con muốn thử cách khác”, hoặc nhờ người lớn đồng hành.
        </p>
      </div>

      {Array.from(grouped.entries()).map(([groupLabel, entries]) => (
        <div key={groupLabel} className="space-y-3">
          <p className="text-xs font-semibold text-[var(--mimora-muted)]">
            {groupLabel} · {entries.length} thẻ
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {entries.map(({ item, parsed }) => {
              const selected = selectedSlug === item.slug;
              return (
                <Card
                  key={item.assignmentItemId}
                  tone={selected ? 'lavender' : 'default'}
                  padding="md"
                  className="space-y-3"
                >
                  <button
                    type="button"
                    disabled={readOnly}
                    aria-pressed={selected}
                    onClick={() => setSelectedSlug(item.slug)}
                    className="w-full text-left space-y-2 cursor-pointer disabled:cursor-default"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--mimora-secondary)]">
                        <HandHeart className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>Thẻ chiến lược</span>
                      </span>
                      {selected && (
                        <Check
                          className="h-5 w-5 text-[var(--mimora-secondary)] shrink-0"
                          aria-hidden="true"
                        />
                      )}
                    </div>
                    <h4 className="text-base font-semibold text-[var(--mimora-text)]">
                      {parsed.displayTitle}
                    </h4>
                    <p className="text-sm text-[var(--mimora-text)] leading-relaxed">
                      {parsed.actionPhrase}
                    </p>
                    {parsed.contextExplanation && (
                      <p className="text-xs text-[var(--mimora-muted)] leading-relaxed">
                        {parsed.contextExplanation}
                      </p>
                    )}
                    {parsed.possibleOutcomes.length > 0 && (
                      <ul className="pt-1 space-y-1 text-xs text-[var(--mimora-muted)] list-disc pl-4">
                        {parsed.possibleOutcomes.map((out) => (
                          <li key={out}>{out}</li>
                        ))}
                      </ul>
                    )}
                  </button>

                  {readAloudEnabled && (
                    <div className="pt-2 border-t border-[var(--mimora-border)] flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setUsedReadAloudLocally(true);
                          if (isSpeechSupported()) {
                            speakText(
                              parsed.readAloud?.text ??
                                `${parsed.displayTitle}. ${parsed.actionPhrase}`,
                              {
                                locale: item.locale,
                                speechRate: parsed.readAloud?.speechRateHint ?? speechRate,
                              }
                            );
                          }
                        }}
                        leftIcon={<Volume2 className="h-3.5 w-3.5" aria-hidden="true" />}
                      >
                        Đọc to thẻ này
                      </Button>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      ))}

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button
            type="button"
            variant="primary"
            size="student"
            loading={saving}
            disabled={!selectedSlug}
            onClick={handleSaveChosenStrategy}
          >
            Chọn chiến lược này để thử
          </Button>

          <Button
            type="button"
            variant="outline"
            size="md"
            disabled={saving}
            onClick={() => handleOpenChoice('try_another_way')}
            leftIcon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
          >
            Con muốn thử cách khác
          </Button>

          <Button
            type="button"
            variant="outline"
            size="md"
            disabled={saving}
            onClick={() => handleOpenChoice('ask_adult_help')}
            leftIcon={<HelpCircle className="h-4 w-4" aria-hidden="true" />}
          >
            Con muốn nhờ người lớn giúp
          </Button>
        </div>
      )}
    </div>
  );
}
