import {
  Archive,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  FilePlus2,
  HeartHandshake,
  Lock,
  Plus,
  Send,
  Trash2,
  UserPlus,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { adminApi } from '../../api/admin.ts';
import { ApiClientError } from '../../api/client.ts';
import { resolveLocalizedErrorMessage, type AppLocale } from '../../i18n/index.ts';
import type {
  AdminFamilyWorkspaceCandidate,
  FamilyProgramAvailabilityMode,
  SafeAdminProgramDetailResponse,
  SafeAdminProgramSummaryView,
  SafeAdminProgramVersionView,
} from '../../types/admin.ts';
import type { CanonicalContentType } from '../../types/chapter.ts';
import { formatDateTime, getContentTypeLabel } from '../../utils/p302.ts';
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
} from '../ui/index.ts';

export interface AdminFamilyProgramsPageProps {
  locale: AppLocale;
  onToast: (msg: string) => void;
}

interface PublishedContentOption {
  contentVersionId: string;
  contentItemId: string;
  slug: string;
  contentType: string;
  versionNumber: number;
  title: string;
  locale: string;
}

interface DraftItemRow {
  chapterNumber: number;
  chapterTitle: string;
  contentVersionId: string;
}

function getProgramStatusBadge(status: string): {
  label: string;
  variant: 'success' | 'warning' | 'neutral';
} {
  if (status === 'published') return { label: 'Đã xuất bản', variant: 'success' };
  if (status === 'retired') return { label: 'Ngừng phát hành mới', variant: 'neutral' };
  return { label: 'Bản nháp', variant: 'warning' };
}

function getAvailabilityLabel(mode: string): string {
  return mode === 'free_family'
    ? 'Miễn phí cho gia đình'
    : 'Quản trị viên kích hoạt';
}

export function AdminFamilyProgramsPage({
  locale,
  onToast,
}: AdminFamilyProgramsPageProps) {
  const [programs, setPrograms] = useState<SafeAdminProgramSummaryView[]>([]);
  const [selectedProgramId, setSelectedProgramId] = useState<string>('');
  const [detail, setDetail] = useState<SafeAdminProgramDetailResponse | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');

  const [publishedContent, setPublishedContent] = useState<PublishedContentOption[]>([]);
  const [workspaceCandidates, setWorkspaceCandidates] = useState<
    AdminFamilyWorkspaceCandidate[]
  >([]);

  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Create/Edit Version Modal State
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<
    'create_program' | 'edit_draft' | 'new_version'
  >('create_program');
  const [formSlug, setFormSlug] = useState('');
  const [formMode, setFormMode] =
    useState<FamilyProgramAvailabilityMode>('admin_assigned');
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formLocale, setFormLocale] = useState<'vi' | 'vi-VN' | 'en' | 'en-US'>('vi');
  const [formAgeBand, setFormAgeBand] = useState('');
  const [formItems, setFormItems] = useState<DraftItemRow[]>([]);
  const [editorErr, setEditorErr] = useState<string | null>(null);
  const [savingEditor, setSavingEditor] = useState(false);

  // Manual Admin Activation (Enroll Student) Modal State
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollSearch, setEnrollSearch] = useState('');
  const [enrollWorkspaceId, setEnrollWorkspaceId] = useState('');
  const [enrollStudentUserId, setEnrollStudentUserId] = useState('');
  const [enrollErr, setEnrollErr] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);

  const loadPrograms = useCallback(
    async (preferId?: string) => {
      setLoadingList(true);
      setErrorMsg(null);
      try {
        const res = await adminApi.listFamilyPrograms();
        setPrograms(res.programs);
        setSelectedProgramId((prev) => {
          if (preferId && res.programs.some((p) => p.id === preferId)) {
            return preferId;
          }
          if (prev && res.programs.some((p) => p.id === prev)) {
            return prev;
          }
          return res.programs[0]?.id ?? '';
        });
      } catch (err) {
        setErrorMsg(
          err instanceof ApiClientError
            ? resolveLocalizedErrorMessage(err.info, locale)
            : 'Không thể tải danh sách chương trình gia đình.'
        );
      } finally {
        setLoadingList(false);
      }
    },
    [locale]
  );

  const loadPublishedContentPool = useCallback(async () => {
    try {
      const listRes = await adminApi.listContentItems({
        isArchived: 'false',
        page: 1,
        limit: 50,
      });
      const publishedItems = listRes.items.filter(
        (item) => Boolean(item.currentPublishedVersionId) && !item.isArchived
      );
      const details = await Promise.all(
        publishedItems.map((item) => adminApi.getContentItem(item.id))
      );
      const options: PublishedContentOption[] = [];
      for (const d of details) {
        const pubVer = d.versions.find(
          (v) =>
            v.id === d.item.currentPublishedVersionId && v.status === 'published'
        );
        if (pubVer) {
          options.push({
            contentVersionId: pubVer.id,
            contentItemId: d.item.id,
            slug: d.item.slug,
            contentType: d.item.contentType,
            versionNumber: pubVer.versionNumber,
            title: pubVer.title,
            locale: pubVer.locale,
          });
        }
      }
      setPublishedContent(options);
    } catch {
      // Keep pool empty cleanly if unavailable; handled in UI message
    }
  }, []);

  const loadDetail = useCallback(
    async (programId: string, preferVersionId?: string) => {
      if (!programId) {
        setDetail(null);
        setSelectedVersionId('');
        return;
      }
      setLoadingDetail(true);
      setErrorMsg(null);
      try {
        const res = await adminApi.getFamilyProgramDetail(programId);
        setDetail(res);
        setSelectedVersionId((prev) => {
          if (preferVersionId && res.versions.some((v) => v.id === preferVersionId)) {
            return preferVersionId;
          }
          if (prev && res.versions.some((v) => v.id === prev)) {
            return prev;
          }
          return res.versions[0]?.id ?? '';
        });
      } catch (err) {
        setErrorMsg(
          err instanceof ApiClientError
            ? resolveLocalizedErrorMessage(err.info, locale)
            : 'Không thể tải chi tiết chương trình gia đình.'
        );
      } finally {
        setLoadingDetail(false);
      }
    },
    [locale]
  );

  useEffect(() => {
    void loadPrograms();
    void loadPublishedContentPool();
  }, [loadPrograms, loadPublishedContentPool]);

  useEffect(() => {
    if (selectedProgramId) {
      void loadDetail(selectedProgramId);
    } else {
      setDetail(null);
    }
  }, [selectedProgramId, loadDetail]);

  const activeVersion: SafeAdminProgramVersionView | null = useMemo(() => {
    if (!detail) return null;
    return (
      detail.versions.find((v) => v.id === selectedVersionId) ??
      detail.versions[0] ??
      null
    );
  }, [detail, selectedVersionId]);

  const openCreateProgram = () => {
    setEditorMode('create_program');
    setFormSlug('');
    setFormMode('admin_assigned');
    setFormTitle('');
    setFormDescription('');
    setFormLocale('vi');
    setFormAgeBand('6-10 tuổi');
    setFormItems(
      publishedContent[0]
        ? [
            {
              chapterNumber: 1,
              chapterTitle: 'Chương 1: Khởi đầu bình tĩnh',
              contentVersionId: publishedContent[0].contentVersionId,
            },
          ]
        : []
    );
    setEditorErr(null);
    setEditorOpen(true);
  };

  const openEditDraft = (ver: SafeAdminProgramVersionView) => {
    setEditorMode('edit_draft');
    setFormSlug(detail?.program.slug ?? '');
    setFormMode(
      ver.availabilityMode === 'free_family' ? 'free_family' : 'admin_assigned'
    );
    setFormTitle(ver.title);
    setFormDescription(ver.description ?? '');
    setFormLocale((ver.locale as 'vi' | 'vi-VN' | 'en' | 'en-US') || 'vi');
    setFormAgeBand(ver.ageBand ?? '');
    setFormItems(
      (ver.items ?? []).map((it) => ({
        chapterNumber: it.chapterNumber,
        chapterTitle: it.chapterTitle,
        contentVersionId: it.contentVersionId,
      }))
    );
    setEditorErr(null);
    setEditorOpen(true);
  };

  const openNewDraftVersion = (baseVer: SafeAdminProgramVersionView) => {
    setEditorMode('new_version');
    setFormSlug(detail?.program.slug ?? '');
    setFormMode(
      baseVer.availabilityMode === 'free_family'
        ? 'free_family'
        : 'admin_assigned'
    );
    setFormTitle(baseVer.title);
    setFormDescription(baseVer.description ?? '');
    setFormLocale((baseVer.locale as 'vi' | 'vi-VN' | 'en' | 'en-US') || 'vi');
    setFormAgeBand(baseVer.ageBand ?? '');
    setFormItems(
      (baseVer.items ?? []).map((it) => ({
        chapterNumber: it.chapterNumber,
        chapterTitle: it.chapterTitle,
        contentVersionId: it.contentVersionId,
      }))
    );
    setEditorErr(null);
    setEditorOpen(true);
  };

  const addDraftItemRow = () => {
    const fallbackCv = publishedContent[0]?.contentVersionId ?? '';
    const lastChapter = formItems[formItems.length - 1]?.chapterNumber ?? 1;
    setFormItems((prev) => [
      ...prev,
      {
        chapterNumber: lastChapter,
        chapterTitle: `Chương ${lastChapter}: Hoạt động thực hành`,
        contentVersionId: fallbackCv,
      },
    ]);
  };

  const moveDraftItem = (idx: number, delta: -1 | 1) => {
    const target = idx + delta;
    if (target < 0 || target >= formItems.length) return;
    setFormItems((prev) => {
      const next = [...prev];
      const temp = next[idx];
      next[idx] = next[target];
      next[target] = temp;
      return next;
    });
  };

  const handleSaveEditor = async (e: FormEvent) => {
    e.preventDefault();
    setEditorErr(null);
    if (!formTitle.trim()) {
      setEditorErr('Vui lòng nhập tiêu đề chương trình.');
      return;
    }
    if (editorMode === 'create_program' && !formSlug.trim()) {
      setEditorErr('Vui lòng nhập slug định danh cho chương trình.');
      return;
    }

    const cleanItems = formItems
      .filter((i) => i.contentVersionId.trim().length > 0 && i.chapterTitle.trim().length > 0)
      .map((i) => ({
        chapterNumber: Math.max(1, Number(i.chapterNumber) || 1),
        chapterTitle: i.chapterTitle.trim(),
        contentVersionId: i.contentVersionId.trim(),
      }));

    setSavingEditor(true);
    try {
      if (editorMode === 'create_program') {
        const res = await adminApi.createFamilyProgram({
          slug: formSlug.trim().toLowerCase(),
          availabilityMode: formMode,
          title: formTitle.trim(),
          description: formDescription.trim() || null,
          locale: formLocale,
          ageBand: formAgeBand.trim() || null,
          items: cleanItems,
        });
        setEditorOpen(false);
        onToast(`Đã tạo chương trình gia đình "${formTitle.trim()}" (bản nháp v1).`);
        await loadPrograms(res.program.id);
        await loadDetail(res.program.id, res.versions[0]?.id);
      } else if (editorMode === 'edit_draft' && detail && activeVersion) {
        await adminApi.updateDraftFamilyProgramVersion(
          detail.program.id,
          activeVersion.id,
          {
            availabilityMode: formMode,
            title: formTitle.trim(),
            description: formDescription.trim() || null,
            locale: formLocale,
            ageBand: formAgeBand.trim() || null,
            items: cleanItems,
          }
        );
        setEditorOpen(false);
        onToast(`Đã lưu bản nháp v${activeVersion.versionNumber}.`);
        await loadPrograms(detail.program.id);
        await loadDetail(detail.program.id, activeVersion.id);
      } else if (editorMode === 'new_version' && detail) {
        const res = await adminApi.createFamilyProgramVersion(detail.program.id, {
          availabilityMode: formMode,
          title: formTitle.trim(),
          description: formDescription.trim() || null,
          locale: formLocale,
          ageBand: formAgeBand.trim() || null,
          items: cleanItems,
        });
        setEditorOpen(false);
        onToast('Đã tạo phiên bản nháp mới.');
        await loadPrograms(detail.program.id);
        await loadDetail(detail.program.id, res.createdVersionId);
      }
    } catch (err) {
      setEditorErr(
        err instanceof ApiClientError
          ? resolveLocalizedErrorMessage(err.info, locale)
          : 'Không thể lưu chương trình gia đình.'
      );
    } finally {
      setSavingEditor(false);
    }
  };

  const handlePublishVersion = async (ver: SafeAdminProgramVersionView) => {
    if (!detail) return;
    setActionBusy(true);
    setErrorMsg(null);
    try {
      await adminApi.publishFamilyProgramVersion(detail.program.id, ver.id);
      onToast(`Đã xuất bản v${ver.versionNumber}. Phiên bản này từ nay là bất biến.`);
      await loadPrograms(detail.program.id);
      await loadDetail(detail.program.id, ver.id);
    } catch (err) {
      setErrorMsg(
        err instanceof ApiClientError
          ? resolveLocalizedErrorMessage(err.info, locale)
          : 'Không thể xuất bản phiên bản chương trình.'
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleRetireProgram = async () => {
    if (!detail) return;
    setActionBusy(true);
    setErrorMsg(null);
    try {
      await adminApi.retireFamilyProgram(detail.program.id);
      onToast('Đã ngừng phát hành mới chương trình. Học sinh đang tham gia vẫn tiếp tục học bình thường.');
      await loadPrograms(detail.program.id);
      await loadDetail(detail.program.id);
    } catch (err) {
      setErrorMsg(
        err instanceof ApiClientError
          ? resolveLocalizedErrorMessage(err.info, locale)
          : 'Không thể ngừng phát hành chương trình.'
      );
    } finally {
      setActionBusy(false);
    }
  };

  const loadWorkspaceCandidates = useCallback(async (searchText?: string) => {
    try {
      const res = await adminApi.listEligibleFamilyWorkspaces(searchText);
      setWorkspaceCandidates(res.workspaces);
      const firstWsWithStudent =
        res.workspaces.find((w) => w.students.length > 0) ?? res.workspaces[0];
      if (firstWsWithStudent) {
        setEnrollWorkspaceId(firstWsWithStudent.workspaceId);
        setEnrollStudentUserId(firstWsWithStudent.students[0]?.studentUserId ?? '');
      }
    } catch {
      // ignore
    }
  }, []);

  const openEnrollModal = async () => {
    setEnrollErr(null);
    setEnrollSearch('');
    setEnrollOpen(true);
    await loadWorkspaceCandidates();
  };

  const selectedEnrollWorkspace = useMemo(
    () =>
      workspaceCandidates.find((w) => w.workspaceId === enrollWorkspaceId) ?? null,
    [workspaceCandidates, enrollWorkspaceId]
  );

  const handleEnrollStudent = async (e: FormEvent) => {
    e.preventDefault();
    if (!detail || !enrollWorkspaceId || !enrollStudentUserId) {
      setEnrollErr('Vui lòng chọn Không gian Gia đình và học sinh cần kích hoạt.');
      return;
    }
    setEnrolling(true);
    setEnrollErr(null);
    try {
      await adminApi.enrollStudentInFamilyProgram(detail.program.id, {
        familyWorkspaceId: enrollWorkspaceId,
        studentUserId: enrollStudentUserId,
      });
      setEnrollOpen(false);
      onToast('Đã kích hoạt chương trình cho học sinh trong Không gian Gia đình.');
      await loadDetail(detail.program.id);
    } catch (err) {
      setEnrollErr(
        err instanceof ApiClientError
          ? resolveLocalizedErrorMessage(err.info, locale)
          : 'Không thể kích hoạt chương trình cho học sinh.'
      );
    } finally {
      setEnrolling(false);
    }
  };

  const handleRevokeEnrollment = async (enrollmentId: string) => {
    if (!detail) return;
    setActionBusy(true);
    setErrorMsg(null);
    try {
      await adminApi.revokeFamilyProgramEnrollment(enrollmentId);
      onToast('Đã thu hồi quyền tham gia chương trình.');
      await loadDetail(detail.program.id);
    } catch (err) {
      setErrorMsg(
        err instanceof ApiClientError
          ? resolveLocalizedErrorMessage(err.info, locale)
          : 'Không thể thu hồi lượt kích hoạt.'
      );
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        metadataLine="Quản trị Chương trình Gia đình · Không cần giáo viên · Phiên bản bất biến"
        title="Chương trình Gia đình"
        description="Thiết kế chương trình SEL từ các học liệu đã duyệt xuất bản (published), quản lý phiên bản bất biến và kích hoạt cho Không gian Gia đình hợp lệ."
        action={
          <Button
            type="button"
            variant="primary"
            onClick={openCreateProgram}
            leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
          >
            Tạo chương trình mới
          </Button>
        }
      />

      <Alert variant="info" title="Quy tắc an toàn & phiên bản bất biến">
        Chỉ học liệu SEL đang ở trạng thái đã xuất bản (published) mới được đưa vào Chương trình Gia đình. Sau khi xuất bản một phiên bản chương trình, phiên bản đó sẽ khóa chỉnh sửa (bất biến) — khi cần thay đổi hãy tạo phiên bản nháp mới. Quản trị viên chỉ thấy danh sách kích hoạt, không xem câu trả lời hay cảm xúc của học sinh.
      </Alert>

      {errorMsg && <Alert variant="danger">{errorMsg}</Alert>}

      {loadingList ? (
        <LoadingState label="Đang tải danh sách chương trình gia đình..." />
      ) : programs.length === 0 ? (
        <EmptyState
          title="Chưa có Chương trình Gia đình nào"
          description="Tạo chương trình bản nháp đầu tiên từ các thẻ SEL đã xuất bản trong Thư viện SEL."
          action={
            <Button
              type="button"
              variant="primary"
              onClick={openCreateProgram}
              leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
            >
              Tạo chương trình đầu tiên
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Program List */}
          <div className="lg:col-span-4 space-y-2">
            {programs.map((prog) => {
              const selected = prog.id === selectedProgramId;
              const badge = getProgramStatusBadge(prog.status);
              return (
                <button
                  key={prog.id}
                  type="button"
                  onClick={() => setSelectedProgramId(prog.id)}
                  className={[
                    'w-full text-left rounded-[var(--mimora-radius-md)] border p-4 transition-colors cursor-pointer space-y-1.5',
                    selected
                      ? 'bg-[var(--mimora-surface-mint)] border-[#8fc4b8]'
                      : 'bg-[var(--mimora-surface)] border-[var(--mimora-border)] hover:bg-[var(--mimora-surface-subtle)]/70',
                  ].join(' ')}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-sm text-[var(--mimora-text)] break-words">
                      {prog.title}
                    </span>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </div>
                  <p className="font-mono text-xs text-[var(--mimora-primary)]">{prog.slug}</p>
                  <p className="text-xs text-[var(--mimora-muted)]">
                    v{prog.latestVersionNumber} · {getAvailabilityLabel(prog.availabilityMode)}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Program Detail */}
          <div className="lg:col-span-8 space-y-6">
            {loadingDetail || !detail ? (
              <LoadingState label="Đang tải chi tiết chương trình..." />
            ) : (
              <>
                <Card padding="md">
                  <CardHeader
                    title={activeVersion?.title ?? detail.program.slug}
                    description={`Slug: ${detail.program.slug} · ${getAvailabilityLabel(detail.program.availabilityMode)}`}
                    action={
                      <div className="flex flex-wrap gap-2">
                        {detail.program.status !== 'retired' && activeVersion && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => openNewDraftVersion(activeVersion)}
                            leftIcon={<FilePlus2 className="h-4 w-4" aria-hidden="true" />}
                          >
                            Tạo phiên bản nháp mới
                          </Button>
                        )}
                        {detail.program.status !== 'retired' && (
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            disabled={actionBusy}
                            onClick={() => void handleRetireProgram()}
                            leftIcon={<Archive className="h-4 w-4" aria-hidden="true" />}
                          >
                            Ngừng phát hành mới
                          </Button>
                        )}
                      </div>
                    }
                  />
                  <CardContent className="space-y-4">
                    {/* Version Switcher */}
                    <div className="flex flex-wrap gap-2">
                      {detail.versions.map((ver) => {
                        const isSel = ver.id === activeVersion?.id;
                        const st = getProgramStatusBadge(ver.status);
                        return (
                          <button
                            key={ver.id}
                            type="button"
                            onClick={() => setSelectedVersionId(ver.id)}
                            className={[
                              'inline-flex items-center gap-2 rounded-[var(--mimora-radius-sm)] border px-3 py-1.5 text-xs font-medium cursor-pointer',
                              isSel
                                ? 'bg-[var(--mimora-primary)] text-white border-transparent'
                                : 'bg-[var(--mimora-surface)] text-[var(--mimora-text)] border-[var(--mimora-border)]',
                            ].join(' ')}
                          >
                            <span>v{ver.versionNumber}</span>
                            <span>({st.label})</span>
                          </button>
                        );
                      })}
                    </div>

                    {activeVersion && (
                      <div className="space-y-4 rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)] bg-[var(--mimora-surface-subtle)]/50 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="space-y-0.5">
                            <p className="text-sm font-semibold text-[var(--mimora-text)]">
                              Phiên bản v{activeVersion.versionNumber} ·{' '}
                              {getProgramStatusBadge(activeVersion.status).label}
                            </p>
                            <p className="text-xs text-[var(--mimora-muted)]">
                              {activeVersion.ageBand || 'Chưa gắn nhóm tuổi'} · Ngôn ngữ:{' '}
                              {activeVersion.locale}
                            </p>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {activeVersion.status === 'draft' ? (
                              <>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openEditDraft(activeVersion)}
                                >
                                  Chỉnh sửa bản nháp
                                </Button>
                                <Button
                                  type="button"
                                  variant="primary"
                                  size="sm"
                                  loading={actionBusy}
                                  disabled={(activeVersion.items ?? []).length === 0}
                                  onClick={() => void handlePublishVersion(activeVersion)}
                                  leftIcon={<Send className="h-4 w-4" aria-hidden="true" />}
                                >
                                  Xuất bản v{activeVersion.versionNumber}
                                </Button>
                              </>
                            ) : (
                              <Badge variant="neutral">
                                <span className="inline-flex items-center gap-1">
                                  <Lock className="h-3 w-3" aria-hidden="true" />
                                  <span>Phiên bản bất biến</span>
                                </span>
                              </Badge>
                            )}
                          </div>
                        </div>

                        {activeVersion.description && (
                          <p className="text-sm text-[var(--mimora-text)] leading-relaxed">
                            {activeVersion.description}
                          </p>
                        )}

                        <div className="space-y-2">
                          <p className="text-xs font-semibold text-[var(--mimora-muted)]">
                            Cấu trúc Chương & Hoạt động SEL ({(activeVersion.items ?? []).length})
                          </p>
                          {(activeVersion.items ?? []).length === 0 ? (
                            <p className="text-xs text-[var(--mimora-muted)]">
                              Phiên bản nháp chưa có hoạt động nào. Hãy chỉnh sửa bản nháp để thêm thẻ SEL đã xuất bản.
                            </p>
                          ) : (
                            <div className="space-y-1.5">
                              {(activeVersion.items ?? []).map((it, idx) => (
                                <div
                                  key={it.id}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--mimora-radius-sm)] bg-[var(--mimora-surface)] border border-[var(--mimora-border)] px-3 py-2 text-xs"
                                >
                                  <div className="space-y-0.5">
                                    <p className="font-semibold text-[var(--mimora-text)]">
                                      {idx + 1}. Chương {it.chapterNumber}: {it.chapterTitle}
                                    </p>
                                    <p className="text-[var(--mimora-muted)]">
                                      Thẻ: {it.contentTitle} ({getContentTypeLabel(it.contentType as CanonicalContentType)} · v
                                      {it.contentVersionNumber})
                                    </p>
                                  </div>
                                  <Badge variant="success">Published</Badge>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Operational Enrollment Roster */}
                <Card padding="md">
                  <CardHeader
                    title={`Danh sách kích hoạt Gia đình (${detail.enrollments.length})`}
                    description="Chỉ hiển thị trạng thái kích hoạt và phiên bản đã ghim — tuyệt đối không hiển thị câu trả lời hay telemetry của học sinh."
                    action={
                      detail.program.status === 'published' && (
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          onClick={() => void openEnrollModal()}
                          leftIcon={<UserPlus className="h-4 w-4" aria-hidden="true" />}
                        >
                          Kích hoạt cho Gia đình
                        </Button>
                      )
                    }
                  />
                  <CardContent>
                    {detail.enrollments.length === 0 ? (
                      <p className="text-sm text-[var(--mimora-muted)]">
                        {detail.program.status === 'published'
                          ? 'Chưa có học sinh nào được kích hoạt chương trình này.'
                          : 'Hãy xuất bản ít nhất một phiên bản chương trình trước khi kích hoạt cho gia đình.'}
                      </p>
                    ) : (
                      <div className="divide-y divide-[var(--mimora-border)] border border-[var(--mimora-border)] rounded-[var(--mimora-radius-md)]">
                        {detail.enrollments.map((row) => (
                          <div
                            key={row.enrollmentId}
                            className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs"
                          >
                            <div className="space-y-0.5">
                              <p className="font-semibold text-sm text-[var(--mimora-text)]">
                                {row.studentDisplayName}{' '}
                                <span className="font-mono text-xs text-[var(--mimora-muted)]">
                                  {row.familyUsername ? `@${row.familyUsername}` : ''}
                                </span>
                              </p>
                              <p className="text-[var(--mimora-muted)]">
                                {row.workspaceName} ({row.workspaceCode}) · Ghim v{row.versionNumber} ·{' '}
                                {row.activationSource === 'free_program'
                                  ? 'Phụ huynh tự mở'
                                  : 'Quản trị cấp'}
                              </p>
                              <p className="text-[var(--mimora-muted)] tabular-nums">
                                Kích hoạt: {formatDateTime(row.activatedAt)}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={row.status === 'active' ? 'success' : 'neutral'}>
                                {row.status === 'active' ? 'Đang mở' : 'Đã thu hồi'}
                              </Badge>
                              {row.status === 'active' && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={actionBusy}
                                  onClick={() => void handleRevokeEnrollment(row.enrollmentId)}
                                  leftIcon={<XCircle className="h-3.5 w-3.5" aria-hidden="true" />}
                                >
                                  Thu hồi
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      )}

      {/* Create / Edit Draft / New Version Dialog */}
      <Dialog
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        maxWidthClass="max-w-3xl"
        title={
          editorMode === 'create_program'
            ? 'Tạo Chương trình Gia đình mới (Bản nháp v1)'
            : editorMode === 'edit_draft'
              ? 'Chỉnh sửa phiên bản nháp'
              : 'Tạo phiên bản nháp mới'
        }
        description="Gắn các thẻ SEL đã xuất bản vào từng chương theo đúng thứ tự học nhẹ nhàng cho trẻ."
      >
        <form onSubmit={(e) => void handleSaveEditor(e)} className="space-y-4">
          {editorErr && <Alert variant="danger">{editorErr}</Alert>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {editorMode === 'create_program' && (
              <FormField
                label="Slug định danh"
                htmlFor="fp-slug"
                hint="Chỉ gồm a-z, 0-9, gạch ngang/dưới."
                required
              >
                <Input
                  id="fp-slug"
                  value={formSlug}
                  onChange={(e) => setFormSlug(e.target.value)}
                  placeholder="vi-du: binh-tinh-tai-nha"
                  disabled={savingEditor}
                />
              </FormField>
            )}

            <FormField label="Chế độ mở chương trình" htmlFor="fp-mode" required>
              <Select
                id="fp-mode"
                value={formMode}
                onChange={(e) =>
                  setFormMode(e.target.value as FamilyProgramAvailabilityMode)
                }
                options={[
                  { value: 'admin_assigned', label: 'Quản trị viên kích hoạt cho gia đình' },
                  { value: 'free_family', label: 'Miễn phí (Phụ huynh tự mở)' },
                ]}
              />
            </FormField>

            <FormField label="Tiêu đề chương trình" htmlFor="fp-title" required>
              <Input
                id="fp-title"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="Ví dụ: Hành trình lắng nghe cảm xúc tại nhà"
                disabled={savingEditor}
              />
            </FormField>

            <FormField label="Nhóm tuổi gợi ý" htmlFor="fp-ageband">
              <Input
                id="fp-ageband"
                value={formAgeBand}
                onChange={(e) => setFormAgeBand(e.target.value)}
                placeholder="Ví dụ: 6-10 tuổi"
                disabled={savingEditor}
              />
            </FormField>
          </div>

          <FormField label="Mô tả nhẹ nhàng" htmlFor="fp-desc">
            <Input
              id="fp-desc"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder="Mô tả ngắn gọn mục tiêu thực hành tại nhà..."
              disabled={savingEditor}
            />
          </FormField>

          {/* Items Picker */}
          <div className="space-y-3 rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)] p-4 bg-[var(--mimora-surface-subtle)]/40">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-[var(--mimora-text)]">
                Các hoạt động SEL đã xuất bản trong chương trình ({formItems.length})
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={publishedContent.length === 0}
                onClick={addDraftItemRow}
                leftIcon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
              >
                Thêm hoạt động
              </Button>
            </div>

            {publishedContent.length === 0 && (
              <Alert variant="warning">
                Chưa tìm thấy thẻ SEL nào đang ở trạng thái đã xuất bản (published). Vui lòng duyệt và xuất bản thẻ trong mục “Thư viện SEL” trước.
              </Alert>
            )}

            <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
              {formItems.map((row, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end rounded-[var(--mimora-radius-sm)] border border-[var(--mimora-border)] bg-[var(--mimora-surface)] p-2.5"
                >
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-medium text-[var(--mimora-muted)] mb-1">
                      Chương số
                    </label>
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={String(row.chapterNumber)}
                      onChange={(e) =>
                        setFormItems((prev) =>
                          prev.map((it, i) =>
                            i === idx
                              ? { ...it, chapterNumber: Number(e.target.value) || 1 }
                              : it
                          )
                        )
                      }
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <label className="block text-[11px] font-medium text-[var(--mimora-muted)] mb-1">
                      Tên chương
                    </label>
                    <Input
                      value={row.chapterTitle}
                      onChange={(e) =>
                        setFormItems((prev) =>
                          prev.map((it, i) =>
                            i === idx ? { ...it, chapterTitle: e.target.value } : it
                          )
                        )
                      }
                      placeholder="Tên chương..."
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <label className="block text-[11px] font-medium text-[var(--mimora-muted)] mb-1">
                      Học liệu SEL (Published)
                    </label>
                    <Select
                      value={row.contentVersionId}
                      onChange={(e) =>
                        setFormItems((prev) =>
                          prev.map((it, i) =>
                            i === idx
                              ? { ...it, contentVersionId: e.target.value }
                              : it
                          )
                        )
                      }
                      options={publishedContent.map((opt) => ({
                        value: opt.contentVersionId,
                        label: `${opt.title} (v${opt.versionNumber})`,
                      }))}
                    />
                  </div>
                  <div className="sm:col-span-2 flex items-center justify-end gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={idx === 0}
                      onClick={() => moveDraftItem(idx, -1)}
                      aria-label="Di chuyển lên"
                    >
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={idx === formItems.length - 1}
                      onClick={() => moveDraftItem(idx, 1)}
                      aria-label="Di chuyển xuống"
                    >
                      <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setFormItems((prev) => prev.filter((_, i) => i !== idx))
                      }
                      aria-label="Xóa hoạt động"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setEditorOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" loading={savingEditor}>
              Lưu phiên bản nháp
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Admin Manual Enrollment Dialog */}
      <Dialog
        open={enrollOpen}
        onClose={() => setEnrollOpen(false)}
        title="Kích hoạt chương trình cho Không gian Gia đình"
        description="Chọn Không gian Gia đình và hồ sơ học sinh đã được liên kết người giám hộ hợp lệ để mở phiên bản đã xuất bản hiện tại."
      >
        <form onSubmit={(e) => void handleEnrollStudent(e)} className="space-y-4">
          {enrollErr && <Alert variant="danger">{enrollErr}</Alert>}

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <FormField label="Tìm theo tên hoặc mã gia đình (FAM)" htmlFor="enroll-search">
                <Input
                  id="enroll-search"
                  value={enrollSearch}
                  onChange={(e) => setEnrollSearch(e.target.value)}
                  placeholder="Ví dụ: FAM-..."
                />
              </FormField>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void loadWorkspaceCandidates(enrollSearch)}
            >
              Tìm kiếm
            </Button>
          </div>

          <FormField label="Chọn Không gian Gia đình" htmlFor="enroll-ws-select" required>
            <Select
              id="enroll-ws-select"
              value={enrollWorkspaceId}
              onChange={(e) => {
                const wsId = e.target.value;
                setEnrollWorkspaceId(wsId);
                const ws = workspaceCandidates.find((w) => w.workspaceId === wsId);
                setEnrollStudentUserId(ws?.students[0]?.studentUserId ?? '');
              }}
              options={workspaceCandidates.map((w) => ({
                value: w.workspaceId,
                label: `${w.workspaceName} (${w.workspaceCode}) · ${w.students.length} học sinh`,
              }))}
            />
          </FormField>

          <FormField label="Chọn học sinh đủ điều kiện" htmlFor="enroll-stu-select" required>
            <Select
              id="enroll-stu-select"
              value={enrollStudentUserId}
              onChange={(e) => setEnrollStudentUserId(e.target.value)}
              options={(selectedEnrollWorkspace?.students ?? []).map((st) => ({
                value: st.studentUserId,
                label: `${st.displayName} (@${st.familyUsername})`,
              }))}
            />
          </FormField>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setEnrollOpen(false)}>
              Hủy
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={enrolling}
              disabled={!enrollWorkspaceId || !enrollStudentUserId}
              leftIcon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
            >
              Xác nhận kích hoạt
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
