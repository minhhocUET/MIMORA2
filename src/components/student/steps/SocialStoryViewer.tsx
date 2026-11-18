import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Eye,
  PauseCircle,
  Volume2,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../ui/Button.tsx';
import { Alert } from '../../ui/Alert.tsx';
import { Card } from '../../ui/Card.tsx';
import { StoryBookIllustration } from '../../illustrations/SelIllustrations.tsx';
import type { ParsedSocialStoryCardPayload } from '../../../types/student.ts';
import { isSafeRenderableImageSrc } from '../../../utils/studentContent.ts';
import { isSpeechSupported, speakText, stopSpeech } from '../../../utils/speech.ts';

export interface SocialStoryViewerProps {
  payload: ParsedSocialStoryCardPayload;
  locale?: string;
  speechRate?: 'slow' | 'normal';
  readAloudEnabled?: boolean;
  readOnly?: boolean;
  savedSceneKey?: string | null;
  saving?: boolean;
  onSaveSceneProgress?: (sceneNumber: number, isFinalScene: boolean) => void;
  onUsedReadAloud?: () => void;
  onPauseStory?: () => void;
}

export function SocialStoryViewer({
  payload,
  locale = 'vi-VN',
  speechRate = 'normal',
  readAloudEnabled = true,
  readOnly = false,
  savedSceneKey,
  saving = false,
  onSaveSceneProgress,
  onUsedReadAloud,
  onPauseStory,
}: SocialStoryViewerProps) {
  const scenes = payload.scenes;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAccessibleDesc, setShowAccessibleDesc] = useState(true);
  const [failedImageKeys, setFailedImageKeys] = useState<Record<number, boolean>>({});
  const [speakingScene, setSpeakingScene] = useState(false);

  if (scenes.length === 0) {
    return (
      <Alert variant="warning" title="Chưa có cảnh câu chuyện nào trong thẻ này">
        Thẻ câu chuyện xã hội này hiện chưa có dữ liệu cảnh minh họa từ thư viện nội dung. Con có thể
        nhờ thầy cô kiểm tra lại hoặc chuyển sang hoạt động tiếp theo.
      </Alert>
    );
  }

  const safeIndex = Math.min(Math.max(currentIndex, 0), scenes.length - 1);
  const activeScene = scenes[safeIndex];
  const isFirst = safeIndex === 0;
  const isLast = safeIndex === scenes.length - 1;
  const hasFiveScenes = scenes.length === 5;
  const hasRenderableImg =
    isSafeRenderableImageSrc(activeScene.illustration?.assetRef) &&
    !failedImageKeys[activeScene.sceneNumber];

  const handleGoScene = (nextIdx: number) => {
    stopSpeech();
    setSpeakingScene(false);
    setCurrentIndex(nextIdx);
  };

  const handleSpeakScene = () => {
    if (speakingScene) {
      stopSpeech();
      setSpeakingScene(false);
      return;
    }
    const textToSpeak =
      activeScene.readAloud?.text ??
      `${activeScene.text}. ${activeScene.accessibleDescription}`;
    onUsedReadAloud?.();
    if (!isSpeechSupported()) {
      return;
    }
    speakText(textToSpeak, {
      locale,
      speechRate: activeScene.readAloud?.speechRateHint ?? speechRate,
      onStart: () => setSpeakingScene(true),
      onEnd: () => setSpeakingScene(false),
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-medium text-[var(--mimora-secondary)] flex items-center gap-1.5">
            <BookOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Trình xem Câu chuyện Xã hội · Cảnh {safeIndex + 1} / {scenes.length}
            </span>
          </p>
          <h3 className="text-xl font-semibold text-[var(--mimora-text)]">
            {payload.displayTitle}
          </h3>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowAccessibleDesc((v) => !v)}
            leftIcon={<Eye className="h-4 w-4" aria-hidden="true" />}
          >
            {showAccessibleDesc ? 'Ẩn mô tả ảnh' : 'Hiện mô tả ảnh'}
          </Button>
          {onPauseStory && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                stopSpeech();
                onPauseStory();
              }}
              leftIcon={<PauseCircle className="h-4 w-4" aria-hidden="true" />}
            >
              Tạm dừng đọc truyện
            </Button>
          )}
        </div>
      </div>

      {!hasFiveScenes && (
        <Alert variant="info">
          Câu chuyện này có {scenes.length} cảnh (khác định dạng 5 cảnh tiêu chuẩn). Toàn bộ các cảnh
          hiện có vẫn hiển thị đầy đủ theo đúng thứ tự.
        </Alert>
      )}

      {payload.storyIntro && safeIndex === 0 && (
        <div className="rounded-[var(--mimora-radius-md)] bg-[var(--mimora-surface-lavender)] border border-[#d3cbe9] px-4 py-3 text-sm text-[var(--mimora-text)] leading-relaxed">
          <span className="font-semibold">Mở đầu câu chuyện: </span>
          {payload.storyIntro}
        </div>
      )}

      {/* Sequential scene navigator (1..N, zero autoplay) */}
      <nav aria-label="Các cảnh trong câu chuyện" className="flex flex-wrap gap-2">
        {scenes.map((scene, idx) => {
          const active = idx === safeIndex;
          return (
            <button
              key={scene.sceneNumber}
              type="button"
              onClick={() => handleGoScene(idx)}
              aria-current={active ? 'step' : undefined}
              className={[
                'min-h-[42px] px-4 py-2 rounded-[var(--mimora-radius-md)] border text-sm font-semibold cursor-pointer whitespace-nowrap shrink-0',
                'transition-colors duration-150',
                active
                  ? 'bg-[var(--mimora-secondary)] text-white border-transparent'
                  : 'bg-[var(--mimora-surface)] text-[var(--mimora-text)] border-[var(--mimora-border-strong)] hover:bg-[var(--mimora-surface-lavender)]',
              ].join(' ')}
            >
              Cảnh {scene.sceneNumber}
            </button>
          );
        })}
      </nav>

      {/* Main scene stage */}
      <Card tone="default" padding="lg" className="space-y-5">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          <div className="lg:col-span-5">
            {hasRenderableImg && activeScene.illustration ? (
              <div className="overflow-hidden rounded-[var(--mimora-radius-lg)] border border-[var(--mimora-border)] bg-[var(--mimora-surface-subtle)] aspect-[4/3] flex items-center justify-center">
                <img
                  src={activeScene.illustration.assetRef}
                  alt={activeScene.illustration.altText}
                  referrerPolicy="no-referrer"
                  onError={() =>
                    setFailedImageKeys((prev) => ({
                      ...prev,
                      [activeScene.sceneNumber]: true,
                    }))
                  }
                  className="w-full h-full object-cover"
                />
              </div>
            ) : (
              <div className="rounded-[var(--mimora-radius-lg)] border border-[var(--mimora-border)] bg-[var(--mimora-surface-lavender)] p-6 aspect-[4/3] flex flex-col items-center justify-center text-center gap-3">
                <StoryBookIllustration />
                <p className="text-xs font-medium text-[var(--mimora-secondary)]">
                  Cảnh {activeScene.sceneNumber} / {scenes.length}
                </p>
                <p className="text-xs text-[var(--mimora-muted)] leading-relaxed max-w-xs">
                  {activeScene.illustration?.altText ?? activeScene.accessibleDescription}
                </p>
              </div>
            )}
          </div>

          <div className="lg:col-span-7 space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-medium text-[var(--mimora-muted)] tabular-nums">
                Cảnh {activeScene.sceneNumber} trên {scenes.length} · Tự chuyển cảnh theo nhịp của con
              </p>
              <p className="text-lg sm:text-xl font-medium text-[var(--mimora-text)] leading-relaxed">
                {activeScene.text}
              </p>
            </div>

            {showAccessibleDesc && (
              <div className="rounded-[var(--mimora-radius-md)] bg-[var(--mimora-surface-subtle)] border border-[var(--mimora-border)] p-3.5 text-sm text-[var(--mimora-muted)] leading-relaxed">
                <span className="font-semibold text-[var(--mimora-text)]">Mô tả khung cảnh: </span>
                {activeScene.illustration?.visualDescription ?? activeScene.accessibleDescription}
              </div>
            )}

            {readAloudEnabled && (
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button
                  type="button"
                  variant={speakingScene ? 'secondary' : 'outline'}
                  size="md"
                  onClick={handleSpeakScene}
                  leftIcon={<Volume2 className="h-4 w-4" aria-hidden="true" />}
                >
                  {speakingScene ? 'Dừng đọc cảnh này' : `Đọc to Cảnh ${activeScene.sceneNumber}`}
                </Button>
              </div>
            )}

            {isLast && payload.closingReflection && (
              <div className="rounded-[var(--mimora-radius-md)] bg-[var(--mimora-surface-mint)] border border-[#c3dfd8] p-4 text-sm text-[var(--mimora-text)] leading-relaxed">
                <p className="font-semibold text-[var(--mimora-primary)] mb-1">
                  Suy ngẫm nhẹ nhàng sau câu chuyện
                </p>
                <p>{payload.closingReflection}</p>
              </div>
            )}
          </div>
        </div>

        <div className="pt-4 border-t border-[var(--mimora-border)] flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            size="student"
            disabled={isFirst}
            onClick={() => handleGoScene(safeIndex - 1)}
            leftIcon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
          >
            Cảnh trước
          </Button>

          <div className="flex flex-wrap items-center gap-3">
            {!readOnly && onSaveSceneProgress && (
              <Button
                type="button"
                variant="secondary"
                size="student"
                loading={saving}
                onClick={() => onSaveSceneProgress(activeScene.sceneNumber, isLast)}
                leftIcon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
              >
                {savedSceneKey === `scene_${activeScene.sceneNumber}`
                  ? `Đã ghi nhận Cảnh ${activeScene.sceneNumber}`
                  : `Ghi nhận đã xem Cảnh ${activeScene.sceneNumber}`}
              </Button>
            )}

            {!isLast && (
              <Button
                type="button"
                variant="primary"
                size="student"
                onClick={() => handleGoScene(safeIndex + 1)}
                rightIcon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
              >
                Cảnh tiếp theo
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
