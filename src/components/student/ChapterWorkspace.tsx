import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CloudCheck,
  CloudOff,
  Loader2,
  PauseCircle,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClientError } from '../../api/client.ts';
import { studentApi } from '../../api/student.ts';
import { resolveLocalizedErrorMessage, type AppLocale } from '../../i18n/index.ts';
import { PROPOSAL_V1_SESSIONS, type StepNumber } from '../../types/chapter.ts';
import type {
  PendingTurnDraft,
  SafeStudentAssignmentDetailView,
  SafeStudentAttemptView,
  StudentAccessibilityRuntime,
  TurnPersistenceStatus,
} from '../../types/student.ts';
import { stopSpeech } from '../../utils/speech.ts';
import {
  extractAacCoreVocabulary,
  extractPrimaryReadAloudText,
  formatTimeVi,
  parseEmotionCardPayload,
  parseSituationCardPayload,
  parseSocialStoryPayload,
  resolveItemChapterPlacement,
  sanitizeTurnPayloadObject,
  translateContentTypeChildLabelVi,
} from '../../utils/studentContent.ts';
import { Alert } from '../ui/Alert.tsx';
import { Button } from '../ui/Button.tsx';
import { Card } from '../ui/Card.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { LoadingState } from '../ui/States.tsx';
import { AacSupportBar } from './AacSupportBar.tsx';
import { BodyMapStep } from './steps/BodyMapStep.tsx';
import { CommunicationBoardStep } from './steps/CommunicationBoardStep.tsx';
import { FactVsGuessStep } from './steps/FactVsGuessStep.tsx';
import { IntensityScaleStep } from './steps/IntensityScaleStep.tsx';
import { SituationEmotionStep } from './steps/SituationEmotionStep.tsx';
import { SocialStoryViewer } from './steps/SocialStoryViewer.tsx';
import { StrategyDeckStep } from './steps/StrategyDeckStep.tsx';

export interface ChapterWorkspaceProps {
  assignment: SafeStudentAssignmentDetailView;
  initialItemIndex?: number;
  locale: AppLocale;
  accessibility: StudentAccessibilityRuntime;
  onBackToDetail: () => void;
  onAssignmentProgressMutated?: () => void;
}

export function ChapterWorkspace({
  assignment,
  initialItemIndex = 0,
  locale,
  accessibility,
  onBackToDetail,
  onAssignmentProgressMutated,
}: ChapterWorkspaceProps) {
  const items = assignment.items;
  const safeInitialIdx = Math.min(Math.max(initialItemIndex, 0), Math.max(items.length - 1, 0));
  const [activeItemIndex, setActiveItemIndex] = useState(safeInitialIdx);

  const activeItem = items[activeItemIndex] ?? null;
  const activePlacement = useMemo(
    () => (activeItem ? resolveItemChapterPlacement(activeItem) : null),
    [activeItem]
  );

  const [activeStepView, setActiveStepView] = useState<StepNumber>(
    activePlacement?.stepNumber ?? 1
  );

  const [attempt, setAttempt] = useState<SafeStudentAttemptView | null>(null);
  const [attemptLoading, setAttemptLoading] = useState(false);
  const [attemptError, setAttemptError] = useState<string | null>(null);
  const [retryPromptRequired, setRetryPromptRequired] = useState(false);

  const [saveStatus, setSaveStatus] = useState<TurnPersistenceStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<PendingTurnDraft | null>(null);
  const [lastSavedNotice, setLastSavedNotice] = useState<string | null>(null);

  const [pendingAacTapDelta, setPendingAacTapDelta] = useState(0);
  const [pendingReadAloudDelta, setPendingReadAloudDelta] = useState(0);

  const [abandonDialogOpen, setAbandonDialogOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [abandoning, setAbandoning] = useState(false);
  const [adultHelpToast, setAdultHelpToast] = useState<string | null>(null);

  const itemStartedAtRef = useRef<number>(Date.now());
  const attemptLoadSeqRef = useRef<number>(0);

  const computeElapsedSeconds = () =>
    Math.min(86400, Math.max(0, Math.round((Date.now() - itemStartedAtRef.current) / 1000)));

  const loadItemAttempt = useCallback(
    async (intent: 'start_or_resume' | 'retry') => {
      if (!activeItem) {
        return;
      }

      const reqSeq = ++attemptLoadSeqRef.current;

      if (assignment.isReadOnly) {
        setAttempt(null);
        setAttemptError(null);
        setRetryPromptRequired(false);
        setAttemptLoading(false);
        return;
      }

      setAttemptLoading(true);
      setAttemptError(null);
      setRetryPromptRequired(false);
      setPendingDraft(null);
      setSaveStatus('idle');
      setSaveError(null);
      setLastSavedNotice(null);

      try {
        const idemKey = `stu_${activeItem.assignmentItemId}_${intent}_${Date.now()}`;
        const res = await studentApi.startOrResumeAttempt(
          assignment.targetId,
          activeItem.assignmentItemId,
          {
            intent,
            expectedContentVersionId: activeItem.contentVersionId,
            idempotencyKey: idemKey.slice(0, 64),
          }
        );
        if (reqSeq !== attemptLoadSeqRef.current) {
          return;
        }
        itemStartedAtRef.current = Date.now();
        setAttempt(res.attempt);
        if (res.action === 'resumed') {
          setLastSavedNotice(
            `Đã khôi phục lượt thực hành trước đó (${res.attempt.turns.length} bước đã lưu).`
          );
        } else if (res.action === 'retried') {
          setLastSavedNotice(`Đã mở lượt thực hành mới (Lượt #${res.attempt.attemptNumber}).`);
          onAssignmentProgressMutated?.();
        } else {
          onAssignmentProgressMutated?.();
        }
      } catch (err) {
        if (reqSeq !== attemptLoadSeqRef.current) {
          return;
        }
        if (err instanceof ApiClientError && err.info.code === 'RETRY_INTENT_REQUIRED') {
          setAttempt(null);
          setRetryPromptRequired(true);
        } else if (err instanceof ApiClientError) {
          setAttemptError(resolveLocalizedErrorMessage(err.info, locale));
        } else {
          setAttemptError('Không thể mở lượt thực hành cho hoạt động này.');
        }
      } finally {
        if (reqSeq === attemptLoadSeqRef.current) {
          setAttemptLoading(false);
        }
      }
    },
    [activeItem, assignment.isReadOnly, assignment.targetId, locale, onAssignmentProgressMutated]
  );

  useEffect(() => {
    stopSpeech();
    if (!activeItem || !activePlacement) {
      return;
    }
    setActiveStepView(activePlacement.stepNumber);
    void loadItemAttempt('start_or_resume');
    // Note: Intentionally never call abandon on cleanup/unmount.
    return () => {
      stopSpeech();
    };
  }, [activeItem?.assignmentItemId, assignment.targetId]);

  const submitTurnDraft = async (draft: PendingTurnDraft) => {
    if (!attempt || attempt.state !== 'in_progress' || assignment.isReadOnly || saveStatus === 'saving') {
      return;
    }

    setPendingDraft(draft);
    setSaveStatus('saving');
    setSaveError(null);

    try {
      const res = await studentApi.saveTurn(attempt.attemptId, draft);
      setAttempt(res.attempt);
      setPendingDraft(null);
      setPendingAacTapDelta(0);
      setPendingReadAloudDelta(0);
      setSaveStatus('saved');
      setLastSavedNotice(
        `Đã lưu bước #${res.savedTurn.turnIndex + 1} (${formatTimeVi(res.savedTurn.respondedAt)}).`
      );
      onAssignmentProgressMutated?.();
    } catch (err) {
      setSaveStatus('error');
      if (err instanceof ApiClientError && err.info.code === 'TURN_INDEX_CONFLICT') {
        try {
          const fresh = await studentApi.getAttempt(attempt.attemptId);
          setAttempt(fresh.attempt);
          setPendingDraft(null);
          setSaveError(
            'Dữ liệu lượt thực hành vừa được đồng bộ lại từ máy chủ. Con hãy bấm lưu lại bước vừa chọn nhé.'
          );
          return;
        } catch {
          // Fall through to generic message
        }
      }
      if (err instanceof ApiClientError) {
        setSaveError(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setSaveError('Kết nối mạng gián đoạn — lựa chọn của con vẫn đang được giữ an toàn trên màn hình.');
      }
    }
  };

  const handleSaveStepInteraction = (input: {
    stepKey: string;
    selectedChoiceKey: string | null;
    selectedEmotionKey: string | null;
    usedAac?: boolean;
    usedReadAloud?: boolean;
    responsePayloadJson?: Record<string, unknown> | null;
  }) => {
    if (
      !attempt ||
      attempt.state !== 'in_progress' ||
      assignment.isReadOnly ||
      saveStatus === 'saving' ||
      completing ||
      abandoning
    ) {
      return;
    }

    const nextIndex = pendingDraft
      ? pendingDraft.turnIndex
      : attempt.resumePosition.nextTurnIndex;

    const draft: PendingTurnDraft = {
      turnIndex: nextIndex,
      stepKey: input.stepKey,
      selectedChoiceKey: input.selectedChoiceKey,
      selectedEmotionKey: input.selectedEmotionKey,
      usedAac: Boolean(input.usedAac) || pendingAacTapDelta > 0,
      usedReadAloud: Boolean(input.usedReadAloud) || pendingReadAloudDelta > 0,
      aacTapDelta: pendingAacTapDelta > 0 ? pendingAacTapDelta : input.usedAac ? 1 : 0,
      readAloudDelta:
        pendingReadAloudDelta > 0 ? pendingReadAloudDelta : input.usedReadAloud ? 1 : 0,
      durationSeconds: computeElapsedSeconds(),
      responsePayloadJson: sanitizeTurnPayloadObject(input.responsePayloadJson),
    };

    void submitTurnDraft(draft);
  };

  const handleCompleteAttempt = async () => {
    if (
      !attempt ||
      attempt.state !== 'in_progress' ||
      assignment.isReadOnly ||
      completing ||
      saveStatus === 'saving' ||
      abandoning
    ) {
      return;
    }
    setCompleting(true);
    setSaveError(null);
    try {
      const res = await studentApi.completeAttempt(attempt.attemptId, {
        durationSeconds: computeElapsedSeconds(),
        usedAacSupport: pendingAacTapDelta > 0,
        usedReadAloud: pendingReadAloudDelta > 0,
        aacTapDelta: pendingAacTapDelta,
        readAloudDelta: pendingReadAloudDelta,
      });
      setAttempt(res.attempt);
      setPendingAacTapDelta(0);
      setPendingReadAloudDelta(0);
      setLastSavedNotice('Hoạt động đã được ghi nhận hoàn thành nhẹ nhàng.');
      onAssignmentProgressMutated?.();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setSaveError(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setSaveError('Chưa thể gửi xác nhận hoàn thành. Con thử bấm lại nhé.');
      }
    } finally {
      setCompleting(false);
    }
  };

  const handleConfirmAbandon = async () => {
    if (!attempt || attempt.state !== 'in_progress' || assignment.isReadOnly) {
      setAbandonDialogOpen(false);
      return;
    }
    if (abandoning) {
      return;
    }
    setAbandoning(true);
    setSaveError(null);
    try {
      const res = await studentApi.abandonAttempt(attempt.attemptId, {
        confirmed: true,
        reason: 'paused_for_later',
        durationSeconds: computeElapsedSeconds(),
      });
      setAttempt(res.attempt);
      setAbandonDialogOpen(false);
      setLastSavedNotice('Đã tạm dừng hoạt động. Con có thể làm lại bất cứ lúc nào.');
      onAssignmentProgressMutated?.();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setSaveError(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setSaveError('Không thể tạm dừng lúc này. Con thử lại sau nhé.');
      }
    } finally {
      setAbandoning(false);
    }
  };

  if (!activeItem || !activePlacement) {
    return (
      <Alert
        variant="info"
        action={
          <Button type="button" variant="outline" size="sm" onClick={onBackToDetail}>
            Quay lại
          </Button>
        }
      >
        Bài tập này chưa có thẻ hoạt động nào để thực hành.
      </Alert>
    );
  }

  const companionActionItems = items.filter((i) => i.contentType === 'action_card');
  const companionCommItems = items.filter(
    (i) => i.contentType === 'communication_card' || i.contentType === 'action_card'
  );

  const isStageInteractive =
    !assignment.isReadOnly && attempt?.state === 'in_progress' && !retryPromptRequired;

  const isReadOnlyStage = !isStageInteractive;

  const readAloudText = extractPrimaryReadAloudText(activeItem);
  const aacWords = extractAacCoreVocabulary(activeItem);
  const stepInstanceKey = `${activeItem.assignmentItemId}:${attempt?.attemptId ?? 'readonly'}`;

  const lastSavedSceneTurn =
    attempt?.turns
      .slice()
      .reverse()
      .find((t) => t.stepKey.startsWith('story_scene_')) ?? null;

  return (
    <div className="space-y-6">
      {/* Top navigation & position strip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          size="md"
          onClick={onBackToDetail}
          leftIcon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
        >
          Về chi tiết bài tập
        </Button>

        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--mimora-muted)] min-w-0">
          <span className="font-semibold text-[var(--mimora-text)] break-words">{assignment.title}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">
            Hoạt động {activeItemIndex + 1} / {items.length}
          </span>
          {attempt && (
            <>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">Lượt #{attempt.attemptNumber}</span>
            </>
          )}
        </div>
      </div>

      {/* Pinned Activity Switcher */}
      {items.length > 1 && (
        <nav
          aria-label="Danh sách hoạt động trong bài tập"
          className="flex flex-wrap gap-2"
        >
          {items.map((item, idx) => {
            const active = idx === activeItemIndex;
            return (
              <button
                key={item.assignmentItemId}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => setActiveItemIndex(idx)}
                className={[
                  'min-h-[44px] max-w-full text-left break-words px-4 py-2 rounded-[var(--mimora-radius-md)] border text-sm font-medium cursor-pointer transition-colors',
                  active
                    ? 'bg-[var(--mimora-primary)] text-white border-transparent'
                    : 'bg-[var(--mimora-surface)] text-[var(--mimora-text)] border-[var(--mimora-border-strong)] hover:bg-[var(--mimora-surface-subtle)]',
                ].join(' ')}
              >
                {idx + 1}. {item.title}
              </button>
            );
          })}
        </nav>
      )}

      {/* Persistence & Attempt Status Bar */}
      <div className="rounded-[var(--mimora-radius-lg)] border border-[var(--mimora-border)] bg-[var(--mimora-surface)] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 text-sm">
          {saveStatus === 'saving' ? (
            <span className="inline-flex items-center gap-2 text-[var(--mimora-primary)] font-medium">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden="true" />
              <span>Đang lưu bước vừa chọn...</span>
            </span>
          ) : saveStatus === 'error' ? (
            <span className="inline-flex items-center gap-2 text-[var(--mimora-danger)] font-medium">
              <CloudOff className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Chưa lưu được — dữ liệu tạm giữ trên màn hình</span>
            </span>
          ) : assignment.isReadOnly ? (
            <span className="inline-flex items-center gap-2 text-[var(--mimora-muted)] font-medium">
              <span>Chế độ xem lại (Bài tập đã đóng)</span>
            </span>
          ) : attempt?.state === 'completed' ? (
            <span className="inline-flex items-center gap-2 text-[var(--mimora-success)] font-semibold">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Đã hoàn thành lượt #{attempt.attemptNumber}</span>
            </span>
          ) : attempt?.state === 'abandoned' ? (
            <span className="inline-flex items-center gap-2 text-[var(--mimora-muted)] font-medium">
              <PauseCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Lượt #{attempt.attemptNumber} đang tạm dừng</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 text-[var(--mimora-primary)] font-medium">
              <CloudCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                {lastSavedNotice ??
                  `Sẵn sàng · Đã lưu ${attempt?.turns.length ?? 0} bước`}
              </span>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {saveStatus === 'error' && pendingDraft && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => void submitTurnDraft(pendingDraft)}
              leftIcon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
            >
              Thử lưu lại
            </Button>
          )}

          {!assignment.isReadOnly && attempt?.state === 'in_progress' && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAbandonDialogOpen(true)}
                leftIcon={<PauseCircle className="h-4 w-4" aria-hidden="true" />}
              >
                Tạm dừng để lúc khác
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                loading={completing}
                onClick={() => void handleCompleteAttempt()}
                leftIcon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
              >
                Hoàn thành hoạt động
              </Button>
            </>
          )}
        </div>
      </div>

      {saveError && (
        <Alert
          variant="danger"
          title="Chưa thể lưu thay đổi lên máy chủ"
          action={
            pendingDraft ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void submitTurnDraft(pendingDraft)}
              >
                Thử lưu lại ngay
              </Button>
            ) : undefined
          }
        >
          {saveError}
        </Alert>
      )}

      {adultHelpToast && (
        <Alert variant="info" title="Đã ghi nhận yêu cầu hỗ trợ">
          {adultHelpToast}
        </Alert>
      )}

      {attemptLoading ? (
        <LoadingState label="Đang chuẩn bị không gian hoạt động của con..." />
      ) : attemptError ? (
        <Alert
          variant="danger"
          title="Chưa mở được hoạt động"
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadItemAttempt('start_or_resume')}
            >
              Thử mở lại
            </Button>
          }
        >
          {attemptError}
        </Alert>
      ) : (
        <>
          {retryPromptRequired && (
            <Card tone="butter" padding="md" className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1 max-w-2xl">
                <p className="text-base font-semibold text-[var(--mimora-text)]">
                  Hoạt động này đã có lượt thực hành trước đó
                </p>
                <p className="text-sm text-[var(--mimora-muted)] leading-relaxed">
                  Con có thể xem lại thẻ nội dung ở chế độ đọc bên dưới, hoặc bắt đầu một lượt
                  thực hành mới tinh mà không mất lịch sử cũ.
                </p>
              </div>
              <Button
                type="button"
                variant="primary"
                size="student"
                onClick={() => void loadItemAttempt('retry')}
                leftIcon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
              >
                Thực hành lại từ đầu
              </Button>
            </Card>
          )}

          {attempt?.state === 'completed' && (
            <Card tone="mint" padding="md" className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1 max-w-2xl">
                <p className="text-base font-semibold text-[var(--mimora-success)]">
                  Con đã hoàn thành hoạt động “{activeItem.title}”!
                </p>
                <p className="text-sm text-[var(--mimora-text)] leading-relaxed">
                  Cảm ơn con đã lắng nghe cảm xúc của mình theo đúng nhịp độ riêng. Con có thể
                  chuyển sang hoạt động tiếp theo hoặc thử lại thêm một lượt mới.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {attempt.availableActions.canRetry && (
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={() => void loadItemAttempt('retry')}
                    leftIcon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
                  >
                    Thực hành lại
                  </Button>
                )}
                {activeItemIndex < items.length - 1 && (
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    onClick={() => setActiveItemIndex((i) => i + 1)}
                    rightIcon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
                  >
                    Hoạt động tiếp theo
                  </Button>
                )}
              </div>
            </Card>
          )}

          {attempt?.state === 'abandoned' && (
            <Card tone="subtle" padding="md" className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <p className="text-base font-semibold text-[var(--mimora-text)]">
                  Lượt thực hành đang tạm dừng — hoàn toàn không sao cả
                </p>
                <p className="text-sm text-[var(--mimora-muted)]">
                  Khi nào con thấy thoải mái, con có thể bắt đầu một lượt mới bất cứ lúc nào.
                </p>
              </div>
              {attempt.availableActions.canRetry && (
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={() => void loadItemAttempt('retry')}
                  leftIcon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
                >
                  Bắt đầu lượt mới
                </Button>
              )}
            </Card>
          )}

          {/* 3-Session · 6-Step Workspace Stage Navigator */}
          <Card tone="default" padding="md" className="space-y-4">
            <div className="space-y-1">
              <p className="text-xs font-medium text-[var(--mimora-muted)]">
                Thẻ bài tập: {activeItem.title} · {translateContentTypeChildLabelVi(activeItem.contentType)}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                {PROPOSAL_V1_SESSIONS.map((session) => (
                  <div
                    key={session.sessionNumber}
                    className="rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)] bg-[var(--mimora-surface-subtle)]/50 p-2.5 space-y-2"
                  >
                    <p className="text-xs font-semibold text-[var(--mimora-muted)] px-1">
                      {session.titleVi}
                    </p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {session.steps.map((step) => {
                        const isSelected = activeStepView === step.stepNumber;
                        const isPrimaryForItem = activePlacement.stepNumber === step.stepNumber;
                        return (
                          <button
                            key={step.stepNumber}
                            type="button"
                            onClick={() => setActiveStepView(step.stepNumber)}
                            aria-current={isSelected ? 'step' : undefined}
                            className={[
                              'min-h-[40px] px-2.5 py-1.5 rounded-[var(--mimora-radius-sm)] border text-xs font-medium cursor-pointer text-left transition-colors',
                              isSelected
                                ? 'bg-[var(--mimora-primary)] text-white border-transparent'
                                : isPrimaryForItem
                                  ? 'bg-[var(--mimora-surface-mint)] text-[var(--mimora-primary)] border-[#c3dfd8]'
                                  : 'bg-[var(--mimora-surface)] text-[var(--mimora-text)] border-[var(--mimora-border)] hover:bg-[var(--mimora-surface-subtle)]',
                            ].join(' ')}
                          >
                            Bước {step.stepNumber}
                            {isPrimaryForItem ? ' · Chính' : ''}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Step Interactive Canvas */}
            <div className="pt-4 border-t border-[var(--mimora-border)] space-y-6">
              {activeStepView === 1 && activeItem.contentType === 'social_story_card' && (
                <div className="space-y-6">
                  {(() => {
                    const story = parseSocialStoryPayload(activeItem.payloadJson, activeItem.title);
                    return (
                      <>
                        <SocialStoryViewer
                          key={`story-${stepInstanceKey}`}
                          payload={story}
                          locale={activeItem.locale}
                          speechRate={accessibility.speechRate}
                          readAloudEnabled={accessibility.readAloudEnabled}
                          readOnly={isReadOnlyStage}
                          saving={saveStatus === 'saving'}
                          savedSceneKey={lastSavedSceneTurn?.selectedChoiceKey ?? null}
                          onUsedReadAloud={() => setPendingReadAloudDelta((d) => d + 1)}
                          onPauseStory={() => {
                            if (!assignment.isReadOnly && attempt?.state === 'in_progress') {
                              setAbandonDialogOpen(true);
                            } else {
                              onBackToDetail();
                            }
                          }}
                          onSaveSceneProgress={(sceneNumber, isFinalScene) =>
                            handleSaveStepInteraction({
                              stepKey: `story_scene_${sceneNumber}`,
                              selectedChoiceKey: `scene_${sceneNumber}`,
                              selectedEmotionKey: null,
                              responsePayloadJson: {
                                step: 1,
                                sceneNumber,
                                totalScenes: story.scenes.length,
                                isFinalScene,
                              },
                            })
                          }
                        />
                        <SituationEmotionStep
                          key={`story-followup-${stepInstanceKey}`}
                          mode="story_followup"
                          storyClosingPrompt={
                            story.closingReflection ??
                            'Sau khi xem câu chuyện, nhân vật hoặc con có thể đang cảm thấy điều gì?'
                          }
                          readOnly={isReadOnlyStage}
                          saving={saveStatus === 'saving'}
                          onSaveResponse={handleSaveStepInteraction}
                          onRequestHelp={() =>
                            setAdultHelpToast('Con đã chọn nhờ thầy cô hỗ trợ ở Bước 1.')
                          }
                        />
                      </>
                    );
                  })()}
                </div>
              )}

              {activeStepView === 1 && activeItem.contentType === 'situation_card' && (
                <SituationEmotionStep
                  key={`situation-${stepInstanceKey}`}
                  mode="situation_card"
                  situationPayload={parseSituationCardPayload(
                    activeItem.payloadJson,
                    activeItem.title
                  )}
                  readOnly={isReadOnlyStage}
                  saving={saveStatus === 'saving'}
                  onSaveResponse={handleSaveStepInteraction}
                  onRequestHelp={() =>
                    setAdultHelpToast('Con đã chọn nhờ thầy cô hỗ trợ ở Bước 1.')
                  }
                />
              )}

              {activeStepView === 1 && activeItem.contentType === 'emotion_card' && (
                <SituationEmotionStep
                  key={`emotion-${stepInstanceKey}`}
                  mode="emotion_card"
                  emotionPayload={parseEmotionCardPayload(activeItem.payloadJson, activeItem.title)}
                  readOnly={isReadOnlyStage}
                  saving={saveStatus === 'saving'}
                  onSaveResponse={handleSaveStepInteraction}
                  onRequestHelp={() =>
                    setAdultHelpToast('Con đã chọn nhờ thầy cô hỗ trợ ở Bước 1.')
                  }
                />
              )}

              {activeStepView === 1 &&
                activeItem.contentType !== 'social_story_card' &&
                activeItem.contentType !== 'situation_card' &&
                activeItem.contentType !== 'emotion_card' && (
                  <SituationEmotionStep
                    key={`generic-${stepInstanceKey}`}
                    mode="story_followup"
                    storyClosingPrompt={`Khám phá cảm xúc liên quan đến thẻ “${activeItem.title}”.`}
                    readOnly={isReadOnlyStage}
                    saving={saveStatus === 'saving'}
                    onSaveResponse={handleSaveStepInteraction}
                    onRequestHelp={() =>
                      setAdultHelpToast('Con đã chọn nhờ thầy cô hỗ trợ ở Bước 1.')
                    }
                  />
                )}

              {activeStepView === 2 && (
                <BodyMapStep
                  key={`bodymap-${stepInstanceKey}`}
                  readOnly={isReadOnlyStage}
                  saving={saveStatus === 'saving'}
                  onSaveBodyMap={handleSaveStepInteraction}
                />
              )}

              {activeStepView === 3 && (
                <IntensityScaleStep
                  key={`intensity-${stepInstanceKey}`}
                  readOnly={isReadOnlyStage}
                  saving={saveStatus === 'saving'}
                  onSaveIntensity={handleSaveStepInteraction}
                />
              )}

              {activeStepView === 4 && (
                <StrategyDeckStep
                  key={`strategy-${stepInstanceKey}`}
                  primaryItem={activeItem}
                  companionStrategyItems={companionActionItems}
                  speechRate={accessibility.speechRate}
                  readAloudEnabled={accessibility.readAloudEnabled}
                  readOnly={isReadOnlyStage}
                  saving={saveStatus === 'saving'}
                  onSaveStrategy={handleSaveStepInteraction}
                  onRequestHelp={() =>
                    setAdultHelpToast('Con đã chọn nhờ người lớn hỗ trợ ở Bước 4.')
                  }
                />
              )}

              {activeStepView === 5 && (
                <FactVsGuessStep
                  key={`factguess-${stepInstanceKey}`}
                  title={activeItem.title}
                  situationPayload={
                    activeItem.contentType === 'situation_card'
                      ? parseSituationCardPayload(activeItem.payloadJson, activeItem.title)
                      : undefined
                  }
                  locale={activeItem.locale}
                  speechRate={accessibility.speechRate}
                  readAloudEnabled={accessibility.readAloudEnabled}
                  readOnly={isReadOnlyStage}
                  saving={saveStatus === 'saving'}
                  onSaveFactVsGuess={handleSaveStepInteraction}
                />
              )}

              {activeStepView === 6 && (
                <CommunicationBoardStep
                  key={`comm-${stepInstanceKey}`}
                  primaryItem={activeItem}
                  companionItems={companionCommItems}
                  speechRate={accessibility.speechRate}
                  readAloudEnabled={accessibility.readAloudEnabled}
                  readOnly={isReadOnlyStage}
                  saving={saveStatus === 'saving'}
                  onSaveCommunicationChoice={handleSaveStepInteraction}
                  onRequestHelp={() =>
                    setAdultHelpToast('Con đã chọn nhờ thầy cô hỗ trợ qua Bảng giao tiếp AAC.')
                  }
                />
              )}
            </div>
          </Card>

          {/* User-initiated AAC & Read-Aloud Support Bar */}
          <AacSupportBar
            key={`aac-${stepInstanceKey}`}
            readAloudText={readAloudText}
            aacWords={aacWords}
            locale={activeItem.locale}
            speechRate={accessibility.speechRate}
            aacEnabled={accessibility.aacEnabled}
            readAloudEnabled={accessibility.readAloudEnabled}
            onUsedReadAloud={() => setPendingReadAloudDelta((d) => d + 1)}
            onUsedAac={() => setPendingAacTapDelta((d) => d + 1)}
            onRequestAdultHelp={(reason) => {
              setAdultHelpToast(`Thẻ nhờ trợ giúp đã sẵn sàng cho thầy cô xem: “${reason}”`);
            }}
          />

          {/* Honest in-session saved turns view (no fabricated cross-session diary) */}
          {attempt && (
            <Card tone="subtle" padding="md" className="space-y-3">
              <div className="space-y-0.5">
                <h3 className="text-sm font-semibold text-[var(--mimora-text)]">
                  Những bước con đã lưu trong lượt thực hành #{attempt.attemptNumber}
                </h3>
                <p className="text-xs text-[var(--mimora-muted)] leading-relaxed">
                  Chỉ hiển thị các bước đã được máy chủ xác nhận lưu cho lượt đang mở này. Nhật ký
                  tổng hợp nhiều buổi học qua các ngày sẽ cần mô hình dữ liệu Nhật ký Chương riêng ở
                  giai đoạn sau.
                </p>
              </div>
              {attempt.turns.length === 0 ? (
                <p className="text-xs text-[var(--mimora-muted)]">
                  Chưa có bước nào được lưu trong lượt này.
                </p>
              ) : (
                <ul className="space-y-1.5 text-xs text-[var(--mimora-text)]">
                  {attempt.turns.map((turn) => (
                    <li
                      key={turn.id}
                      className="flex flex-wrap items-center gap-2 rounded-[var(--mimora-radius-sm)] bg-[var(--mimora-surface)] border border-[var(--mimora-border)] px-3 py-2"
                    >
                      <span className="font-semibold tabular-nums">Bước #{turn.turnIndex + 1}</span>
                      <span aria-hidden="true">·</span>
                      <span>{turn.stepKey}</span>
                      {turn.selectedChoiceKey && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Lựa chọn: {turn.selectedChoiceKey}</span>
                        </>
                      )}
                      {turn.selectedEmotionKey && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Cảm xúc: {turn.selectedEmotionKey}</span>
                        </>
                      )}
                      <span className="ml-auto text-[var(--mimora-muted)] tabular-nums">
                        {formatTimeVi(turn.respondedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </>
      )}

      {/* Gentle Abandon Confirmation Dialog (never auto-triggered) */}
      <Dialog
        open={abandonDialogOpen}
        onClose={() => setAbandonDialogOpen(false)}
        title="Con muốn tạm dừng hoạt động này?"
        description="Không có bất kỳ điểm trừ hay hình phạt nào khi tạm dừng. Các bước con vừa lưu trước đó vẫn được giữ nguyên."
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => setAbandonDialogOpen(false)}
            >
              Tiếp tục làm tiếp
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              loading={abandoning}
              onClick={() => void handleConfirmAbandon()}
            >
              Xác nhận tạm dừng
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--mimora-text)] leading-relaxed">
          Nếu con chỉ muốn quay lại Trang chính hoặc đóng trình duyệt mà chưa cần kết thúc lượt này,
          con có thể bấm <strong>“Tiếp tục làm tiếp”</strong> và thoát ra bình thường — lần sau quay
          lại con vẫn tiếp tục được ngay!
        </p>
      </Dialog>
    </div>
  );
}
