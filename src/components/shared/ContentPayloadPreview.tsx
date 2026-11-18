import { BookOpen, Volume2, MessageSquare } from 'lucide-react';
import type { CanonicalContentType } from '../../types/chapter.ts';
import type { ContentMetadataJson } from '../../types/admin.ts';
import type { AppLocale } from '../../i18n/index.ts';
import { getContentTypeLabel } from '../../utils/p302.ts';
import { Badge, Card, CardContent } from '../ui/index.ts';

export interface ContentPayloadPreviewProps {
  contentType: CanonicalContentType;
  title: string;
  summary?: string | null;
  locale: string;
  uiLocale?: AppLocale;
  payloadJson: Record<string, unknown>;
  metadataJson?: ContentMetadataJson | null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function ContentPayloadPreview({
  contentType,
  title,
  summary,
  locale,
  uiLocale = 'vi-VN',
  payloadJson,
  metadataJson,
}: ContentPayloadPreviewProps) {
  const displayTitle = asString(payloadJson.displayTitle) ?? title;
  const accessibleDesc = asString(payloadJson.accessibleDescription);
  const readAloud = asRecord(payloadJson.readAloud);
  const aacSupport = asRecord(payloadJson.aacSupport);
  const media = asRecord(payloadJson.illustration ?? payloadJson.visualSupport);
  const scenes = Array.isArray(payloadJson.scenes)
    ? payloadJson.scenes.map((s) => asRecord(s)).filter((s): s is Record<string, unknown> => s !== null)
    : [];

  return (
    <div className="space-y-4">
      <Card tone="mint" padding="md">
        <CardContent className="mt-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge variant="info">{getContentTypeLabel(contentType, uiLocale)}</Badge>
            <span className="text-xs font-mono text-[var(--mimora-muted)]">
              Ngôn ngữ thẻ: {locale}
              {metadataJson?.ageBand ? ` · Độ tuổi: ${metadataJson.ageBand}` : ''}
            </span>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-[var(--mimora-text)]">{displayTitle}</h3>
            {summary && <p className="text-sm text-[var(--mimora-muted)] mt-1">{summary}</p>}
          </div>

          {/* Type-specific core message */}
          {contentType === 'emotion_card' && (
            <div className="rounded-[var(--mimora-radius-md)] bg-[var(--mimora-surface)] border border-[var(--mimora-border)] p-4 space-y-2 text-sm">
              <p>
                <strong>Cảm xúc:</strong> {asString(payloadJson.emotionLabel) ?? '—'}{' '}
                <span className="font-mono text-xs text-[var(--mimora-muted)]">
                  ({asString(payloadJson.emotionKey) ?? ''})
                </span>
              </p>
              <p>
                <strong>Lời dành cho trẻ:</strong> {asString(payloadJson.childText) ?? '—'}
              </p>
              {asString(payloadJson.supportiveBodyCue) && (
                <p className="text-[var(--mimora-muted)]">
                  <strong>Gợi ý cảm nhận cơ thể:</strong> {asString(payloadJson.supportiveBodyCue)}
                </p>
              )}
              {asStringArray(payloadJson.reflectionPrompts).length > 0 && (
                <div>
                  <strong>Câu hỏi gợi mở nhẹ nhàng:</strong>
                  <ul className="list-disc pl-5 mt-1 space-y-0.5 text-[var(--mimora-muted)]">
                    {asStringArray(payloadJson.reflectionPrompts).map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {contentType === 'situation_card' && (
            <div className="rounded-[var(--mimora-radius-md)] bg-[var(--mimora-surface)] border border-[var(--mimora-border)] p-4 space-y-2 text-sm">
              <p>
                <strong>Tình huống:</strong> {asString(payloadJson.situationText) ?? '—'}
              </p>
              <p className="text-[var(--mimora-muted)]">
                <strong>Bối cảnh:</strong> {asString(payloadJson.narrativeContext) ?? '—'}
              </p>
              {asStringArray(payloadJson.discussionPrompts).length > 0 && (
                <div>
                  <strong>Gợi ý trò chuyện:</strong>
                  <ul className="list-disc pl-5 mt-1 space-y-0.5 text-[var(--mimora-muted)]">
                    {asStringArray(payloadJson.discussionPrompts).map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {contentType === 'action_card' && (
            <div className="rounded-[var(--mimora-radius-md)] bg-[var(--mimora-surface)] border border-[var(--mimora-border)] p-4 space-y-2 text-sm">
              <p>
                <strong>Hành động / Chiến lược:</strong> {asString(payloadJson.actionPhrase) ?? '—'}
              </p>
              {asString(payloadJson.contextExplanation) && (
                <p className="text-[var(--mimora-muted)]">
                  <strong>Khi nào có thể dùng:</strong> {asString(payloadJson.contextExplanation)}
                </p>
              )}
              {asStringArray(payloadJson.possibleOutcomes).length > 0 && (
                <div>
                  <strong>Điều có thể xảy ra nhẹ nhàng:</strong>
                  <ul className="list-disc pl-5 mt-1 space-y-0.5 text-[var(--mimora-muted)]">
                    {asStringArray(payloadJson.possibleOutcomes).map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {contentType === 'communication_card' && (
            <div className="rounded-[var(--mimora-radius-md)] bg-[var(--mimora-surface)] border border-[var(--mimora-border)] p-4 space-y-2 text-sm">
              <p>
                <strong>Mục đích giao tiếp:</strong> {asString(payloadJson.communicationIntent) ?? '—'}
              </p>
              <p className="text-base font-medium text-[var(--mimora-primary)]">
                “{asString(payloadJson.phrase) ?? '—'}”
              </p>
            </div>
          )}

          {contentType === 'social_story_card' && (
            <div className="space-y-3">
              {asString(payloadJson.storyIntro) && (
                <p className="text-sm text-[var(--mimora-text)] bg-[var(--mimora-surface)] rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)] p-3">
                  <strong>Mở đầu:</strong> {asString(payloadJson.storyIntro)}
                </p>
              )}
              <div className="space-y-2">
                {scenes.map((sc, idx) => (
                  <div
                    key={idx}
                    className="rounded-[var(--mimora-radius-md)] bg-[var(--mimora-surface)] border border-[var(--mimora-border)] p-3.5 text-sm space-y-1"
                  >
                    <p className="text-xs font-semibold text-[var(--mimora-primary)] flex items-center gap-1.5">
                      <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                      Cảnh {typeof sc.sceneNumber === 'number' ? sc.sceneNumber : idx + 1}
                    </p>
                    <p className="text-[var(--mimora-text)]">{asString(sc.text) ?? '—'}</p>
                    {asString(sc.accessibleDescription) && (
                      <p className="text-xs text-[var(--mimora-muted)]">
                        Mô tả tiếp cận: {asString(sc.accessibleDescription)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              {asString(payloadJson.closingReflection) && (
                <p className="text-sm text-[var(--mimora-text)] bg-[var(--mimora-surface)] rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)] p-3">
                  <strong>Kết thúc nhẹ nhàng:</strong> {asString(payloadJson.closingReflection)}
                </p>
              )}
            </div>
          )}

          {/* Accessibility & Support blocks */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {accessibleDesc && (
              <div className="rounded-[var(--mimora-radius-sm)] bg-[var(--mimora-surface)] border border-[var(--mimora-border)] p-3">
                <p className="font-semibold text-[var(--mimora-text)] mb-1">Mô tả tiếp cận (Alt / Screen reader)</p>
                <p className="text-[var(--mimora-muted)]">{accessibleDesc}</p>
              </div>
            )}

            {readAloud && asString(readAloud.text) && (
              <div className="rounded-[var(--mimora-radius-sm)] bg-[var(--mimora-surface)] border border-[var(--mimora-border)] p-3">
                <p className="font-semibold text-[var(--mimora-text)] mb-1 flex items-center gap-1.5">
                  <Volume2 className="h-3.5 w-3.5 text-[var(--mimora-primary)]" aria-hidden="true" />
                  Đọc to ({asString(readAloud.speechRateHint) ?? 'normal'})
                </p>
                <p className="text-[var(--mimora-muted)]">{asString(readAloud.text)}</p>
              </div>
            )}

            {aacSupport && (asString(aacSupport.symbolLabel) || asStringArray(aacSupport.coreVocabulary).length > 0) && (
              <div className="rounded-[var(--mimora-radius-sm)] bg-[var(--mimora-surface)] border border-[var(--mimora-border)] p-3">
                <p className="font-semibold text-[var(--mimora-text)] mb-1 flex items-center gap-1.5">
                  <MessageSquare className="h-3.5 w-3.5 text-[var(--mimora-secondary)]" aria-hidden="true" />
                  Hỗ trợ giao tiếp AAC
                </p>
                {asString(aacSupport.symbolLabel) && (
                  <p className="text-[var(--mimora-muted)]">Biểu tượng: {asString(aacSupport.symbolLabel)}</p>
                )}
                {asStringArray(aacSupport.coreVocabulary).length > 0 && (
                  <p className="text-[var(--mimora-muted)]">
                    Từ vựng lõi: {asStringArray(aacSupport.coreVocabulary).join(', ')}
                  </p>
                )}
              </div>
            )}

            {media && asString(media.assetRef) && (
              <div className="rounded-[var(--mimora-radius-sm)] bg-[var(--mimora-surface)] border border-[var(--mimora-border)] p-3">
                <p className="font-semibold text-[var(--mimora-text)] mb-1">Tài nguyên hình ảnh</p>
                <p className="font-mono text-[var(--mimora-muted)] break-all">{asString(media.assetRef)}</p>
                {asString(media.altText) && (
                  <p className="text-[var(--mimora-muted)] mt-0.5">Alt: {asString(media.altText)}</p>
                )}
              </div>
            )}
          </div>

          {metadataJson?.selThemes && metadataJson.selThemes.length > 0 && (
            <p className="text-xs text-[var(--mimora-muted)]">
              Nhãn chủ đề SEL: <span className="font-mono">{metadataJson.selThemes.join(' · ')}</span>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
