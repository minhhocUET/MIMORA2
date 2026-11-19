import { Archive, Link2, Lock, Pencil, Plus, Save, Target, Trash2, UserCheck } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiClientError } from '../../api/client.ts';
import { teacherApi } from '../../api/teacher.ts';
import { resolveLocalizedErrorMessage, type AppLocale } from '../../i18n/index.ts';
import type { ClassStudentRoster, SafeClassView } from '../../types/admin.ts';
import type {
  GoalStatus,
  PreferredCommunicationMode,
  SafeStudentGoalView,
  SafeTeacherObservationView,
  StudentSupportPreferences,
  SupportSpeechRate,
  SupportVisualContrast,
} from '../../types/teacher.ts';
import { formatDateOnly, formatDateTime, getGoalStatusMeta } from '../../utils/p302.ts';
import { GuardianInviteDialog } from '../shared/GuardianInviteDialog.tsx';
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

export interface TeacherStudentsPageProps {
  locale: AppLocale;
  initialStudentMembershipId?: string | null;
  onToast: (msg: string) => void;
}

interface RosterStudentOption extends ClassStudentRoster {
  classId: string;
  className: string;
}

export function TeacherStudentsPage({
  locale,
  initialStudentMembershipId = null,
  onToast,
}: TeacherStudentsPageProps) {
  const [classes, setClasses] = useState<SafeClassView[]>([]);
  const [classFilter, setClassFilter] = useState('');
  const [students, setStudents] = useState<RosterStudentOption[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState(initialStudentMembershipId ?? '');
  const [loadingRoster, setLoadingRoster] = useState(true);
  const [rosterErr, setRosterErr] = useState<string | null>(null);

  const [detailTab, setDetailTab] = useState<'profile' | 'goals' | 'observations'>('profile');

  // Support Profile state
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [profileErr, setProfileErr] = useState<string | null>(null);
  const [preferredName, setPreferredName] = useState('');
  const [commMode, setCommMode] = useState<PreferredCommunicationMode>('mixed');
  const [aacEnabled, setAacEnabled] = useState(true);
  const [readAloudEnabled, setReadAloudEnabled] = useState(true);
  const [speechRate, setSpeechRate] = useState<SupportSpeechRate>('normal');
  const [visualContrast, setVisualContrast] = useState<SupportVisualContrast>('standard');
  const [reducedMotion, setReducedMotion] = useState(false);
  const [preferredVisualCues, setPreferredVisualCues] = useState('');
  const [sensoryNotes, setSensoryNotes] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Goals state
  const [goals, setGoals] = useState<SafeStudentGoalView[]>([]);
  const [loadingGoals, setLoadingGoals] = useState(false);
  const [goalsErr, setGoalsErr] = useState<string | null>(null);
  const [includeArchivedGoals, setIncludeArchivedGoals] = useState(false);
  const [goalFormOpen, setGoalFormOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<SafeStudentGoalView | null>(null);
  const [goalTitle, setGoalTitle] = useState('');
  const [goalDescription, setGoalDescription] = useState('');
  const [goalFocusArea, setGoalFocusArea] = useState('');
  const [goalTargetDate, setGoalTargetDate] = useState('');
  const [goalStatus, setGoalStatus] = useState<GoalStatus>('active');
  const [savingGoal, setSavingGoal] = useState(false);
  const [goalFormErr, setGoalFormErr] = useState<string | null>(null);
  const [confirmArchiveGoal, setConfirmArchiveGoal] = useState<SafeStudentGoalView | null>(null);

  // Observations state
  const [observations, setObservations] = useState<SafeTeacherObservationView[]>([]);
  const [loadingObs, setLoadingObs] = useState(false);
  const [obsErr, setObsErr] = useState<string | null>(null);
  const [obsModalOpen, setObsModalOpen] = useState(false);
  const [editingObs, setEditingObs] = useState<SafeTeacherObservationView | null>(null);
  const [obsBody, setObsBody] = useState('');
  const [obsClassId, setObsClassId] = useState('');
  const [savingObs, setSavingObs] = useState(false);
  const [obsFormErr, setObsFormErr] = useState<string | null>(null);
  const [confirmDeleteObs, setConfirmDeleteObs] = useState<SafeTeacherObservationView | null>(null);
  const [guardianInviteOpen, setGuardianInviteOpen] = useState(false);

  useEffect(() => {
    if (initialStudentMembershipId) {
      setSelectedStudentId(initialStudentMembershipId);
    }
  }, [initialStudentMembershipId]);

  const loadDirectory = useCallback(async () => {
    setLoadingRoster(true);
    setRosterErr(null);
    try {
      const clsRes = await teacherApi.listMyClasses({ page: 1, limit: 100, status: 'active' });
      setClasses(clsRes.items);
      const rosterResponses = await Promise.all(
        clsRes.items.map((c) => teacherApi.getClassStudents(c.id))
      );
      const seen = new Set<string>();
      const aggregated: RosterStudentOption[] = [];
      for (const rr of rosterResponses) {
        for (const s of rr.students) {
          if (!seen.has(s.studentMembershipId)) {
            seen.add(s.studentMembershipId);
            aggregated.push({
              ...s,
              classId: rr.class.id,
              className: rr.class.name,
            });
          }
        }
      }
      setStudents(aggregated);
      if (aggregated.length > 0) {
        setSelectedStudentId((prev) =>
          prev && aggregated.some((s) => s.studentMembershipId === prev)
            ? prev
            : aggregated[0].studentMembershipId
        );
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        setRosterErr(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setRosterErr('Không thể tải danh sách học sinh từ các lớp được phân công.');
      }
    } finally {
      setLoadingRoster(false);
    }
  }, [locale]);

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  const loadProfile = useCallback(async () => {
    if (!selectedStudentId) return;
    setLoadingProfile(true);
    setProfileErr(null);
    try {
      const res = await teacherApi.getStudentProfile(selectedStudentId);
      const prof = res.profile;
      const prefs = prof.supportPreferencesJson ?? {};
      setPreferredName(prof.preferredName ?? '');
      setCommMode(prefs.preferredCommunicationMode ?? 'mixed');
      setAacEnabled(prefs.aacEnabled ?? true);
      setReadAloudEnabled(prefs.readAloudEnabled ?? true);
      setSpeechRate(prefs.speechRate ?? 'normal');
      setVisualContrast(prefs.visualContrast ?? 'standard');
      setReducedMotion(prefs.reducedMotion ?? false);
      setPreferredVisualCues((prefs.preferredVisualCues ?? []).join(', '));
      setSensoryNotes(prefs.sensoryNotes ?? '');
    } catch (err) {
      if (err instanceof ApiClientError) {
        setProfileErr(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setProfileErr('Không thể tải hồ sơ hỗ trợ học sinh.');
      }
    } finally {
      setLoadingProfile(false);
    }
  }, [selectedStudentId, locale]);

  const loadGoals = useCallback(async () => {
    if (!selectedStudentId) return;
    setLoadingGoals(true);
    setGoalsErr(null);
    try {
      const res = await teacherApi.listStudentGoals(selectedStudentId, {
        includeArchived: includeArchivedGoals ? 'true' : 'false',
        page: 1,
        limit: 50,
      });
      setGoals(res.items);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setGoalsErr(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setGoalsErr('Không thể tải mục tiêu SEL.');
      }
    } finally {
      setLoadingGoals(false);
    }
  }, [selectedStudentId, includeArchivedGoals, locale]);

  const loadObservations = useCallback(async () => {
    if (!selectedStudentId) return;
    setLoadingObs(true);
    setObsErr(null);
    try {
      const res = await teacherApi.listObservations({
        studentMembershipId: selectedStudentId,
        page: 1,
        limit: 50,
      });
      setObservations(res.items);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setObsErr(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setObsErr('Không thể tải ghi chú quan sát riêng tư.');
      }
    } finally {
      setLoadingObs(false);
    }
  }, [selectedStudentId, locale]);

  useEffect(() => {
    if (!selectedStudentId) return;
    void Promise.all([loadProfile(), loadObservations()]);
  }, [selectedStudentId, loadProfile, loadObservations]);

  useEffect(() => {
    if (!selectedStudentId) return;
    void loadGoals();
  }, [selectedStudentId, loadGoals]);

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedStudentId) return;
    setSavingProfile(true);
    setProfileErr(null);

    const cues = preferredVisualCues
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const supportPreferencesJson: StudentSupportPreferences = {
      preferredCommunicationMode: commMode,
      aacEnabled,
      readAloudEnabled,
      speechRate,
      visualContrast,
      reducedMotion,
      ...(cues.length > 0 ? { preferredVisualCues: cues } : {}),
      ...(sensoryNotes.trim() ? { sensoryNotes: sensoryNotes.trim() } : {}),
    };

    try {
      await teacherApi.updateStudentProfile(selectedStudentId, {
        preferredName: preferredName.trim() ? preferredName.trim() : null,
        supportPreferencesJson,
      });
      onToast('Đã lưu tùy chọn hỗ trợ tiếp cận của học sinh.');
      await loadProfile();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setProfileErr(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setProfileErr('Không thể cập nhật hồ sơ hỗ trợ.');
      }
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSaveGoal = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedStudentId || !goalTitle.trim()) {
      setGoalFormErr('Vui lòng nhập tiêu đề mục tiêu SEL.');
      return;
    }
    setSavingGoal(true);
    setGoalFormErr(null);
    const currentStu = students.find((s) => s.studentMembershipId === selectedStudentId);
    try {
      if (editingGoal) {
        await teacherApi.updateGoal(editingGoal.id, {
          title: goalTitle.trim(),
          description: goalDescription.trim() ? goalDescription.trim() : null,
          focusArea: goalFocusArea.trim() ? goalFocusArea.trim() : null,
          status: goalStatus,
          targetDate: goalTargetDate.trim() ? goalTargetDate.trim() : null,
        });
        onToast('Đã cập nhật mục tiêu SEL.');
      } else {
        await teacherApi.createStudentGoal(selectedStudentId, {
          classId: currentStu?.classId ?? null,
          title: goalTitle.trim(),
          description: goalDescription.trim() ? goalDescription.trim() : null,
          focusArea: goalFocusArea.trim() ? goalFocusArea.trim() : null,
          targetDate: goalTargetDate.trim() ? goalTargetDate.trim() : null,
        });
        onToast('Đã thêm mục tiêu SEL mới cho học sinh.');
      }
      setGoalFormOpen(false);
      await loadGoals();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setGoalFormErr(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setGoalFormErr('Không thể lưu mục tiêu.');
      }
    } finally {
      setSavingGoal(false);
    }
  };

  const handleArchiveGoal = async () => {
    if (!confirmArchiveGoal) return;
    try {
      await teacherApi.archiveGoal(confirmArchiveGoal.id);
      setConfirmArchiveGoal(null);
      onToast('Đã lưu trữ mục tiêu SEL.');
      await loadGoals();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setGoalsErr(resolveLocalizedErrorMessage(err.info, locale));
      }
    }
  };

  const handleSaveObs = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedStudentId || !obsBody.trim()) {
      setObsFormErr('Vui lòng nhập nội dung ghi chú quan sát.');
      return;
    }
    setSavingObs(true);
    setObsFormErr(null);
    try {
      if (editingObs) {
        await teacherApi.updateObservation(editingObs.id, {
          noteBody: obsBody.trim(),
          classId: obsClassId ? obsClassId : null,
        });
        onToast('Đã cập nhật ghi chú quan sát riêng tư.');
      } else {
        await teacherApi.createObservation({
          studentMembershipId: selectedStudentId,
          classId: obsClassId ? obsClassId : null,
          noteBody: obsBody.trim(),
        });
        onToast('Đã lưu ghi chú quan sát riêng tư.');
      }
      setObsModalOpen(false);
      await loadObservations();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setObsFormErr(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setObsFormErr('Không thể lưu ghi chú.');
      }
    } finally {
      setSavingObs(false);
    }
  };

  const handleDeleteObs = async () => {
    if (!confirmDeleteObs) return;
    try {
      await teacherApi.deleteObservation(confirmDeleteObs.id);
      setConfirmDeleteObs(null);
      onToast('Đã xóa ghi chú quan sát riêng tư.');
      await loadObservations();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setObsErr(resolveLocalizedErrorMessage(err.info, locale));
      }
    }
  };

  const visibleStudents = students.filter((s) =>
    classFilter ? s.classId === classFilter : true
  );
  const activeStudent = students.find((s) => s.studentMembershipId === selectedStudentId);

  return (
    <div className="space-y-6">
      <PageHeader
        metadataLine="Cổng Giáo viên · P2-07"
        title="Hồ sơ Hỗ trợ, Mục tiêu SEL & Ghi chú Riêng tư"
        description="Thiết lập tùy chọn hỗ trợ thoải mái cho từng trẻ (phi chẩn đoán), đồng hành mục tiêu cá nhân và ghi chép quan sát riêng tư theo tác giả."
      />

      {rosterErr && <Alert variant="danger">{rosterErr}</Alert>}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
        <Card className="lg:col-span-1" padding="md">
          <CardHeader title="Học sinh của tôi" />
          <CardContent className="space-y-3">
            <FormField label="Lọc theo lớp" htmlFor="stu-class-filter">
              <Select
                id="stu-class-filter"
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                options={[
                  { value: '', label: 'Tất cả lớp được phân công' },
                  ...classes.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
            </FormField>

            {loadingRoster ? (
              <LoadingState label="Đang tải danh sách học sinh..." />
            ) : visibleStudents.length === 0 ? (
              <EmptyState
                title="Chưa có học sinh"
                description="Khi lớp được phân công có học sinh, danh sách sẽ hiển thị tại đây."
              />
            ) : (
              <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
                {visibleStudents.map((st) => {
                  const selected = st.studentMembershipId === selectedStudentId;
                  return (
                    <button
                      key={st.studentMembershipId}
                      type="button"
                      onClick={() => setSelectedStudentId(st.studentMembershipId)}
                      className={[
                        'w-full text-left rounded-[var(--mimora-radius-sm)] border px-3 py-2.5 text-sm cursor-pointer transition-colors',
                        selected
                          ? 'bg-[var(--mimora-surface-mint)]/70 border-[#9ecbc1] font-semibold'
                          : 'bg-[var(--mimora-surface)] border-[var(--mimora-border)] hover:bg-[var(--mimora-surface-subtle)]/60',
                      ].join(' ')}
                    >
                      <p className="truncate text-[var(--mimora-text)]">{st.displayName}</p>
                      <p className="text-xs text-[var(--mimora-muted)] truncate">
                        {st.className} · @{st.orgUsername ?? '—'}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-3 space-y-4">
          {!activeStudent ? (
            <Card padding="md">
              <EmptyState
                title="Chọn một học sinh"
                description="Chọn học sinh từ danh sách bên trái để xem hồ sơ hỗ trợ, mục tiêu SEL và ghi chú quan sát riêng tư."
              />
            </Card>
          ) : (
            <>
              <Card padding="sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold">{activeStudent.displayName}</p>
                    <p className="text-xs text-[var(--mimora-muted)] font-mono">
                      @{activeStudent.orgUsername ?? '—'} · Lớp {activeStudent.className}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setGuardianInviteOpen(true)}
                      leftIcon={<Link2 className="h-3.5 w-3.5" aria-hidden="true" />}
                    >
                      Mã liên kết phụ huynh
                    </Button>
                    <Tabs
                      ariaLabel="Hồ sơ chi tiết học sinh"
                      value={detailTab}
                      onChange={setDetailTab}
                      options={[
                        { value: 'profile', label: 'Hồ sơ hỗ trợ', icon: <UserCheck className="h-4 w-4" aria-hidden="true" /> },
                        { value: 'goals', label: 'Mục tiêu SEL', icon: <Target className="h-4 w-4" aria-hidden="true" /> },
                        { value: 'observations', label: 'Ghi chú riêng tư', icon: <Lock className="h-4 w-4" aria-hidden="true" /> },
                      ]}
                    />
                  </div>
                </div>
              </Card>

              {/* Tab 1: Support Preferences */}
              {detailTab === 'profile' && (
                <Card padding="md">
                  <CardHeader
                    title="Tùy chọn hỗ trợ tiếp cận (Phi chẩn đoán)"
                    description="Giúp trẻ học tập dễ chịu hơn theo nhịp độ cá nhân. Trường fontScale và preferredLocale hiện chưa nằm trong schema backend nên không gửi lên máy chủ."
                  />
                  <CardContent>
                    {profileErr && <Alert variant="danger" className="mb-4">{profileErr}</Alert>}
                    {loadingProfile ? (
                      <LoadingState label="Đang tải hồ sơ hỗ trợ..." />
                    ) : (
                      <form onSubmit={(e) => void handleSaveProfile(e)} className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <FormField label="Tên thân mật học sinh thích được gọi (preferredName)" htmlFor="prof-pref-name">
                            <Input
                              id="prof-pref-name"
                              value={preferredName}
                              onChange={(e) => setPreferredName(e.target.value)}
                              placeholder="Ví dụ: Bé An"
                            />
                          </FormField>

                          <FormField label="Hình thức giao tiếp ưu tiên" htmlFor="prof-comm-mode">
                            <Select
                              id="prof-comm-mode"
                              value={commMode}
                              onChange={(e) => setCommMode(e.target.value as PreferredCommunicationMode)}
                              options={[
                                { value: 'mixed', label: 'Kết hợp linh hoạt (mixed)' },
                                { value: 'aac', label: 'Biểu tượng giao tiếp AAC' },
                                { value: 'read_aloud', label: 'Nghe đọc to (read_aloud)' },
                                { value: 'visual', label: 'Hình ảnh trực quan (visual)' },
                              ]}
                            />
                          </FormField>

                          <FormField label="Tốc độ đọc to" htmlFor="prof-speech-rate">
                            <Select
                              id="prof-speech-rate"
                              value={speechRate}
                              onChange={(e) => setSpeechRate(e.target.value as SupportSpeechRate)}
                              options={[
                                { value: 'normal', label: 'Bình thường (normal)' },
                                { value: 'slow', label: 'Chậm dịu (slow)' },
                              ]}
                            />
                          </FormField>

                          <FormField label="Độ tương phản màn hình" htmlFor="prof-contrast">
                            <Select
                              id="prof-contrast"
                              value={visualContrast}
                              onChange={(e) => setVisualContrast(e.target.value as SupportVisualContrast)}
                              options={[
                                { value: 'standard', label: 'Chuẩn dịu mắt (standard)' },
                                { value: 'soft', label: 'Ánh sáng nhẹ (soft)' },
                                { value: 'high_contrast', label: 'Tương phản cao (high_contrast)' },
                              ]}
                            />
                          </FormField>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <label className="flex items-center gap-2.5 rounded-[var(--mimora-radius-sm)] border border-[var(--mimora-border)] px-3 py-2.5 text-sm cursor-pointer">
                            <input
                              type="checkbox"
                              checked={aacEnabled}
                              onChange={(e) => setAacEnabled(e.target.checked)}
                              className="h-4 w-4 accent-[var(--mimora-primary)]"
                            />
                            <span>Bật hỗ trợ AAC</span>
                          </label>
                          <label className="flex items-center gap-2.5 rounded-[var(--mimora-radius-sm)] border border-[var(--mimora-border)] px-3 py-2.5 text-sm cursor-pointer">
                            <input
                              type="checkbox"
                              checked={readAloudEnabled}
                              onChange={(e) => setReadAloudEnabled(e.target.checked)}
                              className="h-4 w-4 accent-[var(--mimora-primary)]"
                            />
                            <span>Bật Đọc to (Read-Aloud)</span>
                          </label>
                          <label className="flex items-center gap-2.5 rounded-[var(--mimora-radius-sm)] border border-[var(--mimora-border)] px-3 py-2.5 text-sm cursor-pointer">
                            <input
                              type="checkbox"
                              checked={reducedMotion}
                              onChange={(e) => setReducedMotion(e.target.checked)}
                              className="h-4 w-4 accent-[var(--mimora-primary)]"
                            />
                            <span>Giảm chuyển động</span>
                          </label>
                        </div>

                        <FormField
                          label="Gợi ý hình ảnh ưa thích (preferredVisualCues, cách nhau dấu phẩy)"
                          htmlFor="prof-visual-cues"
                        >
                          <Input
                            id="prof-visual-cues"
                            value={preferredVisualCues}
                            onChange={(e) => setPreferredVisualCues(e.target.value)}
                            placeholder="minh họa dịu mắt, biểu tượng từng bước"
                          />
                        </FormField>

                        <FormField
                          label="Lưu ý giác quan & sự thoải mái (sensoryNotes — không ghi chẩn đoán y khoa)"
                          htmlFor="prof-sensory-notes"
                        >
                          <textarea
                            id="prof-sensory-notes"
                            rows={3}
                            value={sensoryNotes}
                            onChange={(e) => setSensoryNotes(e.target.value)}
                            placeholder="Ví dụ: Em cảm thấy thoải mái hơn khi âm lượng đọc nhẹ nhàng và không có chuyển động đột ngột."
                            className="w-full rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border-strong)] p-3 text-sm"
                          />
                        </FormField>

                        <div className="flex justify-end">
                          <Button
                            type="submit"
                            variant="primary"
                            loading={savingProfile}
                            leftIcon={<Save className="h-4 w-4" aria-hidden="true" />}
                          >
                            Lưu hồ sơ hỗ trợ
                          </Button>
                        </div>
                      </form>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Tab 2: Individual SEL Goals */}
              {detailTab === 'goals' && (
                <Card padding="md">
                  <CardHeader
                    title="Mục tiêu đồng hành SEL cá nhân"
                    description="Theo dõi mục tiêu phát triển cảm xúc - xã hội theo hướng hỗ trợ tích cực, không chấm điểm GAS hay xếp hạng."
                    action={
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex items-center gap-1.5 text-xs text-[var(--mimora-muted)] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={includeArchivedGoals}
                            onChange={(e) => setIncludeArchivedGoals(e.target.checked)}
                            className="h-3.5 w-3.5 accent-[var(--mimora-primary)]"
                          />
                          Hiện mục tiêu đã lưu trữ
                        </label>
                        <Button
                          variant="primary"
                          size="sm"
                          leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
                          onClick={() => {
                            setEditingGoal(null);
                            setGoalTitle('');
                            setGoalDescription('');
                            setGoalFocusArea('');
                            setGoalTargetDate('');
                            setGoalStatus('active');
                            setGoalFormErr(null);
                            setGoalFormOpen(true);
                          }}
                        >
                          Thêm mục tiêu
                        </Button>
                      </div>
                    }
                  />
                  <CardContent>
                    {goalsErr && <Alert variant="danger" className="mb-4">{goalsErr}</Alert>}
                    {loadingGoals ? (
                      <LoadingState label="Đang tải mục tiêu SEL..." />
                    ) : goals.length === 0 ? (
                      <EmptyState
                        title="Chưa có mục tiêu SEL nào"
                        description="Thêm mục tiêu đồng hành nhẹ nhàng để giáo viên cùng học sinh luyện tập."
                      />
                    ) : (
                      <div className="space-y-3">
                        {goals.map((g) => {
                          const st = getGoalStatusMeta(g.status, locale);
                          return (
                            <div
                              key={g.id}
                              className="rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)] p-4 space-y-2"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <h4 className="font-semibold text-[var(--mimora-text)]">{g.title}</h4>
                                  <p className="text-xs text-[var(--mimora-muted)] mt-0.5">
                                    {g.focusArea ? `Trọng tâm: ${g.focusArea} · ` : ''}
                                    {g.targetDate ? `Mục tiêu ngày: ${formatDateOnly(g.targetDate, locale)}` : 'Không ép hạn'}
                                  </p>
                                </div>
                                <Badge variant={st.variant}>{st.label}</Badge>
                              </div>
                              {g.description && (
                                <p className="text-sm text-[var(--mimora-muted)]">{g.description}</p>
                              )}
                              {g.status !== 'archived' && (
                                <div className="flex flex-wrap gap-2 pt-1">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    leftIcon={<Pencil className="h-3.5 w-3.5" aria-hidden="true" />}
                                    onClick={() => {
                                      setEditingGoal(g);
                                      setGoalTitle(g.title);
                                      setGoalDescription(g.description ?? '');
                                      setGoalFocusArea(g.focusArea ?? '');
                                      setGoalTargetDate(g.targetDate ?? '');
                                      setGoalStatus(g.status);
                                      setGoalFormErr(null);
                                      setGoalFormOpen(true);
                                    }}
                                  >
                                    Chỉnh sửa
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    leftIcon={<Archive className="h-3.5 w-3.5" aria-hidden="true" />}
                                    onClick={() => setConfirmArchiveGoal(g)}
                                  >
                                    Lưu trữ
                                  </Button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Tab 3: Private Author-Only Observations */}
              {detailTab === 'observations' && (
                <Card padding="md">
                  <CardHeader
                    title="Ghi chú quan sát riêng tư của giáo viên"
                    description="Chỉ mình bạn xem, sửa hoặc xóa các ghi chú do chính bạn viết. Đồng giáo viên khác và quản trị viên không thể xem."
                    action={
                      <Button
                        variant="primary"
                        size="sm"
                        leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
                        onClick={() => {
                          setEditingObs(null);
                          setObsBody('');
                          setObsClassId(activeStudent.classId);
                          setObsFormErr(null);
                          setObsModalOpen(true);
                        }}
                      >
                        Viết ghi chú mới
                      </Button>
                    }
                  />
                  <CardContent>
                    {obsErr && <Alert variant="danger" className="mb-4">{obsErr}</Alert>}
                    {loadingObs ? (
                      <LoadingState label="Đang tải ghi chú riêng tư..." />
                    ) : observations.length === 0 ? (
                      <EmptyState
                        title="Bạn chưa có ghi chú nào cho học sinh này"
                        description="Ghi lại những quan sát hỗ trợ tích cực để nhớ cách đồng hành phù hợp với em trong các buổi tới."
                        calmNote="Ghi chú của các đồng giáo viên khác được cô lập hoàn toàn và không hiển thị tại đây."
                      />
                    ) : (
                      <div className="space-y-3">
                        {observations.map((obs) => (
                          <div
                            key={obs.id}
                            className="rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)] p-4 space-y-2"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--mimora-muted)]">
                              <span className="inline-flex items-center gap-1.5 font-medium text-[var(--mimora-primary)]">
                                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                                Ghi chú riêng tư của bạn
                              </span>
                              <span>Cập nhật: {formatDateTime(obs.updatedAt, locale)}</span>
                            </div>
                            <p className="text-sm text-[var(--mimora-text)] whitespace-pre-wrap leading-relaxed">
                              {obs.noteBody}
                            </p>
                            <div className="flex flex-wrap gap-2 pt-1">
                              <Button
                                variant="outline"
                                size="sm"
                                leftIcon={<Pencil className="h-3.5 w-3.5" aria-hidden="true" />}
                                onClick={() => {
                                  setEditingObs(obs);
                                  setObsBody(obs.noteBody);
                                  setObsClassId(obs.classId ?? '');
                                  setObsFormErr(null);
                                  setObsModalOpen(true);
                                }}
                              >
                                Chỉnh sửa
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                leftIcon={<Trash2 className="h-3.5 w-3.5 text-[var(--mimora-danger)]" aria-hidden="true" />}
                                onClick={() => setConfirmDeleteObs(obs)}
                              >
                                Xóa ghi chú
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </div>

      {/* Goal Modal */}
      <Dialog
        open={goalFormOpen}
        onClose={() => setGoalFormOpen(false)}
        title={editingGoal ? 'Cập nhật mục tiêu SEL' : 'Thêm mục tiêu SEL mới'}
      >
        <form onSubmit={(e) => void handleSaveGoal(e)} className="space-y-4">
          {goalFormErr && <Alert variant="danger">{goalFormErr}</Alert>}

          <FormField label="Tên mục tiêu" htmlFor="goal-title" required>
            <Input
              id="goal-title"
              value={goalTitle}
              onChange={(e) => setGoalTitle(e.target.value)}
              placeholder="Ví dụ: Thực hành xin nghỉ ngơi bằng thẻ AAC khi lớp ồn"
              required
            />
          </FormField>

          <FormField label="Lĩnh vực trọng tâm (focusArea)" htmlFor="goal-focus">
            <Input
              id="goal-focus"
              value={goalFocusArea}
              onChange={(e) => setGoalFocusArea(e.target.value)}
              placeholder="Tự điều chỉnh cảm xúc / Giao tiếp"
            />
          </FormField>

          <FormField label="Mô tả cách đồng hành" htmlFor="goal-desc">
            <textarea
              id="goal-desc"
              rows={3}
              value={goalDescription}
              onChange={(e) => setGoalDescription(e.target.value)}
              className="w-full rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border-strong)] p-3 text-sm"
            />
          </FormField>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Ngày mục tiêu (YYYY-MM-DD, tùy chọn)" htmlFor="goal-date">
              <Input
                id="goal-date"
                type="date"
                value={goalTargetDate}
                onChange={(e) => setGoalTargetDate(e.target.value)}
              />
            </FormField>

            {editingGoal && (
              <FormField label="Trạng thái" htmlFor="goal-status">
                <Select
                  id="goal-status"
                  value={goalStatus}
                  onChange={(e) => setGoalStatus(e.target.value as GoalStatus)}
                  options={[
                    { value: 'active', label: 'Đang đồng hành (active)' },
                    { value: 'achieved', label: 'Đã đạt mục tiêu (achieved)' },
                    { value: 'paused', label: 'Tạm nghỉ (paused)' },
                  ]}
                />
              </FormField>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setGoalFormOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" loading={savingGoal}>
              Lưu mục tiêu
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Archive Goal Confirm */}
      <Dialog
        open={Boolean(confirmArchiveGoal)}
        onClose={() => setConfirmArchiveGoal(null)}
        title="Lưu trữ mục tiêu SEL"
        description={`Xác nhận chuyển mục tiêu "${confirmArchiveGoal?.title ?? ''}" sang trạng thái đã lưu trữ?`}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmArchiveGoal(null)}>
              Hủy
            </Button>
            <Button variant="danger" onClick={() => void handleArchiveGoal()}>
              Xác nhận lưu trữ
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--mimora-muted)]">
          Bạn vẫn có thể xem lại bằng bộ lọc "Hiện mục tiêu đã lưu trữ".
        </p>
      </Dialog>

      {/* Observation Modal */}
      <Dialog
        open={obsModalOpen}
        onClose={() => setObsModalOpen(false)}
        title={editingObs ? 'Sửa ghi chú quan sát riêng tư' : 'Viết ghi chú quan sát riêng tư mới'}
        description="Ghi chú này chỉ hiển thị duy nhất với tài khoản tác giả là bạn."
      >
        <form onSubmit={(e) => void handleSaveObs(e)} className="space-y-4">
          {obsFormErr && <Alert variant="danger">{obsFormErr}</Alert>}

          <FormField label="Gắn ngữ cảnh lớp học (tùy chọn)" htmlFor="obs-class">
            <Select
              id="obs-class"
              value={obsClassId}
              onChange={(e) => setObsClassId(e.target.value)}
              options={[
                { value: '', label: 'Không gắn lớp cụ thể' },
                ...classes.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          </FormField>

          <FormField label="Nội dung quan sát" htmlFor="obs-body" required>
            <textarea
              id="obs-body"
              rows={4}
              value={obsBody}
              onChange={(e) => setObsBody(e.target.value)}
              placeholder="Ghi lại điều hỗ trợ tốt cho em hoặc bối cảnh em cảm thấy an tâm..."
              className="w-full rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border-strong)] p-3 text-sm"
              required
            />
          </FormField>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setObsModalOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" loading={savingObs}>
              Lưu ghi chú riêng tư
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Delete Observation Confirm */}
      <Dialog
        open={Boolean(confirmDeleteObs)}
        onClose={() => setConfirmDeleteObs(null)}
        title="Xác nhận xóa ghi chú riêng tư"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDeleteObs(null)}>
              Hủy
            </Button>
            <Button variant="danger" onClick={() => void handleDeleteObs()}>
              Xóa ghi chú
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--mimora-muted)]">
          Ghi chú này sẽ được ẩn khỏi danh sách quan sát riêng tư của bạn.
        </p>
      </Dialog>
      <GuardianInviteDialog
        open={guardianInviteOpen && Boolean(activeStudent)}
        onClose={() => setGuardianInviteOpen(false)}
        locale={locale}
        mode="teacher"
        studentMembershipId={activeStudent?.studentMembershipId ?? null}
        studentDisplayName={activeStudent?.displayName ?? ''}
        onToast={onToast}
      />
    </div>
  );
}
