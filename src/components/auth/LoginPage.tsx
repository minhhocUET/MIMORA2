import { GraduationCap, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiClientError } from '../../api/client.ts';
import { useAuth } from '../../auth/AuthContext.tsx';
import { getMessages, resolveLocalizedErrorMessage } from '../../i18n/index.ts';
import type { ApiErrorInfo } from '../../types/auth.ts';
import {
  MimoraBrandMark,
  WelcomeGardenIllustration,
} from '../illustrations/SelIllustrations.tsx';
import { Alert, Button, Card, FormField, Input, PasswordInput, Tabs } from '../ui/index.ts';

type LoginMode = 'admin_teacher' | 'student';

export function LoginPage() {
  const { login, authNotice, clearAuthNotice, locale, setLocale } = useAuth();
  const t = getMessages(locale);

  const [mode, setMode] = useState<LoginMode>('student');
  const [identifier, setIdentifier] = useState('');
  const [organizationCode, setOrganizationCode] = useState('');
  const [orgUsername, setOrgUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<ApiErrorInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleModeChange = (nextMode: LoginMode) => {
    setMode(nextMode);
    setFieldError(null);
    setApiError(null);
    clearAuthNotice();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFieldError(null);
    setApiError(null);
    clearAuthNotice();

    if (mode === 'admin_teacher') {
      if (!identifier.trim() || !password) {
        setFieldError(t.auth.validationRequired);
        return;
      }
    } else {
      if (!organizationCode.trim() || !orgUsername.trim() || !password) {
        setFieldError(t.auth.validationRequired);
        return;
      }
    }

    setSubmitting(true);
    try {
      if (mode === 'admin_teacher') {
        await login({
          mode: 'admin_teacher',
          identifier: identifier.trim(),
          password,
        });
      } else {
        await login({
          mode: 'student',
          organizationCode: organizationCode.trim(),
          orgUsername: orgUsername.trim(),
          password,
        });
      }
      setPassword('');
    } catch (err) {
      if (err instanceof ApiClientError) {
        setApiError(err.info);
      } else {
        setApiError({
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

  const activeError = apiError ?? authNotice;

  return (
    <div className="min-h-screen flex flex-col bg-[var(--mimora-bg)] text-[var(--mimora-text)]">
      {/* Top Bar */}
      <header className="border-b border-[var(--mimora-border)] bg-[var(--mimora-surface)]">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <MimoraBrandMark />
            <span className="text-lg font-bold tracking-tight whitespace-nowrap shrink-0">
              {t.app.brand}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="mimora-login-locale" className="sr-only">
              {t.app.languageLabel}
            </label>
            <select
              id="mimora-login-locale"
              value={locale}
              onChange={(e) => setLocale(e.target.value as 'vi-VN' | 'en')}
              className="min-h-[38px] rounded-[var(--mimora-radius-sm)] border border-[var(--mimora-border-strong)] bg-[var(--mimora-surface)] px-3 py-1 text-xs font-medium text-[var(--mimora-text)] cursor-pointer"
            >
              <option value="vi-VN">{t.app.viLabel}</option>
              <option value="en">{t.app.enLabel}</option>
            </select>
          </div>
        </div>
      </header>

      {/* Main Split Workspace */}
      <main className="flex-1 max-w-[1200px] w-full mx-auto px-4 sm:px-6 py-8 sm:py-12 flex items-center">
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
          {/* Warm Story/Product Welcome Column */}
          <section className="lg:col-span-6 flex flex-col justify-between rounded-[var(--mimora-radius-xl)] bg-[var(--mimora-surface-mint)] border border-[#c3dfd8] p-6 sm:p-10 space-y-6">
            <div className="space-y-4">
              <p className="text-xs font-semibold text-[var(--mimora-primary)] tracking-wide">
                {t.app.tagline}
              </p>
              <h1 className="text-3xl sm:text-4xl font-bold text-[var(--mimora-text)] tracking-tight leading-tight">
                {t.auth.pageTitle}
              </h1>
              <p className="text-base text-[var(--mimora-muted)] leading-relaxed max-w-md">
                {t.auth.pageSubtitle}
              </p>
            </div>

            <div className="flex justify-center py-2">
              <WelcomeGardenIllustration />
            </div>

            <div className="pt-4 border-t border-[#c3dfd8] text-xs text-[var(--mimora-muted)] flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{t.student.calmStatusLabel}</span>
            </div>
          </section>

          {/* Real Backend Authentication Card */}
          <section className="lg:col-span-6 flex flex-col justify-center">
            <Card tone="default" elevated padding="lg" className="space-y-6">
              <div className="space-y-3">
                <Tabs<LoginMode>
                  ariaLabel="Chọn chế độ đăng nhập"
                  value={mode}
                  onChange={handleModeChange}
                  fullWidth
                  options={[
                    {
                      value: 'student',
                      label: t.auth.modeStudent,
                      icon: <GraduationCap className="h-4 w-4" aria-hidden="true" />,
                    },
                    {
                      value: 'admin_teacher',
                      label: t.auth.modeAdminTeacher,
                      icon: <ShieldCheck className="h-4 w-4" aria-hidden="true" />,
                    },
                  ]}
                />
              </div>

              {activeError && (
                <Alert
                  variant={activeError.httpStatus === 429 || activeError.httpStatus === 503 ? 'warning' : 'danger'}
                >
                  <p>{resolveLocalizedErrorMessage(activeError, locale)}</p>
                  {activeError.code && (
                    <p className="mt-1 font-mono text-xs text-[var(--mimora-muted)]">
                      {activeError.code}
                      {activeError.httpStatus > 0 ? ` · HTTP ${activeError.httpStatus}` : ''}
                    </p>
                  )}
                </Alert>
              )}

              {fieldError && <Alert variant="danger">{fieldError}</Alert>}

              <form onSubmit={handleSubmit} noValidate className="space-y-4">
                {mode === 'student' ? (
                  <>
                    <p className="text-xs text-[var(--mimora-muted)] bg-[var(--mimora-surface-subtle)] rounded-[var(--mimora-radius-md)] px-3.5 py-2.5 leading-relaxed">
                      {t.auth.studentNoEmailHint}
                    </p>
                    <FormField label={t.auth.orgCodeLabel} htmlFor="login-org-code" required>
                      <Input
                        id="login-org-code"
                        name="organizationCode"
                        autoComplete="organization"
                        value={organizationCode}
                        onChange={(e) => setOrganizationCode(e.target.value)}
                        placeholder={t.auth.orgCodePlaceholder}
                        disabled={submitting}
                        hasError={Boolean(fieldError && !organizationCode.trim())}
                      />
                    </FormField>

                    <FormField
                      label={t.auth.orgUsernameLabel}
                      htmlFor="login-org-username"
                      required
                    >
                      <Input
                        id="login-org-username"
                        name="orgUsername"
                        autoComplete="username"
                        value={orgUsername}
                        onChange={(e) => setOrgUsername(e.target.value)}
                        placeholder={t.auth.orgUsernamePlaceholder}
                        disabled={submitting}
                        hasError={Boolean(fieldError && !orgUsername.trim())}
                      />
                    </FormField>
                  </>
                ) : (
                  <FormField
                    label={t.auth.identifierLabel}
                    htmlFor="login-identifier"
                    required
                  >
                    <Input
                      id="login-identifier"
                      name="identifier"
                      autoComplete="username"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder={t.auth.identifierPlaceholder}
                      disabled={submitting}
                      hasError={Boolean(fieldError && !identifier.trim())}
                    />
                  </FormField>
                )}

                <FormField label={t.auth.passwordLabel} htmlFor="login-password" required>
                  <PasswordInput
                    id="login-password"
                    name="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t.auth.passwordPlaceholder}
                    showLabel={t.auth.showPassword}
                    hideLabel={t.auth.hidePassword}
                    disabled={submitting}
                    hasError={Boolean(fieldError && !password)}
                  />
                </FormField>

                <div className="pt-2">
                  <Button
                    type="submit"
                    variant="primary"
                    size={mode === 'student' ? 'student' : 'lg'}
                    fullWidth
                    loading={submitting}
                  >
                    {submitting ? t.auth.submittingLogin : t.auth.submitLogin}
                  </Button>
                </div>
              </form>
            </Card>
          </section>
        </div>
      </main>
    </div>
  );
}
