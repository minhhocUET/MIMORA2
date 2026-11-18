import { Eye, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ApiClientError } from '../../api/client.ts';
import { teacherApi } from '../../api/teacher.ts';
import { resolveLocalizedErrorMessage, type AppLocale } from '../../i18n/index.ts';
import type { CanonicalContentType } from '../../types/chapter.ts';
import type { SafeTeacherLibraryContentView } from '../../types/teacher.ts';
import {
  CANONICAL_CONTENT_TYPE_LIST,
  formatDateTime,
  getContentTypeLabel,
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

export interface TeacherLibraryPageProps {
  locale: AppLocale;
}

export function TeacherLibraryPage({ locale }: TeacherLibraryPageProps) {
  const [items, setItems] = useState<SafeTeacherLibraryContentView[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [contentType, setContentType] = useState<'' | CanonicalContentType>('');
  const [localeFilter, setLocaleFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<SafeTeacherLibraryContentView | null>(null);

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await teacherApi.listPublishedLibrary({
        page,
        limit: 18,
        contentType: contentType || undefined,
        locale: localeFilter || undefined,
        search: search.trim() || undefined,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrorMsg(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setErrorMsg('Không thể tải thư viện học liệu đã xuất bản.');
      }
    } finally {
      setLoading(false);
    }
  }, [page, contentType, localeFilter, search, locale]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  return (
    <div className="space-y-6">
      <PageHeader
        metadataLine="Cổng Giáo viên · P2-04 · Chỉ đọc"
        title="Thư viện Học liệu SEL Đã Xuất Bản"
        description="Chỉ hiển thị các phiên bản đã được phê duyệt và xuất bản chính thức. Bản nháp hoặc phiên bản chưa duyệt không hiển thị tại đây."
      />

      <Card padding="sm">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <FormField label="Tìm theo tiêu đề hoặc slug" htmlFor="lib-search">
            <Input
              id="lib-search"
              leftAdornment={<Search className="h-4 w-4" aria-hidden="true" />}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Tìm thẻ cảm xúc, chiến lược..."
            />
          </FormField>

          <FormField label="Loại thẻ" htmlFor="lib-type">
            <Select
              id="lib-type"
              value={contentType}
              onChange={(e) => {
                setContentType(e.target.value as '' | CanonicalContentType);
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

          <FormField label="Ngôn ngữ" htmlFor="lib-locale">
            <Select
              id="lib-locale"
              value={localeFilter}
              onChange={(e) => {
                setLocaleFilter(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'Tất cả ngôn ngữ' },
                { value: 'vi-VN', label: 'Tiếng Việt (vi-VN)' },
                { value: 'vi', label: 'Tiếng Việt (vi)' },
                { value: 'en', label: 'English (en)' },
              ]}
            />
          </FormField>
        </div>
      </Card>

      {errorMsg && <Alert variant="danger">{errorMsg}</Alert>}

      {loading ? (
        <LoadingState label="Đang tải học liệu đã xuất bản..." />
      ) : items.length === 0 ? (
        <EmptyState
          title="Chưa có học liệu đã xuất bản khớp bộ lọc"
          description="Khi Quản trị hệ thống xuất bản thẻ SEL mới, học liệu sẽ xuất hiện tại đây để thầy/cô chọn giao bài."
        />
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-[var(--mimora-muted)] tabular-nums">
            Tổng số học liệu đã xuất bản: {total}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((item) => (
              <Card key={item.versionId} padding="md" className="flex flex-col justify-between">
                <CardHeader
                  title={item.title}
                  description={item.summary ?? `Slug: ${item.slug}`}
                  action={<Badge variant="info">{getContentTypeLabel(item.contentType, locale)}</Badge>}
                />
                <CardContent className="space-y-3">
                  <p className="text-xs font-mono text-[var(--mimora-muted)]">
                    v{item.versionNumber} · {item.locale} · Xuất bản {formatDateTime(item.publishedAt, locale)}
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    fullWidth
                    leftIcon={<Eye className="h-4 w-4" aria-hidden="true" />}
                    onClick={() => setPreviewItem(item)}
                  >
                    Xem trước thẻ học liệu
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          {total > 18 && (
            <div className="flex items-center justify-between text-xs text-[var(--mimora-muted)]">
              <span className="tabular-nums">
                Trang {page} / {Math.max(1, Math.ceil(total / 18))}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Trước
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= Math.ceil(total / 18)}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Sau
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <Dialog
        open={Boolean(previewItem)}
        onClose={() => setPreviewItem(null)}
        maxWidthClass="max-w-2xl"
        title={previewItem ? `${previewItem.title} (v${previewItem.versionNumber})` : ''}
      >
        {previewItem && (
          <ContentPayloadPreview
            contentType={previewItem.contentType}
            title={previewItem.title}
            summary={previewItem.summary}
            locale={previewItem.locale}
            uiLocale={locale}
            payloadJson={previewItem.payloadJson}
            metadataJson={previewItem.metadataJson}
          />
        )}
      </Dialog>
    </div>
  );
}
