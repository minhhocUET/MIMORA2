import { KeyRound, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext.tsx';
import { getMessages } from '../../i18n/index.ts';
import { Alert, Badge, Button, Card, CardContent, CardHeader, PageHeader } from '../ui/index.ts';

export interface GuardianSettingsPageProps {
  onOpenChangePassword: () => void;
}

export function GuardianSettingsPage({ onOpenChangePassword }: GuardianSettingsPageProps) {
  const { context, locale } = useAuth();
  const t = getMessages(locale);

  if (!context) {
    return null;
  }

  const emailVerified = Boolean(context.user.emailVerified);

  return (
    <div className="space-y-6">
      <PageHeader
        metadataLine="Cài đặt tài khoản người giám hộ"
        title={t.guardian.navSettings}
        description="Quản lý thông tin xác minh email, bảo mật đăng nhập và nguyên tắc quyền riêng tư cho trẻ em."
      />

      <Card padding="md" className="max-w-2xl">
        <CardHeader
          title="Thông tin tài khoản người giám hộ"
          action={
            <Badge variant={emailVerified ? 'success' : 'warning'}>
              {emailVerified ? 'Đã xác minh email' : 'Chờ xác minh email'}
            </Badge>
          }
        />
        <CardContent className="space-y-4 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-[var(--mimora-muted)]">Họ tên hiển thị</p>
              <p className="font-medium text-[var(--mimora-text)]">{context.user.displayName}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--mimora-muted)]">Vai trò</p>
              <p className="font-medium text-[var(--mimora-text)]">{t.roles.guardian}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--mimora-muted)]">Email liên hệ</p>
              <p className="font-mono text-xs text-[var(--mimora-text)]">
                {context.user.email ?? '—'}
              </p>
            </div>
          </div>

          <div className="pt-2 border-t border-[var(--mimora-border)] flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={onOpenChangePassword}
              leftIcon={<KeyRound className="h-4 w-4" aria-hidden="true" />}
            >
              {t.auth.changePassword}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Alert variant="info" title="Chính sách bảo vệ dữ liệu học sinh">
        <div className="flex items-start gap-2">
          <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="leading-relaxed">{t.guardian.privacyNote}</p>
        </div>
      </Alert>
    </div>
  );
}
