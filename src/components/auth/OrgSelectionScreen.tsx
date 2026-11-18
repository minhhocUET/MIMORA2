import { Building2, LogOut } from 'lucide-react';
import { useState } from 'react';
import { ApiClientError } from '../../api/client.ts';
import { useAuth } from '../../auth/AuthContext.tsx';
import { getMessages, resolveLocalizedErrorMessage } from '../../i18n/index.ts';
import type { ApiErrorInfo } from '../../types/auth.ts';
import { MimoraBrandMark } from '../illustrations/SelIllustrations.tsx';
import { Alert, Button, Card } from '../ui/index.ts';

export function OrgSelectionScreen() {
  const { context, switchOrganization, logout, locale } = useAuth();
  const t = getMessages(locale);

  const [selectedOrgId, setSelectedOrgId] = useState<string>(
    context?.organizations[0]?.organizationId ?? ''
  );
  const [submitting, setSubmitting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);

  const orgList = context?.organizations ?? [];
  const effectiveOrgId = orgList.some((o) => o.organizationId === selectedOrgId)
    ? selectedOrgId
    : (orgList[0]?.organizationId ?? '');

  if (!context) {
    return null;
  }

  const handleConfirm = async () => {
    if (!effectiveOrgId) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await switchOrganization(effectiveOrgId);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.info);
      } else {
        setError({
          httpStatus: 0,
          code: 'UNKNOWN',
          messageKey: 'error.unknown',
          message: t.errors.UNKNOWN,
          locale,
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--mimora-bg)] text-[var(--mimora-text)] flex flex-col">
      <header className="border-b border-[var(--mimora-border)] bg-[var(--mimora-surface)]">
        <div className="max-w-[960px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <MimoraBrandMark />
            <span className="text-lg font-bold tracking-tight whitespace-nowrap shrink-0">
              {t.app.brand}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            loading={loggingOut}
            leftIcon={<LogOut className="h-4 w-4" aria-hidden="true" />}
            onClick={() => void handleLogout()}
          >
            {loggingOut ? t.auth.loggingOut : t.auth.logout}
          </Button>
        </div>
      </header>

      <main className="flex-1 max-w-[680px] w-full mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <Card tone="default" elevated padding="lg" className="space-y-6">
          <div className="space-y-2">
            <p className="text-xs font-medium text-[var(--mimora-primary)]">
              {context.user.displayName} · {t.roles.teacher}
            </p>
            <h1 className="text-2xl font-bold text-[var(--mimora-text)]">
              {t.auth.orgSelectionTitle}
            </h1>
            <p className="text-sm text-[var(--mimora-muted)] leading-relaxed">
              {t.auth.orgSelectionSubtitle}
            </p>
          </div>

          {error && (
            <Alert variant="danger">{resolveLocalizedErrorMessage(error, locale)}</Alert>
          )}

          {context.organizations.length === 0 ? (
            <Alert variant="warning">
              Không tìm thấy trường học khả dụng cho tài khoản này. Vui lòng liên hệ quản trị hệ thống.
            </Alert>
          ) : (
            <fieldset className="space-y-2.5">
              <legend className="sr-only">{t.auth.orgSelectionTitle}</legend>
              {context.organizations.map((org) => {
                const checked = org.organizationId === effectiveOrgId;
                return (
                  <label
                    key={org.organizationId}
                    className={[
                      'flex items-center gap-3.5 rounded-[var(--mimora-radius-md)] border p-4 cursor-pointer transition-colors duration-150',
                      checked
                        ? 'border-[var(--mimora-primary)] bg-[var(--mimora-surface-mint)]'
                        : 'border-[var(--mimora-border)] bg-[var(--mimora-surface)] hover:bg-[var(--mimora-surface-subtle)]',
                    ].join(' ')}
                  >
                    <input
                      type="radio"
                      name="organizationId"
                      value={org.organizationId}
                      checked={checked}
                      onChange={() => setSelectedOrgId(org.organizationId)}
                      className="h-4 w-4 accent-[var(--mimora-primary)]"
                    />
                    <Building2
                      className="h-5 w-5 text-[var(--mimora-primary)] shrink-0"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[var(--mimora-text)] truncate">
                        {org.name}
                      </p>
                      <p className="text-xs font-mono text-[var(--mimora-muted)]">
                        {org.code} · {t.roles[org.role]}
                      </p>
                    </div>
                  </label>
                );
              })}
            </fieldset>
          )}

          <div className="pt-2">
            <Button
              variant="primary"
              size="lg"
              fullWidth
              disabled={!effectiveOrgId || context.organizations.length === 0}
              loading={submitting}
              onClick={() => void handleConfirm()}
            >
              {submitting ? t.auth.orgSwitching : t.auth.orgSelectionConfirm}
            </Button>
          </div>
        </Card>
      </main>
    </div>
  );
}
