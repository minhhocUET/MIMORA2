import { ArrowRight, BookOpen, ClipboardList, GraduationCap, HeartHandshake, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiClientError } from '../../api/client.ts';
import { teacherApi } from '../../api/teacher.ts';
import { resolveLocalizedErrorMessage, type AppLocale } from '../../i18n/index.ts';
import type { SafeClassView } from '../../types/admin.ts';
import type { SafeOrganizationChoice } from '../../types/auth.ts';
import type { SafeTeacherAssignmentListItemView } from '../../types/teacher.ts';
import { getAssignmentStatusMeta, getClassStatusMeta } from '../../utils/p302.ts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  LoadingState,
  PageHeader,
} from '../ui/index.ts';

export type TeacherSection =
  | 'overview'
  | 'classes'
  | 'students'
  | 'library'
  | 'assignments';

export interface TeacherOverviewPageProps {
  activeOrg: SafeOrganizationChoice | null;
  locale: AppLocale;
  onNavigate: (section: TeacherSection) => void;
}

export function TeacherOverviewPage({
  activeOrg,
  locale,
  onNavigate,
}: TeacherOverviewPageProps) {
  const [classes, setClasses] = useState<SafeClassView[]>([]);
  const [classesTotal, setClassesTotal] = useState(0);
  const [assignments, setAssignments] = useState<SafeTeacherAssignmentListItemView[]>([]);
  const [assignmentsTotal, setAssignmentsTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const [clsRes, asgRes] = await Promise.all([
          teacherApi.listMyClasses({ page: 1, limit: 5, status: 'active' }),
          teacherApi.listAssignments({ page: 1, limit: 5 }),
        ]);
        if (!active) return;
        setClasses(clsRes.items);
        setClassesTotal(clsRes.total);
        setAssignments(asgRes.items);
        setAssignmentsTotal(asgRes.total);
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiClientError) {
          setErrorMsg(resolveLocalizedErrorMessage(err.info, locale));
        } else {
          setErrorMsg('Không thể tải tổng quan lớp học.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [activeOrg?.organizationId, locale]);

  return (
    <div className="space-y-6">
      <PageHeader
        metadataLine={`${activeOrg ? `${activeOrg.name} (${activeOrg.code})` : ''} · Giáo viên`}
        title="Không gian giảng dạy MIMORA"
        description="Dữ liệu lớp học được phân công, bài tập thực hành SEL và hồ sơ hỗ trợ học sinh được tải trực tiếp cho trường đang chọn."
      />

      <Alert variant="info" title="Nguyên tắc bảo vệ quyền riêng tư quan sát giáo viên">
        Mọi ghi chú quan sát giáo viên trong mục Hồ sơ học sinh đều là riêng tư tuyệt đối theo tác giả viết ghi chú — đồng giáo viên cùng lớp, quản trị viên và học sinh đều không thể xem.
      </Alert>

      {errorMsg && <Alert variant="danger">{errorMsg}</Alert>}

      {loading ? (
        <LoadingState label="Đang tải lớp học và bài tập của bạn..." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <Card padding="md">
            <CardHeader
              title={`Lớp học được phân công (${classesTotal})`}
              description="Chỉ hiển thị các lớp thầy/cô được phân công tại trường hiện tại."
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  rightIcon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => onNavigate('classes')}
                >
                  Mở lớp & Nhập CSV
                </Button>
              }
            />
            <CardContent>
              {classes.length === 0 ? (
                <EmptyState
                  title="Chưa có lớp học nào được phân công"
                  description="Hãy liên hệ Quản trị hệ thống để được phân công vào lớp học trong trường này."
                />
              ) : (
                <ul className="space-y-2.5">
                  {classes.map((c) => {
                    const st = getClassStatusMeta(c.status, locale);
                    return (
                      <li
                        key={c.id}
                        className="rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)] px-3.5 py-2.5 flex items-center justify-between gap-2"
                      >
                        <div>
                          <p className="font-semibold text-sm">{c.name}</p>
                          <p className="text-xs text-[var(--mimora-muted)]">
                            Niên khóa: {c.academicYear ?? 'Chưa ghi'}
                          </p>
                        </div>
                        <Badge variant={st.variant}>{st.label}</Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card padding="md">
            <CardHeader
              title={`Bài tập đã tạo / đồng phụ trách (${assignmentsTotal})`}
              description="Theo dõi tiến độ thực hành nhẹ nhàng và hướng dẫn tại nhà."
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  rightIcon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => onNavigate('assignments')}
                >
                  Quản lý bài tập
                </Button>
              }
            />
            <CardContent>
              {assignments.length === 0 ? (
                <EmptyState
                  title="Chưa có bài tập nào"
                  description="Chọn học liệu SEL đã xuất bản để tạo bài tập gắn chặt phiên bản cho học sinh lớp bạn."
                  action={
                    <Button variant="primary" size="sm" onClick={() => onNavigate('assignments')}>
                      Tạo bài tập đầu tiên
                    </Button>
                  }
                />
              ) : (
                <ul className="space-y-2.5">
                  {assignments.map((a) => {
                    const st = getAssignmentStatusMeta(a.status, locale);
                    return (
                      <li
                        key={a.id}
                        className="rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)] px-3.5 py-2.5 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate">{a.title}</p>
                          <p className="text-xs text-[var(--mimora-muted)]">
                            {a.className} · {a.itemCount} hoạt động · {a.targetCount} học sinh
                          </p>
                        </div>
                        <Badge variant={st.variant}>{st.label}</Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Button
          variant="outline"
          fullWidth
          leftIcon={<GraduationCap className="h-4 w-4" aria-hidden="true" />}
          onClick={() => onNavigate('classes')}
        >
          Danh sách lớp & Nhập CSV
        </Button>
        <Button
          variant="outline"
          fullWidth
          leftIcon={<Users className="h-4 w-4" aria-hidden="true" />}
          onClick={() => onNavigate('students')}
        >
          Hồ sơ hỗ trợ & Mục tiêu
        </Button>
        <Button
          variant="outline"
          fullWidth
          leftIcon={<BookOpen className="h-4 w-4" aria-hidden="true" />}
          onClick={() => onNavigate('library')}
        >
          Thư viện SEL đã xuất bản
        </Button>
        <Button
          variant="outline"
          fullWidth
          leftIcon={<HeartHandshake className="h-4 w-4" aria-hidden="true" />}
          onClick={() => onNavigate('assignments')}
        >
          Giao bài & Hướng dẫn tại nhà
        </Button>
      </div>
    </div>
  );
}
