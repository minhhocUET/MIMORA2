import { FileSpreadsheet, Search, UserPlus, Users } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiClientError } from '../../api/client.ts';
import { teacherApi } from '../../api/teacher.ts';
import { resolveLocalizedErrorMessage, type AppLocale } from '../../i18n/index.ts';
import type { ClassStatus, ClassStudentRoster, SafeClassView } from '../../types/admin.ts';
import { formatDateTime, getClassStatusMeta } from '../../utils/p302.ts';
import { CsvImportPanel } from '../shared/CsvImportPanel.tsx';
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

export interface TeacherClassesPageProps {
  locale: AppLocale;
  onToast: (msg: string) => void;
  onOpenStudentDetail: (studentMembershipId: string) => void;
}

export function TeacherClassesPage({
  locale,
  onToast,
  onOpenStudentDetail,
}: TeacherClassesPageProps) {
  const [classes, setClasses] = useState<SafeClassView[]>([]);
  const [statusFilter, setStatusFilter] = useState<'' | ClassStatus>('active');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [selectedClass, setSelectedClass] = useState<SafeClassView | null>(null);
  const [students, setStudents] = useState<ClassStudentRoster[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [detailTab, setDetailTab] = useState<'roster' | 'csv'>('roster');

  // Create Student Modal
  const [createOpen, setCreateOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [orgUsername, setOrgUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [savingStudent, setSavingStudent] = useState(false);
  const [studentErr, setStudentErr] = useState<string | null>(null);

  const loadClasses = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await teacherApi.listMyClasses({
        page: 1,
        limit: 100,
        status: statusFilter || undefined,
      });
      setClasses(res.items);
      if (res.items.length > 0) {
        setSelectedClass((prev) =>
          prev && res.items.some((c) => c.id === prev.id) ? prev : res.items[0]
        );
      } else {
        setSelectedClass(null);
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrorMsg(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setErrorMsg('Không thể tải danh sách lớp được phân công.');
      }
    } finally {
      setLoading(false);
    }
  }, [statusFilter, locale]);

  useEffect(() => {
    void loadClasses();
  }, [loadClasses]);

  const loadRoster = useCallback(async () => {
    if (!selectedClass) {
      setStudents([]);
      return;
    }
    setLoadingRoster(true);
    try {
      const res = await teacherApi.getClassStudents(selectedClass.id);
      setStudents(res.students);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrorMsg(resolveLocalizedErrorMessage(err.info, locale));
      }
      setStudents([]);
    } finally {
      setLoadingRoster(false);
    }
  }, [selectedClass, locale]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  const filteredClasses = classes.filter((c) =>
    search.trim()
      ? c.name.toLowerCase().includes(search.trim().toLowerCase()) ||
        (c.academicYear ?? '').toLowerCase().includes(search.trim().toLowerCase())
      : true
  );

  const handleCreateStudent = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedClass) return;
    if (!displayName.trim() || !orgUsername.trim() || !password) {
      setStudentErr('Vui lòng nhập họ tên, orgUsername và mật khẩu khởi tạo.');
      return;
    }
    setSavingStudent(true);
    setStudentErr(null);
    try {
      const res = await teacherApi.createClassStudent(selectedClass.id, {
        displayName: displayName.trim(),
        orgUsername: orgUsername.trim().toLowerCase(),
        password,
        email: email.trim() ? email.trim() : null,
      });
      setCreateOpen(false);
      setDisplayName('');
      setOrgUsername('');
      setEmail('');
      setPassword('');
      onToast(`Đã tạo và ghi danh học sinh ${res.user.displayName} vào lớp ${selectedClass.name}.`);
      await loadRoster();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setStudentErr(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setStudentErr('Không thể tạo tài khoản học sinh.');
      }
    } finally {
      setSavingStudent(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        metadataLine="Cổng Giáo viên · P2-03"
        title="Lớp học được phân công & Nhập học sinh CSV"
        description="Xem danh sách học sinh trong các lớp thầy/cô phụ trách, tạo tài khoản học sinh trực tiếp hoặc nhập hàng loạt bằng CSV."
      />

      <Card padding="sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField
            label="Tìm nhanh lớp được phân công"
            htmlFor="teacher-cls-search"
            hint="Lọc trên danh sách lớp đã tải của trường hiện tại."
          >
            <Input
              id="teacher-cls-search"
              leftAdornment={<Search className="h-4 w-4" aria-hidden="true" />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tên lớp hoặc niên khóa..."
            />
          </FormField>

          <FormField label="Trạng thái lớp" htmlFor="teacher-cls-status">
            <Select
              id="teacher-cls-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as '' | ClassStatus)}
              options={[
                { value: 'active', label: 'Đang hoạt động' },
                { value: 'archived', label: 'Đã lưu trữ' },
                { value: '', label: 'Tất cả trạng thái' },
              ]}
            />
          </FormField>
        </div>
      </Card>

      {errorMsg && <Alert variant="danger">{errorMsg}</Alert>}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        <Card className="lg:col-span-2" padding="md">
          <CardHeader title={`Lớp của tôi (${filteredClasses.length})`} />
          <CardContent>
            {loading ? (
              <LoadingState label="Đang tải lớp học..." />
            ) : filteredClasses.length === 0 ? (
              <EmptyState
                title="Không có lớp nào phù hợp"
                description="Thử xóa từ khóa lọc hoặc kiểm tra xem bạn đã được phân công lớp ở trường này chưa."
              />
            ) : (
              <div className="space-y-2">
                {filteredClasses.map((c) => {
                  const st = getClassStatusMeta(c.status, locale);
                  const active = selectedClass?.id === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedClass(c)}
                      className={[
                        'w-full text-left rounded-[var(--mimora-radius-md)] border p-3.5 flex items-center justify-between gap-2 cursor-pointer transition-colors',
                        active
                          ? 'bg-[var(--mimora-surface-mint)]/60 border-[#9ecbc1]'
                          : 'bg-[var(--mimora-surface)] border-[var(--mimora-border)] hover:bg-[var(--mimora-surface-subtle)]/50',
                      ].join(' ')}
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{c.name}</p>
                        <p className="text-xs text-[var(--mimora-muted)]">
                          Niên khóa: {c.academicYear ?? '—'}
                        </p>
                      </div>
                      <Badge variant={st.variant}>{st.label}</Badge>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-3 space-y-4">
          {!selectedClass ? (
            <Card padding="md">
              <EmptyState
                title="Chưa chọn lớp học"
                description="Chọn một lớp học bên trái để xem danh sách học sinh hoặc nhập CSV vào lớp."
              />
            </Card>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Tabs
                  ariaLabel="Tác vụ lớp học"
                  value={detailTab}
                  onChange={setDetailTab}
                  options={[
                    { value: 'roster', label: 'Danh sách học sinh', icon: <Users className="h-4 w-4" aria-hidden="true" /> },
                    { value: 'csv', label: 'Nhập CSV vào lớp', icon: <FileSpreadsheet className="h-4 w-4" aria-hidden="true" /> },
                  ]}
                />

                <Button
                  variant="primary"
                  size="sm"
                  disabled={selectedClass.status !== 'active'}
                  leftIcon={<UserPlus className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => {
                    setStudentErr(null);
                    setCreateOpen(true);
                  }}
                >
                  Thêm học sinh vào lớp
                </Button>
              </div>

              {detailTab === 'roster' && (
                <Card padding="md">
                  <CardHeader
                    title={`Danh sách học sinh · ${selectedClass.name} (${students.length})`}
                    description="Nhấn vào học sinh để mở hồ sơ hỗ trợ tiếp cận, mục tiêu SEL và ghi chú quan sát riêng tư."
                  />
                  <CardContent>
                    {loadingRoster ? (
                      <LoadingState label="Đang tải danh sách học sinh..." />
                    ) : students.length === 0 ? (
                      <EmptyState
                        title="Lớp chưa có học sinh"
                        description="Bạn có thể thêm từng học sinh mới hoặc dùng tab Nhập CSV vào lớp."
                      />
                    ) : (
                      <div className="overflow-x-auto rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)]">
                        <table className="w-full text-left text-sm border-collapse">
                          <thead className="bg-[var(--mimora-surface-subtle)] text-xs text-[var(--mimora-muted)]">
                            <tr>
                              <th className="py-2.5 px-3 font-medium">Họ tên học sinh</th>
                              <th className="py-2.5 px-3 font-medium">org_username</th>
                              <th className="py-2.5 px-3 font-medium">Ngày ghi danh</th>
                              <th className="py-2.5 px-3 font-medium text-right">Hồ sơ</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--mimora-border)]">
                            {students.map((st) => (
                              <tr key={st.enrollmentId}>
                                <td className="py-2.5 px-3 font-medium">{st.displayName}</td>
                                <td className="py-2.5 px-3 font-mono text-xs">{st.orgUsername ?? '—'}</td>
                                <td className="py-2.5 px-3 text-xs text-[var(--mimora-muted)]">
                                  {formatDateTime(st.enrolledAt, locale)}
                                </td>
                                <td className="py-2.5 px-3 text-right">
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => onOpenStudentDetail(st.studentMembershipId)}
                                  >
                                    Mở hồ sơ & Hỗ trợ
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {detailTab === 'csv' && (
                <CsvImportPanel
                  locale={locale}
                  title={`Nhập học sinh CSV vào lớp ${selectedClass.name}`}
                  description="Tài khoản học sinh tạo thành công sẽ tự động được ghi danh vào lớp này."
                  selectedClassId={selectedClass.id}
                  onExecuteImport={({ mode, sourceFilename, csvContent }) =>
                    teacherApi.runClassCsvImport(selectedClass.id, {
                      mode,
                      sourceFilename,
                      csvContent,
                    })
                  }
                  onCommitted={loadRoster}
                  onToast={onToast}
                />
              )}
            </>
          )}
        </div>
      </div>

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={`Tạo & ghi danh học sinh vào lớp ${selectedClass?.name ?? ''}`}
        description="Học sinh không cần email cá nhân. Tài khoản đăng nhập bằng Mã trường, org_username và mật khẩu khởi tạo."
      >
        <form onSubmit={(e) => void handleCreateStudent(e)} className="space-y-4">
          {studentErr && <Alert variant="danger">{studentErr}</Alert>}

          <FormField label="Họ và tên học sinh" htmlFor="cls-stu-name" required>
            <Input
              id="cls-stu-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Nguyễn Minh An"
              required
            />
          </FormField>

          <FormField
            label="Tên tài khoản trong trường (org_username)"
            htmlFor="cls-stu-uname"
            required
            hint="2-64 ký tự chữ thường/số/._-, không có dấu @"
          >
            <Input
              id="cls-stu-uname"
              value={orgUsername}
              onChange={(e) => setOrgUsername(e.target.value.toLowerCase())}
              placeholder="minh.an"
              required
            />
          </FormField>

          <FormField label="Email phụ huynh/liên hệ (tùy chọn)" htmlFor="cls-stu-email">
            <Input
              id="cls-stu-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Để trống nếu không cần"
            />
          </FormField>

          <FormField label="Mật khẩu khởi tạo" htmlFor="cls-stu-pwd" required>
            <PasswordInput
              id="cls-stu-pwd"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Nhập mật khẩu khởi tạo"
              required
            />
          </FormField>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" loading={savingStudent}>
              Tạo & Ghi danh
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
