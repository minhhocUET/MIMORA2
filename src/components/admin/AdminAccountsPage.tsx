import { KeyRound, Link2, Plus, Search, UserCheck, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { adminApi } from '../../api/admin.ts';
import { ApiClientError } from '../../api/client.ts';
import { resolveLocalizedErrorMessage, type AppLocale } from '../../i18n/index.ts';
import type {
  AccountStatus,
  MembershipRole,
  MembershipStatus,
  SafeAdminUserView,
  SafeClassView,
  SafeMembershipView,
  SafeOrganizationView,
} from '../../types/admin.ts';
import {
  formatDateTime,
  getAccountStatusMeta,
  getMembershipStatusMeta,
} from '../../utils/p302.ts';
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
  PasswordInput,
  Select,
  Tabs,
} from '../ui/index.ts';

export interface AdminAccountsPageProps {
  locale: AppLocale;
  onToast: (msg: string) => void;
}

export function AdminAccountsPage({ locale, onToast }: AdminAccountsPageProps) {
  const [tab, setTab] = useState<'users' | 'memberships'>('users');
  const [orgs, setOrgs] = useState<SafeOrganizationView[]>([]);
  const [inviteMem, setInviteMem] = useState<SafeMembershipView | null>(null);
  const [orgsError, setOrgsError] = useState<string | null>(null);

  // Users tab state
  const [users, setUsers] = useState<SafeAdminUserView[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersPage, setUsersPage] = useState(1);
  const [userSearch, setUserSearch] = useState('');
  const [userStatusFilter, setUserStatusFilter] = useState<'' | AccountStatus>('');
  const [platformRoleFilter, setPlatformRoleFilter] = useState<'' | 'platform_admin'>('');
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);

  const [selectedUserDetail, setSelectedUserDetail] = useState<{
    user: SafeAdminUserView;
    memberships: SafeMembershipView[];
  } | null>(null);
  const [loadingUserDetail, setLoadingUserDetail] = useState(false);

  // Create user modal (teacher or student ONLY)
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [newRole, setNewRole] = useState<MembershipRole>('teacher');
  const [newOrgId, setNewOrgId] = useState('');
  const [orgClasses, setOrgClasses] = useState<SafeClassView[]>([]);
  const [newClassId, setNewClassId] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPlatformUsername, setNewPlatformUsername] = useState('');
  const [newOrgUsername, setNewOrgUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);
  const [createUserErr, setCreateUserErr] = useState<string | null>(null);

  // Edit user modal
  const [editUserOpen, setEditUserOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<SafeAdminUserView | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editStatus, setEditStatus] = useState<AccountStatus>('active');
  const [savingUserEdit, setSavingUserEdit] = useState(false);
  const [editUserErr, setEditUserErr] = useState<string | null>(null);

  // Org Memberships tab state
  const [selectedMembershipOrgId, setSelectedMembershipOrgId] = useState('');
  const [memberships, setMemberships] = useState<SafeMembershipView[]>([]);
  const [membershipsTotal, setMembershipsTotal] = useState(0);
  const [membershipsPage, setMembershipsPage] = useState(1);
  const [memSearch, setMemSearch] = useState('');
  const [memRoleFilter, setMemRoleFilter] = useState<'' | MembershipRole>('');
  const [memStatusFilter, setMemStatusFilter] = useState<'' | MembershipStatus>('');
  const [loadingMemberships, setLoadingMemberships] = useState(false);
  const [membershipsError, setMembershipsError] = useState<string | null>(null);

  // Add existing user membership modal
  const [addMemOpen, setAddMemOpen] = useState(false);
  const [addMemUserId, setAddMemUserId] = useState('');
  const [addMemRole, setAddMemRole] = useState<MembershipRole>('teacher');
  const [addMemOrgUsername, setAddMemOrgUsername] = useState('');
  const [savingAddMem, setSavingAddMem] = useState(false);
  const [addMemErr, setAddMemErr] = useState<string | null>(null);

  // Edit membership modal
  const [editMemOpen, setEditMemOpen] = useState(false);
  const [editingMem, setEditingMem] = useState<SafeMembershipView | null>(null);
  const [editMemUsername, setEditMemUsername] = useState('');
  const [editMemStatus, setEditMemStatus] = useState<'active' | 'disabled'>('active');
  const [savingEditMem, setSavingEditMem] = useState(false);
  const [editMemErr, setEditMemErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setOrgsError(null);
    adminApi
      .listOrganizations({ page: 1, limit: 100 })
      .then((res) => {
        if (!active) return;
        setOrgs(res.items);
        if (res.items.length > 0) {
          setNewOrgId((prev) => prev || res.items[0].id);
          setSelectedMembershipOrgId((prev) => prev || res.items[0].id);
        }
      })
      .catch((err) => {
        if (!active) return;
        setOrgsError(
          err instanceof ApiClientError
            ? resolveLocalizedErrorMessage(err.info, locale)
            : 'Không thể tải danh sách trường học.'
        );
      });
    return () => {
      active = false;
    };
  }, [locale]);

  useEffect(() => {
    if (!newOrgId || newRole !== 'student') {
      setOrgClasses([]);
      setNewClassId('');
      return;
    }
    let active = true;
    adminApi
      .listOrganizationClasses(newOrgId, { page: 1, limit: 100, status: 'active' })
      .then((res) => {
        if (!active) return;
        setOrgClasses(res.items);
      })
      .catch((err) => {
        if (!active) return;
        setOrgClasses([]);
        setCreateUserErr(
          err instanceof ApiClientError
            ? resolveLocalizedErrorMessage(err.info, locale)
            : 'Không thể tải danh sách lớp của trường đã chọn.'
        );
      });
    return () => {
      active = false;
    };
  }, [newOrgId, newRole, locale]);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    setUsersError(null);
    try {
      const res = await adminApi.listUsers({
        page: usersPage,
        limit: 20,
        status: userStatusFilter || undefined,
        platformRole: platformRoleFilter || undefined,
        search: userSearch.trim() || undefined,
      });
      setUsers(res.items);
      setUsersTotal(res.total);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setUsersError(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setUsersError('Không thể tải danh sách tài khoản.');
      }
    } finally {
      setLoadingUsers(false);
    }
  }, [usersPage, userStatusFilter, platformRoleFilter, userSearch, locale]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const loadUserDetail = async (userId: string) => {
    setLoadingUserDetail(true);
    try {
      const res = await adminApi.getUser(userId);
      setSelectedUserDetail({ user: res.user, memberships: res.memberships });
    } catch (err) {
      if (err instanceof ApiClientError) {
        setUsersError(resolveLocalizedErrorMessage(err.info, locale));
      }
    } finally {
      setLoadingUserDetail(false);
    }
  };

  const loadMemberships = useCallback(async () => {
    if (!selectedMembershipOrgId) {
      setMemberships([]);
      return;
    }
    setLoadingMemberships(true);
    setMembershipsError(null);
    try {
      const res = await adminApi.listOrganizationMemberships(selectedMembershipOrgId, {
        page: membershipsPage,
        limit: 20,
        role: memRoleFilter || undefined,
        status: memStatusFilter || undefined,
        search: memSearch.trim() || undefined,
      });
      setMemberships(res.items);
      setMembershipsTotal(res.total);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setMembershipsError(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setMembershipsError('Không thể tải danh sách thành viên trường.');
      }
    } finally {
      setLoadingMemberships(false);
    }
  }, [selectedMembershipOrgId, membershipsPage, memRoleFilter, memStatusFilter, memSearch, locale]);

  useEffect(() => {
    if (tab === 'memberships') {
      void loadMemberships();
    }
  }, [tab, loadMemberships]);

  const handleCreateUser = async (e: FormEvent) => {
    e.preventDefault();
    if (!newOrgId || !newDisplayName.trim() || !newPassword) {
      setCreateUserErr('Vui lòng điền đầy đủ tổ chức, tên hiển thị và mật khẩu khởi tạo.');
      return;
    }
    if (newRole === 'teacher' && !newEmail.trim() && !newPlatformUsername.trim()) {
      setCreateUserErr('Giáo viên cần có Email hoặc tên đăng nhập nền tảng (platformUsername).');
      return;
    }
    if (newRole === 'student' && !newOrgUsername.trim()) {
      setCreateUserErr('Học sinh bắt buộc phải có orgUsername trong trường (không cần email).');
      return;
    }

    setCreatingUser(true);
    setCreateUserErr(null);
    try {
      const res = await adminApi.createUser({
        role: newRole,
        organizationId: newOrgId,
        displayName: newDisplayName.trim(),
        password: newPassword,
        email: newEmail.trim() ? newEmail.trim() : null,
        platformUsername:
          newRole === 'teacher' && newPlatformUsername.trim()
            ? newPlatformUsername.trim()
            : null,
        orgUsername: newOrgUsername.trim() ? newOrgUsername.trim() : null,
        classId: newRole === 'student' && newClassId ? newClassId : undefined,
      });
      setCreateUserOpen(false);
      setNewDisplayName('');
      setNewEmail('');
      setNewPlatformUsername('');
      setNewOrgUsername('');
      setNewPassword('');
      setNewClassId('');
      onToast(`Đã tạo tài khoản ${res.user.displayName} (${newRole === 'teacher' ? 'Giáo viên' : 'Học sinh'}).`);
      await loadUsers();
      if (tab === 'memberships') {
        await loadMemberships();
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        setCreateUserErr(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setCreateUserErr('Không thể tạo tài khoản.');
      }
    } finally {
      setCreatingUser(false);
    }
  };

  const handleSaveUserEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingUser || !editDisplayName.trim()) {
      return;
    }
    setSavingUserEdit(true);
    setEditUserErr(null);
    try {
      const res = await adminApi.updateUser(editingUser.id, {
        displayName: editDisplayName.trim(),
        email: editEmail.trim() ? editEmail.trim() : null,
        status: editStatus,
      });
      setEditUserOpen(false);
      onToast(`Đã cập nhật tài khoản ${res.user.displayName}.`);
      await loadUsers();
      if (selectedUserDetail?.user.id === res.user.id) {
        await loadUserDetail(res.user.id);
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        setEditUserErr(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setEditUserErr('Không thể cập nhật tài khoản.');
      }
    } finally {
      setSavingUserEdit(false);
    }
  };

  const handleAddMembership = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedMembershipOrgId || !addMemUserId.trim()) {
      setAddMemErr('Vui lòng nhập UUID người dùng.');
      return;
    }
    setSavingAddMem(true);
    setAddMemErr(null);
    try {
      await adminApi.createOrganizationMembership(selectedMembershipOrgId, {
        userId: addMemUserId.trim(),
        role: addMemRole,
        orgUsername: addMemOrgUsername.trim() ? addMemOrgUsername.trim() : null,
      });
      setAddMemOpen(false);
      setAddMemUserId('');
      setAddMemOrgUsername('');
      onToast('Đã thêm thành viên vào tổ chức.');
      await loadMemberships();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setAddMemErr(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setAddMemErr('Không thể gắn thành viên vào tổ chức.');
      }
    } finally {
      setSavingAddMem(false);
    }
  };

  const handleSaveEditMem = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingMem || !selectedMembershipOrgId) {
      return;
    }
    setSavingEditMem(true);
    setEditMemErr(null);
    try {
      await adminApi.updateOrganizationMembership(selectedMembershipOrgId, editingMem.id, {
        orgUsername: editMemUsername.trim() ? editMemUsername.trim() : null,
        status: editMemStatus,
      });
      setEditMemOpen(false);
      onToast('Đã cập nhật trạng thái thành viên.');
      await loadMemberships();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setEditMemErr(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setEditMemErr('Không thể cập nhật thành viên.');
      }
    } finally {
      setSavingEditMem(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        metadataLine="Cổng Quản trị · P2-03"
        title="Tài khoản & Thành viên theo trường"
        description="Hệ thống chỉ hỗ trợ 3 vai trò: Quản trị hệ thống, Giáo viên và Học sinh. Học sinh không cần email cá nhân."
        action={
          <Button
            variant="primary"
            leftIcon={<UserPlus className="h-4 w-4" aria-hidden="true" />}
            onClick={() => {
              setCreateUserErr(null);
              setCreateUserOpen(true);
            }}
          >
            Cấp tài khoản giáo viên / học sinh
          </Button>
        }
      />

      {orgsError && <Alert variant="danger">{orgsError}</Alert>}

      <Tabs
        ariaLabel="Phân khu tài khoản và thành viên"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'users', label: 'Tài khoản hệ thống' },
          { value: 'memberships', label: 'Thành viên theo trường' },
        ]}
      />

      {tab === 'users' && (
        <div className="space-y-6">
          <Card padding="sm">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <FormField label="Tìm theo tên, email hoặc username" htmlFor="user-search">
                <Input
                  id="user-search"
                  leftAdornment={<Search className="h-4 w-4" aria-hidden="true" />}
                  value={userSearch}
                  onChange={(e) => {
                    setUserSearch(e.target.value);
                    setUsersPage(1);
                  }}
                  placeholder="Tìm tài khoản..."
                />
              </FormField>

              <FormField label="Trạng thái tài khoản" htmlFor="user-status-filter">
                <Select
                  id="user-status-filter"
                  value={userStatusFilter}
                  onChange={(e) => {
                    setUserStatusFilter(e.target.value as '' | AccountStatus);
                    setUsersPage(1);
                  }}
                  options={[
                    { value: '', label: 'Tất cả trạng thái' },
                    { value: 'active', label: 'Đang hoạt động' },
                    { value: 'locked', label: 'Đang tạm khóa' },
                    { value: 'disabled', label: 'Đã vô hiệu hóa' },
                  ]}
                />
              </FormField>

              <FormField label="Vai trò nền tảng" htmlFor="user-role-filter">
                <Select
                  id="user-role-filter"
                  value={platformRoleFilter}
                  onChange={(e) => {
                    setPlatformRoleFilter(e.target.value as '' | 'platform_admin');
                    setUsersPage(1);
                  }}
                  options={[
                    { value: '', label: 'Tất cả tài khoản' },
                    { value: 'platform_admin', label: 'Chỉ Quản trị hệ thống' },
                  ]}
                />
              </FormField>
            </div>
          </Card>

          {usersError && <Alert variant="danger">{usersError}</Alert>}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            <Card className="lg:col-span-2" padding="md">
              <CardHeader
                title={`Danh sách tài khoản (${usersTotal})`}
                description="Chọn một tài khoản để xem thành viên trường hoặc mở khóa/cập nhật trạng thái."
              />
              <CardContent>
                {loadingUsers ? (
                  <LoadingState label="Đang tải tài khoản..." />
                ) : users.length === 0 ? (
                  <EmptyState
                    title="Không có tài khoản nào khớp bộ lọc"
                    description="Thử thay đổi từ khóa tìm kiếm hoặc cấp tài khoản giáo viên/học sinh mới."
                  />
                ) : (
                  <div className="space-y-4">
                    <div className="overflow-x-auto rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)]">
                      <table className="w-full text-left text-sm border-collapse">
                        <thead className="bg-[var(--mimora-surface-subtle)] text-xs text-[var(--mimora-muted)]">
                          <tr>
                            <th className="py-2.5 px-3 font-medium">Tên hiển thị</th>
                            <th className="py-2.5 px-3 font-medium">Định danh</th>
                            <th className="py-2.5 px-3 font-medium">Trạng thái</th>
                            <th className="py-2.5 px-3 font-medium text-right">Thao tác</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--mimora-border)]">
                          {users.map((u) => {
                            const st = getAccountStatusMeta(u.status, locale);
                            return (
                              <tr key={u.id} className="hover:bg-[var(--mimora-surface-subtle)]/50">
                                <td className="py-2.5 px-3">
                                  <p className="font-medium text-[var(--mimora-text)]">{u.displayName}</p>
                                  {u.platformRole === 'platform_admin' && (
                                    <span className="text-xs text-[var(--mimora-primary)] font-medium">
                                      Quản trị hệ thống
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-xs font-mono text-[var(--mimora-muted)]">
                                  {u.email ?? u.platformUsername ?? 'Tài khoản học sinh theo trường'}
                                </td>
                                <td className="py-2.5 px-3">
                                  <Badge variant={st.variant}>{st.label}</Badge>
                                </td>
                                <td className="py-2.5 px-3 text-right space-x-2 whitespace-nowrap">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => void loadUserDetail(u.id)}
                                  >
                                    Chi tiết
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      setEditingUser(u);
                                      setEditDisplayName(u.displayName);
                                      setEditEmail(u.email ?? '');
                                      setEditStatus(u.status);
                                      setEditUserErr(null);
                                      setEditUserOpen(true);
                                    }}
                                  >
                                    Cập nhật
                                  </Button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {usersTotal > 20 && (
                      <div className="flex items-center justify-between text-xs text-[var(--mimora-muted)]">
                        <span className="tabular-nums">
                          Trang {usersPage} / {Math.max(1, Math.ceil(usersTotal / 20))}
                        </span>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={usersPage <= 1}
                            onClick={() => setUsersPage((p) => Math.max(1, p - 1))}
                          >
                            Trước
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={usersPage >= Math.ceil(usersTotal / 20)}
                            onClick={() => setUsersPage((p) => p + 1)}
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
                title="Chi tiết tài khoản & Thành viên"
                description="Lưu ý: Quản trị viên chỉ hỗ trợ đổi tên/email/mở khóa trạng thái; chưa có API đặt lại mật khẩu hộ."
              />
              <CardContent>
                {loadingUserDetail ? (
                  <LoadingState label="Đang tải chi tiết..." />
                ) : !selectedUserDetail ? (
                  <p className="text-sm text-[var(--mimora-muted)]">
                    Chọn "Chi tiết" trên một tài khoản để xem danh sách trường mà tài khoản tham gia.
                  </p>
                ) : (
                  <div className="space-y-4 text-sm">
                    <div className="space-y-1">
                      <p className="font-semibold text-base">{selectedUserDetail.user.displayName}</p>
                      <p className="font-mono text-xs text-[var(--mimora-muted)] break-all">
                        ID: {selectedUserDetail.user.id}
                      </p>
                      <p className="text-xs text-[var(--mimora-muted)]">
                        Đăng nhập gần nhất: {formatDateTime(selectedUserDetail.user.lastLoginAt, locale)}
                      </p>
                      {selectedUserDetail.user.failedLoginAttempts > 0 && (
                        <p className="text-xs text-[var(--mimora-warning)] tabular-nums">
                          Số lần nhập sai mật khẩu gần đây: {selectedUserDetail.user.failedLoginAttempts}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--mimora-muted)]">
                        Trường học trực thuộc ({selectedUserDetail.memberships.length})
                      </h4>
                      {selectedUserDetail.memberships.length === 0 ? (
                        <p className="text-xs text-[var(--mimora-muted)]">Chưa gắn với tổ chức nào.</p>
                      ) : (
                        <ul className="space-y-2">
                          {selectedUserDetail.memberships.map((m) => (
                            <li
                              key={m.id}
                              className="rounded-[var(--mimora-radius-sm)] border border-[var(--mimora-border)] p-2.5 text-xs space-y-1"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold">
                                  {m.organization?.name ?? m.organizationId}
                                </span>
                                <Badge variant={getMembershipStatusMeta(m.status, locale).variant}>
                                  {getMembershipStatusMeta(m.status, locale).label}
                                </Badge>
                              </div>
                              <p className="text-[var(--mimora-muted)]">
                                Vai trò: <strong>{m.role === 'teacher' ? 'Giáo viên' : 'Học sinh'}</strong>
                                {m.orgUsername ? ` · @${m.orgUsername}` : ''}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {tab === 'memberships' && (
        <div className="space-y-6">
          <Card padding="sm">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
              <FormField label="Chọn trường học" htmlFor="mem-org-select">
                <Select
                  id="mem-org-select"
                  value={selectedMembershipOrgId}
                  onChange={(e) => {
                    setSelectedMembershipOrgId(e.target.value);
                    setMembershipsPage(1);
                  }}
                  options={orgs.map((o) => ({ value: o.id, label: `${o.name} (${o.code})` }))}
                />
              </FormField>

              <FormField label="Vai trò trong trường" htmlFor="mem-role-filter">
                <Select
                  id="mem-role-filter"
                  value={memRoleFilter}
                  onChange={(e) => {
                    setMemRoleFilter(e.target.value as '' | MembershipRole);
                    setMembershipsPage(1);
                  }}
                  options={[
                    { value: '', label: 'Giáo viên & Học sinh' },
                    { value: 'teacher', label: 'Giáo viên' },
                    { value: 'student', label: 'Học sinh' },
                  ]}
                />
              </FormField>

              <FormField label="Trạng thái thành viên" htmlFor="mem-status-filter">
                <Select
                  id="mem-status-filter"
                  value={memStatusFilter}
                  onChange={(e) => {
                    setMemStatusFilter(e.target.value as '' | MembershipStatus);
                    setMembershipsPage(1);
                  }}
                  options={[
                    { value: '', label: 'Tất cả trạng thái' },
                    { value: 'active', label: 'Đang hoạt động' },
                    { value: 'disabled', label: 'Ngưng hoạt động' },
                    { value: 'transferred', label: 'Đã chuyển trường' },
                  ]}
                />
              </FormField>

              <FormField label="Tìm thành viên" htmlFor="mem-search">
                <Input
                  id="mem-search"
                  value={memSearch}
                  onChange={(e) => {
                    setMemSearch(e.target.value);
                    setMembershipsPage(1);
                  }}
                  placeholder="Tên hoặc org_username"
                />
              </FormField>
            </div>
          </Card>

          {membershipsError && <Alert variant="danger">{membershipsError}</Alert>}

          <Card padding="md">
            <CardHeader
              title={`Thành viên trường (${membershipsTotal})`}
              description="Quản lý org_username và trạng thái hoạt động của giáo viên/học sinh trong trường đã chọn."
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!selectedMembershipOrgId}
                  leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => {
                    setAddMemErr(null);
                    setAddMemOpen(true);
                  }}
                >
                  Gắn tài khoản có sẵn vào trường
                </Button>
              }
            />
            <CardContent>
              {loadingMemberships ? (
                <LoadingState label="Đang tải thành viên..." />
              ) : memberships.length === 0 ? (
                <EmptyState
                  title="Chưa có thành viên nào"
                  description="Tạo tài khoản giáo viên/học sinh mới hoặc gắn tài khoản hiện có vào trường."
                />
              ) : (
                <div className="overflow-x-auto rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)]">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead className="bg-[var(--mimora-surface-subtle)] text-xs text-[var(--mimora-muted)]">
                      <tr>
                        <th className="py-2.5 px-3 font-medium">Họ tên</th>
                        <th className="py-2.5 px-3 font-medium">Vai trò</th>
                        <th className="py-2.5 px-3 font-medium">org_username</th>
                        <th className="py-2.5 px-3 font-medium">Trạng thái</th>
                        <th className="py-2.5 px-3 font-medium text-right">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--mimora-border)]">
                      {memberships.map((m) => {
                        const st = getMembershipStatusMeta(m.status, locale);
                        return (
                          <tr key={m.id}>
                            <td className="py-2.5 px-3">
                              <p className="font-medium">{m.user?.displayName ?? m.userId}</p>
                              {m.user?.email && (
                                <p className="text-xs text-[var(--mimora-muted)]">{m.user.email}</p>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-xs">
                              {m.role === 'teacher' ? 'Giáo viên' : 'Học sinh'}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-xs">{m.orgUsername ?? '—'}</td>
                            <td className="py-2.5 px-3">
                              <Badge variant={st.variant}>{st.label}</Badge>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <div className="inline-flex flex-wrap items-center justify-end gap-2">
                                {m.role === 'student' && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={m.status !== 'active'}
                                    leftIcon={<Link2 className="h-3.5 w-3.5" aria-hidden="true" />}
                                    onClick={() => setInviteMem(m)}
                                  >
                                    Liên kết phụ huynh
                                  </Button>
                                )}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={m.status === 'transferred'}
                                  onClick={() => {
                                    setEditingMem(m);
                                    setEditMemUsername(m.orgUsername ?? '');
                                    setEditMemStatus(m.status === 'disabled' ? 'disabled' : 'active');
                                    setEditMemErr(null);
                                    setEditMemOpen(true);
                                  }}
                                >
                                  Chỉnh sửa
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Create User Modal */}
      <Dialog
        open={createUserOpen}
        onClose={() => setCreateUserOpen(false)}
        title="Cấp tài khoản Giáo viên hoặc Học sinh"
        description="Hệ thống chỉ tạo tài khoản trường học cho giáo viên/học sinh (không có org_admin; tài khoản người giám hộ tự đăng ký riêng)."
      >
        <form onSubmit={(e) => void handleCreateUser(e)} className="space-y-4">
          {createUserErr && <Alert variant="danger">{createUserErr}</Alert>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Vai trò" htmlFor="new-user-role" required>
              <Select
                id="new-user-role"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as MembershipRole)}
                options={[
                  { value: 'teacher', label: 'Giáo viên (teacher)' },
                  { value: 'student', label: 'Học sinh (student)' },
                ]}
              />
            </FormField>

            <FormField label="Thuộc trường học" htmlFor="new-user-org" required>
              <Select
                id="new-user-org"
                value={newOrgId}
                onChange={(e) => setNewOrgId(e.target.value)}
                options={orgs.map((o) => ({ value: o.id, label: `${o.name} (${o.code})` }))}
              />
            </FormField>
          </div>

          <FormField label="Tên hiển thị" htmlFor="new-user-name" required>
            <Input
              id="new-user-name"
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.target.value)}
              placeholder={newRole === 'teacher' ? 'Cô Nguyễn Thu Hà' : 'Nguyễn Minh An'}
              required
            />
          </FormField>

          {newRole === 'teacher' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Email giáo viên" htmlFor="new-teacher-email" hint="Bắt buộc có Email hoặc Username nền tảng">
                <Input
                  id="new-teacher-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="ha.nguyen@truong.edu.vn"
                />
              </FormField>
              <FormField label="Username nền tảng (tùy chọn)" htmlFor="new-teacher-uname">
                <Input
                  id="new-teacher-uname"
                  value={newPlatformUsername}
                  onChange={(e) => setNewPlatformUsername(e.target.value)}
                  placeholder="co.ha"
                />
              </FormField>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                label="Tên tài khoản học sinh (orgUsername)"
                htmlFor="new-student-org-uname"
                required
                hint="2-64 ký tự chữ thường/số/._-, không chứa @"
              >
                <Input
                  id="new-student-org-uname"
                  value={newOrgUsername}
                  onChange={(e) => setNewOrgUsername(e.target.value.toLowerCase())}
                  placeholder="minh.an"
                  required
                />
              </FormField>

              <FormField label="Ghi danh ngay vào lớp (tùy chọn)" htmlFor="new-student-class">
                <Select
                  id="new-student-class"
                  value={newClassId}
                  onChange={(e) => setNewClassId(e.target.value)}
                  options={[
                    { value: '', label: 'Chưa xếp lớp ngay' },
                    ...orgClasses.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                />
              </FormField>
            </div>
          )}

          <FormField
            label="Mật khẩu khởi tạo"
            htmlFor="new-user-pwd"
            required
            hint="Giáo viên/học sinh có thể tự đổi mật khẩu sau khi đăng nhập."
          >
            <PasswordInput
              id="new-user-pwd"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Nhập mật khẩu khởi tạo an toàn"
              required
            />
          </FormField>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCreateUserOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" loading={creatingUser}>
              Tạo tài khoản
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Edit User Modal */}
      <Dialog
        open={editUserOpen}
        onClose={() => setEditUserOpen(false)}
        title={`Cập nhật tài khoản: ${editingUser?.displayName ?? ''}`}
        description="Mở khóa tài khoản bị khóa do nhập sai mật khẩu bằng cách đặt trạng thái về Đang hoạt động (active)."
      >
        <form onSubmit={(e) => void handleSaveUserEdit(e)} className="space-y-4">
          {editUserErr && <Alert variant="danger">{editUserErr}</Alert>}

          <FormField label="Tên hiển thị" htmlFor="edit-user-name" required>
            <Input
              id="edit-user-name"
              value={editDisplayName}
              onChange={(e) => setEditDisplayName(e.target.value)}
              required
            />
          </FormField>

          <FormField label="Email (tùy chọn với học sinh)" htmlFor="edit-user-email">
            <Input
              id="edit-user-email"
              type="email"
              value={editEmail}
              onChange={(e) => setEditEmail(e.target.value)}
              placeholder="Để trống nếu không có email"
            />
          </FormField>

          <FormField label="Trạng thái" htmlFor="edit-user-status">
            <Select
              id="edit-user-status"
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value as AccountStatus)}
              options={[
                { value: 'active', label: 'Đang hoạt động (mở khóa)' },
                { value: 'locked', label: 'Tạm khóa (locked)' },
                { value: 'disabled', label: 'Vô hiệu hóa (disabled)' },
              ]}
            />
          </FormField>

          <Alert variant="info" title="Chính sách mật khẩu">
            <span className="inline-flex items-center gap-1.5 text-xs">
              <KeyRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Backend hiện chỉ hỗ trợ người dùng tự đổi mật khẩu qua phiên đăng nhập cá nhân, chưa có chức năng đặt lại mật khẩu hộ bởi quản trị viên.
            </span>
          </Alert>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEditUserOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" loading={savingUserEdit}>
              Lưu thay đổi
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Add Existing User Membership Modal */}
      <Dialog
        open={addMemOpen}
        onClose={() => setAddMemOpen(false)}
        title="Gắn tài khoản có sẵn vào trường"
        description="Lưu ý: Học sinh hiện bị chặn chuyển/gắn chéo nhiều trường theo chính sách STUDENT_TRANSFER_POLICY_DEFERRED."
      >
        <form onSubmit={(e) => void handleAddMembership(e)} className="space-y-4">
          {addMemErr && <Alert variant="danger">{addMemErr}</Alert>}

          <FormField label="UUID người dùng (userId)" htmlFor="add-mem-uid" required>
            <Input
              id="add-mem-uid"
              value={addMemUserId}
              onChange={(e) => setAddMemUserId(e.target.value)}
              placeholder="019..."
              required
            />
          </FormField>

          <FormField label="Vai trò tại trường" htmlFor="add-mem-role">
            <Select
              id="add-mem-role"
              value={addMemRole}
              onChange={(e) => setAddMemRole(e.target.value as MembershipRole)}
              options={[
                { value: 'teacher', label: 'Giáo viên (teacher)' },
                { value: 'student', label: 'Học sinh (student)' },
              ]}
            />
          </FormField>

          <FormField label="org_username (nếu có)" htmlFor="add-mem-uname">
            <Input
              id="add-mem-uname"
              value={addMemOrgUsername}
              onChange={(e) => setAddMemOrgUsername(e.target.value.toLowerCase())}
              placeholder="minh.an"
            />
          </FormField>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setAddMemOpen(false)}>
              Hủy
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={savingAddMem}
              leftIcon={<UserCheck className="h-4 w-4" aria-hidden="true" />}
            >
              Xác nhận gắn thành viên
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Edit Membership Modal */}
      <Dialog
        open={editMemOpen}
        onClose={() => setEditMemOpen(false)}
        title="Cập nhật thành viên trường"
      >
        <form onSubmit={(e) => void handleSaveEditMem(e)} className="space-y-4">
          {editMemErr && <Alert variant="danger">{editMemErr}</Alert>}

          <FormField label="org_username" htmlFor="edit-mem-uname">
            <Input
              id="edit-mem-uname"
              value={editMemUsername}
              onChange={(e) => setEditMemUsername(e.target.value.toLowerCase())}
            />
          </FormField>

          <FormField label="Trạng thái thành viên" htmlFor="edit-mem-status">
            <Select
              id="edit-mem-status"
              value={editMemStatus}
              onChange={(e) => setEditMemStatus(e.target.value as 'active' | 'disabled')}
              options={[
                { value: 'active', label: 'Đang hoạt động (active)' },
                { value: 'disabled', label: 'Ngưng hoạt động (disabled)' },
              ]}
            />
          </FormField>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEditMemOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" loading={savingEditMem}>
              Lưu cập nhật
            </Button>
          </div>
        </form>
      </Dialog>
      <GuardianInviteDialog
        open={Boolean(inviteMem)}
        onClose={() => setInviteMem(null)}
        locale={locale}
        mode="admin"
        organizationId={selectedMembershipOrgId}
        studentMembershipId={inviteMem?.id ?? null}
        studentDisplayName={inviteMem?.user?.displayName ?? inviteMem?.orgUsername ?? 'Học sinh'}
        onToast={onToast}
      />
    </div>
  );
}
