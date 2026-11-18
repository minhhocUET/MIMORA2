import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Calendar,
  Compass,
  Play,
  Printer,
} from 'lucide-react';
import { useState } from 'react';
import { Alert } from '../ui/Alert.tsx';
import { Button } from '../ui/Button.tsx';
import { Card, CardContent, CardHeader } from '../ui/Card.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { PageHeader } from '../ui/Navigation.tsx';
import { LoadingState } from '../ui/States.tsx';
import { PROPOSAL_V1_SESSIONS } from '../../types/chapter.ts';
import type { SafeStudentAssignmentDetailView } from '../../types/student.ts';
import {
  formatDueDateVi,
  resolveItemChapterPlacement,
  translateContentTypeChildLabelVi,
  translateStudentProgressStatusVi,
} from '../../utils/studentContent.ts';

export interface StudentAssignmentDetailPageProps {
  assignment: SafeStudentAssignmentDetailView | null;
  loading: boolean;
  error: string | null;
  onRetryLoad: () => void;
  onBackHome: () => void;
  onStartWorkspace: (startItemIndex?: number) => void;
}

export function StudentAssignmentDetailPage({
  assignment,
  loading,
  error,
  onRetryLoad,
  onBackHome,
  onStartWorkspace,
}: StudentAssignmentDetailPageProps) {
  const [guideOpen, setGuideOpen] = useState(false);

  if (loading) {
    return <LoadingState label="Đang mở chi tiết bài tập..." />;
  }

  if (error || !assignment) {
    return (
      <div className="space-y-4">
        <Button
          type="button"
          variant="outline"
          size="md"
          onClick={onBackHome}
          leftIcon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
        >
          Quay lại Trang chính
        </Button>
        <Alert
          variant="danger"
          title="Không thể mở chi tiết bài tập"
          action={
            <Button type="button" variant="outline" size="sm" onClick={onRetryLoad}>
              Thử lại
            </Button>
          }
        >
          {error ?? 'Không tìm thấy bài tập được giao cho tài khoản của con.'}
        </Alert>
      </div>
    );
  }

  const placements = assignment.items.map(resolveItemChapterPlacement);
  const statusLabel = translateStudentProgressStatusVi(assignment.progress.status);
  const printable = assignment.homePractice.printableGuide;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mimora-no-print">
        <Button
          type="button"
          variant="outline"
          size="md"
          onClick={onBackHome}
          leftIcon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
        >
          Quay lại Trang chính
        </Button>

        {assignment.homePractice.hasInstructions && (
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => setGuideOpen(true)}
            leftIcon={<Printer className="h-4 w-4" aria-hidden="true" />}
          >
            Xem / In hướng dẫn tại nhà
          </Button>
        )}
      </div>

      <PageHeader
        metadataLine={`${assignment.className} · ${
          assignment.isReadOnly ? 'Đã đóng (Chỉ xem lại)' : statusLabel
        } · ${assignment.progress.completedItems}/${assignment.progress.totalItems || assignment.items.length} hoạt động`}
        title={assignment.title}
        description={
          assignment.isReadOnly
            ? 'Bài tập này đã kết thúc thời gian làm bài. Con vẫn có thể xem lại toàn bộ thẻ nội dung và nghe đọc to thoải mái.'
            : 'Con có thể bắt đầu từ hoạt động đầu tiên hoặc tiếp tục từ nơi con đã dừng lại. Mọi bước đã lưu đều an toàn.'
        }
        action={
          assignment.items.length > 0 ? (
            <Button
              type="button"
              variant="primary"
              size="student"
              onClick={() => onStartWorkspace(0)}
              leftIcon={<Play className="h-4 w-4" aria-hidden="true" />}
            >
              {assignment.isReadOnly
                ? 'Xem lại các hoạt động'
                : assignment.progress.status === 'in_progress'
                  ? 'Tiếp tục không gian học'
                  : 'Vào không gian học tập'}
            </Button>
          ) : undefined
        }
      />

      {/* Informational date & Home Practice instructions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <Card tone="mint" padding="md" className="lg:col-span-5 space-y-2">
          <p className="text-xs font-semibold text-[var(--mimora-primary)] flex items-center gap-1.5">
            <Calendar className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Thông tin nhẹ nhàng</span>
          </p>
          <p className="text-sm text-[var(--mimora-text)]">
            <span className="font-semibold">Ngày gợi ý hoàn thành: </span>
            {formatDueDateVi(assignment.dueAt)}
          </p>
          <p className="text-xs text-[var(--mimora-muted)] leading-relaxed">
            {assignment.isPastDue
              ? 'Đã qua ngày gợi ý nhưng hoàn toàn không có điểm phạt. Con cứ làm khi thấy sẵn sàng nhé.'
              : 'Ngày gợi ý chỉ để thầy cô và gia đình sắp xếp thời gian thuận tiện, không giới hạn giờ làm.'}
          </p>
        </Card>

        <Card tone="butter" padding="md" className="lg:col-span-7 space-y-2">
          <p className="text-xs font-semibold text-[var(--mimora-warning)] flex items-center gap-1.5">
            <BookOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Hướng dẫn thực hành tại nhà (từ thầy cô)</span>
          </p>
          {assignment.homePractice.hasInstructions ? (
            <p className="text-sm text-[var(--mimora-text)] leading-relaxed whitespace-pre-line">
              {assignment.homePractice.instructions}
            </p>
          ) : (
            <p className="text-sm text-[var(--mimora-muted)]">
              Thầy cô chưa thêm ghi chú riêng cho phần thực hành tại nhà. Con cứ thực hành trực tiếp
              trên từng thẻ bên dưới nhé.
            </p>
          )}
        </Card>
      </div>

      {/* 3-Session · 6-Step Overview with actual pinned items */}
      <Card tone="default" padding="lg" className="space-y-4">
        <CardHeader
          title="Các hoạt động đã gắn trong bài tập (3 Buổi · 6 Bước)"
          description="Mỗi thẻ đều gắn phiên bản nội dung đã duyệt từ thầy cô. Chạm vào bất kỳ hoạt động nào để mở."
        />
        <CardContent className="space-y-4">
          {placements.length === 0 ? (
            <Alert variant="info">
              Bài tập này hiện chưa có thẻ hoạt động nào được gắn. Con hãy báo thầy cô kiểm tra lại nhé.
            </Alert>
          ) : (
            <div className="space-y-3">
              {placements.map((placed, idx) => {
                const sessionInfo = PROPOSAL_V1_SESSIONS.find(
                  (s) => s.sessionNumber === placed.sessionNumber
                );
                return (
                  <div
                    key={placed.item.assignmentItemId}
                    className="rounded-[var(--mimora-radius-lg)] border border-[var(--mimora-border)] bg-[var(--mimora-surface-subtle)]/60 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="space-y-1 min-w-0">
                      <p className="text-xs font-medium text-[var(--mimora-primary)] flex flex-wrap items-center gap-1.5">
                        <Compass className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>
                          Hoạt động {idx + 1} · {translateContentTypeChildLabelVi(placed.item.contentType)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          Buổi {placed.sessionNumber} · Bước {placed.stepNumber}
                          {sessionInfo ? ` (${sessionInfo.titleVi.replace(/^Buổi \d+: /, '')})` : ''}
                        </span>
                      </p>
                      <h3 className="text-base font-semibold text-[var(--mimora-text)] break-words">
                        {placed.item.title}
                      </h3>
                      {placed.item.summary && (
                        <p className="text-sm text-[var(--mimora-muted)] leading-relaxed break-words">
                          {placed.item.summary}
                        </p>
                      )}
                    </div>

                    <Button
                      type="button"
                      variant="primary"
                      size="md"
                      onClick={() => onStartWorkspace(idx)}
                      rightIcon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
                    >
                      {assignment.isReadOnly ? 'Xem thẻ này' : 'Mở hoạt động này'}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Printable Home Practice Guide Dialog */}
      <Dialog
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Phiếu hướng dẫn thực hành tại nhà"
        description="Gia đình có thể xem trực tiếp hoặc in phiếu này để đồng hành cùng trẻ."
        maxWidthClass="max-w-2xl"
        footer={
          <>
            <Button type="button" variant="outline" size="md" onClick={() => setGuideOpen(false)}>
              Đóng
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => {
                if (typeof globalThis.print === 'function') {
                  globalThis.print();
                }
              }}
              leftIcon={<Printer className="h-4 w-4" aria-hidden="true" />}
            >
              In phiếu hướng dẫn
            </Button>
          </>
        }
      >
        <div className="mimora-print-sheet space-y-4 rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)] bg-[var(--mimora-surface-subtle)] p-5">
          <div className="space-y-1 border-b border-[var(--mimora-border)] pb-3">
            <p className="text-xs font-medium text-[var(--mimora-muted)]">
              MIMORA · Hướng dẫn thực hành tại nhà · {printable.className}
            </p>
            <h3 className="text-xl font-bold text-[var(--mimora-text)]">
              {printable.assignmentTitle}
            </h3>
            <p className="text-xs text-[var(--mimora-muted)]">
              Ngày gợi ý: {formatDueDateVi(printable.dueAt)}
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-semibold text-[var(--mimora-text)]">
              Lời nhắn dành cho gia đình & trẻ:
            </p>
            <p className="text-sm text-[var(--mimora-text)] leading-relaxed whitespace-pre-line">
              {printable.instructions ?? 'Cùng con trò chuyện nhẹ nhàng theo từng thẻ hoạt động.'}
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-semibold text-[var(--mimora-text)]">
              Các hoạt động trong bài ({printable.activityTitles.length}):
            </p>
            <ol className="list-decimal pl-5 space-y-1 text-sm text-[var(--mimora-text)]">
              {printable.activityTitles.map((title, idx) => (
                <li key={`${idx}-${title}`}>{title}</li>
              ))}
            </ol>
          </div>

          <p className="text-xs text-[var(--mimora-muted)] pt-2 border-t border-[var(--mimora-border)]">
            Nguyên tắc đồng hành: Tôn trọng nhịp độ của trẻ, không chấm điểm, không ép buộc trẻ
            bộc lộ cảm xúc khi chưa sẵn sàng.
          </p>
        </div>
      </Dialog>
    </div>
  );
}
