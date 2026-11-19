import { ArrowRight, BookOpen, Calendar, CheckCircle2, Compass, HeartHandshake, SlidersHorizontal } from 'lucide-react';
import { Button } from '../ui/Button.tsx';
import { Card, CardContent, CardHeader } from '../ui/Card.tsx';
import { Alert } from '../ui/Alert.tsx';
import { EmptyState, LoadingState } from '../ui/States.tsx';
import { Tabs } from '../ui/Tabs.tsx';
import {
  StoryBookIllustration,
  WelcomeGardenIllustration,
} from '../illustrations/SelIllustrations.tsx';
import type {
  SafeStudentAssignmentListItemView,
  SafeStudentFamilyProgramSummaryView,
  SafeStudentGoalView,
  SafeStudentProfileView,
} from '../../types/student.ts';
import {
  formatDueDateVi,
  translateStudentProgressStatusVi,
} from '../../utils/studentContent.ts';

export interface StudentHomePageProps {
  displayName: string;
  preferredName?: string | null;
  hasSchoolContext?: boolean;
  profile: SafeStudentProfileView | null;
  familyPrograms?: SafeStudentFamilyProgramSummaryView[];
  familyProgramsLoading?: boolean;
  familyProgramsError?: string | null;
  onRetryLoadFamilyPrograms?: () => void;
  onOpenFamilyProgram?: (enrollmentId: string) => void;
  assignments: SafeStudentAssignmentListItemView[];
  assignmentsLoading: boolean;
  assignmentsError: string | null;
  statusFilter: 'active' | 'closed';
  onChangeStatusFilter: (status: 'active' | 'closed') => void;
  onRetryLoadAssignments: () => void;
  goals: SafeStudentGoalView[];
  goalsLoading: boolean;
  goalsError?: string | null;
  onRetryLoadGoals?: () => void;
  onOpenAssignment: (assignmentId: string) => void;
  onOpenChaptersOverview: () => void;
  onOpenSampleCards: () => void;
  onOpenSettings: () => void;
}

export function StudentHomePage({
  displayName,
  preferredName,
  hasSchoolContext = true,
  profile,
  familyPrograms = [],
  familyProgramsLoading = false,
  familyProgramsError = null,
  onRetryLoadFamilyPrograms,
  onOpenFamilyProgram,
  assignments,
  assignmentsLoading,
  assignmentsError,
  statusFilter,
  onChangeStatusFilter,
  onRetryLoadAssignments,
  goals,
  goalsLoading,
  goalsError,
  onRetryLoadGoals,
  onOpenAssignment,
  onOpenChaptersOverview,
  onOpenSampleCards,
  onOpenSettings,
}: StudentHomePageProps) {
  const friendlyName =
    preferredName?.trim() || profile?.preferredName?.trim() || displayName;

  return (
    <div className="space-y-8">
      {/* Warm child-friendly hero */}
      <Card tone="mint" padding="lg">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
          <div className="md:col-span-7 space-y-4">
            <p className="text-xs font-semibold text-[var(--mimora-primary)]">
              Không gian học tập nhẹ nhàng · Theo nhịp độ của riêng con
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold text-[var(--mimora-text)] leading-snug">
              Chào {friendlyName}, hôm nay mình cùng khám phá thật bình tĩnh nhé
            </h1>
            <p className="text-base text-[var(--mimora-text)]/85 leading-relaxed">
              Không có đồng hồ đếm ngược, không xếp hạng và không trừ điểm. Con luôn có thể dừng
              nghỉ, bỏ qua bước chưa sẵn sàng hoặc nhờ người lớn tin cậy giúp đỡ.
            </p>
            <div className="pt-1 flex flex-wrap gap-3">
              <Button
                type="button"
                variant="primary"
                size="student"
                onClick={onOpenChaptersOverview}
                leftIcon={<Compass className="h-4 w-4" aria-hidden="true" />}
              >
                Xem lộ trình 3 Buổi · 6 Bước
              </Button>
              <Button
                type="button"
                variant="outline"
                size="student"
                onClick={onOpenSettings}
                leftIcon={<SlidersHorizontal className="h-4 w-4" aria-hidden="true" />}
              >
                Cài đặt thoải mái
              </Button>
            </div>
          </div>
          <div className="md:col-span-5 flex justify-center">
            <WelcomeGardenIllustration />
          </div>
        </div>
      </Card>

      {/* Teacher-Free Family Programs Section (Shown for both Family-only & Dual-context Students) */}
      <section aria-labelledby="student-family-programs-heading" className="space-y-4">
        <div className="space-y-1">
          <h2
            id="student-family-programs-heading"
            className="text-xl font-semibold text-[var(--mimora-text)]"
          >
            Chương trình Gia đình của con
          </h2>
          <p className="text-sm text-[var(--mimora-muted)]">
            Học tập nhẹ nhàng tại nhà cùng gia đình · Không cần giáo viên, không giới hạn thời gian.
          </p>
        </div>

        {familyProgramsLoading ? (
          <LoadingState label="Đang tải chương trình gia đình của con..." />
        ) : familyProgramsError ? (
          <Alert
            variant="danger"
            title="Chưa tải được chương trình gia đình"
            action={
              onRetryLoadFamilyPrograms ? (
                <Button type="button" variant="outline" size="sm" onClick={onRetryLoadFamilyPrograms}>
                  Thử tải lại
                </Button>
              ) : undefined
            }
          >
            {familyProgramsError}
          </Alert>
        ) : familyPrograms.length === 0 ? (
          <Card tone="subtle" padding="md">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-[var(--mimora-text)]">
                  Chưa có chương trình gia đình nào được mở
                </p>
                <p className="text-xs text-[var(--mimora-muted)]">
                  Khi phụ huynh hoặc quản trị viên mở một chương trình học tại nhà cho con, các hoạt động sẽ xuất hiện ngay tại đây.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onOpenSampleCards}
              >
                Xem thẻ mẫu minh họa
              </Button>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {familyPrograms.map((prog) => {
              const isCompleted = prog.learningStatus === 'completed';
              const isInProgress = prog.learningStatus === 'in_progress';
              return (
                <Card
                  key={prog.enrollmentId}
                  tone={isCompleted ? 'mint' : 'default'}
                  elevated
                  padding="md"
                  className="flex flex-col justify-between gap-4"
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--mimora-muted)]">
                      <span className="font-semibold text-[var(--mimora-primary)]">
                        {prog.workspaceName}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{prog.statusLabelVi}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        {prog.completedActivities}/{prog.totalActivities} hoạt động
                      </span>
                    </div>

                    <h3 className="text-lg font-semibold text-[var(--mimora-text)] leading-snug">
                      {prog.title}
                    </h3>

                    {prog.description && (
                      <p className="text-sm text-[var(--mimora-muted)] line-clamp-2 leading-relaxed">
                        {prog.description}
                      </p>
                    )}
                  </div>

                  <div className="pt-3 border-t border-[var(--mimora-border)] flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs text-[var(--mimora-muted)] inline-flex items-center gap-1.5">
                      {isCompleted && (
                        <CheckCircle2
                          className="h-4 w-4 text-[var(--mimora-success)] shrink-0"
                          aria-hidden="true"
                        />
                      )}
                      <span>
                        {prog.ageBand ? `Gợi ý: ${prog.ageBand}` : `Phiên bản v${prog.versionNumber}`}
                      </span>
                    </span>

                    <Button
                      type="button"
                      variant="primary"
                      size="md"
                      onClick={() => onOpenFamilyProgram?.(prog.enrollmentId)}
                      rightIcon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
                    >
                      {isInProgress
                        ? 'Tiếp tục khám phá'
                        : isCompleted
                          ? 'Xem lại / Thực hành thêm'
                          : 'Bắt đầu khám phá'}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Assigned School Learning Activities */}
      <section aria-labelledby="student-assignments-heading" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="space-y-1">
            <h2
              id="student-assignments-heading"
              className="text-xl font-semibold text-[var(--mimora-text)]"
            >
              Bài tập & Hoạt động thầy cô giao cho con
            </h2>
            <p className="text-sm text-[var(--mimora-muted)]">
              Dữ liệu thật từ lớp học của con · Mọi bước đã lưu đều được giữ an toàn.
            </p>
          </div>

          {hasSchoolContext && (
            <Tabs
              ariaLabel="Lọc bài tập theo trạng thái"
              value={statusFilter}
              onChange={onChangeStatusFilter}
              options={[
                { value: 'active', label: 'Đang mở' },
                { value: 'closed', label: 'Đã đóng (Xem lại)' },
              ]}
            />
          )}
        </div>

        {!hasSchoolContext ? (
          <EmptyState
            illustration={<StoryBookIllustration />}
            title="Không gian học tập gia đình của con đã sẵn sàng"
            description="Hiện tài khoản của con đang học trong Không gian Gia đình và chưa có bài tập trường học nào được gắn. Con vẫn có thể học các Chương trình Gia đình ở trên, khám phá lộ trình 3 Buổi · 6 Bước hoặc xem bộ thẻ mẫu minh họa."
            calmNote="Không có đồng hồ đếm ngược · Không xếp hạng · Không phạt khi thử lại"
            action={
              <Button
                type="button"
                variant="secondary"
                size="student"
                onClick={onOpenSampleCards}
              >
                Xem bộ thẻ mẫu minh họa
              </Button>
            }
          />
        ) : assignmentsLoading ? (
          <LoadingState label="Đang tải danh sách bài tập của con..." />
        ) : assignmentsError ? (
          <Alert
            variant="danger"
            title="Chưa tải được danh sách bài tập"
            action={
              <Button type="button" variant="outline" size="sm" onClick={onRetryLoadAssignments}>
                Thử tải lại
              </Button>
            }
          >
            {assignmentsError}
          </Alert>
        ) : assignments.length === 0 ? (
          <EmptyState
            illustration={<StoryBookIllustration />}
            title={
              statusFilter === 'active'
                ? 'Hiện chưa có bài tập mới nào được giao'
                : 'Chưa có bài tập đã đóng nào'
            }
            description={
              statusFilter === 'active'
                ? 'Khi thầy cô giao bài tập SEL cho lớp của con, các hoạt động sẽ xuất hiện ngay tại đây. Con vẫn có thể xem trước bộ thẻ minh họa hoặc tùy chỉnh màn hình thoải mái.'
                : 'Các bài tập thầy cô đã kết thúc sẽ hiển thị ở đây để con xem lại bất cứ lúc nào.'
            }
            calmNote="Không có đồng hồ đếm ngược · Không xếp hạng · Không phạt khi thử lại"
            action={
              <Button
                type="button"
                variant="secondary"
                size="student"
                onClick={onOpenSampleCards}
              >
                Xem bộ thẻ mẫu minh họa
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {assignments.map((item) => {
              const progressLabel = translateStudentProgressStatusVi(item.progress.status);
              const isCompleted = item.progress.status === 'completed';
              const isInProgress = item.progress.status === 'in_progress';
              return (
                <Card
                  key={item.id}
                  tone={isCompleted ? 'mint' : 'default'}
                  elevated
                  padding="md"
                  className="flex flex-col justify-between gap-4"
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--mimora-muted)]">
                      <span className="font-semibold text-[var(--mimora-primary)]">
                        {item.className}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{item.isReadOnly ? 'Chế độ xem lại' : progressLabel}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        {item.progress.completedItems}/{item.progress.totalItems || item.itemCount}{' '}
                        hoạt động
                      </span>
                    </div>

                    <h3 className="text-lg font-semibold text-[var(--mimora-text)] leading-snug">
                      {item.title}
                    </h3>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[var(--mimora-muted)]">
                      <span className="inline-flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>Gợi ý hoàn thành: {formatDueDateVi(item.dueAt)}</span>
                      </span>
                      {item.homePractice.hasInstructions && (
                        <span className="inline-flex items-center gap-1.5 text-[var(--mimora-secondary)] font-medium">
                          <BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span>Có hướng dẫn thực hành tại nhà</span>
                        </span>
                      )}
                    </div>

                    {item.homePractice.instructions && (
                      <p className="text-sm text-[var(--mimora-muted)] line-clamp-2 leading-relaxed">
                        {item.homePractice.instructions}
                      </p>
                    )}
                  </div>

                  <div className="pt-3 border-t border-[var(--mimora-border)] flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs text-[var(--mimora-muted)] inline-flex items-center gap-1.5 tabular-nums">
                      {isCompleted && (
                        <CheckCircle2
                          className="h-4 w-4 text-[var(--mimora-success)] shrink-0"
                          aria-hidden="true"
                        />
                      )}
                      <span>
                        {item.progress.attemptCount > 0
                          ? `Đã thực hành ${item.progress.attemptCount} lượt`
                          : 'Chưa mở hoạt động'}
                      </span>
                    </span>

                    <Button
                      type="button"
                      variant={item.isReadOnly ? 'outline' : 'primary'}
                      size="md"
                      onClick={() => onOpenAssignment(item.id)}
                      rightIcon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
                    >
                      {item.isReadOnly
                        ? 'Xem lại bài tập'
                        : isInProgress
                          ? 'Tiếp tục làm bài'
                          : isCompleted
                            ? 'Xem lại / Thực hành thêm'
                            : 'Bắt đầu khám phá'}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Teacher-shared SEL Goals (read-only from P2-07) */}
      {hasSchoolContext && (
      <section aria-labelledby="student-goals-heading" className="space-y-3">
        <Card tone="subtle" padding="md">
          <CardHeader
            title="Mục tiêu đồng hành cùng thầy cô"
            description="Những điều nhỏ nhẹ nhàng con và thầy cô đang cùng hướng tới (không chấm điểm)."
          />
          <CardContent>
            {goalsLoading ? (
              <p className="text-sm text-[var(--mimora-muted)]">Đang tải mục tiêu...</p>
            ) : goalsError ? (
              <Alert
                variant="danger"
                title="Chưa tải được mục tiêu đồng hành"
                action={
                  onRetryLoadGoals ? (
                    <Button type="button" variant="outline" size="sm" onClick={onRetryLoadGoals}>
                      Thử tải lại
                    </Button>
                  ) : undefined
                }
              >
                {goalsError}
              </Alert>
            ) : goals.length === 0 ? (
              <p className="text-sm text-[var(--mimora-muted)] flex items-center gap-2">
                <HeartHandshake className="h-4 w-4 text-[var(--mimora-primary)] shrink-0" aria-hidden="true" />
                <span>Chưa có mục tiêu cá nhân nào được thêm. Con cứ học từng bước nhẹ nhàng nhé.</span>
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {goals.map((goal) => (
                  <div
                    key={goal.id}
                    className="rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)] bg-[var(--mimora-surface)] p-4 space-y-1.5"
                  >
                    <p className="text-xs font-medium text-[var(--mimora-primary)]">
                      {goal.focusArea || 'Đồng hành SEL'} ·{' '}
                      {goal.status === 'achieved'
                        ? 'Đã đạt được'
                        : goal.status === 'paused'
                          ? 'Tạm nghỉ'
                          : 'Đang đồng hành'}
                    </p>
                    <p className="text-base font-semibold text-[var(--mimora-text)]">{goal.title}</p>
                    {goal.description && (
                      <p className="text-sm text-[var(--mimora-muted)] leading-relaxed">
                        {goal.description}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
      )}
    </div>
  );
}
