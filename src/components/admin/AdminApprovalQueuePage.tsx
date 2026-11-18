import { CheckCircle2, Eye, RefreshCw, UploadCloud, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../../api/admin.ts';
import { ApiClientError } from '../../api/client.ts';
import { resolveLocalizedErrorMessage, type AppLocale } from '../../i18n/index.ts';
import type { SafeContentItemView, SafeContentVersionView } from '../../types/admin.ts';
import { formatDateTime, getContentTypeLabel, getVersionStatusMeta } from '../../utils/p302.ts';
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
  LoadingState,
  PageHeader,
} from '../ui/index.ts';

export interface AdminApprovalQueuePageProps {
  locale: AppLocale;
  onToast: (msg: string) => void;
}

interface QueueEntry {
  item: SafeContentItemView;
  version: SafeContentVersionView;
}

export function AdminApprovalQueuePage({ locale, onToast }: AdminApprovalQueuePageProps) {
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [scannedItemsCount, setScannedItemsCount] = useState(0);
  const [totalItemsCount, setTotalItemsCount] = useState(0);

  const [previewEntry, setPreviewEntry] = useState<QueueEntry | null>(null);
  const [reviewModal, setReviewModal] = useState<{
    action: 'approve' | 'reject';
    entry: QueueEntry;
  } | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const listRes = await adminApi.listContentItems({
        page: 1,
        limit: 50,
        isArchived: 'false',
      });
      setTotalItemsCount(listRes.total);
      setScannedItemsCount(listRes.items.length);

      const details = await Promise.all(
        listRes.items.map((item) => adminApi.getContentItem(item.id))
      );

      const collected: QueueEntry[] = [];
      for (const d of details) {
        for (const ver of d.versions) {
          if (ver.status === 'pending_review' || ver.status === 'approved') {
            collected.push({ item: d.item, version: ver });
          }
        }
      }
      setEntries(collected);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrorMsg(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setErrorMsg('Không thể tải hàng đợi phê duyệt.');
      }
    } finally {
      setLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const executeAction = async (
    versionId: string,
    fn: () => Promise<unknown>,
    successMessage: string
  ) => {
    setBusyId(versionId);
    setErrorMsg(null);
    try {
      await fn();
      onToast(successMessage);
      await loadQueue();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrorMsg(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setErrorMsg('Thao tác thất bại.');
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        metadataLine="Cổng Quản trị · P2-04"
        title="Hàng đợi Phê duyệt & Xuất bản"
        description="Tổng hợp các phiên bản thẻ SEL đang chờ phê duyệt (pending_review) hoặc đã duyệt chờ xuất bản (approved)."
        action={
          <Button
            variant="outline"
            size="sm"
            leftIcon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
            onClick={() => void loadQueue()}
          >
            Làm mới hàng đợi
          </Button>
        }
      />

      <Alert variant="info" title="Cơ chế quét hàng đợi hiện tại">
        Backend P2-04 chưa có endpoint lọc riêng theo trạng thái phiên bản toàn cục, nên hàng đợi đang quét tối đa 50 học liệu đầu tiên (đã quét {scannedItemsCount}/{totalItemsCount}). Quy tắc kiểm soát tự duyệt đa quản trị viên (khi có &ge; 2 Admin) và chặn xung đột đồng thời (HTTP 409) vẫn được máy chủ thực thi đầy đủ.
      </Alert>

      {errorMsg && <Alert variant="danger">{errorMsg}</Alert>}

      {loading ? (
        <LoadingState label="Đang tổng hợp phiên bản chờ duyệt..." />
      ) : entries.length === 0 ? (
        <EmptyState
          title="Hàng đợi phê duyệt đang trống"
          description="Hiện không có phiên bản nào đang chờ duyệt hoặc chờ xuất bản trong danh sách đã quét."
        />
      ) : (
        <div className="space-y-4">
          {entries.map(({ item, version }) => {
            const st = getVersionStatusMeta(version.status, locale);
            const busy = busyId === version.id;
            return (
              <Card key={version.id} padding="md">
                <CardHeader
                  title={`${version.title} (v${version.versionNumber})`}
                  description={`${item.slug} · ${getContentTypeLabel(item.contentType, locale)} · Gửi duyệt lúc ${formatDateTime(version.submittedAt ?? version.updatedAt, locale)}`}
                  action={<Badge variant={st.variant}>{st.label}</Badge>}
                />
                <CardContent className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                    onClick={() => setPreviewEntry({ item, version })}
                  >
                    Xem trước nội dung
                  </Button>

                  {version.status === 'pending_review' && (
                    <>
                      <Button
                        variant="primary"
                        size="sm"
                        loading={busy}
                        leftIcon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
                        onClick={() => {
                          setDecisionNote('');
                          setReviewModal({ action: 'approve', entry: { item, version } });
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
                          setReviewModal({ action: 'reject', entry: { item, version } });
                        }}
                      >
                        Từ chối
                      </Button>
                    </>
                  )}

                  {version.status === 'approved' && (
                    <Button
                      variant="primary"
                      size="sm"
                      loading={busy}
                      leftIcon={<UploadCloud className="h-3.5 w-3.5" aria-hidden="true" />}
                      onClick={() =>
                        void executeAction(
                          version.id,
                          () => adminApi.publishContentVersion(version.id),
                          `Đã xuất bản "${version.title}" v${version.versionNumber}.`
                        )
                      }
                    >
                      Xuất bản ngay
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={Boolean(previewEntry)}
        onClose={() => setPreviewEntry(null)}
        maxWidthClass="max-w-2xl"
        title={previewEntry ? `${previewEntry.version.title} (v${previewEntry.version.versionNumber})` : ''}
      >
        {previewEntry && (
          <ContentPayloadPreview
            contentType={previewEntry.item.contentType}
            title={previewEntry.version.title}
            summary={previewEntry.version.summary}
            locale={previewEntry.version.locale}
            uiLocale={locale}
            payloadJson={previewEntry.version.payloadJson}
            metadataJson={previewEntry.version.metadataJson}
          />
        )}
      </Dialog>

      <Dialog
        open={Boolean(reviewModal)}
        onClose={() => setReviewModal(null)}
        title={
          reviewModal?.action === 'approve'
            ? `Phê duyệt ${reviewModal.entry.version.title}`
            : `Từ chối ${reviewModal?.entry.version.title ?? ''}`
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setReviewModal(null)}>
              Hủy
            </Button>
            <Button
              variant={reviewModal?.action === 'approve' ? 'primary' : 'danger'}
              onClick={() => {
                if (!reviewModal) return;
                const { action, entry } = reviewModal;
                setReviewModal(null);
                if (action === 'approve') {
                  void executeAction(
                    entry.version.id,
                    () => adminApi.approveContentVersion(entry.version.id, decisionNote.trim() || null),
                    `Đã phê duyệt v${entry.version.versionNumber}.`
                  );
                } else {
                  void executeAction(
                    entry.version.id,
                    () => adminApi.rejectContentVersion(entry.version.id, decisionNote.trim() || null),
                    `Đã từ chối v${entry.version.versionNumber}.`
                  );
                }
              }}
            >
              Xác nhận
            </Button>
          </>
        }
      >
        <FormField label="Ghi chú quyết định (tùy chọn)" htmlFor="queue-decision-note">
          <textarea
            id="queue-decision-note"
            rows={3}
            value={decisionNote}
            onChange={(e) => setDecisionNote(e.target.value)}
            placeholder="Nhận xét chuyên môn SEL..."
            className="w-full rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border-strong)] p-3 text-sm"
          />
        </FormField>
      </Dialog>
    </div>
  );
}
