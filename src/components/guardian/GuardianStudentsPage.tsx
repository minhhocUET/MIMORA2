import { Copy, Link2, Plus, ShieldAlert, Unlink, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiClientError } from '../../api/client.ts';
import { guardianApi } from '../../api/guardian.ts';
import { resolveLocalizedErrorMessage, type AppLocale } from '../../i18n/index.ts';
import type {
  SafeFamilyWorkspaceView,
  SafeGuardianStudentLinkView,
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
  PasswordInput,
  Select,
} from '../ui/index.ts';

export interface GuardianStudentsPageProps {
  locale: AppLocale;
  onToast: (msg: string) => void;
}

export function GuardianStudentsPage({ locale, onToast }: GuardianStudentsPageProps) {
  const [links, setLinks] = useState<SafeGuardianStudentLinkView[]>([]);
  const [workspaces, setWorkspaces] = useState<SafeFamilyWorkspaceView[]>([]);
  const [includeRevoked, setIncludeRevoked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Add new Family Student modal
  const [addStudentOpen, setAddStudentOpen] = useState(false);
  const [targetWorkspaceId, setTargetWorkspaceId] = useState('');
  const [studentDisplayName, setStudentDisplayName] = useState('');
  const [familyUsername, setFamilyUsername] = useState('');
  const [studentPassword, setStudentPassword] = useState('');
  const [creatingStudent, setCreatingStudent] = useState(false);
  const [addStudentErr, setAddStudentErr] = useState<string | null>(null);
  const [createdCredentials, setCreatedCredentials] = useState<{
    displayName: string;
    workspaceCode: string;
    familyUsername: string;
  } | null>(null);

  // Claim School Invitation modal
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimWorkspaceId, setClaimWorkspaceId] = useState('');
  const [claimCode, setClaimCode] = useState('');
  const [claimFamilyUsername, setClaimFamilyUsername] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimErr, setClaimErr] = useState<string | null>(null);

  // Confirm revoke dialog
  const [confirmRevokeLink, setConfirmRevokeLink] =
    useState<SafeGuardianStudentLinkView | null>(null);
  const [revoking, setRevoking] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [studentsRes, wsRes] = await Promise.all([
        guardianApi.listMyStudents({ includeRevoked }),
        guardianApi.listWorkspaces(),
      ]);
      setLinks(studentsRes.students);
      setWorkspaces(wsRes.workspaces);
      if (wsRes.workspaces.length > 0) {
        setTargetWorkspaceId((prev) => prev || wsRes.workspaces[0].id);
        setClaimWorkspaceId((prev) => prev || wsRes.workspaces[0].id);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof ApiClientError
          ? resolveLocalizedErrorMessage(err.info, locale)
          : 'Không thể tải danh sách học sinh liên kết.'
      );
    } finally {
      setLoading(false);
    }
  }, [includeRevoked, locale]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCreateStudent = async (e: FormEvent) => {
    e.preventDefault();
    setAddStudentErr(null);

    if (!targetWorkspaceId || !studentDisplayName.trim() || !familyUsername.trim() || !studentPassword) {
      setAddStudentErr('Vui lòng điền đầy đủ các trường bắt buộc.');
      return;
    }
    if (studentPassword.length < 8) {
      setAddStudentErr('Mật khẩu học sinh phải có ít nhất 8 ký tự.');
      return;
    }

    setCreatingStudent(true);
    try {
      const res = await guardianApi.createFamilyStudent(targetWorkspaceId, {
        displayName: studentDisplayName.trim(),
        familyUsername: familyUsername.trim(),
        password: studentPassword,
      });
      setCreatedCredentials({
        displayName: res.student.displayName,
        workspaceCode: res.loginGuide.workspaceCode,
        familyUsername: res.loginGuide.familyUsername,
      });
      setAddStudentOpen(false);
      setStudentDisplayName('');
      setFamilyUsername('');
      setStudentPassword('');
      onToast(`Đã tạo hồ sơ học sinh "${res.student.displayName}".`);
      await loadData();
    } catch (err) {
      setAddStudentErr(
        err instanceof ApiClientError
          ? resolveLocalizedErrorMessage(err.info, locale)
          : 'Không thể tạo hồ sơ học sinh.'
      );
    } finally {
      setCreatingStudent(false);
    }
  };

  const handleClaimSchoolInvitation = async (e: FormEvent) => {
    e.preventDefault();
    setClaimErr(null);
    if (!claimWorkspaceId || !claimCode.trim()) {
      setClaimErr('Vui lòng chọn không gian gia đình và nhập mã liên kết từ trường học.');
      return;
    }

    setClaiming(true);
    try {
      const res = await guardianApi.claimSchoolInvitation({
        targetWorkspaceId: claimWorkspaceId,
        claimCode: claimCode.trim(),
        ...(claimFamilyUsername.trim()
          ? { familyUsername: claimFamilyUsername.trim() }
          : {}),
      });
      setClaimOpen(false);
      setClaimCode('');
      setClaimFamilyUsername('');
      onToast(
        `Đã liên kết thành công học sinh "${res.link.studentDisplayName}" mà không tạo trùng tài khoản.`
      );
      await loadData();
    } catch (err) {
      setClaimErr(
        err instanceof ApiClientError
          ? resolveLocalizedErrorMessage(err.info, locale)
          : 'Không thể liên kết học sinh bằng mã này.'
      );
    } finally {
      setClaiming(false);
    }
  };

  const handleRevokeLink = async () => {
    if (!confirmRevokeLink) return;
    setRevoking(true);
    try {
      await guardianApi.revokeMyLink(confirmRevokeLink.linkId);
      setConfirmRevokeLink(null);
      onToast('Đã thu hồi liên kết người giám hộ. Tài khoản và lịch sử học tập của học sinh vẫn được giữ nguyên.');
      await loadData();
    } catch (err) {
      setErrorMsg(
        err instanceof ApiClientError
          ? resolveLocalizedErrorMessage(err.info, locale)
          : 'Không thể thu hồi liên kết.'
      );
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        metadataLine="Quyền riêng tư trẻ em · Không hiển thị câu trả lời, AAC hay ghi chú riêng tư"
        title="Học sinh đã liên kết"
        description="Quản lý danh sách con trong gia đình: tạo hồ sơ mới không cần trường học hoặc liên kết tài khoản học sinh đang học ở trường."
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={workspaces.length === 0}
              onClick={() => {
                setClaimErr(null);
                setClaimOpen(true);
              }}
              leftIcon={<Link2 className="h-4 w-4" aria-hidden="true" />}
            >
              Liên kết từ mã trường học
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={workspaces.length === 0}
              onClick={() => {
                setAddStudentErr(null);
                setAddStudentOpen(true);
              }}
              leftIcon={<UserPlus className="h-4 w-4" aria-hidden="true" />}
            >
              Thêm hồ sơ học sinh
            </Button>
          </div>
        }
      />

      {createdCredentials && (
        <Alert
          variant="success"
          title={`Thông tin đăng nhập dành riêng cho học sinh "${createdCredentials.displayName}"`}
        >
          <p className="leading-relaxed">
            Học sinh đăng nhập ở tab <strong>Học sinh</strong> bằng thông tin sau (mật khẩu không hiển thị lại):
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-4 font-mono text-xs bg-[var(--mimora-surface)] border border-[var(--mimora-border)] rounded-[var(--mimora-radius-sm)] px-3 py-2">
            <span>Mã gia đình: {createdCredentials.workspaceCode}</span>
            <span>Tên tài khoản: {createdCredentials.familyUsername}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (typeof navigator !== 'undefined' && navigator.clipboard) {
                  void navigator.clipboard.writeText(
                    `Mã gia đình: ${createdCredentials.workspaceCode} | Tài khoản: ${createdCredentials.familyUsername}`
                  );
                  onToast('Đã sao chép hướng dẫn đăng nhập của học sinh.');
                }
              }}
              leftIcon={<Copy className="h-3.5 w-3.5" aria-hidden="true" />}
            >
              Sao chép
            </Button>
          </div>
        </Alert>
      )}

      {workspaces.length === 0 && !loading && (
        <Alert variant="warning">
          Bạn cần tạo ít nhất một Không gian Gia đình trước khi thêm hồ sơ học sinh hoặc nhập mã liên kết từ trường học.
        </Alert>
      )}

      {errorMsg && <Alert variant="danger">{errorMsg}</Alert>}

      <div className="flex items-center justify-between gap-4">
        <label className="inline-flex items-center gap-2 text-xs text-[var(--mimora-muted)] cursor-pointer">
          <input
            type="checkbox"
            checked={includeRevoked}
            onChange={(e) => setIncludeRevoked(e.target.checked)}
            className="h-4 w-4 accent-[var(--mimora-primary)]"
          />
          <span>Hiển thị cả liên kết đã thu hồi</span>
        </label>
      </div>

      {loading ? (
        <LoadingState label="Đang tải danh sách học sinh..." />
      ) : links.length === 0 ? (
        <EmptyState
          title="Chưa có học sinh nào được liên kết"
          description="Bạn có thể tạo hồ sơ học sinh trực tiếp trong Không gian Gia đình hoặc nhập mã liên kết một lần do giáo viên/trường học cấp."
          action={
            workspaces.length > 0 ? (
              <Button
                type="button"
                variant="primary"
                onClick={() => setAddStudentOpen(true)}
                leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
              >
                Thêm hồ sơ học sinh
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {links.map((item) => {
            const isActiveLink = item.relationshipStatus === 'active';
            return (
              <Card key={item.linkId} padding="md" className="flex flex-col justify-between gap-4">
                <CardHeader
                  title={item.studentDisplayName}
                  description={`${item.workspaceName} · Mã ${item.workspaceCode}`}
                  action={
                    <Badge variant={isActiveLink ? 'success' : 'neutral'}>
                      {isActiveLink ? 'Đang liên kết' : 'Đã thu hồi'}
                    </Badge>
                  }
                />
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-[var(--mimora-muted)]">Tài khoản gia đình</p>
                      <p className="font-mono font-medium text-[var(--mimora-text)]">
                        @{item.familyUsername ?? '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[var(--mimora-muted)]">Trạng thái tài khoản</p>
                      <p className="font-medium text-[var(--mimora-text)]">
                        {item.studentStatus === 'active' ? 'Đang hoạt động' : item.studentStatus}
                      </p>
                    </div>
                    <div>
                      <p className="text-[var(--mimora-muted)]">Nguồn xác minh</p>
                      <p className="font-medium text-[var(--mimora-text)]">
                        {item.verificationSource === 'school_invitation'
                          ? 'Mã mời từ trường học'
                          : item.verificationSource === 'co_guardian_verified'
                            ? 'Đồng giám hộ gia đình'
                            : 'Tạo trong gia đình'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[var(--mimora-muted)]">Ngữ cảnh trường học</p>
                      <p className="font-medium text-[var(--mimora-text)]">
                        {item.hasSchoolMembership
                          ? item.sourceOrganizationName || 'Có tài khoản trường'
                          : 'Chỉ học tại gia đình'}
                      </p>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-[var(--mimora-border)] flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--mimora-muted)]">
                    <span className="tabular-nums">
                      Xác minh: {formatDateTime(item.verifiedAt)}
                    </span>
                    {isActiveLink && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmRevokeLink(item)}
                        leftIcon={<Unlink className="h-3.5 w-3.5" aria-hidden="true" />}
                      >
                        Thu hồi liên kết
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Family Student Modal */}
      <Dialog
        open={addStudentOpen}
        onClose={() => setAddStudentOpen(false)}
        title="Thêm hồ sơ học sinh trong Gia đình"
        description="Tạo tài khoản độc lập cho con mà không cần giáo viên hay lớp học. Không thu thập email trẻ em hay thông tin chẩn đoán."
      >
        <form onSubmit={(e) => void handleCreateStudent(e)} className="space-y-4">
          {addStudentErr && <Alert variant="danger">{addStudentErr}</Alert>}

          <FormField label="Thuộc Không gian Gia đình" htmlFor="stu-ws-id" required>
            <Select
              id="stu-ws-id"
              value={targetWorkspaceId}
              onChange={(e) => setTargetWorkspaceId(e.target.value)}
              options={workspaces.map((w) => ({
                value: w.id,
                label: `${w.name} (${w.code})`,
              }))}
            />
          </FormField>

          <FormField label="Tên hiển thị của học sinh" htmlFor="stu-display-name" required>
            <Input
              id="stu-display-name"
              value={studentDisplayName}
              onChange={(e) => setStudentDisplayName(e.target.value)}
              placeholder="Ví dụ: Bé Minh An"
              disabled={creatingStudent}
            />
          </FormField>

          <FormField
            label="Tên đăng nhập trong gia đình"
            htmlFor="stu-family-username"
            hint="Chữ thường, số, dấu chấm, gạch ngang hoặc gạch dưới (2-64 ký tự)."
            required
          >
            <Input
              id="stu-family-username"
              value={familyUsername}
              onChange={(e) => setFamilyUsername(e.target.value)}
              placeholder="Ví dụ: minh.an"
              disabled={creatingStudent}
            />
          </FormField>

          <FormField
            label="Mật khẩu đăng nhập của học sinh"
            htmlFor="stu-password"
            hint="Tối thiểu 8 ký tự. Phụ huynh và học sinh dùng tài khoản riêng biệt."
            required
          >
            <PasswordInput
              id="stu-password"
              value={studentPassword}
              onChange={(e) => setStudentPassword(e.target.value)}
              placeholder="Nhập mật khẩu cho học sinh"
              showLabel="Hiện mật khẩu"
              hideLabel="Ẩn mật khẩu"
              disabled={creatingStudent}
            />
          </FormField>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setAddStudentOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" loading={creatingStudent}>
              Tạo hồ sơ học sinh
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Claim School Invitation Modal */}
      <Dialog
        open={claimOpen}
        onClose={() => setClaimOpen(false)}
        title="Liên kết học sinh từ trường học"
        description="Nhập mã liên kết một lần do giáo viên hoặc quản trị viên trường học cung cấp. Hệ thống sẽ gắn đúng hồ sơ học sinh sẵn có, không tạo trùng tài khoản."
      >
        <form onSubmit={(e) => void handleClaimSchoolInvitation(e)} className="space-y-4">
          {claimErr && <Alert variant="danger">{claimErr}</Alert>}

          <FormField label="Đưa vào Không gian Gia đình" htmlFor="claim-ws-id" required>
            <Select
              id="claim-ws-id"
              value={claimWorkspaceId}
              onChange={(e) => setClaimWorkspaceId(e.target.value)}
              options={workspaces.map((w) => ({
                value: w.id,
                label: `${w.name} (${w.code})`,
              }))}
            />
          </FormField>

          <FormField label="Mã liên kết từ trường học" htmlFor="claim-school-code" required>
            <Input
              id="claim-school-code"
              value={claimCode}
              onChange={(e) => setClaimCode(e.target.value)}
              placeholder="Ví dụ: MIM-XXXX-XXXX-XXXX"
              className="font-mono"
              disabled={claiming}
            />
          </FormField>

          <FormField
            label="Tên đăng nhập trong gia đình (tùy chọn)"
            htmlFor="claim-family-username"
            hint="Nếu bỏ trống, hệ thống tự tạo tên nhận diện an toàn trong không gian gia đình."
          >
            <Input
              id="claim-family-username"
              value={claimFamilyUsername}
              onChange={(e) => setClaimFamilyUsername(e.target.value)}
              placeholder="Ví dụ: minh.an"
              disabled={claiming}
            />
          </FormField>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setClaimOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" loading={claiming}>
              Xác nhận liên kết
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Confirm Revoke Link Modal */}
      <Dialog
        open={Boolean(confirmRevokeLink)}
        onClose={() => setConfirmRevokeLink(null)}
        title="Xác nhận thu hồi liên kết giám hộ"
        description={
          confirmRevokeLink
            ? `Thu hồi liên kết của bạn với học sinh "${confirmRevokeLink.studentDisplayName}" trong không gian "${confirmRevokeLink.workspaceName}".`
            : undefined
        }
      >
        <div className="space-y-4">
          <Alert variant="info">
            <div className="flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
              <p className="leading-relaxed">
                Thao tác này chỉ gỡ liên kết của riêng tài khoản bạn. Tài khoản học sinh, tư cách thành viên trường học, liên kết của người đồng giám hộ khác và toàn bộ lịch sử học tập vẫn được giữ nguyên vẹn.
              </p>
            </div>
          </Alert>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirmRevokeLink(null)}>
              Giữ lại liên kết
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={revoking}
              onClick={() => void handleRevokeLink()}
            >
              Xác nhận thu hồi
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
