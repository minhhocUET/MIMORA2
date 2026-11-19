import { Copy, KeyRound, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../../api/admin.ts';
import { ApiClientError } from '../../api/client.ts';
import { teacherApi } from '../../api/teacher.ts';
import { resolveLocalizedErrorMessage, type AppLocale } from '../../i18n/index.ts';
import type { SafeInvitationStatusView } from '../../types/guardian.ts';
import { formatDateTime } from '../../utils/p302.ts';
import { Alert, Badge, Button, Dialog, LoadingState, Select } from '../ui/index.ts';

export interface GuardianInviteDialogProps {
  open: boolean;
  onClose: () => void;
  locale: AppLocale;
  mode: 'teacher' | 'admin';
  organizationId?: string;
  studentMembershipId: string | null;
  studentDisplayName: string;
  onToast: (msg: string) => void;
}

function getStatusBadge(status: string): {
  label: string;
  variant: 'success' | 'warning' | 'danger' | 'neutral';
} {
  switch (status) {
    case 'pending':
      return { label: 'Đang chờ liên kết', variant: 'warning' };
    case 'claimed':
      return { label: 'Đã được phụ huynh nhận', variant: 'success' };
    case 'revoked':
      return { label: 'Đã thu hồi', variant: 'danger' };
    default:
      return { label: 'Đã hết hạn', variant: 'neutral' };
  }
}

export function GuardianInviteDialog({
  open,
  onClose,
  locale,
  mode,
  organizationId,
  studentMembershipId,
  studentDisplayName,
  onToast,
}: GuardianInviteDialogProps) {
  const [invitations, setInvitations] = useState<SafeInvitationStatusView[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [expiresInHours, setExpiresInHours] = useState<string>('72');
  const [issuing, setIssuing] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [latestClaimCode, setLatestClaimCode] = useState<string | null>(null);

  const loadInvitations = useCallback(async () => {
    if (!open || !studentMembershipId) {
      return;
    }
    if (mode === 'admin' && !organizationId) {
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const res =
        mode === 'teacher'
          ? await teacherApi.listGuardianInvitations(studentMembershipId)
          : await adminApi.listStudentGuardianInvitations(
              organizationId!,
              studentMembershipId
            );
      setInvitations(res.invitations);
    } catch (err) {
      setErrorMsg(
        err instanceof ApiClientError
          ? resolveLocalizedErrorMessage(err.info, locale)
          : 'Không thể tải danh sách mã liên kết phụ huynh.'
      );
    } finally {
      setLoading(false);
    }
  }, [open, studentMembershipId, mode, organizationId, locale]);

  useEffect(() => {
    setLatestClaimCode(null);
    if (open && studentMembershipId) {
      void loadInvitations();
    }
  }, [open, studentMembershipId, loadInvitations]);

  const handleGenerate = async () => {
    if (!studentMembershipId) return;
    if (mode === 'admin' && !organizationId) return;

    setIssuing(true);
    setErrorMsg(null);
    try {
      const hours = Number(expiresInHours) || 72;
      const res =
        mode === 'teacher'
          ? await teacherApi.createGuardianInvitation(studentMembershipId, {
              expiresInHours: hours,
            })
          : await adminApi.createStudentGuardianInvitation(
              organizationId!,
              studentMembershipId,
              { expiresInHours: hours }
            );
      setLatestClaimCode(res.claimCode);
      onToast('Đã tạo mã liên kết phụ huynh một lần.');
      await loadInvitations();
    } catch (err) {
      setErrorMsg(
        err instanceof ApiClientError
          ? resolveLocalizedErrorMessage(err.info, locale)
          : 'Không thể tạo mã liên kết phụ huynh.'
      );
    } finally {
      setIssuing(false);
    }
  };

  const handleRevoke = async (invitationId: string) => {
    if (mode === 'admin' && !organizationId) return;
    setRevokingId(invitationId);
    setErrorMsg(null);
    try {
      if (mode === 'teacher') {
        await teacherApi.revokeGuardianInvitation(invitationId);
      } else {
        await adminApi.revokeStudentGuardianInvitation(organizationId!, invitationId);
      }
      onToast('Đã thu hồi mã liên kết phụ huynh.');
      await loadInvitations();
    } catch (err) {
      setErrorMsg(
        err instanceof ApiClientError
          ? resolveLocalizedErrorMessage(err.info, locale)
          : 'Không thể thu hồi mã liên kết.'
      );
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Mã liên kết Phụ huynh — ${studentDisplayName}`}
      description="Tạo mã dùng một lần để phụ huynh đã xác minh email liên kết vào đúng hồ sơ học sinh này (không tạo trùng tài khoản và không hiển thị thông tin riêng tư của phụ huynh)."
    >
      <div className="space-y-4">
        {errorMsg && <Alert variant="danger">{errorMsg}</Alert>}

        {latestClaimCode && (
          <Alert variant="success" title="Mã liên kết mới (chỉ hiển thị duy nhất một lần)">
            <div className="flex flex-wrap items-center gap-3 mt-1">
              <code className="font-mono text-base font-bold text-[var(--mimora-text)]">
                {latestClaimCode}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (typeof navigator !== 'undefined' && navigator.clipboard) {
                    void navigator.clipboard.writeText(latestClaimCode);
                    onToast('Đã sao chép mã liên kết phụ huynh.');
                  }
                }}
                leftIcon={<Copy className="h-3.5 w-3.5" aria-hidden="true" />}
              >
                Sao chép mã
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-[var(--mimora-muted)]">
              Hãy gửi mã này trực tiếp cho phụ huynh. Hệ thống không lưu lại mã gốc sau khi đóng hộp thoại này.
            </p>
          </Alert>
        )}

        <div className="flex flex-wrap items-end justify-between gap-3 rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)] bg-[var(--mimora-surface-subtle)] p-3">
          <div className="min-w-[180px] space-y-1">
            <label
              htmlFor="guardian-invite-expiry"
              className="block text-xs font-medium text-[var(--mimora-text)]"
            >
              Thời hạn hiệu lực mã
            </label>
            <Select
              id="guardian-invite-expiry"
              value={expiresInHours}
              onChange={(e) => setExpiresInHours(e.target.value)}
              options={[
                { value: '24', label: '24 giờ' },
                { value: '72', label: '72 giờ (Mặc định)' },
                { value: '168', label: '7 ngày (168 giờ)' },
              ]}
            />
          </div>
          <Button
            type="button"
            variant="primary"
            loading={issuing}
            onClick={() => void handleGenerate()}
            leftIcon={<KeyRound className="h-4 w-4" aria-hidden="true" />}
          >
            Tạo mã liên kết mới
          </Button>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-[var(--mimora-muted)]">
            Trạng thái các mã đã phát hành ({invitations.length})
          </p>
          {loading ? (
            <LoadingState label="Đang tải trạng thái mã..." />
          ) : invitations.length === 0 ? (
            <p className="text-xs text-[var(--mimora-muted)] py-2">
              Chưa có mã liên kết phụ huynh nào được tạo cho học sinh này.
            </p>
          ) : (
            <div className="divide-y divide-[var(--mimora-border)] border border-[var(--mimora-border)] rounded-[var(--mimora-radius-md)] max-h-60 overflow-y-auto">
              {invitations.map((inv) => {
                const st = getStatusBadge(inv.status);
                return (
                  <div
                    key={inv.id}
                    className="px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={st.variant}>{st.label}</Badge>
                        <span className="text-[var(--mimora-muted)]">
                          Tạo bởi: {inv.createdByRole === 'teacher' ? 'Giáo viên' : 'Quản trị'}
                        </span>
                      </div>
                      <p className="text-[var(--mimora-muted)] tabular-nums">
                        Hết hạn: {formatDateTime(inv.expiresAt)}
                        {inv.claimedAt ? ` · Đã nhận: ${formatDateTime(inv.claimedAt)}` : ''}
                      </p>
                    </div>
                    {inv.status === 'pending' && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        loading={revokingId === inv.id}
                        onClick={() => void handleRevoke(inv.id)}
                        leftIcon={<XCircle className="h-3.5 w-3.5" aria-hidden="true" />}
                      >
                        Thu hồi
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end pt-1">
          <Button type="button" variant="outline" onClick={onClose}>
            Đóng
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
