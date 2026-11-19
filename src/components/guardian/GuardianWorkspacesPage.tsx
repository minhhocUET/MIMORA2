import { Copy, Home, KeyRound, Plus, UserPlus, Users, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiClientError } from '../../api/client.ts';
import { guardianApi } from '../../api/guardian.ts';
import { resolveLocalizedErrorMessage, type AppLocale } from '../../i18n/index.ts';
import type {
  FamilyWorkspaceDetailView,
  SafeFamilyWorkspaceView,
} from '../../types/guardian.ts';
import { formatDateTime } from '../../utils/p302.ts';
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
} from '../ui/index.ts';

export interface GuardianWorkspacesPageProps {
  locale: AppLocale;
  onToast: (msg: string) => void;
  onNavigateToStudents: () => void;
}

function getInvitationBadge(status: string): { label: string; variant: 'success' | 'warning' | 'danger' | 'neutral' } {
  switch (status) {
    case 'pending':
      return { label: 'Đang chờ nhận', variant: 'warning' };
    case 'claimed':
      return { label: 'Đã sử dụng', variant: 'success' };
    case 'revoked':
      return { label: 'Đã thu hồi', variant: 'danger' };
    default:
      return { label: 'Đã hết hạn', variant: 'neutral' };
  }
}

export function GuardianWorkspacesPage({
  locale,
  onToast,
  onNavigateToStudents,
}: GuardianWorkspacesPageProps) {
  const [workspaces, setWorkspaces] = useState<SafeFamilyWorkspaceView[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [detail, setDetail] = useState<FamilyWorkspaceDetailView | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Create Workspace dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  // Co-guardian invitation state
  const [selectedInviteStudentIds, setSelectedInviteStudentIds] = useState<string[]>([]);
  const [issuingInvite, setIssuingInvite] = useState(false);
  const [latestClaimCode, setLatestClaimCode] = useState<string | null>(null);
  const [revokingInviteId, setRevokingInviteId] = useState<string | null>(null);

  // Join co-guardian workspace dialog
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinErr, setJoinErr] = useState<string | null>(null);

  const loadWorkspaces = useCallback(
    async (preferId?: string) => {
      setLoadingList(true);
      setErrorMsg(null);
      try {
        const res = await guardianApi.listWorkspaces();
        setWorkspaces(res.workspaces);
        const nextId =
          preferId && res.workspaces.some((w) => w.id === preferId)
            ? preferId
            : selectedId && res.workspaces.some((w) => w.id === selectedId)
              ? selectedId
              : res.workspaces[0]?.id ?? '';
        setSelectedId(nextId);
      } catch (err) {
        setErrorMsg(
          err instanceof ApiClientError
            ? resolveLocalizedErrorMessage(err.info, locale)
            : 'Không thể tải danh sách không gian gia đình.'
        );
      } finally {
        setLoadingList(false);
      }
    },
    [locale, selectedId]
  );

  const loadDetail = useCallback(
    async (workspaceId: string) => {
      if (!workspaceId) {
        setDetail(null);
        setSelectedInviteStudentIds([]);
        return;
      }
      setLoadingDetail(true);
      try {
        const res = await guardianApi.getWorkspaceDetail(workspaceId);
        setDetail(res);
        setSelectedInviteStudentIds(
          res.students
            .filter((s) => s.linkedByCurrentGuardian)
            .map((s) => s.studentUserId)
        );
      } catch (err) {
        setErrorMsg(
          err instanceof ApiClientError
            ? resolveLocalizedErrorMessage(err.info, locale)
            : 'Không thể tải chi tiết không gian gia đình.'
        );
      } finally {
        setLoadingDetail(false);
      }
    },
    [locale]
  );

  useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  useEffect(() => {
    setLatestClaimCode(null);
    if (selectedId) {
      void loadDetail(selectedId);
    } else {
      setDetail(null);
      setSelectedInviteStudentIds([]);
    }
  }, [selectedId, loadDetail]);

  const handleCopy = (value: string, label: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(value);
      onToast(`Đã sao chép ${label}.`);
    }
  };

  const handleCreateWorkspace = async (e: FormEvent) => {
    e.preventDefault();
    setCreateErr(null);
    if (!workspaceName.trim()) {
      setCreateErr('Vui lòng nhập tên Không gian Gia đình.');
      return;
    }

    setCreating(true);
    try {
      const res = await guardianApi.createWorkspace({ name: workspaceName.trim() });
      setCreateOpen(false);
      setWorkspaceName('');
      onToast(`Đã tạo không gian gia đình "${res.workspace.name}".`);
      await loadWorkspaces(res.workspace.id);
    } catch (err) {
      setCreateErr(
        err instanceof ApiClientError
          ? resolveLocalizedErrorMessage(err.info, locale)
          : 'Không thể tạo không gian gia đình.'
      );
    } finally {
      setCreating(false);
    }
  };

  const toggleInviteStudent = (studentUserId: string) => {
    setSelectedInviteStudentIds((prev) =>
      prev.includes(studentUserId)
        ? prev.filter((id) => id !== studentUserId)
        : [...prev, studentUserId]
    );
  };

  const handleCreateCoGuardianInvite = async () => {
    if (!selectedId) return;
    if (selectedInviteStudentIds.length === 0) {
      setErrorMsg('Vui lòng chọn ít nhất một học sinh để chia sẻ trong lời mời đồng giám hộ.');
      return;
    }
    setIssuingInvite(true);
    setErrorMsg(null);
    try {
      const res = await guardianApi.createCoGuardianInvitation(selectedId, {
        expiresInHours: 72,
        studentUserIds: selectedInviteStudentIds,
      });
      setLatestClaimCode(res.claimCode);
      onToast('Đã tạo mã mời đồng giám hộ theo đúng phạm vi học sinh đã chọn (chỉ hiển thị một lần).');
      await loadDetail(selectedId);
    } catch (err) {
      setErrorMsg(
        err instanceof ApiClientError
          ? resolveLocalizedErrorMessage(err.info, locale)
          : 'Không thể tạo mã mời đồng giám hộ.'
      );
    } finally {
      setIssuingInvite(false);
    }
  };

  const handleRevokeCoGuardianInvite = async (invitationId: string) => {
    if (!selectedId) return;
    setRevokingInviteId(invitationId);
    try {
      await guardianApi.revokeCoGuardianInvitation(selectedId, invitationId);
      onToast('Đã thu hồi mã mời đồng giám hộ.');
      await loadDetail(selectedId);
    } catch (err) {
      setErrorMsg(
        err instanceof ApiClientError
          ? resolveLocalizedErrorMessage(err.info, locale)
          : 'Không thể thu hồi mã mời.'
      );
    } finally {
      setRevokingInviteId(null);
    }
  };

  const handleJoinWorkspace = async (e: FormEvent) => {
    e.preventDefault();
    setJoinErr(null);
    if (!joinCode.trim()) {
      setJoinErr('Vui lòng nhập mã mời đồng giám hộ.');
      return;
    }

    setJoining(true);
    try {
      const res = await guardianApi.claimCoGuardianInvitation({
        claimCode: joinCode.trim(),
      });
      setJoinOpen(false);
      setJoinCode('');
      onToast('Đã tham gia không gian gia đình thành công.');
      await loadWorkspaces(res.workspaceId);
    } catch (err) {
      setJoinErr(
        err instanceof ApiClientError
          ? resolveLocalizedErrorMessage(err.info, locale)
          : 'Mã mời không hợp lệ hoặc đã hết hạn.'
      );
    } finally {
      setJoining(false);
    }
  };

  const eligibleInviteStudents = (detail?.students ?? []).filter(
    (st) => st.linkedByCurrentGuardian
  );

  return (
    <div className="space-y-6">
      <PageHeader
        metadataLine="Cổng Gia đình MIMORA · Tách biệt hoàn toàn với tài khoản trường học"
        title="Không gian Gia đình"
        description="Tạo không gian gia đình cho con học tại nhà, quản lý mã đăng nhập gia đình (FAM) và mời người đồng giám hộ cùng đồng hành."
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setJoinErr(null);
                setJoinOpen(true);
              }}
              leftIcon={<KeyRound className="h-4 w-4" aria-hidden="true" />}
            >
              Tham gia bằng mã mời
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                setCreateErr(null);
                setCreateOpen(true);
              }}
              leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
            >
              Tạo Không gian Gia đình
            </Button>
          </div>
        }
      />

      {errorMsg && <Alert variant="danger">{errorMsg}</Alert>}

      {loadingList ? (
        <LoadingState label="Đang tải không gian gia đình..." />
      ) : workspaces.length === 0 ? (
        <EmptyState
          title="Chưa có Không gian Gia đình nào"
          description="Hãy tạo một Không gian Gia đình mới để thêm hồ sơ học sinh hoặc liên kết học sinh từ trường học."
          action={
            <Button
              type="button"
              variant="primary"
              onClick={() => setCreateOpen(true)}
              leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
            >
              Tạo Không gian Gia đình đầu tiên
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Workspace Selector List */}
          <div className="lg:col-span-4 space-y-2">
            {workspaces.map((ws) => {
              const selected = ws.id === selectedId;
              return (
                <button
                  key={ws.id}
                  type="button"
                  onClick={() => setSelectedId(ws.id)}
                  className={[
                    'w-full text-left rounded-[var(--mimora-radius-md)] border p-4 transition-colors cursor-pointer space-y-1.5',
                    selected
                      ? 'bg-[var(--mimora-surface-mint)] border-[#8fc4b8]'
                      : 'bg-[var(--mimora-surface)] border-[var(--mimora-border)] hover:bg-[var(--mimora-surface-subtle)]/70',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm text-[var(--mimora-text)] truncate">
                      {ws.name}
                    </span>
                    <Badge variant={ws.status === 'active' ? 'success' : 'neutral'}>
                      {ws.status === 'active' ? 'Hoạt động' : ws.status}
                    </Badge>
                  </div>
                  <p className="font-mono text-xs text-[var(--mimora-primary)]">{ws.code}</p>
                  <p className="text-xs text-[var(--mimora-muted)] tabular-nums">
                    {ws.memberCount} người giám hộ · {ws.studentCount} học sinh
                  </p>
                </button>
              );
            })}
          </div>

          {/* Selected Workspace Details */}
          <div className="lg:col-span-8 space-y-6">
            {loadingDetail || !detail ? (
              <LoadingState label="Đang tải chi tiết không gian..." />
            ) : (
              <>
                <Card tone="mint" padding="md">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-[var(--mimora-primary)] flex items-center gap-1.5">
                        <Home className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Mã Không gian Gia đình (dùng cho học sinh đăng nhập tại nhà)</span>
                      </p>
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="font-mono text-xl font-bold tracking-wide text-[var(--mimora-text)]">
                          {detail.workspace.code}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopy(detail.workspace.code, 'mã gia đình')}
                          leftIcon={<Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                        >
                          Sao chép mã
                        </Button>
                      </div>
                      <p className="text-xs text-[var(--mimora-muted)] leading-relaxed pt-1">
                        Khi học sinh đăng nhập ở chế độ “Học sinh”, nhập Mã gia đình này cùng Tên tài khoản gia đình và mật khẩu riêng của con.
                      </p>
                    </div>
                    <Button type="button" variant="primary" size="sm" onClick={onNavigateToStudents}>
                      Quản lý học sinh ({detail.students.length})
                    </Button>
                  </div>
                </Card>

                {/* Co-Guardians Section */}
                <Card padding="md">
                  <CardHeader
                    title={`Người giám hộ trong gia đình (${detail.members.length})`}
                    description="Mỗi phụ huynh đăng nhập bằng tài khoản độc lập của riêng mình. Lời mời đồng giám hộ chỉ chia sẻ đúng những học sinh bạn chọn bên dưới."
                    action={
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        loading={issuingInvite}
                        disabled={
                          eligibleInviteStudents.length === 0 ||
                          selectedInviteStudentIds.length === 0
                        }
                        onClick={() => void handleCreateCoGuardianInvite()}
                        leftIcon={<UserPlus className="h-4 w-4" aria-hidden="true" />}
                      >
                        Mời đồng giám hộ
                      </Button>
                    }
                  />
                  <CardContent className="space-y-4">
                    {/* Explicit Per-Student Scope Picker */}
                    <div className="rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)] bg-[var(--mimora-surface-subtle)]/60 p-3.5 space-y-2.5">
                      <p className="text-xs font-semibold text-[var(--mimora-text)]">
                        Phạm vi học sinh được chia sẻ khi tạo mã mời đồng giám hộ (bắt buộc chọn ít nhất 1):
                      </p>
                      {eligibleInviteStudents.length === 0 ? (
                        <p className="text-xs text-[var(--mimora-muted)]">
                          Bạn cần có ít nhất một học sinh đang liên kết trong không gian này trước khi mời người đồng giám hộ.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {eligibleInviteStudents.map((st) => {
                            const checked = selectedInviteStudentIds.includes(st.studentUserId);
                            return (
                              <label
                                key={st.studentUserId}
                                className={[
                                  'inline-flex items-center gap-2 rounded-[var(--mimora-radius-sm)] border px-3 py-1.5 text-xs cursor-pointer transition-colors',
                                  checked
                                    ? 'bg-[var(--mimora-surface-mint)] border-[#8fc4b8] text-[var(--mimora-text)] font-medium'
                                    : 'bg-[var(--mimora-surface)] border-[var(--mimora-border)] text-[var(--mimora-muted)]',
                                ].join(' ')}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleInviteStudent(st.studentUserId)}
                                  className="h-4 w-4 accent-[var(--mimora-primary)]"
                                />
                                <span>{st.displayName}</span>
                                <span className="font-mono text-[11px] opacity-80">
                                  @{st.familyUsername}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {latestClaimCode && (
                      <Alert variant="success" title="Mã mời đồng giám hộ mới (chỉ hiển thị một lần)">
                        <div className="flex flex-wrap items-center gap-3 mt-1">
                          <code className="font-mono text-base font-bold text-[var(--mimora-text)]">
                            {latestClaimCode}
                          </code>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleCopy(latestClaimCode, 'mã mời đồng giám hộ')}
                            leftIcon={<Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                          >
                            Sao chép mã mời
                          </Button>
                        </div>
                        <p className="mt-1.5 text-xs text-[var(--mimora-muted)]">
                          Gửi mã này một cách an toàn cho người đồng giám hộ đã xác minh email. Người nhận mã chỉ liên kết với các học sinh bạn đã chọn.
                        </p>
                      </Alert>
                    )}

                    <div className="divide-y divide-[var(--mimora-border)] border border-[var(--mimora-border)] rounded-[var(--mimora-radius-md)]">
                      {detail.members.map((m) => (
                        <div
                          key={m.membershipId}
                          className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-sm"
                        >
                          <div className="flex items-center gap-2.5">
                            <Users className="h-4 w-4 text-[var(--mimora-primary)] shrink-0" aria-hidden="true" />
                            <span className="font-medium text-[var(--mimora-text)]">
                              {m.displayName}
                            </span>
                          </div>
                          <span className="text-xs text-[var(--mimora-muted)] tabular-nums">
                            Tham gia {formatDateTime(m.joinedAt)}
                          </span>
                        </div>
                      ))}
                    </div>

                    {detail.coGuardianInvitations.length > 0 && (
                      <div className="space-y-2 pt-2">
                        <p className="text-xs font-semibold text-[var(--mimora-muted)]">
                          Lịch sử mã mời đồng giám hộ ({detail.coGuardianInvitations.length})
                        </p>
                        <div className="divide-y divide-[var(--mimora-border)] border border-[var(--mimora-border)] rounded-[var(--mimora-radius-md)]">
                          {detail.coGuardianInvitations.map((inv) => {
                            const st = getInvitationBadge(inv.status);
                            const shared = inv.sharedStudents ?? [];
                            return (
                              <div
                                key={inv.id}
                                className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                              >
                                <div className="space-y-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant={st.variant}>{st.label}</Badge>
                                    <span className="text-[var(--mimora-muted)] tabular-nums">
                                      Hết hạn: {formatDateTime(inv.expiresAt)}
                                    </span>
                                  </div>
                                  {shared.length > 0 && (
                                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--mimora-muted)]">
                                      <span>Chia sẻ cho:</span>
                                      {shared.map((s) => (
                                        <Badge key={s.studentUserId} variant="neutral">
                                          {s.displayName}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                {inv.status === 'pending' && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    loading={revokingInviteId === inv.id}
                                    onClick={() => void handleRevokeCoGuardianInvite(inv.id)}
                                    leftIcon={<XCircle className="h-3.5 w-3.5" aria-hidden="true" />}
                                  >
                                    Thu hồi
                                  </Button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Safe summary of students inside this workspace */}
                <Card padding="md">
                  <CardHeader
                    title={`Học sinh trong không gian (${detail.students.length})`}
                    description="Chỉ hiển thị thông tin tài khoản và trạng thái liên kết an toàn."
                  />
                  <CardContent>
                    {detail.students.length === 0 ? (
                      <p className="text-sm text-[var(--mimora-muted)]">
                        Chưa có hồ sơ học sinh nào trong không gian này. Vào mục “Học sinh liên kết” để thêm học sinh mới hoặc nhập mã liên kết từ trường học.
                      </p>
                    ) : (
                      <div className="divide-y divide-[var(--mimora-border)] border border-[var(--mimora-border)] rounded-[var(--mimora-radius-md)]">
                        {detail.students.map((st) => (
                          <div
                            key={st.familyStudentId}
                            className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-sm"
                          >
                            <div>
                              <p className="font-medium text-[var(--mimora-text)]">{st.displayName}</p>
                              <p className="font-mono text-xs text-[var(--mimora-muted)]">
                                @{st.familyUsername}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {st.hasSchoolMembership && (
                                <Badge variant="info">Có hồ sơ trường học</Badge>
                              )}
                              <Badge variant={st.linkedByCurrentGuardian ? 'success' : 'neutral'}>
                                {st.linkedByCurrentGuardian ? 'Đã liên kết với bạn' : 'Thuộc gia đình'}
                              </Badge>
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

      {/* Create Workspace Modal */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Tạo Không gian Gia đình mới"
        description="Dùng để quản lý tài khoản học sinh học tại nhà hoặc liên kết con từ trường học."
      >
        <form onSubmit={(e) => void handleCreateWorkspace(e)} className="space-y-4">
          {createErr && <Alert variant="danger">{createErr}</Alert>}
          <FormField label="Tên Không gian Gia đình" htmlFor="new-ws-name" required>
            <Input
              id="new-ws-name"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              placeholder="Ví dụ: Gia đình Bé Minh An"
              disabled={creating}
            />
          </FormField>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" loading={creating}>
              Tạo không gian
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Join Co-Guardian Modal */}
      <Dialog
        open={joinOpen}
        onClose={() => setJoinOpen(false)}
        title="Tham gia Không gian Gia đình"
        description="Nhập mã mời đồng giám hộ do thành viên gia đình khác cung cấp."
      >
        <form onSubmit={(e) => void handleJoinWorkspace(e)} className="space-y-4">
          {joinErr && <Alert variant="danger">{joinErr}</Alert>}
          <FormField label="Mã mời đồng giám hộ" htmlFor="join-coguardian-code" required>
            <Input
              id="join-coguardian-code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="Ví dụ: CGU-XXXX-XXXX-XXXX"
              className="font-mono"
              disabled={joining}
            />
          </FormField>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setJoinOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" loading={joining}>
              Xác nhận tham gia
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
