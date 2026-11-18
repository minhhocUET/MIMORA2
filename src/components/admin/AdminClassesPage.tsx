import { GraduationCap, Pencil, Plus, Search, Users } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { adminApi } from '../../api/admin.ts';
import { ApiClientError } from '../../api/client.ts';
import { resolveLocalizedErrorMessage, type AppLocale } from '../../i18n/index.ts';
import type {
  ClassStatus,
  ClassStudentRoster,
  ClassTeacherEntry,
  SafeClassView,
  SafeMembershipView,
  SafeOrganizationView,
} from '../../types/admin.ts';
import { formatDateTime, getClassStatusMeta } from '../../utils/p302.ts';
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

export interface AdminClassesPageProps {
  locale: AppLocale;
  onToast: (msg: string) => void;
}

export function AdminClassesPage({ locale, onToast }: AdminClassesPageProps) {
  const [orgs, setOrgs] = useState<SafeOrganizationView[]>([]);
  const [orgId, setOrgId] = useState('');
  const [classes, setClasses] = useState<SafeClassView[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | ClassStatus>('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Selected class detail
  const [detail, setDetail] = useState<{
    cls: SafeClassView;
    teachers: ClassTeacherEntry[];
    students: ClassStudentRoster[];
  } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Org active teacher & student memberships for assignment pickers
  const [orgTeachers, setOrgTeachers] = useState<SafeMembershipView[]>([]);
  const [orgStudents, setOrgStudents] = useState<SafeMembershipView[]>([]);

  // Create / Edit Class modal
  const [classFormOpen, setClassFormOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<SafeClassView | null>(null);
  const [classNameInput, setClassNameInput] = useState('');
  const [academicYearInput, setAcademicYearInput] = useState('');
  const [classStatusInput, setClassStatusInput] = useState<ClassStatus>('active');
  const [savingClass, setSavingClass] = useState(false);
  const [classFormErr, setClassFormErr] = useState<string | null>(null);

  // Teacher Assignment modal
  const [teachersModalOpen, setTeachersModalOpen] = useState(false);
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<string[]>([]);
  const [savingTeachers, setSavingTeachers] = useState(false);

  // Student Enrollment modal
  const [studentsModalOpen, setStudentsModalOpen] = useState(false);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [removedStatus, setRemovedStatus] = useState<'transferred_out' | 'archived'>('transferred_out');
  const [savingStudents, setSavingStudents] = useState(false);

  useEffect(() => {
    let active = true;
    adminApi
      .listOrganizations({ page: 1, limit: 100 })
      .then((res) => {
        if (!active) return;
        setOrgs(res.items);
        if (res.items.length > 0) {
          setOrgId(res.items[0].id);
        }
      })
      .catch((err) => {
        if (!active) return;
        setErrorMsg(
          err instanceof ApiClientError
            ? resolveLocalizedErrorMessage(err.info, locale)
            : 'Không thể tải danh sách trường học.'
        );
      });
    return () => {
      active = false;
    };
  }, [locale]);

  const loadClasses = useCallback(async () => {
    if (!orgId) {
      setClasses([]);
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await adminApi.listOrganizationClasses(orgId, {
        page,
        limit: 20,
        status: statusFilter || undefined,
        search: search.trim() || undefined,
      });
      setClasses(res.items);
      setTotal(res.total);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrorMsg(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setErrorMsg('Không thể tải danh sách lớp học.');
      }
    } finally {
      setLoading(false);
    }
  }, [orgId, page, statusFilter, search, locale]);

  useEffect(() => {
    setDetail(null);
    void loadClasses();
  }, [loadClasses]);

  const loadOrgRosterCandidates = useCallback(async () => {
    if (!orgId) return;
    try {
      const [tRes, sRes] = await Promise.all([
        adminApi.listOrganizationMemberships(orgId, { page: 1, limit: 100, role: 'teacher', status: 'active' }),
        adminApi.listOrganizationMemberships(orgId, { page: 1, limit: 100, role: 'student', status: 'active' }),
      ]);
      setOrgTeachers(tRes.items);
      setOrgStudents(sRes.items);
    } catch {
      // Ignore silent preload error; surfaced when opening picker if needed
    }
  }, [orgId]);

  useEffect(() => {
    void loadOrgRosterCandidates();
  }, [loadOrgRosterCandidates]);

  const loadClassDetail = async (classId: string) => {
    if (!orgId) return;
    setLoadingDetail(true);
    setErrorMsg(null);
    try {
      const res = await adminApi.getClassDetail(orgId, classId);
      setDetail({
        cls: res.class,
        teachers: res.teachers,
        students: res.students,
      });
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrorMsg(resolveLocalizedErrorMessage(err.info, locale));
      }
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleSaveClass = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId || !classNameInput.trim()) {
      setClassFormErr('Vui lòng nhập tên lớp.');
      return;
    }
    setSavingClass(true);
    setClassFormErr(null);
    try {
      if (editingClass) {
        const res = await adminApi.updateClass(orgId, editingClass.id, {
          name: classNameInput.trim(),
          academicYear: academicYearInput.trim() ? academicYearInput.trim() : null,
          status: classStatusInput,
        });
        onToast(`Đã cập nhật lớp ${res.class.name}.`);
        if (detail?.cls.id === res.class.id) {
          await loadClassDetail(res.class.id);
        }
      } else {
        const res = await adminApi.createClass(orgId, {
          name: classNameInput.trim(),
          academicYear: academicYearInput.trim() ? academicYearInput.trim() : null,
        });
        onToast(`Đã tạo lớp ${res.class.name}.`);
        await loadClassDetail(res.class.id);
      }
      setClassFormOpen(false);
      await loadClasses();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setClassFormErr(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setClassFormErr('Không thể lưu lớp học.');
      }
    } finally {
      setSavingClass(false);
    }
  };

  const handleSaveTeachers = async () => {
    if (!orgId || !detail) return;
    setSavingTeachers(true);
    setErrorMsg(null);
    try {
      const res = await adminApi.setClassTeachers(orgId, detail.cls.id, selectedTeacherIds);
      setDetail((prev) => (prev ? { ...prev, teachers: res.teachers } : prev));
      setTeachersModalOpen(false);
      onToast(`Đã cập nhật danh sách giáo viên cho lớp ${detail.cls.name}.`);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrorMsg(resolveLocalizedErrorMessage(err.info, locale));
      }
    } finally {
      setSavingTeachers(false);
    }
  };

  const handleSaveStudents = async () => {
    if (!orgId || !detail) return;
    setSavingStudents(true);
    setErrorMsg(null);
    try {
      const res = await adminApi.updateClassStudents(orgId, detail.cls.id, {
        mode: 'set',
        studentMembershipIds: selectedStudentIds,
        removedStatus,
      });
      setDetail((prev) => (prev ? { ...prev, students: res.students } : prev));
      setStudentsModalOpen(false);
      onToast(`Đã cập nhật danh sách học sinh lớp ${detail.cls.name}.`);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrorMsg(resolveLocalizedErrorMessage(err.info, locale));
      }
    } finally {
      setSavingStudents(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        metadataLine="Cổng Quản trị · P2-03"
        title="Lớp học & Phân công Danh sách"
        description="Quản lý lớp học theo trường, phân công giáo viên phụ trách và ghi danh học sinh đang hoạt động."
        action={
          <Button
            variant="primary"
            disabled={!orgId}
            leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
            onClick={() => {
              setEditingClass(null);
              setClassNameInput('');
              setAcademicYearInput('2026-2027');
              setClassStatusInput('active');
              setClassFormErr(null);
              setClassFormOpen(true);
            }}
          >
            Tạo lớp mới
          </Button>
        }
      />

      <Card padding="sm">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <FormField label="Trường học" htmlFor="cls-org-select">
            <Select
              id="cls-org-select"
              value={orgId}
              onChange={(e) => {
                setOrgId(e.target.value);
                setPage(1);
              }}
              options={orgs.map((o) => ({ value: o.id, label: `${o.name} (${o.code})` }))}
            />
          </FormField>

          <FormField label="Tìm tên lớp" htmlFor="cls-search">
            <Input
              id="cls-search"
              leftAdornment={<Search className="h-4 w-4" aria-hidden="true" />}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Ví dụ: Lớp 1A"
            />
          </FormField>

          <FormField label="Trạng thái lớp" htmlFor="cls-status-filter">
            <Select
              id="cls-status-filter"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as '' | ClassStatus);
                setPage(1);
              }}
              options={[
                { value: '', label: 'Tất cả trạng thái' },
                { value: 'active', label: 'Đang hoạt động' },
                { value: 'archived', label: 'Đã lưu trữ' },
              ]}
            />
          </FormField>
        </div>
      </Card>

      {errorMsg && <Alert variant="danger">{errorMsg}</Alert>}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        <Card className="lg:col-span-2" padding="md">
          <CardHeader title={`Danh sách lớp (${total})`} />
          <CardContent>
            {loading ? (
              <LoadingState label="Đang tải lớp học..." />
            ) : classes.length === 0 ? (
              <EmptyState
                title="Chưa có lớp học nào"
                description="Tạo lớp học mới để phân công giáo viên và ghi danh học sinh."
              />
            ) : (
              <div className="space-y-2">
                {classes.map((c) => {
                  const st = getClassStatusMeta(c.status, locale);
                  const active = detail?.cls.id === c.id;
                  return (
                    <div
                      key={c.id}
                      className={[
                        'rounded-[var(--mimora-radius-md)] border p-3.5 flex items-center justify-between gap-3',
                        active
                          ? 'bg-[var(--mimora-surface-mint)]/60 border-[#9ecbc1]'
                          : 'bg-[var(--mimora-surface)] border-[var(--mimora-border)]',
                      ].join(' ')}
                    >
                      <button
                        type="button"
                        onClick={() => void loadClassDetail(c.id)}
                        className="text-left min-w-0 flex-1 cursor-pointer"
                      >
                        <p className="font-semibold text-sm text-[var(--mimora-text)] truncate">{c.name}</p>
                        <p className="text-xs text-[var(--mimora-muted)]">
                          Niên khóa: {c.academicYear ?? 'Chưa ghi'}
                        </p>
                      </button>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant={st.variant}>{st.label}</Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Sửa lớp ${c.name}`}
                          onClick={() => {
                            setEditingClass(c);
                            setClassNameInput(c.name);
                            setAcademicYearInput(c.academicYear ?? '');
                            setClassStatusInput(c.status);
                            setClassFormErr(null);
                            setClassFormOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3" padding="md">
          <CardHeader
            title={detail ? `Lớp ${detail.cls.name}` : 'Chi tiết lớp học'}
            description={
              detail
                ? `Niên khóa: ${detail.cls.academicYear ?? '—'} · Tạo lúc ${formatDateTime(detail.cls.createdAt, locale)}`
                : 'Chọn một lớp học bên trái để xem và điều chỉnh giáo viên / học sinh.'
            }
          />
          <CardContent>
            {loadingDetail ? (
              <LoadingState label="Đang tải chi tiết lớp..." />
            ) : !detail ? (
              <EmptyState
                title="Chưa chọn lớp học"
                description="Nhấp vào một lớp học ở cột bên trái để xem danh sách giáo viên phụ trách và học sinh đang ghi danh."
              />
            ) : (
              <div className="space-y-6">
                <Alert variant="info" title="Phạm vi dữ liệu ghi danh">
                  Endpoint chi tiết lớp hiện chỉ trả về danh sách học sinh đang ghi danh hoạt động (chưa trả về lịch sử học sinh đã chuyển lớp/lưu trữ trước đây).
                </Alert>

                {/* Teachers section */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <GraduationCap className="h-4 w-4 text-[var(--mimora-primary)]" aria-hidden="true" />
                      Giáo viên phụ trách ({detail.teachers.length})
                    </h3>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setSelectedTeacherIds(detail.teachers.map((t) => t.teacherMembershipId));
                        setTeachersModalOpen(true);
                      }}
                    >
                      Phân công giáo viên
                    </Button>
                  </div>

                  {detail.teachers.length === 0 ? (
                    <p className="text-xs text-[var(--mimora-muted)]">Chưa có giáo viên nào được gán vào lớp này.</p>
                  ) : (
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {detail.teachers.map((t) => (
                        <li
                          key={t.id}
                          className="rounded-[var(--mimora-radius-sm)] border border-[var(--mimora-border)] px-3 py-2 text-xs"
                        >
                          <p className="font-semibold text-[var(--mimora-text)]">{t.displayName}</p>
                          <p className="font-mono text-[var(--mimora-muted)]">
                            {t.email ?? t.platformUsername ?? t.teacherMembershipId}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Active Students section */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <Users className="h-4 w-4 text-[var(--mimora-primary)]" aria-hidden="true" />
                      Học sinh đang ghi danh ({detail.students.length})
                    </h3>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setSelectedStudentIds(detail.students.map((s) => s.studentMembershipId));
                        setStudentsModalOpen(true);
                      }}
                    >
                      Cập nhật danh sách học sinh
                    </Button>
                  </div>

                  {detail.students.length === 0 ? (
                    <p className="text-xs text-[var(--mimora-muted)]">Chưa có học sinh nào trong lớp này.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)]">
                      <table className="w-full text-left text-sm border-collapse">
                        <thead className="bg-[var(--mimora-surface-subtle)] text-xs text-[var(--mimora-muted)]">
                          <tr>
                            <th className="py-2 px-3 font-medium">Họ tên học sinh</th>
                            <th className="py-2 px-3 font-medium">org_username</th>
                            <th className="py-2 px-3 font-medium">Ngày ghi danh</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--mimora-border)]">
                          {detail.students.map((s) => (
                            <tr key={s.enrollmentId}>
                              <td className="py-2 px-3 font-medium">{s.displayName}</td>
                              <td className="py-2 px-3 font-mono text-xs">{s.orgUsername ?? '—'}</td>
                              <td className="py-2 px-3 text-xs text-[var(--mimora-muted)]">
                                {formatDateTime(s.enrolledAt, locale)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create / Edit Class Modal */}
      <Dialog
        open={classFormOpen}
        onClose={() => setClassFormOpen(false)}
        title={editingClass ? `Sửa lớp: ${editingClass.name}` : 'Tạo lớp học mới'}
      >
        <form onSubmit={(e) => void handleSaveClass(e)} className="space-y-4">
          {classFormErr && <Alert variant="danger">{classFormErr}</Alert>}

          <FormField label="Tên lớp" htmlFor="cls-form-name" required>
            <Input
              id="cls-form-name"
              value={classNameInput}
              onChange={(e) => setClassNameInput(e.target.value)}
              placeholder="Ví dụ: Lớp 1A - Hòa Nhập"
              required
            />
          </FormField>

          <FormField label="Niên khóa" htmlFor="cls-form-year">
            <Input
              id="cls-form-year"
              value={academicYearInput}
              onChange={(e) => setAcademicYearInput(e.target.value)}
              placeholder="2026-2027"
            />
          </FormField>

          {editingClass && (
            <FormField label="Trạng thái lớp" htmlFor="cls-form-status">
              <Select
                id="cls-form-status"
                value={classStatusInput}
                onChange={(e) => setClassStatusInput(e.target.value as ClassStatus)}
                options={[
                  { value: 'active', label: 'Đang hoạt động (active)' },
                  { value: 'archived', label: 'Đã lưu trữ (archived)' },
                ]}
              />
            </FormField>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setClassFormOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" loading={savingClass}>
              {editingClass ? 'Lưu thay đổi' : 'Tạo lớp học'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Assign Teachers Modal */}
      <Dialog
        open={teachersModalOpen}
        onClose={() => setTeachersModalOpen(false)}
        title={`Phân công giáo viên · ${detail?.cls.name ?? ''}`}
        description="Chọn tất cả giáo viên đang hoạt động trong trường được phép quản lý lớp này."
        footer={
          <>
            <Button variant="outline" onClick={() => setTeachersModalOpen(false)}>
              Hủy
            </Button>
            <Button variant="primary" loading={savingTeachers} onClick={() => void handleSaveTeachers()}>
              Lưu phân công ({selectedTeacherIds.length})
            </Button>
          </>
        }
      >
        {orgTeachers.length === 0 ? (
          <p className="text-sm text-[var(--mimora-muted)]">
            Trường này chưa có tài khoản giáo viên đang hoạt động.
          </p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {orgTeachers.map((t) => {
              const checked = selectedTeacherIds.includes(t.id);
              return (
                <label
                  key={t.id}
                  className="flex items-center gap-3 rounded-[var(--mimora-radius-sm)] border border-[var(--mimora-border)] px-3 py-2.5 text-sm cursor-pointer hover:bg-[var(--mimora-surface-subtle)]"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      setSelectedTeacherIds((prev) =>
                        e.target.checked ? [...prev, t.id] : prev.filter((id) => id !== t.id)
                      )
                    }
                    className="h-4 w-4 accent-[var(--mimora-primary)]"
                  />
                  <div className="min-w-0">
                    <p className="font-medium">{t.user?.displayName ?? t.userId}</p>
                    <p className="text-xs font-mono text-[var(--mimora-muted)]">
                      {t.user?.email ?? t.user?.platformUsername ?? t.id}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </Dialog>

      {/* Update Student Roster Modal */}
      <Dialog
        open={studentsModalOpen}
        onClose={() => setStudentsModalOpen(false)}
        title={`Cập nhật danh sách học sinh · ${detail?.cls.name ?? ''}`}
        description="Chọn danh sách học sinh đang ghi danh vào lớp. Các học sinh bỏ chọn sẽ được chuyển sang trạng thái rút khỏi lớp đã chọn."
        footer={
          <>
            <Button variant="outline" onClick={() => setStudentsModalOpen(false)}>
              Hủy
            </Button>
            <Button variant="primary" loading={savingStudents} onClick={() => void handleSaveStudents()}>
              Lưu danh sách ({selectedStudentIds.length})
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label="Trạng thái áp dụng cho học sinh bị gỡ khỏi lớp" htmlFor="removed-stu-status">
            <Select
              id="removed-stu-status"
              value={removedStatus}
              onChange={(e) => setRemovedStatus(e.target.value as 'transferred_out' | 'archived')}
              options={[
                { value: 'transferred_out', label: 'Chuyển lớp (transferred_out)' },
                { value: 'archived', label: 'Lưu trữ (archived)' },
              ]}
            />
          </FormField>

          {orgStudents.length === 0 ? (
            <p className="text-sm text-[var(--mimora-muted)]">
              Trường này chưa có tài khoản học sinh đang hoạt động.
            </p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {orgStudents.map((s) => {
                const checked = selectedStudentIds.includes(s.id);
                return (
                  <label
                    key={s.id}
                    className="flex items-center gap-3 rounded-[var(--mimora-radius-sm)] border border-[var(--mimora-border)] px-3 py-2.5 text-sm cursor-pointer hover:bg-[var(--mimora-surface-subtle)]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setSelectedStudentIds((prev) =>
                          e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)
                        )
                      }
                      className="h-4 w-4 accent-[var(--mimora-primary)]"
                    />
                    <div className="min-w-0">
                      <p className="font-medium">{s.user?.displayName ?? s.userId}</p>
                      <p className="text-xs font-mono text-[var(--mimora-muted)]">
                        @{s.orgUsername ?? '—'}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </Dialog>
    </div>
  );
}
