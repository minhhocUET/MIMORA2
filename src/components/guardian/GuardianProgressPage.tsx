import { BookOpenCheck, CheckCircle2, Compass, PlusCircle, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClientError } from '../../api/client.ts';
import { guardianApi } from '../../api/guardian.ts';
import { resolveLocalizedErrorMessage, type AppLocale } from '../../i18n/index.ts';
import type {
  FreeFamilyProgramView,
  LearningStateCode,
  SafeGuardianStudentLinkView,
  SafeGuardianStudentProgressOverview,
} from '../../types/guardian.ts';
import { formatDateTime } from '../../utils/p302.ts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  FormField,
  LoadingState,
  PageHeader,
  Select,
} from '../ui/index.ts';

export interface GuardianProgressPageProps {
  locale: AppLocale;
  onToast: (msg: string) => void;
}

function getLearningStatusBadgeVariant(
  status: LearningStateCode
): 'success' | 'warning' | 'neutral' {
  if (status === 'completed') return 'success';
  if (status === 'in_progress') return 'warning';
  return 'neutral';
}

export function GuardianProgressPage({ locale, onToast }: GuardianProgressPageProps) {
  const [links, setLinks] = useState<SafeGuardianStudentLinkView[]>([]);
  const [freePrograms, setFreePrograms] = useState<FreeFamilyProgramView[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');

  const [overview, setOverview] = useState<SafeGuardianStudentProgressOverview | null>(null);
  const [loadingBase, setLoadingBase] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(false);
  const [enrollingProgramId, setEnrollingProgramId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const uniqueStudents = useMemo(() => {
    const map = new Map<
      string,
      {
        studentUserId: string;
        displayName: string;
        workspaces: Array<{ id: string; name: string; code: string }>;
      }
    >();
    for (const link of links) {
      if (link.relationshipStatus !== 'active') continue;
      const existing = map.get(link.studentUserId) ?? {
        studentUserId: link.studentUserId,
        displayName: link.studentDisplayName,
        workspaces: [],
      };
      if (!existing.workspaces.some((w) => w.id === link.familyWorkspaceId)) {
        existing.workspaces.push({
          id: link.familyWorkspaceId,
          name: link.workspaceName,
          code: link.workspaceCode,
        });
      }
      map.set(link.studentUserId, existing);
    }
    return Array.from(map.values());
  }, [links]);

  const selectedStudent = useMemo(
    () => uniqueStudents.find((s) => s.studentUserId === selectedStudentId) ?? null,
    [uniqueStudents, selectedStudentId]
  );

  const loadBase = useCallback(async () => {
    setLoadingBase(true);
    setErrorMsg(null);
    try {
      const [studentsRes, programsRes] = await Promise.all([
        guardianApi.listMyStudents({ includeRevoked: false }),
        guardianApi.listFreePrograms(),
      ]);
      setLinks(studentsRes.students);
      setFreePrograms(programsRes.programs);
      const firstActive = studentsRes.students.find((s) => s.relationshipStatus === 'active');
      if (firstActive) {
        setSelectedStudentId((prev) => prev || firstActive.studentUserId);
        setSelectedWorkspaceId((prev) => prev || firstActive.familyWorkspaceId);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof ApiClientError
          ? resolveLocalizedErrorMessage(err.info, locale)
          : 'Không thể tải danh sách học sinh và chương trình gia đình.'
      );
    } finally {
      setLoadingBase(false);
    }
  }, [locale]);

  const loadProgress = useCallback(
    async (studentUserId: string) => {
      if (!studentUserId) {
        setOverview(null);
        return;
      }
      setLoadingProgress(true);
      setErrorMsg(null);
      try {
        const res = await guardianApi.getStudentProgress(studentUserId);
        setOverview({
          student: res.student,
          privacyNotice: res.privacyNotice,
          items: res.items,
        });
      } catch (err) {
        setOverview(null);
        setErrorMsg(
          err instanceof ApiClientError
            ? resolveLocalizedErrorMessage(err.info, locale)
            : 'Không thể tải tóm tắt tiến độ học tập.'
        );
      } finally {
        setLoadingProgress(false);
      }
    },
    [locale]
  );

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    if (!selectedStudent) return;
    if (!selectedStudent.workspaces.some((w) => w.id === selectedWorkspaceId)) {
      setSelectedWorkspaceId(selectedStudent.workspaces[0]?.id ?? '');
    }
  }, [selectedStudent, selectedWorkspaceId]);

  useEffect(() => {
    if (selectedStudentId) {
      void loadProgress(selectedStudentId);
    }
  }, [selectedStudentId, loadProgress]);

  const handleEnrollFreeProgram = async (program: FreeFamilyProgramView) => {
    if (!selectedStudentId || !selectedWorkspaceId) return;
    setEnrollingProgramId(program.programId);
    setErrorMsg(null);
    try {
      await guardianApi.enrollFreeProgram(selectedStudentId, {
        familyWorkspaceId: selectedWorkspaceId,
        familyProgramId: program.programId,
      });
      onToast(`Đã mở chương trình miễn phí "${program.title}" cho con.`);
      await loadProgress(selectedStudentId);
    } catch (err) {
      setErrorMsg(
        err instanceof ApiClientError
          ? resolveLocalizedErrorMessage(err.info, locale)
          : 'Không thể kích hoạt chương trình miễn phí.'
      );
    } finally {
      setEnrollingProgramId(null);
    }
  };

  const progressCounts = useMemo(() => {
    const items = overview?.items ?? [];
    return {
      total: items.length,
      notStarted: items.filter((i) => i.status === 'not_started').length,
      inProgress: items.filter((i) => i.status === 'in_progress').length,
      completed: items.filter((i) => i.status === 'completed').length,
    };
  }, [overview]);

  const familyItems = useMemo(
    () => (overview?.items ?? []).filter((i) => i.sourceContext === 'family'),
    [overview]
  );

  const schoolItems = useMemo(
    () => (overview?.items ?? []).filter((i) => i.sourceContext === 'school'),
    [overview]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        metadataLine="Tóm tắt tiến độ mô tả · Bảo vệ riêng tư tuyệt đối cho trẻ"
        title="Tiến độ học tập"
        description="Theo dõi trạng thái hoàn thành tổng quát (Chưa bắt đầu / Đang học / Đã hoàn thành) của từng con trong Không gian Gia đình và các bài tập từ trường học (nếu có)."
      />

      <Alert variant="info" title="Chính sách bảo vệ trẻ em (Option B)">
        <div className="flex items-start gap-2">
          <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="leading-relaxed">
            {overview?.privacyNotice ??
              'Tóm tắt tiến độ chỉ hiển thị trạng thái hoàn thành và số lượng hoạt động, bảo vệ tuyệt đối câu trả lời, lựa chọn cảm xúc, nhật ký AAC và ghi chú riêng tư của giáo viên.'}
          </p>
        </div>
      </Alert>

      {errorMsg && <Alert variant="danger">{errorMsg}</Alert>}

      {loadingBase ? (
        <LoadingState label="Đang tải danh sách học sinh liên kết..." />
      ) : uniqueStudents.length === 0 ? (
        <EmptyState
          title="Chưa có học sinh nào đang liên kết"
          description="Vui lòng thêm hồ sơ học sinh hoặc nhập mã liên kết từ trường học trong mục Học sinh liên kết để theo dõi tiến độ."
        />
      ) : (
        <>
          {/* Student Selector */}
          <Card padding="md">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
              <FormField label="Chọn học sinh đang liên kết" htmlFor="guardian-progress-student">
                <Select
                  id="guardian-progress-student"
                  value={selectedStudentId}
                  onChange={(e) => setSelectedStudentId(e.target.value)}
                  options={uniqueStudents.map((st) => ({
                    value: st.studentUserId,
                    label: `${st.displayName} (${st.workspaces.map((w) => w.name).join(', ')})`,
                  }))}
                />
              </FormField>

              {selectedStudent && selectedStudent.workspaces.length > 1 && (
                <FormField label="Không gian gia đình để mở chương trình miễn phí" htmlFor="guardian-progress-ws">
                  <Select
                    id="guardian-progress-ws"
                    value={selectedWorkspaceId}
                    onChange={(e) => setSelectedWorkspaceId(e.target.value)}
                    options={selectedStudent.workspaces.map((w) => ({
                      value: w.id,
                      label: `${w.name} (${w.code})`,
                    }))}
                  />
                </FormField>
              )}
            </div>
          </Card>

          {loadingProgress ? (
            <LoadingState label="Đang tải tóm tắt tiến độ học tập..." />
          ) : (
            overview && (
              <div className="space-y-6">
                {/* Summary KPI cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Card padding="md">
                    <p className="text-xs font-medium text-[var(--mimora-muted)]">Tổng chương trình / bài</p>
                    <p className="text-2xl font-semibold text-[var(--mimora-text)] mt-1 tabular-nums">
                      {progressCounts.total}
                    </p>
                  </Card>
                  <Card padding="md">
                    <p className="text-xs font-medium text-[var(--mimora-muted)]">Chưa bắt đầu</p>
                    <p className="text-2xl font-semibold text-[var(--mimora-text)] mt-1 tabular-nums">
                      {progressCounts.notStarted}
                    </p>
                  </Card>
                  <Card padding="md">
                    <p className="text-xs font-medium text-[var(--mimora-muted)]">Đang học</p>
                    <p className="text-2xl font-semibold text-[var(--mimora-warning)] mt-1 tabular-nums">
                      {progressCounts.inProgress}
                    </p>
                  </Card>
                  <Card padding="md" tone="mint">
                    <p className="text-xs font-medium text-[var(--mimora-primary)]">Đã hoàn thành</p>
                    <p className="text-2xl font-semibold text-[var(--mimora-success)] mt-1 tabular-nums">
                      {progressCounts.completed}
                    </p>
                  </Card>
                </div>

                {/* Family Learning Programs Progress */}
                <section className="space-y-3">
                  <h2 className="text-lg font-semibold text-[var(--mimora-text)]">
                    Chương trình trong Không gian Gia đình ({familyItems.length})
                  </h2>

                  {familyItems.length === 0 ? (
                    <Card padding="md">
                      <p className="text-sm text-[var(--mimora-muted)]">
                        Con chưa tham gia chương trình học gia đình nào. Bạn có thể mở chương trình miễn phí bên dưới (nếu có) hoặc liên hệ quản trị viên để kích hoạt chương trình được cấp riêng.
                      </p>
                    </Card>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {familyItems.map((item) => {
                        const pct =
                          item.totalActivities > 0
                            ? Math.round((item.completedActivities / item.totalActivities) * 100)
                            : 0;
                        return (
                          <Card key={item.id} padding="md" className="space-y-4">
                            <CardHeader
                              title={item.title}
                              description={`${item.sourceLabel}${item.versionNumber ? ` · Phiên bản v${item.versionNumber}` : ''}`}
                              action={
                                <Badge variant={getLearningStatusBadgeVariant(item.status)}>
                                  {item.statusLabelVi}
                                </Badge>
                              }
                            />
                            <CardContent className="space-y-3">
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between text-xs text-[var(--mimora-muted)] tabular-nums">
                                  <span>
                                    Hoàn thành {item.completedActivities}/{item.totalActivities} hoạt động
                                  </span>
                                  <span>{pct}%</span>
                                </div>
                                <div className="h-2 w-full rounded-full bg-[var(--mimora-surface-subtle)] overflow-hidden">
                                  <div
                                    className="h-full bg-[var(--mimora-primary)] transition-all"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </div>

                              {item.chapters.length > 0 && (
                                <div className="space-y-1.5 pt-1">
                                  <p className="text-xs font-semibold text-[var(--mimora-muted)]">
                                    Tóm tắt theo chương:
                                  </p>
                                  <div className="space-y-1">
                                    {item.chapters.map((ch) => (
                                      <div
                                        key={`${item.id}-ch-${ch.chapterNumber}`}
                                        className="flex items-center justify-between gap-2 text-xs rounded-[var(--mimora-radius-sm)] bg-[var(--mimora-surface-subtle)]/70 px-2.5 py-1.5"
                                      >
                                        <span className="text-[var(--mimora-text)] truncate">
                                          Chương {ch.chapterNumber}: {ch.chapterTitle}
                                        </span>
                                        <span className="shrink-0 text-[var(--mimora-muted)] tabular-nums">
                                          {ch.completedActivities}/{ch.totalActivities} · {ch.statusLabelVi}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <div className="pt-2 border-t border-[var(--mimora-border)] text-xs text-[var(--mimora-muted)] space-y-0.5 tabular-nums">
                                <p>
                                  Hoạt động gần nhất:{' '}
                                  {item.lastActivityAt ? formatDateTime(item.lastActivityAt) : 'Chưa có'}
                                </p>
                                {item.completedAt && (
                                  <p className="text-[var(--mimora-success)] flex items-center gap-1">
                                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                    <span>Hoàn thành lúc {formatDateTime(item.completedAt)}</span>
                                  </p>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* School Assignments Overview (if dual-context) */}
                <section className="space-y-3">
                  <h2 className="text-lg font-semibold text-[var(--mimora-text)]">
                    Hoạt động tại Trường học ({schoolItems.length})
                  </h2>

                  {schoolItems.length === 0 ? (
                    <Card padding="md">
                      <p className="text-sm text-[var(--mimora-muted)]">
                        Hiện chưa có bài tập trường học nào liên kết với học sinh này.
                      </p>
                    </Card>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {schoolItems.map((item) => {
                        const pct =
                          item.totalActivities > 0
                            ? Math.round((item.completedActivities / item.totalActivities) * 100)
                            : 0;
                        return (
                          <Card key={item.id} padding="md" className="space-y-3">
                            <CardHeader
                              title={item.title}
                              description={item.sourceLabel}
                              action={
                                <Badge variant={getLearningStatusBadgeVariant(item.status)}>
                                  {item.statusLabelVi}
                                </Badge>
                              }
                            />
                            <CardContent className="space-y-2 text-xs text-[var(--mimora-muted)]">
                              <div className="flex items-center justify-between tabular-nums">
                                <span>
                                  Hoàn thành {item.completedActivities}/{item.totalActivities} hoạt động
                                </span>
                                <span>{pct}%</span>
                              </div>
                              <div className="h-2 w-full rounded-full bg-[var(--mimora-surface-subtle)] overflow-hidden">
                                <div
                                  className="h-full bg-[var(--mimora-primary)] transition-all"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <p className="tabular-nums pt-1">
                                Hoạt động gần nhất:{' '}
                                {item.lastActivityAt ? formatDateTime(item.lastActivityAt) : 'Chưa có'}
                              </p>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>
            )
          )}

          {/* Free Family Programs Discovery & Self-Enrollment */}
          <Card padding="lg" tone="subtle" className="space-y-4">
            <CardHeader
              title={`Chương trình Gia đình miễn phí (${freePrograms.length})`}
              description="Phụ huynh có thể tự mở miễn phí các chương trình đã xuất bản dưới đây cho con thực hành tại nhà (không giáo viên, không chấm điểm)."
              action={<BookOpenCheck className="h-5 w-5 text-[var(--mimora-primary)]" aria-hidden="true" />}
            />
            <CardContent>
              {freePrograms.length === 0 ? (
                <p className="text-sm text-[var(--mimora-muted)] flex items-center gap-2">
                  <Compass className="h-4 w-4 text-[var(--mimora-primary)] shrink-0" aria-hidden="true" />
                  <span>Hiện chưa có chương trình miễn phí nào đang phát hành trên hệ thống.</span>
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {freePrograms.map((prog) => {
                    const alreadyActive = familyItems.some(
                      (fi) =>
                        fi.familyWorkspaceId === selectedWorkspaceId &&
                        fi.title === prog.title &&
                        fi.versionNumber === prog.versionNumber
                    );
                    return (
                      <div
                        key={prog.programId}
                        className="rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)] bg-[var(--mimora-surface)] p-4 flex flex-col justify-between gap-3"
                      >
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold text-sm text-[var(--mimora-text)]">
                              {prog.title}
                            </span>
                            <Badge variant="success">Miễn phí · v{prog.versionNumber}</Badge>
                          </div>
                          {prog.description && (
                            <p className="text-xs text-[var(--mimora-muted)] leading-relaxed">
                              {prog.description}
                            </p>
                          )}
                          <p className="text-xs text-[var(--mimora-muted)] tabular-nums">
                            {prog.itemCount} hoạt động SEL · {prog.ageBand || 'Mọi lứa tuổi phù hợp'}
                          </p>
                        </div>

                        <div className="pt-2 border-t border-[var(--mimora-border)] flex justify-end">
                          <Button
                            type="button"
                            variant={alreadyActive ? 'outline' : 'primary'}
                            size="sm"
                            disabled={alreadyActive || !selectedWorkspaceId}
                            loading={enrollingProgramId === prog.programId}
                            onClick={() => void handleEnrollFreeProgram(prog)}
                            leftIcon={<PlusCircle className="h-4 w-4" aria-hidden="true" />}
                          >
                            {alreadyActive ? 'Đã kích hoạt' : 'Mở cho con học'}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
