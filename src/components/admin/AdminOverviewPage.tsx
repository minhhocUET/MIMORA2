import { ArrowRight, BarChart3, BookOpenCheck, Building2, FileSpreadsheet, GraduationCap, HeartHandshake, ShieldAlert, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { adminApi } from '../../api/admin.ts';
import { ApiClientError } from '../../api/client.ts';
import { resolveLocalizedErrorMessage, type AppLocale } from '../../i18n/index.ts';
import type { SafeUserView } from '../../types/auth.ts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  LoadingState,
  PageHeader,
} from '../ui/index.ts';

export type AdminSection =
  | 'overview'
  | 'organizations'
  | 'accounts'
  | 'classes'
  | 'csv_import'
  | 'content'
  | 'family_programs'
  | 'approval_queue'
  | 'insights';

export interface AdminOverviewPageProps {
  user: SafeUserView;
  locale: AppLocale;
  onNavigate: (section: AdminSection) => void;
}

interface RealPlatformCounts {
  organizationsTotal: number;
  activeOrganizationsTotal: number;
  usersTotal: number;
  contentItemsTotal: number;
}

export function AdminOverviewPage({ user, locale, onNavigate }: AdminOverviewPageProps) {
  const [counts, setCounts] = useState<RealPlatformCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const [orgsAll, orgsActive, usersAll, contentAll] = await Promise.all([
          adminApi.listOrganizations({ page: 1, limit: 1 }),
          adminApi.listOrganizations({ page: 1, limit: 1, status: 'active' }),
          adminApi.listUsers({ page: 1, limit: 1 }),
          adminApi.listContentItems({ page: 1, limit: 1 }),
        ]);
        if (!active) return;
        setCounts({
          organizationsTotal: orgsAll.total,
          activeOrganizationsTotal: orgsActive.total,
          usersTotal: usersAll.total,
          contentItemsTotal: contentAll.total,
        });
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiClientError) {
          setErrorMsg(resolveLocalizedErrorMessage(err.info, locale));
        } else {
          setErrorMsg('Không thể tải tổng quan hệ thống.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [locale]);

  return (
    <div className="space-y-6">
      <PageHeader
        metadataLine={`Quản trị hệ thống · ${user.platformUsername ?? user.email ?? user.id}`}
        title="Không gian điều hành nền tảng MIMORA"
        description="Số liệu tổng quan dưới đây được đọc trực tiếp từ API quản trị thực tế, không sử dụng dữ liệu mô phỏng."
      />

      <Alert variant="info" title="Ranh giới quyền riêng tư và vai trò">
        Tài khoản Quản trị hệ thống quản lý trường học, tài khoản giáo viên/học sinh, lớp học và quy trình xuất bản học liệu SEL. Quản trị viên không xem ghi chú quan sát riêng tư của giáo viên và chỉ xem thống kê tổng hợp đáp ứng ngưỡng tối thiểu k = 5.
      </Alert>

      {errorMsg && <Alert variant="danger">{errorMsg}</Alert>}

      {loading ? (
        <LoadingState label="Đang tải tổng quan thực tế từ máy chủ..." />
      ) : (
        counts && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card padding="md">
              <p className="text-xs font-medium text-[var(--mimora-muted)]">Tổ chức / Trường học</p>
              <p className="text-3xl font-semibold text-[var(--mimora-text)] mt-1 tabular-nums">
                {counts.organizationsTotal}
              </p>
              <p className="text-xs text-[var(--mimora-muted)] mt-1 tabular-nums">
                Đang hoạt động: {counts.activeOrganizationsTotal}
              </p>
            </Card>
            <Card padding="md">
              <p className="text-xs font-medium text-[var(--mimora-muted)]">Tài khoản trên nền tảng</p>
              <p className="text-3xl font-semibold text-[var(--mimora-text)] mt-1 tabular-nums">
                {counts.usersTotal}
              </p>
              <p className="text-xs text-[var(--mimora-muted)] mt-1">
                Chỉ gồm 3 vai trò: Quản trị, Giáo viên, Học sinh
              </p>
            </Card>
            <Card padding="md">
              <p className="text-xs font-medium text-[var(--mimora-muted)]">Học liệu trong thư viện SEL</p>
              <p className="text-3xl font-semibold text-[var(--mimora-text)] mt-1 tabular-nums">
                {counts.contentItemsTotal}
              </p>
              <p className="text-xs text-[var(--mimora-muted)] mt-1">
                5 loại thẻ chuẩn hóa có quản lý phiên bản
              </p>
            </Card>
          </div>
        )
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card padding="md">
          <CardHeader
            title="Tổ chức & Trường học"
            description="Tạo trường mới, cập nhật mã trường, tên trường hoặc tạm ngưng hoạt động."
          />
          <CardContent>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Building2 className="h-4 w-4" aria-hidden="true" />}
              rightIcon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
              onClick={() => onNavigate('organizations')}
            >
              Quản lý tổ chức
            </Button>
          </CardContent>
        </Card>

        <Card padding="md">
          <CardHeader
            title="Tài khoản & Thành viên"
            description="Cấp tài khoản giáo viên/học sinh, khóa/mở khóa và quản lý thành viên theo trường."
          />
          <CardContent>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Users className="h-4 w-4" aria-hidden="true" />}
              rightIcon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
              onClick={() => onNavigate('accounts')}
            >
              Quản lý tài khoản
            </Button>
          </CardContent>
        </Card>

        <Card padding="md">
          <CardHeader
            title="Lớp học & Danh sách"
            description="Tạo lớp, phân công giáo viên phụ trách và ghi danh học sinh vào lớp."
          />
          <CardContent>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<GraduationCap className="h-4 w-4" aria-hidden="true" />}
              rightIcon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
              onClick={() => onNavigate('classes')}
            >
              Quản lý lớp học
            </Button>
          </CardContent>
        </Card>

        <Card padding="md">
          <CardHeader
            title="Nhập học sinh CSV"
            description="Kiểm tra trước (Preview) từng dòng CSV và xác nhận tạo tài khoản hàng loạt."
          />
          <CardContent>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<FileSpreadsheet className="h-4 w-4" aria-hidden="true" />}
              rightIcon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
              onClick={() => onNavigate('csv_import')}
            >
              Mở công cụ CSV
            </Button>
          </CardContent>
        </Card>

        <Card padding="md">
          <CardHeader
            title="Thư viện & Phê duyệt SEL"
            description="Biên soạn 5 loại thẻ SEL, quản lý phiên bản bất biến và duyệt xuất bản."
          />
          <CardContent className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<BookOpenCheck className="h-4 w-4" aria-hidden="true" />}
              onClick={() => onNavigate('content')}
            >
              Thư viện SEL
            </Button>
            <Button
              variant="outline"
              size="sm"
              leftIcon={<ShieldAlert className="h-4 w-4" aria-hidden="true" />}
              onClick={() => onNavigate('approval_queue')}
            >
              Hàng đợi duyệt
            </Button>
          </CardContent>
        </Card>

        <Card padding="md">
          <CardHeader
            title="Chương trình Gia đình"
            description="Thiết kế chương trình SEL không cần giáo viên và kích hoạt an toàn cho Không gian Gia đình."
          />
          <CardContent>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<HeartHandshake className="h-4 w-4" aria-hidden="true" />}
              rightIcon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
              onClick={() => onNavigate('family_programs')}
            >
              Quản lý chương trình gia đình
            </Button>
          </CardContent>
        </Card>

        <Card padding="md">
          <CardHeader
            title="Thống kê Tổng hợp (k=5)"
            description="Xem tần suất tham gia và hỗ trợ tiếp cận ẩn danh theo ngày, tuần hoặc tháng."
          />
          <CardContent>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<BarChart3 className="h-4 w-4" aria-hidden="true" />}
              rightIcon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
              onClick={() => onNavigate('insights')}
            >
              Xem thống kê k=5
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
