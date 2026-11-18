import { Building2, Pencil, Plus, Search } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { adminApi } from '../../api/admin.ts';
import { ApiClientError } from '../../api/client.ts';
import { resolveLocalizedErrorMessage, type AppLocale } from '../../i18n/index.ts';
import type { OrganizationStatus, SafeOrganizationView } from '../../types/admin.ts';
import { formatDateTime, getOrgStatusMeta } from '../../utils/p302.ts';
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

export interface AdminOrganizationsPageProps {
  locale: AppLocale;
  onToast: (msg: string) => void;
}

export function AdminOrganizationsPage({ locale, onToast }: AdminOrganizationsPageProps) {
  const [items, setItems] = useState<SafeOrganizationView[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | OrganizationStatus>('');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [selectedOrg, setSelectedOrg] = useState<SafeOrganizationView | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<SafeOrganizationView | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [statusInput, setStatusInput] = useState<OrganizationStatus>('active');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmSuspendOpen, setConfirmSuspendOpen] = useState(false);

  const loadOrgs = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await adminApi.listOrganizations({
        page,
        limit: 20,
        status: statusFilter || undefined,
        search: search.trim() || undefined,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrorMsg(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setErrorMsg('Không thể tải danh sách tổ chức.');
      }
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, search, locale]);

  useEffect(() => {
    void loadOrgs();
  }, [loadOrgs]);

  const openCreate = () => {
    setEditingOrg(null);
    setCodeInput('');
    setNameInput('');
    setStatusInput('active');
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (org: SafeOrganizationView) => {
    setEditingOrg(org);
    setCodeInput(org.code);
    setNameInput(org.name);
    setStatusInput(org.status);
    setFormError(null);
    setFormOpen(true);
  };

  const executeSave = async () => {
    setSaving(true);
    setFormError(null);
    try {
      if (editingOrg) {
        const res = await adminApi.updateOrganization(editingOrg.id, {
          code: codeInput.trim().toUpperCase(),
          name: nameInput.trim(),
          status: statusInput,
        });
        setSelectedOrg(res.organization);
        onToast(`Đã cập nhật trường ${res.organization.name}.`);
      } else {
        const res = await adminApi.createOrganization({
          code: codeInput.trim().toUpperCase(),
          name: nameInput.trim(),
          status: statusInput,
        });
        setSelectedOrg(res.organization);
        onToast(`Đã tạo tổ chức ${res.organization.name} (${res.organization.code}).`);
      }
      setFormOpen(false);
      setConfirmSuspendOpen(false);
      await loadOrgs();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFormError(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setFormError('Không thể lưu thông tin tổ chức.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!codeInput.trim() || !nameInput.trim()) {
      setFormError('Vui lòng nhập mã trường và tên tổ chức.');
      return;
    }
    if (editingOrg && editingOrg.status === 'active' && statusInput === 'suspended') {
      setConfirmSuspendOpen(true);
      return;
    }
    void executeSave();
  };

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="space-y-6">
      <PageHeader
        metadataLine="Cổng Quản trị · P2-03"
        title="Tổ chức & Trường học"
        description="Quản lý danh sách trường học, mã tổ chức dùng cho học sinh đăng nhập và trạng thái hoạt động."
        action={
          <Button
            variant="primary"
            leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
            onClick={openCreate}
          >
            Tạo tổ chức mới
          </Button>
        }
      />

      <Card padding="sm">
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
          <FormField label="Tìm theo mã hoặc tên trường" htmlFor="org-search" className="flex-1">
            <Input
              id="org-search"
              leftAdornment={<Search className="h-4 w-4" aria-hidden="true" />}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Ví dụ: MIMORA01 hoặc Bình Minh"
            />
          </FormField>

          <FormField label="Trạng thái" htmlFor="org-status-filter" className="sm:w-52">
            <Select
              id="org-status-filter"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as '' | OrganizationStatus);
                setPage(1);
              }}
              options={[
                { value: '', label: 'Tất cả trạng thái' },
                { value: 'active', label: 'Đang hoạt động' },
                { value: 'suspended', label: 'Tạm ngưng' },
              ]}
            />
          </FormField>
        </div>
      </Card>

      {errorMsg && <Alert variant="danger">{errorMsg}</Alert>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <Card className="lg:col-span-2" padding="md">
          <CardHeader
            title={`Danh sách tổ chức (${total})`}
            description="Chọn một tổ chức để xem chi tiết hoặc chỉnh sửa."
          />
          <CardContent>
            {loading ? (
              <LoadingState label="Đang tải danh sách tổ chức..." />
            ) : items.length === 0 ? (
              <EmptyState
                title="Chưa tìm thấy tổ chức phù hợp"
                description="Thử xóa bộ lọc tìm kiếm hoặc tạo tổ chức mới để bắt đầu."
                action={
                  <Button variant="secondary" onClick={openCreate}>
                    Tạo tổ chức đầu tiên
                  </Button>
                }
              />
            ) : (
              <div className="space-y-4">
                <div className="overflow-x-auto rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)]">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead className="bg-[var(--mimora-surface-subtle)] text-xs text-[var(--mimora-muted)]">
                      <tr>
                        <th className="py-2.5 px-3 font-medium">Mã trường</th>
                        <th className="py-2.5 px-3 font-medium">Tên tổ chức</th>
                        <th className="py-2.5 px-3 font-medium">Trạng thái</th>
                        <th className="py-2.5 px-3 font-medium text-right">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--mimora-border)]">
                      {items.map((org) => {
                        const meta = getOrgStatusMeta(org.status, locale);
                        const activeRow = selectedOrg?.id === org.id;
                        return (
                          <tr
                            key={org.id}
                            className={activeRow ? 'bg-[var(--mimora-surface-mint)]/50' : 'hover:bg-[var(--mimora-surface-subtle)]/50'}
                          >
                            <td className="py-2.5 px-3 font-mono text-xs font-semibold">{org.code}</td>
                            <td className="py-2.5 px-3">
                              <button
                                type="button"
                                className="text-left font-medium text-[var(--mimora-text)] hover:text-[var(--mimora-primary)] cursor-pointer"
                                onClick={() => setSelectedOrg(org)}
                              >
                                {org.name}
                              </button>
                            </td>
                            <td className="py-2.5 px-3">
                              <Badge variant={meta.variant}>{meta.label}</Badge>
                            </td>
                            <td className="py-2.5 px-3 text-right space-x-2 whitespace-nowrap">
                              <Button variant="ghost" size="sm" onClick={() => setSelectedOrg(org)}>
                                Chi tiết
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                leftIcon={<Pencil className="h-3.5 w-3.5" aria-hidden="true" />}
                                onClick={() => openEdit(org)}
                              >
                                Sửa
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-between text-xs text-[var(--mimora-muted)]">
                    <span className="tabular-nums">
                      Trang {page} / {totalPages}
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
                        disabled={page >= totalPages}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        Sau
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card padding="md">
          <CardHeader
            title="Chi tiết tổ chức"
            description="Thông tin định danh dùng cho đăng nhập học sinh và phân quyền theo trường."
          />
          <CardContent>
            {!selectedOrg ? (
              <p className="text-sm text-[var(--mimora-muted)]">
                Chọn một dòng trong danh sách bên trái để xem chi tiết.
              </p>
            ) : (
              <dl className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-[var(--mimora-primary)]" aria-hidden="true" />
                  <span className="font-semibold text-[var(--mimora-text)]">{selectedOrg.name}</span>
                </div>
                <div>
                  <dt className="text-xs text-[var(--mimora-muted)]">Mã trường (Organization Code)</dt>
                  <dd className="font-mono font-semibold">{selectedOrg.code}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--mimora-muted)]">Trạng thái</dt>
                  <dd className="mt-1">
                    <Badge variant={getOrgStatusMeta(selectedOrg.status, locale).variant}>
                      {getOrgStatusMeta(selectedOrg.status, locale).label}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--mimora-muted)]">UUID tổ chức</dt>
                  <dd className="font-mono text-xs break-all text-[var(--mimora-muted)]">
                    {selectedOrg.id}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--mimora-muted)]">Ngày tạo</dt>
                  <dd>{formatDateTime(selectedOrg.createdAt, locale)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--mimora-muted)]">Cập nhật gần nhất</dt>
                  <dd>{formatDateTime(selectedOrg.updatedAt, locale)}</dd>
                </div>
                <div className="pt-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    fullWidth
                    leftIcon={<Pencil className="h-3.5 w-3.5" aria-hidden="true" />}
                    onClick={() => openEdit(selectedOrg)}
                  >
                    Chỉnh sửa tổ chức
                  </Button>
                </div>
              </dl>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingOrg ? `Chỉnh sửa: ${editingOrg.name}` : 'Tạo tổ chức / trường học mới'}
        description="Mã trường chỉ gồm chữ in hoa, số, gạch nối hoặc gạch dưới (2–64 ký tự)."
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && <Alert variant="danger">{formError}</Alert>}

          <FormField
            label="Mã trường (Code)"
            htmlFor="org-form-code"
            required
            hint="Ví dụ: MIMORA01 hoặc TH_BINHMINH. Tự động chuyển chữ hoa."
          >
            <Input
              id="org-form-code"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              placeholder="MIMORA01"
              required
            />
          </FormField>

          <FormField label="Tên trường / tổ chức" htmlFor="org-form-name" required>
            <Input
              id="org-form-name"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Trường Tiểu học Bình Minh"
              required
            />
          </FormField>

          <FormField label="Trạng thái" htmlFor="org-form-status">
            <Select
              id="org-form-status"
              value={statusInput}
              onChange={(e) => setStatusInput(e.target.value as OrganizationStatus)}
              options={[
                { value: 'active', label: 'Đang hoạt động (active)' },
                { value: 'suspended', label: 'Tạm ngưng (suspended)' },
              ]}
            />
          </FormField>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              {editingOrg ? 'Lưu thay đổi' : 'Tạo tổ chức'}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={confirmSuspendOpen}
        onClose={() => setConfirmSuspendOpen(false)}
        title="Xác nhận tạm ngưng tổ chức"
        description={`Bạn sắp chuyển "${editingOrg?.name ?? ''}" sang trạng thái Tạm ngưng (suspended).`}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmSuspendOpen(false)}>
              Giữ nguyên hoạt động
            </Button>
            <Button variant="danger" loading={saving} onClick={() => void executeSave()}>
              Xác nhận tạm ngưng
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--mimora-muted)] leading-relaxed">
          Khi tổ chức bị tạm ngưng, giáo viên và học sinh thuộc trường này sẽ không thể chọn hoặc
          thao tác trên tổ chức cho tới khi được mở lại.
        </p>
      </Dialog>
    </div>
  );
}
