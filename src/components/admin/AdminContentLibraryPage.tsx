import { Archive, CheckCircle2, Eye, FilePlus2, Pencil, Plus, Search, Send, UploadCloud, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { adminApi } from '../../api/admin.ts';
import { ApiClientError } from '../../api/client.ts';
import { resolveLocalizedErrorMessage, type AppLocale } from '../../i18n/index.ts';
import type { CanonicalContentType } from '../../types/chapter.ts';
import type {
  SafeContentItemView,
  SafeContentVersionView,
} from '../../types/admin.ts';
import {
  CANONICAL_CONTENT_TYPE_LIST,
  createDefaultPayloadForType,
  formatDateTime,
  getContentTypeLabel,
  getVersionStatusMeta,
} from '../../utils/p302.ts';
import { ContentPayloadPreview } from '../shared/ContentPayloadPreview.tsx';
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
import {
  ContentPayloadEditor,
  buildCleanMetadataForSubmit,
  buildCleanPayloadForSubmit,
  type ContentEditorValues,
} from './ContentPayloadEditor.tsx';

export interface AdminContentLibraryPageProps {
  locale: AppLocale;
  onToast: (msg: string) => void;
}

export function AdminContentLibraryPage({ locale, onToast }: AdminContentLibraryPageProps) {
  const [items, setItems] = useState<SafeContentItemView[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [contentTypeFilter, setContentTypeFilter] = useState<'' | CanonicalContentType>('');
  const [archivedFilter, setArchivedFilter] = useState<'false' | 'true' | ''>('false');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [selectedDetail, setSelectedDetail] = useState<{
    item: SafeContentItemView;
    versions: SafeContentVersionView[];
  } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyVersionId, setBusyVersionId] = useState<string | null>(null);

  // Preview version modal
  const [previewVersion, setPreviewVersion] = useState<SafeContentVersionView | null>(null);

  // Create/Edit Editor modal
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create_item' | 'create_version' | 'edit_version'>('create_item');
  const [editingVersionId, setEditingVersionId] = useState<string | null>(null);
  const [editorValues, setEditorValues] = useState<ContentEditorValues>({
    slug: '',
    contentType: 'emotion_card',
    title: '',
    summary: '',
    locale: 'vi-VN',
    payloadJson: createDefaultPayloadForType('emotion_card') as unknown as Record<string, unknown>,
    metadataJson: {},
  });
  const [savingEditor, setSavingEditor] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  // Decision Note Modal for Approve/Reject
  const [reviewDialog, setReviewDialog] = useState<{
    action: 'approve' | 'reject';
    version: SafeContentVersionView;
  } | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await adminApi.listContentItems({
        page,
        limit: 20,
        contentType: contentTypeFilter || undefined,
        isArchived: archivedFilter || undefined,
        search: search.trim() || undefined,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrorMsg(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setErrorMsg('Không thể tải thư viện nội dung SEL.');
      }
    } finally {
      setLoading(false);
    }
  }, [page, contentTypeFilter, archivedFilter, search, locale]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const loadItemDetail = async (itemId: string) => {
    setLoadingDetail(true);
    setActionError(null);
    try {
      const res = await adminApi.getContentItem(itemId);
      setSelectedDetail({ item: res.item, versions: res.versions });
    } catch (err) {
      if (err instanceof ApiClientError) {
        setActionError(resolveLocalizedErrorMessage(err.info, locale));
      }
    } finally {
      setLoadingDetail(false);
    }
  };

  const openCreateItem = () => {
    setEditorMode('create_item');
    setEditingVersionId(null);
    setEditorValues({
      slug: '',
      contentType: 'emotion_card',
      title: '',
      summary: '',
      locale: 'vi-VN',
      payloadJson: createDefaultPayloadForType('emotion_card') as unknown as Record<string, unknown>,
      metadataJson: {},
    });
    setEditorError(null);
    setEditorOpen(true);
  };

  const openCreateNewVersion = () => {
    if (!selectedDetail) return;
    const latest = selectedDetail.versions[0];
    setEditorMode('create_version');
    setEditingVersionId(null);
    setEditorValues({
      slug: selectedDetail.item.slug,
      contentType: selectedDetail.item.contentType,
      title: latest?.title ?? '',
      summary: latest?.summary ?? '',
      locale: latest?.locale ?? 'vi-VN',
      payloadJson: latest
        ? structuredClone(latest.payloadJson)
        : (createDefaultPayloadForType(selectedDetail.item.contentType) as unknown as Record<string, unknown>),
      metadataJson: latest?.metadataJson ? structuredClone(latest.metadataJson) : {},
    });
    setEditorError(null);
    setEditorOpen(true);
  };

  const openEditVersion = (ver: SafeContentVersionView) => {
    if (!selectedDetail) return;
    setEditorMode('edit_version');
    setEditingVersionId(ver.id);
    setEditorValues({
      slug: selectedDetail.item.slug,
      contentType: selectedDetail.item.contentType,
      title: ver.title,
      summary: ver.summary ?? '',
      locale: ver.locale,
      payloadJson: structuredClone(ver.payloadJson),
      metadataJson: ver.metadataJson ? structuredClone(ver.metadataJson) : {},
    });
    setEditorError(null);
    setEditorOpen(true);
  };

  const handleSaveEditor = async (e: FormEvent) => {
    e.preventDefault();
    setSavingEditor(true);
    setEditorError(null);

    const payloadJson = buildCleanPayloadForSubmit(
      editorValues.contentType,
      editorValues.payloadJson
    );
    const metadataJson = buildCleanMetadataForSubmit(editorValues.metadataJson);

    try {
      if (editorMode === 'create_item') {
        const res = await adminApi.createContentItem({
          slug: editorValues.slug.trim().toLowerCase(),
          contentType: editorValues.contentType,
          title: editorValues.title.trim(),
          summary: editorValues.summary.trim() ? editorValues.summary.trim() : null,
          locale: editorValues.locale,
          payloadJson,
          metadataJson,
        });
        setEditorOpen(false);
        onToast(`Đã tạo học liệu "${res.version.title}" (v${res.version.versionNumber}).`);
        await loadItems();
        await loadItemDetail(res.item.id);
      } else if (editorMode === 'create_version' && selectedDetail) {
        const res = await adminApi.createContentVersion(selectedDetail.item.id, {
          title: editorValues.title.trim(),
          summary: editorValues.summary.trim() ? editorValues.summary.trim() : null,
          locale: editorValues.locale,
          payloadJson,
          metadataJson,
        });
        setEditorOpen(false);
        onToast(`Đã tạo bản nháp mới v${res.version.versionNumber}.`);
        await loadItemDetail(selectedDetail.item.id);
      } else if (editorMode === 'edit_version' && editingVersionId && selectedDetail) {
        const res = await adminApi.updateContentVersion(editingVersionId, {
          title: editorValues.title.trim(),
          summary: editorValues.summary.trim() ? editorValues.summary.trim() : null,
          locale: editorValues.locale,
          payloadJson,
          metadataJson,
        });
        setEditorOpen(false);
        onToast(`Đã cập nhật bản nháp v${res.version.versionNumber}.`);
        await loadItemDetail(selectedDetail.item.id);
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        const firstDetail = err.info.details?.[0]?.message;
        setEditorError(
          firstDetail
            ? `${resolveLocalizedErrorMessage(err.info, locale)} (${firstDetail})`
            : resolveLocalizedErrorMessage(err.info, locale)
        );
      } else {
        setEditorError('Không thể lưu nội dung thẻ.');
      }
    } finally {
      setSavingEditor(false);
    }
  };

  const runVersionAction = async (
    versionId: string,
    fn: () => Promise<unknown>,
    successMsg: string
  ) => {
    if (!selectedDetail) return;
    setBusyVersionId(versionId);
    setActionError(null);
    try {
      await fn();
      onToast(successMsg);
      await loadItemDetail(selectedDetail.item.id);
      await loadItems();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setActionError(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setActionError('Không thể thực hiện thao tác chuyển trạng thái.');
      }
    } finally {
      setBusyVersionId(null);
    }
  };

  const handleConfirmArchive = async () => {
    if (!selectedDetail) return;
    setConfirmArchiveOpen(false);
    setActionError(null);
    try {
      await adminApi.archiveContentItem(selectedDetail.item.id);
      onToast('Đã lưu trữ học liệu.');
      await loadItemDetail(selectedDetail.item.id);
      await loadItems();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setActionError(resolveLocalizedErrorMessage(err.info, locale));
      }
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        metadataLine="Cổng Quản trị · P2-04"
        title="Thư viện Nội dung SEL & Quản lý Phiên bản"
        description="Biên soạn 5 loại thẻ SEL chuẩn hóa, theo dõi lịch sử phiên bản bất biến và quy trình Gửi duyệt → Phê duyệt → Xuất bản."
        action={
          <Button
            variant="primary"
            leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
            onClick={openCreateItem}
          >
            Tạo học liệu SEL mới
          </Button>
        }
      />

      <Card padding="sm">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <FormField label="Tìm theo slug hoặc tiêu đề" htmlFor="content-search">
            <Input
              id="content-search"
              leftAdornment={<Search className="h-4 w-4" aria-hidden="true" />}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Tìm thẻ SEL..."
            />
          </FormField>

          <FormField label="Loại nội dung" htmlFor="content-type-filter">
            <Select
              id="content-type-filter"
              value={contentTypeFilter}
              onChange={(e) => {
                setContentTypeFilter(e.target.value as '' | CanonicalContentType);
                setPage(1);
              }}
              options={[
                { value: '', label: 'Tất cả 5 loại thẻ' },
                ...CANONICAL_CONTENT_TYPE_LIST.map((ct) => ({
                  value: ct,
                  label: getContentTypeLabel(ct, locale),
                })),
              ]}
            />
          </FormField>

          <FormField label="Trạng thái lưu trữ" htmlFor="content-archive-filter">
            <Select
              id="content-archive-filter"
              value={archivedFilter}
              onChange={(e) => {
                setArchivedFilter(e.target.value as 'false' | 'true' | '');
                setPage(1);
              }}
              options={[
                { value: 'false', label: 'Đang sử dụng' },
                { value: 'true', label: 'Đã lưu trữ' },
                { value: '', label: 'Tất cả' },
              ]}
            />
          </FormField>
        </div>
      </Card>

      {errorMsg && <Alert variant="danger">{errorMsg}</Alert>}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        <Card className="lg:col-span-2" padding="md">
          <CardHeader title={`Danh sách học liệu (${total})`} />
          <CardContent>
            {loading ? (
              <LoadingState label="Đang tải thư viện nội dung..." />
            ) : items.length === 0 ? (
              <EmptyState
                title="Chưa có học liệu nào khớp bộ lọc"
                description="Tạo thẻ Cảm xúc, Tình huống, Chiến lược, Truyện xã hội hoặc Thẻ giao tiếp AAC mới."
                action={
                  <Button variant="secondary" onClick={openCreateItem}>
                    Tạo học liệu đầu tiên
                  </Button>
                }
              />
            ) : (
              <div className="space-y-2.5">
                {items.map((item) => {
                  const active = selectedDetail?.item.id === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => void loadItemDetail(item.id)}
                      className={[
                        'w-full text-left rounded-[var(--mimora-radius-md)] border p-3.5 space-y-1.5 cursor-pointer transition-colors',
                        active
                          ? 'bg-[var(--mimora-surface-mint)]/60 border-[#9ecbc1]'
                          : 'bg-[var(--mimora-surface)] border-[var(--mimora-border)] hover:bg-[var(--mimora-surface-subtle)]/60',
                      ].join(' ')}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-[var(--mimora-text)] truncate">
                          {item.slug}
                        </span>
                        {item.isArchived ? (
                          <Badge variant="neutral">Đã lưu trữ</Badge>
                        ) : item.currentPublishedVersionId ? (
                          <Badge variant="success">Đã xuất bản</Badge>
                        ) : (
                          <Badge variant="warning">Chưa xuất bản</Badge>
                        )}
                      </div>
                      <p className="text-xs text-[var(--mimora-muted)]">
                        {getContentTypeLabel(item.contentType, locale)}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3" padding="md">
          <CardHeader
            title={selectedDetail ? `Học liệu: ${selectedDetail.item.slug}` : 'Chi tiết phiên bản & Phê duyệt'}
            description={
              selectedDetail
                ? `${getContentTypeLabel(selectedDetail.item.contentType, locale)} · Phiên bản đã xuất bản là bất biến; để chỉnh sửa tiếp hãy tạo phiên bản mới.`
                : 'Chọn một học liệu ở cột bên trái để xem các phiên bản, lịch sử phê duyệt và thao tác xuất bản.'
            }
            action={
              selectedDetail && !selectedDetail.item.isArchived ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />}
                    onClick={openCreateNewVersion}
                  >
                    Tạo phiên bản mới
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<Archive className="h-3.5 w-3.5" aria-hidden="true" />}
                    onClick={() => setConfirmArchiveOpen(true)}
                  >
                    Lưu trữ
                  </Button>
                </div>
              ) : undefined
            }
          />
          <CardContent>
            {actionError && <Alert variant="danger" className="mb-4">{actionError}</Alert>}

            {loadingDetail ? (
              <LoadingState label="Đang tải các phiên bản..." />
            ) : !selectedDetail ? (
              <EmptyState
                title="Chưa chọn học liệu"
                description="Chọn một học liệu bên trái để xem nội dung, vòng duyệt và lịch sử xuất bản."
              />
            ) : (
              <div className="space-y-4">
                {selectedDetail.versions.map((ver) => {
                  const st = getVersionStatusMeta(ver.status, locale);
                  const canEditDraft = ver.status === 'draft' || ver.status === 'rejected';
                  const canSubmit = ver.status === 'draft' || ver.status === 'rejected';
                  const canReview = ver.status === 'pending_review';
                  const canPublish = ver.status === 'approved';
                  const busy = busyVersionId === ver.id;

                  return (
                    <div
                      key={ver.id}
                      className="rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)] p-4 space-y-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-[var(--mimora-surface-subtle)]">
                              v{ver.versionNumber}
                            </span>
                            <h4 className="font-semibold text-[var(--mimora-text)]">{ver.title}</h4>
                          </div>
                          <p className="text-xs text-[var(--mimora-muted)] mt-1">
                            Ngôn ngữ: {ver.locale} · Cập nhật: {formatDateTime(ver.updatedAt, locale)}
                          </p>
                        </div>
                        <Badge variant={st.variant}>{st.label}</Badge>
                      </div>

                      {ver.summary && (
                        <p className="text-sm text-[var(--mimora-muted)]">{ver.summary}</p>
                      )}

                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          leftIcon={<Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                          onClick={() => setPreviewVersion(ver)}
                        >
                          Xem trước thẻ
                        </Button>

                        {canEditDraft && (
                          <Button
                            variant="outline"
                            size="sm"
                            leftIcon={<Pencil className="h-3.5 w-3.5" aria-hidden="true" />}
                            onClick={() => openEditVersion(ver)}
                          >
                            Sửa bản nháp
                          </Button>
                        )}

                        {canSubmit && (
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={busy}
                            leftIcon={<Send className="h-3.5 w-3.5" aria-hidden="true" />}
                            onClick={() =>
                              void runVersionAction(
                                ver.id,
                                () => adminApi.submitContentVersion(ver.id),
                                `Đã gửi duyệt phiên bản v${ver.versionNumber}.`
                              )
                            }
                          >
                            Gửi phê duyệt
                          </Button>
                        )}

                        {canReview && (
                          <>
                            <Button
                              variant="primary"
                              size="sm"
                              loading={busy}
                              leftIcon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
                              onClick={() => {
                                setDecisionNote('');
                                setReviewDialog({ action: 'approve', version: ver });
                              }}
                            >
                              Phê duyệt
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              loading={busy}
                              leftIcon={<XCircle className="h-3.5 w-3.5" aria-hidden="true" />}
                              onClick={() => {
                                setDecisionNote('');
                                setReviewDialog({ action: 'reject', version: ver });
                              }}
                            >
                              Từ chối
                            </Button>
                          </>
                        )}

                        {canPublish && (
                          <Button
                            variant="primary"
                            size="sm"
                            loading={busy}
                            leftIcon={<UploadCloud className="h-3.5 w-3.5" aria-hidden="true" />}
                            onClick={() =>
                              void runVersionAction(
                                ver.id,
                                () => adminApi.publishContentVersion(ver.id),
                                `Đã xuất bản phiên bản v${ver.versionNumber}. Phiên bản cũ (nếu có) chuyển sang Superseded.`
                              )
                            }
                          >
                            Xuất bản (Publish)
                          </Button>
                        )}
                      </div>

                      {ver.approvals && ver.approvals.length > 0 && (
                        <div className="pt-2 border-t border-[var(--mimora-border)] space-y-1.5">
                          <p className="text-xs font-semibold text-[var(--mimora-muted)]">
                            Lịch sử các vòng duyệt ({ver.approvals.length})
                          </p>
                          <ul className="space-y-1 text-xs">
                            {ver.approvals.map((ap) => (
                              <li
                                key={ap.id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded bg-[var(--mimora-surface-subtle)]/60 px-2.5 py-1.5"
                              >
                                <span>
                                  <strong>Vòng {ap.roundNumber}:</strong> {ap.decision}
                                  {ap.decisionNote ? ` — "${ap.decisionNote}"` : ''}
                                </span>
                                <span className="text-[var(--mimora-muted)]">
                                  {formatDateTime(ap.decidedAt, locale)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create / Edit Modal */}
      <Dialog
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        maxWidthClass="max-w-3xl"
        title={
          editorMode === 'create_item'
            ? 'Tạo học liệu SEL & Bản nháp v1'
            : editorMode === 'create_version'
              ? `Tạo phiên bản mới cho ${selectedDetail?.item.slug ?? ''}`
              : `Chỉnh sửa bản nháp`
        }
      >
        <form onSubmit={(e) => void handleSaveEditor(e)} className="space-y-4">
          {editorError && <Alert variant="danger">{editorError}</Alert>}

          <ContentPayloadEditor
            mode={editorMode}
            locale={locale}
            values={editorValues}
            onChange={(next) => {
              if (
                editorMode === 'create_item' &&
                next.contentType !== editorValues.contentType
              ) {
                setEditorValues({
                  ...next,
                  payloadJson: createDefaultPayloadForType(next.contentType) as unknown as Record<
                    string,
                    unknown
                  >,
                });
              } else {
                setEditorValues(next);
              }
            }}
          />

          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--mimora-border)]">
            <Button variant="outline" onClick={() => setEditorOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" loading={savingEditor}>
              Lưu bản nháp
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Preview Modal */}
      <Dialog
        open={Boolean(previewVersion)}
        onClose={() => setPreviewVersion(null)}
        maxWidthClass="max-w-2xl"
        title={previewVersion ? `Xem trước v${previewVersion.versionNumber}: ${previewVersion.title}` : ''}
      >
        {previewVersion && selectedDetail && (
          <ContentPayloadPreview
            contentType={selectedDetail.item.contentType}
            title={previewVersion.title}
            summary={previewVersion.summary}
            locale={previewVersion.locale}
            uiLocale={locale}
            payloadJson={previewVersion.payloadJson}
            metadataJson={previewVersion.metadataJson}
          />
        )}
      </Dialog>

      {/* Approve / Reject Decision Note Modal */}
      <Dialog
        open={Boolean(reviewDialog)}
        onClose={() => setReviewDialog(null)}
        title={
          reviewDialog?.action === 'approve'
            ? `Phê duyệt phiên bản v${reviewDialog.version.versionNumber}`
            : `Từ chối phiên bản v${reviewDialog?.version.versionNumber ?? ''}`
        }
        description={
          reviewDialog?.action === 'approve'
            ? 'Lưu ý: Nếu hệ thống có từ 2 quản trị viên đang hoạt động trở lên, tác giả không thể tự phê duyệt phiên bản của chính mình.'
            : 'Phiên bản bị từ chối sẽ chuyển về trạng thái "Cần chỉnh sửa" để tác giả sửa và gửi duyệt vòng mới.'
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setReviewDialog(null)}>
              Hủy
            </Button>
            <Button
              variant={reviewDialog?.action === 'approve' ? 'primary' : 'danger'}
              onClick={() => {
                if (!reviewDialog) return;
                const { action, version } = reviewDialog;
                setReviewDialog(null);
                if (action === 'approve') {
                  void runVersionAction(
                    version.id,
                    () => adminApi.approveContentVersion(version.id, decisionNote.trim() || null),
                    `Đã phê duyệt v${version.versionNumber}.`
                  );
                } else {
                  void runVersionAction(
                    version.id,
                    () => adminApi.rejectContentVersion(version.id, decisionNote.trim() || null),
                    `Đã chuyển v${version.versionNumber} về trạng thái Cần chỉnh sửa.`
                  );
                }
              }}
            >
              {reviewDialog?.action === 'approve' ? 'Xác nhận phê duyệt' : 'Xác nhận từ chối'}
            </Button>
          </>
        }
      >
        <FormField label="Ghi chú duyệt (decisionNote, tùy chọn)" htmlFor="decision-note">
          <textarea
            id="decision-note"
            rows={3}
            value={decisionNote}
            onChange={(e) => setDecisionNote(e.target.value)}
            placeholder="Nhập nhận xét chuyên môn SEL hoặc góp ý chỉnh sửa..."
            className="w-full rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border-strong)] p-3 text-sm"
          />
        </FormField>
      </Dialog>

      {/* Archive Confirmation Modal */}
      <Dialog
        open={confirmArchiveOpen}
        onClose={() => setConfirmArchiveOpen(false)}
        title="Xác nhận lưu trữ học liệu"
        description="Học liệu đã lưu trữ sẽ không hiển thị trong thư viện xuất bản mới cho giáo viên, nhưng các bài tập đã gắn phiên bản cũ vẫn giữ nguyên tham chiếu bất biến."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmArchiveOpen(false)}>
              Hủy
            </Button>
            <Button variant="danger" onClick={() => void handleConfirmArchive()}>
              Xác nhận lưu trữ
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--mimora-muted)]">
          Học liệu: <span className="font-mono font-semibold">{selectedDetail?.item.slug}</span>
        </p>
      </Dialog>
    </div>
  );
}
