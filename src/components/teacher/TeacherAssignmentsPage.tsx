import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Eye,
  Lock,
  Pencil,
  Plus,
  Printer,
  Trash2,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiClientError } from '../../api/client.ts';
import { teacherApi } from '../../api/teacher.ts';
import { resolveLocalizedErrorMessage, type AppLocale } from '../../i18n/index.ts';
import type { ClassStudentRoster, SafeClassView } from '../../types/admin.ts';
import {
  groupAssignmentItemsIntoSessions,
  type AssignmentStatus,
  type SafeAssignmentProgressSummaryView,
  type SafeAssignmentTargetView,
  type SafePinnedAssignmentItemView,
  type SafeTeacherAssignmentListItemView,
  type SafeTeacherAssignmentView,
  type SafeTeacherAttemptDetailView,
  type SafeTeacherAttemptSummaryView,
  type SafeTeacherLibraryContentView,
} from '../../types/teacher.ts';
import {
  formatDateTime,
  getAssignmentStatusMeta,
  getAttemptStatusMeta,
  getContentTypeLabel,
  getProgressStatusMeta,
} from '../../utils/p302.ts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Dialog,
  EmptyState,
  FormField,
  Input,
  LoadingState,
  PageHeader,
  Select,
  Tabs,
} from '../ui/index.ts';

export interface TeacherAssignmentsPageProps {
  locale: AppLocale;
  onToast: (msg: string) => void;
}

export function TeacherAssignmentsPage({ locale, onToast }: TeacherAssignmentsPageProps) {
  const [classes, setClasses] = useState<SafeClassView[]>([]);
  const [assignments, setAssignments] = useState<SafeTeacherAssignmentListItemView[]>([]);
  const [total, setTotal] = useState(0);
  const [classFilter, setClassFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | AssignmentStatus>('');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Selected Assignment Detail
  const [selectedDetail, setSelectedDetail] = useState<{
    assignment: SafeTeacherAssignmentView;
    items: SafePinnedAssignmentItemView[];
    targets: SafeAssignmentTargetView[];
  } | null>(null);
  const [progressData, setProgressData] = useState<{
    totalItems: number;
    targets: SafeAssignmentProgressSummaryView[];
  } | null>(null);
  const [attempts, setAttempts] = useState<SafeTeacherAttemptSummaryView[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailTab, setDetailTab] = useState<'items' | 'progress' | 'attempts' | 'home_practice'>('items');
  const [chapterGroupingMode, setChapterGroupingMode] = useState(true);

  // Attempt turns inspection dialog
  const [attemptDetail, setAttemptDetail] = useState<SafeTeacherAttemptDetailView | null>(null);

  // Guided Create Assignment Modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createClassId, setCreateClassId] = useState('');
  const [classStudentsForCreate, setClassStudentsForCreate] = useState<ClassStudentRoster[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [publishedLibrary, setPublishedLibrary] = useState<SafeTeacherLibraryContentView[]>([]);
  const [selectedItems, setSelectedItems] = useState<SafeTeacherLibraryContentView[]>([]);
  const [createTitle, setCreateTitle] = useState('');
  const [createDueLocal, setCreateDueLocal] = useState('');
  const [createHomePractice, setCreateHomePractice] = useState('');
  const [createStatus, setCreateStatus] = useState<'draft' | 'active'>('active');
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  // Edit Assignment Modal (Creator only)
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editHomePractice, setEditHomePractice] = useState('');
  const [editDueLocal, setEditDueLocal] = useState('');
  const [editStatus, setEditStatus] = useState<AssignmentStatus>('active');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);

  // Update Targets Modal (Creator only)
  const [targetsModalOpen, setTargetsModalOpen] = useState(false);
  const [editTargetClassRoster, setEditTargetClassRoster] = useState<ClassStudentRoster[]>([]);
  const [editTargetIds, setEditTargetIds] = useState<string[]>([]);
  const [savingTargets, setSavingTargets] = useState(false);
  const [targetsErr, setTargetsErr] = useState<string | null>(null);

  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  const loadBase = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [clsRes, asgRes] = await Promise.all([
        teacherApi.listMyClasses({ page: 1, limit: 100, status: 'active' }),
        teacherApi.listAssignments({
          classId: classFilter || undefined,
          status: statusFilter || undefined,
          page: 1,
          limit: 50,
        }),
      ]);
      setClasses(clsRes.items);
      setAssignments(asgRes.items);
      setTotal(asgRes.total);
      if (clsRes.items.length > 0) {
        setCreateClassId((prev) => prev || clsRes.items[0].id);
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrorMsg(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setErrorMsg('Không thể tải danh sách bài tập.');
      }
    } finally {
      setLoading(false);
    }
  }, [classFilter, statusFilter, locale]);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  const loadAssignmentDetail = async (assignmentId: string) => {
    setLoadingDetail(true);
    setErrorMsg(null);
    try {
      const [detailRes, progRes, attRes] = await Promise.all([
        teacherApi.getAssignmentDetail(assignmentId),
        teacherApi.getAssignmentProgress(assignmentId),
        teacherApi.listAssignmentAttempts(assignmentId, { page: 1, limit: 50 }),
      ]);
      setSelectedDetail({
        assignment: detailRes.assignment,
        items: detailRes.items,
        targets: detailRes.targets,
      });
      setProgressData({
        totalItems: progRes.totalItems,
        targets: progRes.targets,
      });
      setAttempts(attRes.items);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrorMsg(resolveLocalizedErrorMessage(err.info, locale));
      }
    } finally {
      setLoadingDetail(false);
    }
  };

  // Load class roster + published library when Create Modal opens or class changes
  useEffect(() => {
    if (!createOpen || !createClassId) return;
    let active = true;
    setCreateErr(null);
    Promise.all([
      teacherApi.getClassStudents(createClassId),
      teacherApi.listPublishedLibrary({ page: 1, limit: 50 }),
    ])
      .then(([rosterRes, libRes]) => {
        if (!active) return;
        setClassStudentsForCreate(rosterRes.students);
        setSelectedStudentIds(rosterRes.students.map((s) => s.studentMembershipId));
        setPublishedLibrary(libRes.items);
      })
      .catch((err) => {
        if (!active) return;
        setClassStudentsForCreate([]);
        setSelectedStudentIds([]);
        setPublishedLibrary([]);
        setCreateErr(
          err instanceof ApiClientError
            ? resolveLocalizedErrorMessage(err.info, locale)
            : 'Không thể tải danh sách học sinh hoặc học liệu đã xuất bản.'
        );
      });
    return () => {
      active = false;
    };
  }, [createOpen, createClassId, locale]);

  const handleCreateAssignment = async (e: FormEvent) => {
    e.preventDefault();
    if (!createClassId || !createTitle.trim()) {
      setCreateErr('Vui lòng chọn lớp và nhập tiêu đề bài tập.');
      return;
    }
    if (selectedItems.length === 0) {
      setCreateErr('Vui lòng chọn ít nhất 1 thẻ học liệu đã xuất bản.');
      return;
    }
    if (selectedStudentIds.length === 0) {
      setCreateErr('Vui lòng chọn ít nhất 1 học sinh đang ghi danh trong lớp.');
      return;
    }

    setCreating(true);
    setCreateErr(null);
    try {
      const dueIso = createDueLocal ? new Date(createDueLocal).toISOString() : null;
      const res = await teacherApi.createAssignment({
        classId: createClassId,
        title: createTitle.trim(),
        homePracticeInstructions: createHomePractice.trim()
          ? createHomePractice.trim()
          : null,
        dueAt: dueIso,
        status: createStatus,
        items: selectedItems.map((libItem, idx) => ({
          contentVersionId: libItem.versionId,
          sortOrder: idx,
          expectedContentItemId: libItem.itemId,
        })),
        targetStudentMembershipIds: selectedStudentIds,
      });
      setCreateOpen(false);
      setCreateTitle('');
      setCreateHomePractice('');
      setCreateDueLocal('');
      setSelectedItems([]);
      onToast(`Đã tạo bài tập "${res.assignment.title}" gắn chặt ${res.items.length} phiên bản học liệu.`);
      await loadBase();
      await loadAssignmentDetail(res.assignment.id);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setCreateErr(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setCreateErr('Không thể tạo bài tập.');
      }
    } finally {
      setCreating(false);
    }
  };

  const handleSaveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedDetail) return;
    setSavingEdit(true);
    setEditErr(null);
    try {
      const dueIso = editDueLocal ? new Date(editDueLocal).toISOString() : null;
      await teacherApi.updateAssignment(selectedDetail.assignment.id, {
        title: editTitle.trim(),
        homePracticeInstructions: editHomePractice.trim() ? editHomePractice.trim() : null,
        dueAt: dueIso,
        status: editStatus,
      });
      setEditOpen(false);
      onToast('Đã cập nhật thông tin bài tập.');
      await loadBase();
      await loadAssignmentDetail(selectedDetail.assignment.id);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setEditErr(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setEditErr('Không thể cập nhật bài tập.');
      }
    } finally {
      setSavingEdit(false);
    }
  };

  const openTargetsModal = async () => {
    if (!selectedDetail) return;
    setTargetsErr(null);
    setEditTargetIds(selectedDetail.targets.map((t) => t.studentMembershipId));
    setTargetsModalOpen(true);
    try {
      const res = await teacherApi.getClassStudents(selectedDetail.assignment.classId);
      setEditTargetClassRoster(res.students);
    } catch (err) {
      setEditTargetClassRoster([]);
      setTargetsErr(
        err instanceof ApiClientError
          ? resolveLocalizedErrorMessage(err.info, locale)
          : 'Không thể tải danh sách học sinh của lớp.'
      );
    }
  };

  const handleSaveTargets = async () => {
    if (!selectedDetail) return;
    setSavingTargets(true);
    setTargetsErr(null);
    try {
      await teacherApi.updateAssignmentTargets(selectedDetail.assignment.id, editTargetIds);
      setTargetsModalOpen(false);
      onToast('Đã cập nhật danh sách học sinh giao bài.');
      await loadBase();
      await loadAssignmentDetail(selectedDetail.assignment.id);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setTargetsErr(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setTargetsErr('Không thể cập nhật danh sách học sinh.');
      }
    } finally {
      setSavingTargets(false);
    }
  };

  const handleCloseAssignment = async () => {
    if (!selectedDetail) return;
    setConfirmCloseOpen(false);
    try {
      await teacherApi.closeAssignment(selectedDetail.assignment.id);
      onToast('Đã đóng bài tập. Học sinh chuyển sang chế độ chỉ đọc.');
      await loadBase();
      await loadAssignmentDetail(selectedDetail.assignment.id);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrorMsg(resolveLocalizedErrorMessage(err.info, locale));
      }
    }
  };

  const openAttemptDetail = async (attemptId: string) => {
    if (!selectedDetail) return;
    try {
      const res = await teacherApi.getAssignmentAttemptDetail(
        selectedDetail.assignment.id,
        attemptId
      );
      setAttemptDetail(res.attempt);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrorMsg(resolveLocalizedErrorMessage(err.info, locale));
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="mimora-no-print space-y-6">
        <PageHeader
          metadataLine="Cổng Giáo viên · P2-05 & P2-06"
          title="Bài tập SEL & Hướng dẫn Thực hành tại nhà"
          description="Gắn chặt phiên bản học liệu đã xuất bản, theo dõi tiến độ nhẹ nhàng (không điểm số) và in hướng dẫn thực hành tại nhà."
          action={
            <Button
              variant="primary"
              disabled={classes.length === 0}
              leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
              onClick={() => {
                setCreateErr(null);
                setCreateOpen(true);
              }}
            >
              Tạo bài tập mới
            </Button>
          }
        />

        <Card padding="sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Lọc theo lớp" htmlFor="asg-cls-filter">
              <Select
                id="asg-cls-filter"
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                options={[
                  { value: '', label: 'Tất cả lớp được phân công' },
                  ...classes.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
            </FormField>

            <FormField label="Trạng thái bài tập" htmlFor="asg-status-filter">
              <Select
                id="asg-status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as '' | AssignmentStatus)}
                options={[
                  { value: '', label: 'Tất cả trạng thái' },
                  { value: 'draft', label: 'Bản nháp (draft)' },
                  { value: 'active', label: 'Đang mở (active)' },
                  { value: 'closed', label: 'Đã đóng (closed)' },
                  { value: 'archived', label: 'Đã lưu trữ (archived)' },
                ]}
              />
            </FormField>
          </div>
        </Card>

        {errorMsg && <Alert variant="danger">{errorMsg}</Alert>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        <Card className="lg:col-span-2 mimora-no-print" padding="md">
          <CardHeader title={`Danh sách bài tập (${total})`} />
          <CardContent>
            {loading ? (
              <LoadingState label="Đang tải bài tập..." />
            ) : assignments.length === 0 ? (
              <EmptyState
                title="Chưa có bài tập nào"
                description="Tạo bài tập mới từ học liệu đã xuất bản cho lớp học của bạn."
              />
            ) : (
              <div className="space-y-2.5">
                {assignments.map((a) => {
                  const st = getAssignmentStatusMeta(a.status, locale);
                  const active = selectedDetail?.assignment.id === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => void loadAssignmentDetail(a.id)}
                      className={[
                        'w-full text-left rounded-[var(--mimora-radius-md)] border p-3.5 space-y-1.5 cursor-pointer transition-colors',
                        active
                          ? 'bg-[var(--mimora-surface-mint)]/60 border-[#9ecbc1]'
                          : 'bg-[var(--mimora-surface)] border-[var(--mimora-border)] hover:bg-[var(--mimora-surface-subtle)]/50',
                      ].join(' ')}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-sm text-[var(--mimora-text)]">{a.title}</span>
                        <Badge variant={st.variant}>{st.label}</Badge>
                      </div>
                      <p className="text-xs text-[var(--mimora-muted)]">
                        {a.className} · {a.itemCount} thẻ · {a.targetCount} học sinh
                      </p>
                      <p className="text-xs text-[var(--mimora-muted)]">
                        {a.canEdit ? 'Bạn là tác giả (Có quyền sửa)' : 'Đồng giáo viên (Chỉ xem)'}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3" padding="md">
          {loadingDetail ? (
            <LoadingState label="Đang tải chi tiết bài tập..." />
          ) : !selectedDetail ? (
            <EmptyState
              title="Chọn một bài tập để xem chi tiết"
              description="Xem các phiên bản học liệu đã gắn chặt, tiến độ tham gia, lượt làm bài và hướng dẫn thực hành tại nhà có thể in."
            />
          ) : (
            <div className="space-y-5">
              <div className="mimora-no-print space-y-4">
                <CardHeader
                  title={selectedDetail.assignment.title}
                  description={`${selectedDetail.assignment.className ?? ''} · Tạo lúc ${formatDateTime(selectedDetail.assignment.createdAt, locale)}${selectedDetail.assignment.dueAt ? ` · Hạn nhẹ nhàng: ${formatDateTime(selectedDetail.assignment.dueAt, locale)}` : ''}`}
                  action={
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={getAssignmentStatusMeta(selectedDetail.assignment.status, locale).variant}>
                        {getAssignmentStatusMeta(selectedDetail.assignment.status, locale).label}
                      </Badge>
                      {!selectedDetail.assignment.canEdit && (
                        <Badge variant="neutral" icon={<Lock className="h-3.5 w-3.5" aria-hidden="true" />}>
                          Đồng giáo viên · Chỉ xem
                        </Badge>
                      )}
                    </div>
                  }
                />

                {selectedDetail.assignment.canEdit && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      leftIcon={<Pencil className="h-3.5 w-3.5" aria-hidden="true" />}
                      onClick={() => {
                        setEditTitle(selectedDetail.assignment.title);
                        setEditHomePractice(selectedDetail.assignment.homePracticeInstructions ?? '');
                        setEditDueLocal(
                          selectedDetail.assignment.dueAt
                            ? new Date(selectedDetail.assignment.dueAt).toISOString().slice(0, 16)
                            : ''
                        );
                        setEditStatus(selectedDetail.assignment.status);
                        setEditErr(null);
                        setEditOpen(true);
                      }}
                    >
                      Sửa bài tập
                    </Button>
                    {selectedDetail.assignment.status !== 'closed' &&
                      selectedDetail.assignment.status !== 'archived' && (
                        <>
                          <Button
                            variant="secondary"
                            size="sm"
                            leftIcon={<Users className="h-3.5 w-3.5" aria-hidden="true" />}
                            onClick={() => void openTargetsModal()}
                          >
                            Điều chỉnh học sinh ({selectedDetail.targets.length})
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => setConfirmCloseOpen(true)}
                          >
                            Đóng bài tập (Chỉ đọc)
                          </Button>
                        </>
                      )}
                  </div>
                )}

                <Tabs
                  ariaLabel="Chi tiết bài tập"
                  value={detailTab}
                  onChange={setDetailTab}
                  options={[
                    { value: 'items', label: `Học liệu gắn chặt (${selectedDetail.items.length})` },
                    { value: 'progress', label: `Tiến độ (${progressData?.targets.length ?? 0})` },
                    { value: 'attempts', label: `Lượt làm bài (${attempts.length})` },
                    { value: 'home_practice', label: 'Hướng dẫn tại nhà & In' },
                  ]}
                />
              </div>

              {/* Tab 1: Pinned Items + Chapter Session Grouping */}
              {detailTab === 'items' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-[var(--mimora-muted)]">
                      Phiên bản học liệu đã gắn bất biến (Pinned Content Versions) — cập nhật thư viện mới sẽ không làm thay đổi bài đang giao.
                    </p>
                    <label className="inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={chapterGroupingMode}
                        onChange={(e) => setChapterGroupingMode(e.target.checked)}
                        className="h-3.5 w-3.5 accent-[var(--mimora-primary)]"
                      />
                      Hiển thị theo khung 3 Buổi · 6 Bước (Chapter)
                    </label>
                  </div>

                  {chapterGroupingMode ? (
                    <div className="space-y-3">
                      {groupAssignmentItemsIntoSessions(selectedDetail.items).map((grp) => (
                        <div
                          key={grp.sessionNumber}
                          className="rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)] p-3.5 space-y-2"
                        >
                          <p className="text-xs font-semibold text-[var(--mimora-primary)]">
                            Buổi {grp.sessionNumber} (Hiển thị trực quan)
                          </p>
                          <div className="space-y-2">
                            {grp.items.map(({ item, stepNumber }) => (
                              <div
                                key={item.assignmentItemId}
                                className="rounded-[var(--mimora-radius-sm)] bg-[var(--mimora-surface-subtle)]/50 px-3 py-2 flex items-center justify-between gap-2 text-sm"
                              >
                                <div>
                                  <span className="font-mono text-xs text-[var(--mimora-muted)] mr-2">
                                    Bước {stepNumber}
                                  </span>
                                  <span className="font-medium">{item.title}</span>
                                </div>
                                <span className="text-xs font-mono text-[var(--mimora-muted)]">
                                  {getContentTypeLabel(item.contentType, locale)} · v{item.versionNumber}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <ol className="space-y-2">
                      {selectedDetail.items.map((item) => (
                        <li
                          key={item.assignmentItemId}
                          className="rounded-[var(--mimora-radius-sm)] border border-[var(--mimora-border)] px-3 py-2.5 flex items-center justify-between gap-2 text-sm"
                        >
                          <span>
                            <strong className="font-mono text-xs mr-2">#{item.sortOrder + 1}</strong>
                            {item.title}
                          </span>
                          <span className="text-xs font-mono text-[var(--mimora-muted)]">
                            {getContentTypeLabel(item.contentType, locale)} · v{item.versionNumber}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}

              {/* Tab 2: Progress (Read-only, Descriptive only) */}
              {detailTab === 'progress' && progressData && (
                <div className="space-y-4">
                  <Alert variant="info" title="Theo dõi mô tả (Không chấm điểm)">
                    Trạng thái chỉ phản ánh học sinh chưa bắt đầu, đang thực hành hoặc đã hoàn thành hoạt động. Không dùng để xếp hạng hay đánh giá năng lực.
                  </Alert>

                  <div className="overflow-x-auto rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)]">
                    <table className="w-full text-left text-sm border-collapse">
                      <thead className="bg-[var(--mimora-surface-subtle)] text-xs text-[var(--mimora-muted)]">
                        <tr>
                          <th className="py-2.5 px-3 font-medium">Học sinh</th>
                          <th className="py-2.5 px-3 font-medium">Trạng thái</th>
                          <th className="py-2.5 px-3 font-medium">Hoạt động xong</th>
                          <th className="py-2.5 px-3 font-medium">Lượt mở</th>
                          <th className="py-2.5 px-3 font-medium">Hoạt động gần nhất</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--mimora-border)] tabular-nums">
                        {progressData.targets.map((row) => {
                          const st = getProgressStatusMeta(row.status, locale);
                          return (
                            <tr key={row.assignmentTargetId}>
                              <td className="py-2.5 px-3">
                                <p className="font-medium">{row.displayName}</p>
                                <p className="text-xs font-mono text-[var(--mimora-muted)]">
                                  @{row.orgUsername ?? '—'}
                                </p>
                              </td>
                              <td className="py-2.5 px-3">
                                <Badge variant={st.variant}>{st.label}</Badge>
                              </td>
                              <td className="py-2.5 px-3 text-xs">
                                {row.completedItems} / {row.totalItems}
                              </td>
                              <td className="py-2.5 px-3 text-xs">{row.attemptCount}</td>
                              <td className="py-2.5 px-3 text-xs text-[var(--mimora-muted)]">
                                {formatDateTime(row.lastActivityAt, locale)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Tab 3: Read-Only Student Attempts & Turns */}
              {detailTab === 'attempts' && (
                <div className="space-y-4">
                  {attempts.length === 0 ? (
                    <EmptyState
                      title="Chưa có lượt thực hành nào"
                      description="Khi học sinh bắt đầu thực hành trên bài tập này, các lượt làm và từng bước lựa chọn sẽ hiển thị tại đây (chỉ đọc)."
                    />
                  ) : (
                    <div className="space-y-2.5">
                      {attempts.map((att) => {
                        const st = getAttemptStatusMeta(att.state, locale);
                        return (
                          <div
                            key={att.attemptId}
                            className="rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)] p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                          >
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-sm">{att.studentDisplayName}</span>
                                <Badge variant={st.variant}>{st.label}</Badge>
                              </div>
                              <p className="text-xs text-[var(--mimora-muted)]">
                                Thẻ: {att.pinnedContentVersion.title} · Lượt #{att.attemptNumber} ·{' '}
                                {att.turnCount} bước · Thời gian tự nhiên: {att.elapsedSeconds} giây
                              </p>
                              <p className="text-xs text-[var(--mimora-primary)]">
                                Hỗ trợ tùy chọn: AAC ({att.supportContext.aacTapCount} lần) · Đọc to ({att.supportContext.readAloudCount} lần)
                              </p>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              leftIcon={<Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                              onClick={() => void openAttemptDetail(att.attemptId)}
                            >
                              Xem từng bước
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Tab 4: Printable Home Practice Guide */}
              {detailTab === 'home_practice' && (
                <div className="space-y-4">
                  <div className="flex justify-end mimora-no-print">
                    <Button
                      variant="primary"
                      size="sm"
                      leftIcon={<Printer className="h-4 w-4" aria-hidden="true" />}
                      onClick={() => window.print()}
                    >
                      In phiếu hướng dẫn thực hành tại nhà
                    </Button>
                  </div>

                  <div className="mimora-print-sheet rounded-[var(--mimora-radius-lg)] border border-[var(--mimora-border)] bg-[var(--mimora-surface)] p-6 space-y-4">
                    <div className="border-b border-[var(--mimora-border)] pb-3">
                      <p className="text-xs uppercase tracking-wide text-[var(--mimora-primary)] font-semibold">
                        MIMORA · Phiếu hướng dẫn thực hành tại nhà cùng gia đình
                      </p>
                      <h3 className="text-xl font-semibold mt-1">{selectedDetail.assignment.title}</h3>
                      <p className="text-xs text-[var(--mimora-muted)] mt-1">
                        Lớp: {selectedDetail.assignment.className ?? '—'}
                        {selectedDetail.assignment.dueAt
                          ? ` · Gợi ý hoàn thành trước: ${formatDateTime(selectedDetail.assignment.dueAt, locale)}`
                          : ''}
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <h4 className="text-sm font-semibold">Hướng dẫn dành cho gia đình đồng hành nhẹ nhàng</h4>
                      <p className="text-sm text-[var(--mimora-text)] whitespace-pre-wrap leading-relaxed">
                        {selectedDetail.assignment.homePracticeInstructions ??
                          'Không có hướng dẫn riêng — gia đình có thể cùng trẻ trò chuyện nhẹ nhàng theo từng thẻ bên dưới, không ép buộc hay chấm đúng sai.'}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold">
                        Các hoạt động trong bài ({selectedDetail.items.length})
                      </h4>
                      <ol className="list-decimal pl-5 space-y-1.5 text-sm">
                        {selectedDetail.items.map((it) => (
                          <li key={it.assignmentItemId}>
                            <strong>{it.title}</strong> ({getContentTypeLabel(it.contentType, locale)} · v
                            {it.versionNumber})
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Guided Create Assignment Modal */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        maxWidthClass="max-w-3xl"
        title="Tạo bài tập SEL mới (Gắn chặt phiên bản đã xuất bản)"
        description="Chọn lớp học, thứ tự thẻ SEL đã xuất bản (có thể sắp xếp 6 bước / 3 buổi) và học sinh nhận bài."
      >
        <form onSubmit={(e) => void handleCreateAssignment(e)} className="space-y-5">
          {createErr && <Alert variant="danger">{createErr}</Alert>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Lớp học" htmlFor="new-asg-cls" required>
              <Select
                id="new-asg-cls"
                value={createClassId}
                onChange={(e) => setCreateClassId(e.target.value)}
                options={classes.map((c) => ({ value: c.id, label: c.name }))}
              />
            </FormField>

            <FormField label="Trạng thái khi tạo" htmlFor="new-asg-status">
              <Select
                id="new-asg-status"
                value={createStatus}
                onChange={(e) => setCreateStatus(e.target.value as 'draft' | 'active')}
                options={[
                  { value: 'active', label: 'Mở ngay cho học sinh (active)' },
                  { value: 'draft', label: 'Lưu bản nháp trước (draft)' },
                ]}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Tiêu đề bài tập" htmlFor="new-asg-title" required>
              <Input
                id="new-asg-title"
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                placeholder="Tuần 1: Nhận diện cảm xúc & Hít thở bình tĩnh"
                required
              />
            </FormField>

            <FormField label="Hạn gợi ý nhẹ nhàng (dueAt, tùy chọn)" htmlFor="new-asg-due">
              <Input
                id="new-asg-due"
                type="datetime-local"
                value={createDueLocal}
                onChange={(e) => setCreateDueLocal(e.target.value)}
              />
            </FormField>
          </div>

          <FormField
            label="Hướng dẫn thực hành tại nhà (in trên phiếu)"
            htmlFor="new-asg-home"
          >
            <textarea
              id="new-asg-home"
              rows={2}
              value={createHomePractice}
              onChange={(e) => setCreateHomePractice(e.target.value)}
              placeholder="Ví dụ: Ba mẹ cùng con xem thẻ cảm xúc mỗi tối 5 phút và chọn 1 cách thở con thích..."
              className="w-full rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border-strong)] p-3 text-sm"
            />
          </FormField>

          {/* Published Content Picker */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)] p-3 space-y-2">
              <p className="text-xs font-semibold flex items-center gap-1.5">
                <BookOpen className="h-3.5 w-3.5 text-[var(--mimora-primary)]" aria-hidden="true" />
                Thư viện đã xuất bản ({publishedLibrary.length})
              </p>
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                {publishedLibrary.map((lib) => (
                  <div
                    key={lib.versionId}
                    className="flex items-center justify-between gap-2 rounded border border-[var(--mimora-border)] px-2.5 py-1.5 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">{lib.title}</p>
                      <p className="text-[var(--mimora-muted)]">
                        {getContentTypeLabel(lib.contentType, locale)} · v{lib.versionNumber}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setSelectedItems((prev) => [...prev, lib])}
                    >
                      + Thêm
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)] p-3 space-y-2">
              <p className="text-xs font-semibold">
                Thứ tự thẻ trong bài ({selectedItems.length})
              </p>
              {selectedItems.length === 0 ? (
                <p className="text-xs text-[var(--mimora-muted)]">
                  Chọn thẻ bên trái để gắn vào bài tập theo đúng thứ tự.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                  {selectedItems.map((it, idx) => (
                    <div
                      key={`${it.versionId}-${idx}`}
                      className="flex items-center justify-between gap-2 rounded bg-[var(--mimora-surface-mint)]/40 border border-[var(--mimora-border)] px-2.5 py-1.5 text-xs"
                    >
                      <span className="truncate">
                        <strong className="font-mono mr-1.5">#{idx + 1}</strong>
                        {it.title} (v{it.versionNumber})
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={idx === 0}
                          aria-label="Lên"
                          onClick={() =>
                            setSelectedItems((prev) => {
                              const next = [...prev];
                              [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                              return next;
                            })
                          }
                        >
                          <ArrowUp className="h-3 w-3" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={idx === selectedItems.length - 1}
                          aria-label="Xuống"
                          onClick={() =>
                            setSelectedItems((prev) => {
                              const next = [...prev];
                              [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
                              return next;
                            })
                          }
                        >
                          <ArrowDown className="h-3 w-3" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Xóa"
                          onClick={() =>
                            setSelectedItems((prev) => prev.filter((_, i) => i !== idx))
                          }
                        >
                          <Trash2 className="h-3 w-3 text-[var(--mimora-danger)]" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Target Students Picker */}
          <div className="rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)] p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold">
                Học sinh nhận bài ({selectedStudentIds.length}/{classStudentsForCreate.length})
              </p>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setSelectedStudentIds(classStudentsForCreate.map((s) => s.studentMembershipId))
                  }
                >
                  Chọn cả lớp
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSelectedStudentIds([])}>
                  Bỏ chọn
                </Button>
              </div>
            </div>
            {classStudentsForCreate.length === 0 ? (
              <p className="text-xs text-[var(--mimora-muted)]">Lớp này chưa có học sinh đang ghi danh.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto">
                {classStudentsForCreate.map((st) => (
                  <label
                    key={st.studentMembershipId}
                    className="flex items-center gap-2 rounded border border-[var(--mimora-border)] px-2.5 py-1.5 text-xs cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedStudentIds.includes(st.studentMembershipId)}
                      onChange={(e) =>
                        setSelectedStudentIds((prev) =>
                          e.target.checked
                            ? [...prev, st.studentMembershipId]
                            : prev.filter((id) => id !== st.studentMembershipId)
                        )
                      }
                      className="h-3.5 w-3.5 accent-[var(--mimora-primary)]"
                    />
                    <span className="truncate">{st.displayName}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--mimora-border)]">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" loading={creating}>
              Tạo bài tập
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Edit Assignment Modal */}
      <Dialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Chỉnh sửa thông tin bài tập"
      >
        <form onSubmit={(e) => void handleSaveEdit(e)} className="space-y-4">
          {editErr && <Alert variant="danger">{editErr}</Alert>}

          <FormField label="Tiêu đề" htmlFor="edit-asg-title" required>
            <Input
              id="edit-asg-title"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              required
            />
          </FormField>

          <FormField label="Hạn gợi ý (tùy chọn)" htmlFor="edit-asg-due">
            <Input
              id="edit-asg-due"
              type="datetime-local"
              value={editDueLocal}
              onChange={(e) => setEditDueLocal(e.target.value)}
            />
          </FormField>

          <FormField label="Trạng thái" htmlFor="edit-asg-status">
            <Select
              id="edit-asg-status"
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value as AssignmentStatus)}
              options={[
                { value: 'draft', label: 'Bản nháp (draft)' },
                { value: 'active', label: 'Đang mở (active)' },
                { value: 'closed', label: 'Đã đóng (closed)' },
                { value: 'archived', label: 'Đã lưu trữ (archived)' },
              ]}
            />
          </FormField>

          <FormField label="Hướng dẫn thực hành tại nhà" htmlFor="edit-asg-home">
            <textarea
              id="edit-asg-home"
              rows={3}
              value={editHomePractice}
              onChange={(e) => setEditHomePractice(e.target.value)}
              className="w-full rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border-strong)] p-3 text-sm"
            />
          </FormField>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" loading={savingEdit}>
              Lưu thay đổi
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Update Targets Modal */}
      <Dialog
        open={targetsModalOpen}
        onClose={() => setTargetsModalOpen(false)}
        title="Điều chỉnh học sinh nhận bài"
        description="Hệ thống tự động ngăn gỡ học sinh đã có tiến độ hoặc lượt làm bài thực tế."
        footer={
          <>
            <Button variant="outline" onClick={() => setTargetsModalOpen(false)}>
              Hủy
            </Button>
            <Button variant="primary" loading={savingTargets} onClick={() => void handleSaveTargets()}>
              Lưu danh sách ({editTargetIds.length})
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {targetsErr && <Alert variant="danger">{targetsErr}</Alert>}
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {editTargetClassRoster.map((s) => (
              <label
                key={s.studentMembershipId}
                className="flex items-center gap-2.5 rounded border border-[var(--mimora-border)] px-3 py-2 text-sm cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={editTargetIds.includes(s.studentMembershipId)}
                  onChange={(e) =>
                    setEditTargetIds((prev) =>
                      e.target.checked
                        ? [...prev, s.studentMembershipId]
                        : prev.filter((id) => id !== s.studentMembershipId)
                    )
                  }
                  className="h-4 w-4 accent-[var(--mimora-primary)]"
                />
                <span>{s.displayName}</span>
              </label>
            ))}
          </div>
        </div>
      </Dialog>

      {/* Close Assignment Confirm */}
      <Dialog
        open={confirmCloseOpen}
        onClose={() => setConfirmCloseOpen(false)}
        title="Xác nhận đóng bài tập"
        description="Sau khi đóng, học sinh không thể gửi thêm lượt mới và chỉ xem lại ở chế độ chỉ đọc."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmCloseOpen(false)}>
              Giữ nguyên
            </Button>
            <Button variant="danger" onClick={() => void handleCloseAssignment()}>
              Xác nhận đóng bài
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--mimora-muted)]">
          Bài tập: <strong>{selectedDetail?.assignment.title}</strong>
        </p>
      </Dialog>

      {/* Attempt Turns Read-Only Modal */}
      <Dialog
        open={Boolean(attemptDetail)}
        onClose={() => setAttemptDetail(null)}
        maxWidthClass="max-w-2xl"
        title={
          attemptDetail
            ? `Chi tiết lượt #${attemptDetail.attemptNumber} · ${attemptDetail.studentDisplayName}`
            : ''
        }
        description={attemptDetail?.supportContext.contextNote}
      >
        {attemptDetail && (
          <div className="space-y-3">
            {attemptDetail.turns.length === 0 ? (
              <p className="text-sm text-[var(--mimora-muted)]">Chưa có bước phản hồi nào được lưu.</p>
            ) : (
              <div className="space-y-2">
                {attemptDetail.turns.map((turn) => (
                  <div
                    key={turn.id}
                    className="rounded-[var(--mimora-radius-sm)] border border-[var(--mimora-border)] p-3 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between font-semibold">
                      <span>
                        Bước #{turn.turnIndex + 1} · {turn.stepKey}
                      </span>
                      <span className="text-[var(--mimora-muted)]">
                        {formatDateTime(turn.respondedAt, locale)}
                      </span>
                    </div>
                    <p>
                      Lựa chọn: <span className="font-mono">{turn.selectedChoiceKey ?? '—'}</span> · Cảm xúc:{' '}
                      <span className="font-mono">{turn.selectedEmotionKey ?? '—'}</span>
                    </p>
                    <p className="text-[var(--mimora-muted)]">
                      Hỗ trợ trong lượt: AAC {turn.usedAac ? 'Có' : 'Không'} · Đọc to{' '}
                      {turn.usedReadAloud ? 'Có' : 'Không'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
