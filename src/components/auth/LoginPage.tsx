import {
  ArrowRight,
  BookOpenCheck,
  GraduationCap,
  HeartHandshake,
  Home,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiClientError, authApi } from '../../api/client.ts';
import { useAuth } from '../../auth/AuthContext.tsx';
import { getMessages, resolveLocalizedErrorMessage } from '../../i18n/index.ts';
import type { ApiErrorInfo, DemoPersona, MailDeliveryStatus } from '../../types/auth.ts';
import {
  MimoraBrandMark,
  WelcomeGardenIllustration,
} from '../illustrations/SelIllustrations.tsx';
import { Alert, Button, Card, FormField, Input, PasswordInput, Tabs } from '../ui/index.ts';

type LoginMode = 'student' | 'guardian' | 'admin_teacher';
type GuardianAuthView = 'login' | 'register' | 'verify';

export interface LoginPageProps {
  initialVerifyToken?: string | null;
  onConsumeInitialVerifyToken?: () => void;
}

export function LoginPage({
  initialVerifyToken,
  onConsumeInitialVerifyToken,
}: LoginPageProps) {
  const {
    login,
    loginDemoPersona,
    demoModeEnabled,
    authNotice,
    clearAuthNotice,
    locale,
    setLocale,
  } = useAuth();
  const t = getMessages(locale);

  const [mode, setMode] = useState<LoginMode>('student');
  const [guardianView, setGuardianView] = useState<GuardianAuthView>('login');

  // Shared / Login state
  const [identifier, setIdentifier] = useState('');
  const [guardianEmail, setGuardianEmail] = useState('');
  const [guardianDisplayName, setGuardianDisplayName] = useState('');
  const [organizationCode, setOrganizationCode] = useState('');
  const [orgUsername, setOrgUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [verifyToken, setVerifyToken] = useState('');

  const [fieldError, setFieldError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<ApiErrorInfo | null>(null);
  const [demoError, setDemoError] = useState<ApiErrorInfo | null>(null);
  const [infoNotice, setInfoNotice] = useState<string | null>(null);
  const [mailDeliveryStatus, setMailDeliveryStatus] = useState<MailDeliveryStatus | null>(null);
  const [fromVerifyLink, setFromVerifyLink] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pendingDemoPersona, setPendingDemoPersona] = useState<DemoPersona | null>(null);

  const isBusy = submitting || pendingDemoPersona !== null;

  useEffect(() => {
    if (!initialVerifyToken) {
      return;
    }
    setMode('guardian');
    setGuardianView('verify');
    setVerifyToken(initialVerifyToken);
    setFromVerifyLink(true);
    setMailDeliveryStatus(null);
    setFieldError(null);
    setApiError(null);
    setInfoNotice(null);
    clearAuthNotice();
    onConsumeInitialVerifyToken?.();
  }, [initialVerifyToken, onConsumeInitialVerifyToken, clearAuthNotice]);

  const handleModeChange = (nextMode: LoginMode) => {
    setMode(nextMode);
    setGuardianView('login');
    setFieldError(null);
    setApiError(null);
    setInfoNotice(null);
    setMailDeliveryStatus(null);
    setFromVerifyLink(false);
    clearAuthNotice();
  };

  const switchGuardianView = (nextView: GuardianAuthView) => {
    setGuardianView(nextView);
    setFieldError(null);
    setApiError(null);
    setInfoNotice(null);
    clearAuthNotice();
  };

  const handleDemoAccess = async (persona: DemoPersona) => {
    if (isBusy) {
      return;
    }
    setDemoError(null);
    setFieldError(null);
    setApiError(null);
    setInfoNotice(null);
    clearAuthNotice();
    setPendingDemoPersona(persona);
    try {
      await loginDemoPersona(persona);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setDemoError(err.info);
      } else {
        setDemoError({
          httpStatus: 0,
          code: 'UNKNOWN',
          messageKey: 'error.unknown',
          message: t.errors.UNKNOWN,
          locale,
        });
      }
    } finally {
      setPendingDemoPersona(null);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isBusy) {
      return;
    }
    setFieldError(null);
    setApiError(null);
    setDemoError(null);
    setInfoNotice(null);
    clearAuthNotice();

    if (mode === 'guardian' && guardianView === 'register') {
      if (
        !guardianDisplayName.trim() ||
        !guardianEmail.trim() ||
        !password ||
        !confirmPassword
      ) {
        setFieldError(t.auth.validationRequired);
        return;
      }
      if (password.length < 8) {
        setFieldError('Mật khẩu người giám hộ cần có ít nhất 8 ký tự.');
        return;
      }
      if (password !== confirmPassword) {
        setFieldError(t.auth.passwordMismatch);
        return;
      }

      setSubmitting(true);
      try {
        const res = await authApi.registerGuardian({
          displayName: guardianDisplayName.trim(),
          email: guardianEmail.trim(),
          password,
        });
        setPassword('');
        setConfirmPassword('');
        setMailDeliveryStatus(res.mailDelivery);
        setFromVerifyLink(false);
        setGuardianView('verify');
        setInfoNotice(
          `Đã tạo tài khoản cho ${res.user.email ?? guardianEmail.trim()}. Tài khoản đang ở trạng thái chờ xác minh email.`
        );
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
      return;
    }

    if (mode === 'guardian' && guardianView === 'verify') {
      if (!verifyToken.trim()) {
        setFieldError(t.auth.validationRequired);
        return;
      }

      setSubmitting(true);
      try {
        await authApi.verifyGuardianEmail({ token: verifyToken.trim() });
        setVerifyToken('');
        setMailDeliveryStatus(null);
        setFromVerifyLink(false);
        setGuardianView('login');
        setInfoNotice(t.auth.guardianVerifySuccess);
      } catch (err) {
        if (err instanceof ApiClientError && err.info.code === 'EMAIL_ALREADY_VERIFIED') {
          setVerifyToken('');
          setMailDeliveryStatus(null);
          setFromVerifyLink(false);
          setGuardianView('login');
          setInfoNotice(t.auth.guardianAlreadyVerifiedNotice);
        } else if (err instanceof ApiClientError) {
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
      return;
    }

    if (mode === 'admin_teacher') {
      if (!identifier.trim() || !password) {
        setFieldError(t.auth.validationRequired);
        return;
      }
    } else if (mode === 'guardian') {
      if (!guardianEmail.trim() || !password) {
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
      } else if (mode === 'guardian') {
        await login({
          mode: 'guardian',
          email: guardianEmail.trim(),
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
          {/* Warm Story/Product Welcome & Optional Demo Quick Access Column */}
          <section className="lg:col-span-6 flex flex-col justify-between rounded-[var(--mimora-radius-xl)] bg-[var(--mimora-surface-mint)] border border-[#c3dfd8] p-6 sm:p-8 space-y-5">
            <div className="space-y-3">
              <p className="text-xs font-semibold text-[var(--mimora-primary)] tracking-wide">
                {t.app.tagline}
              </p>
              <h1 className="text-3xl sm:text-4xl font-bold text-[var(--mimora-text)] tracking-tight leading-tight">
                {t.auth.pageTitle}
              </h1>
              <p className="text-sm sm:text-base text-[var(--mimora-muted)] leading-relaxed max-w-lg">
                {t.auth.pageSubtitle}
              </p>
            </div>

            {demoModeEnabled ? (
              <section
                aria-labelledby="mimora-demo-access-heading"
                className="rounded-[var(--mimora-radius-lg)] bg-[var(--mimora-surface)] border border-[#c3dfd8] p-4 sm:p-5 space-y-3.5 shadow-[var(--mimora-shadow-soft)]"
              >
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--mimora-primary)]">
                    {t.auth.demoBadgeLabel}
                  </p>
                  <h2
                    id="mimora-demo-access-heading"
                    className="text-lg sm:text-xl font-bold text-[var(--mimora-text)] tracking-tight"
                  >
                    {t.auth.demoTitle}
                  </h2>
                  <p className="text-xs sm:text-sm text-[var(--mimora-muted)] leading-relaxed">
                    {t.auth.demoSubtitle}
                  </p>
                </div>

                {demoError && (
                  <Alert
                    variant={
                      demoError.httpStatus === 429 || demoError.httpStatus === 503
                        ? 'warning'
                        : 'danger'
                    }
                  >
                    <p>{resolveLocalizedErrorMessage(demoError, locale)}</p>
                    {demoError.code && (
                      <p className="mt-1 font-mono text-xs text-[var(--mimora-muted)]">
                        {demoError.code}
                        {demoError.httpStatus > 0 ? ` · HTTP ${demoError.httpStatus}` : ''}
                      </p>
                    )}
                  </Alert>
                )}

                <div className="grid grid-cols-1 gap-2.5" role="group" aria-labelledby="mimora-demo-access-heading">
                  {(
                    [
                      {
                        persona: 'admin',
                        label: t.auth.demoRoles.admin.label,
                        description: t.auth.demoRoles.admin.description,
                        icon: ShieldCheck,
                        iconBoxClass: 'bg-[var(--mimora-surface-lavender)] text-[var(--mimora-secondary)]',
                      },
                      {
                        persona: 'teacher',
                        label: t.auth.demoRoles.teacher.label,
                        description: t.auth.demoRoles.teacher.description,
                        icon: BookOpenCheck,
                        iconBoxClass: 'bg-[var(--mimora-surface-mint)] text-[var(--mimora-primary)]',
                      },
                      {
                        persona: 'guardian',
                        label: t.auth.demoRoles.guardian.label,
                        description: t.auth.demoRoles.guardian.description,
                        icon: HeartHandshake,
                        iconBoxClass: 'bg-[var(--mimora-surface-peach)] text-[var(--mimora-accent)]',
                      },
                      {
                        persona: 'student_school',
                        label: t.auth.demoRoles.student_school.label,
                        description: t.auth.demoRoles.student_school.description,
                        icon: GraduationCap,
                        iconBoxClass: 'bg-[var(--mimora-surface-butter)] text-[#7d5108]',
                      },
                      {
                        persona: 'student_family',
                        label: t.auth.demoRoles.student_family.label,
                        description: t.auth.demoRoles.student_family.description,
                        icon: Home,
                        iconBoxClass: 'bg-[var(--mimora-surface-subtle)] text-[var(--mimora-text)]',
                      },
                    ] as const
                  ).map((item) => {
                    const Icon = item.icon;
                    const isLoadingThis = pendingDemoPersona === item.persona;
                    return (
                      <button
                        key={item.persona}
                        type="button"
                        data-testid={`demo-login-${item.persona}`}
                        disabled={isBusy}
                        aria-busy={isLoadingThis || undefined}
                        onClick={() => void handleDemoAccess(item.persona)}
                        className={[
                          'group w-full min-h-[54px] flex items-center justify-between gap-3 rounded-[var(--mimora-radius-md)] border px-3.5 py-2.5 text-left',
                          'transition-[background-color,border-color,transform] duration-150 ease-out cursor-pointer',
                          'disabled:opacity-55 disabled:cursor-not-allowed disabled:transform-none',
                          isLoadingThis
                            ? 'border-[var(--mimora-primary)] bg-[var(--mimora-surface-mint)]'
                            : 'border-[var(--mimora-border)] bg-[var(--mimora-surface)] hover:border-[var(--mimora-primary)] hover:bg-[var(--mimora-surface-mint)] active:translate-y-px',
                        ].join(' ')}
                      >
                        <span className="flex items-center gap-3 min-w-0">
                          <span
                            className={`h-9 w-9 rounded-[var(--mimora-radius-sm)] flex items-center justify-center shrink-0 ${item.iconBoxClass}`}
                            aria-hidden="true"
                          >
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-[var(--mimora-text)] leading-snug">
                              {item.label}
                            </span>
                            <span className="block text-xs text-[var(--mimora-muted)] leading-snug mt-0.5">
                              {item.description}
                            </span>
                          </span>
                        </span>
                        {isLoadingThis ? (
                          <Loader2
                            className="h-4 w-4 animate-spin text-[var(--mimora-primary)] shrink-0"
                            aria-hidden="true"
                          />
                        ) : (
                          <ArrowRight
                            className="h-4 w-4 text-[var(--mimora-muted)] group-hover:text-[var(--mimora-primary)] transition-transform duration-150 group-hover:translate-x-0.5 shrink-0"
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : (
              <div className="flex justify-center py-2">
                <WelcomeGardenIllustration />
              </div>
            )}

            <div className="pt-3 border-t border-[#c3dfd8] text-xs text-[var(--mimora-muted)] flex flex-wrap items-center gap-x-2 gap-y-1">
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
                      value: 'guardian',
                      label: t.auth.modeGuardian,
                      icon: <HeartHandshake className="h-4 w-4" aria-hidden="true" />,
                    },
                    {
                      value: 'admin_teacher',
                      label: t.auth.modeAdminTeacher,
                      icon: <ShieldCheck className="h-4 w-4" aria-hidden="true" />,
                    },
                  ]}
                />
              </div>

              {infoNotice && <Alert variant="success">{infoNotice}</Alert>}

              {activeError && (
                <Alert
                  variant={
                    activeError.httpStatus === 429 || activeError.httpStatus === 503
                      ? 'warning'
                      : 'danger'
                  }
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
                {mode === 'student' && (
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
                        disabled={isBusy}
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
                        disabled={isBusy}
                        hasError={Boolean(fieldError && !orgUsername.trim())}
                      />
                    </FormField>

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
                        disabled={isBusy}
                        hasError={Boolean(fieldError && !password)}
                      />
                    </FormField>

                    <div className="pt-2">
                      <Button
                        type="submit"
                        variant="primary"
                        size="student"
                        fullWidth
                        loading={submitting}
                        disabled={pendingDemoPersona !== null}
                      >
                        {submitting ? t.auth.submittingLogin : t.auth.submitLogin}
                      </Button>
                    </div>
                  </>
                )}

                {mode === 'guardian' && guardianView === 'login' && (
                  <>
                    <p className="text-xs text-[var(--mimora-muted)] bg-[var(--mimora-surface-subtle)] rounded-[var(--mimora-radius-md)] px-3.5 py-2.5 leading-relaxed">
                      {t.auth.guardianLoginHint}
                    </p>

                    <FormField label={t.auth.guardianEmailLabel} htmlFor="guardian-login-email" required>
                      <Input
                        id="guardian-login-email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        value={guardianEmail}
                        onChange={(e) => setGuardianEmail(e.target.value)}
                        placeholder={t.auth.guardianEmailPlaceholder}
                        disabled={isBusy}
                        hasError={Boolean(fieldError && !guardianEmail.trim())}
                      />
                    </FormField>

                    <FormField label={t.auth.passwordLabel} htmlFor="guardian-login-password" required>
                      <PasswordInput
                        id="guardian-login-password"
                        name="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={t.auth.passwordPlaceholder}
                        showLabel={t.auth.showPassword}
                        hideLabel={t.auth.hidePassword}
                        disabled={isBusy}
                        hasError={Boolean(fieldError && !password)}
                      />
                    </FormField>

                    <div className="pt-2 space-y-3">
                      <Button
                        type="submit"
                        variant="primary"
                        size="lg"
                        fullWidth
                        loading={submitting}
                        disabled={pendingDemoPersona !== null}
                      >
                        {submitting ? t.auth.submittingLogin : t.auth.submitLogin}
                      </Button>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                        <button
                          type="button"
                          onClick={() => switchGuardianView('register')}
                          className="font-medium text-[var(--mimora-primary)] hover:underline cursor-pointer"
                        >
                          {t.auth.guardianRegisterToggle}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMailDeliveryStatus(null);
                            setFromVerifyLink(false);
                            switchGuardianView('verify');
                          }}
                          className="text-[var(--mimora-muted)] hover:text-[var(--mimora-text)] hover:underline cursor-pointer"
                        >
                          Đã có liên kết / token xác minh email?
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {mode === 'guardian' && guardianView === 'register' && (
                  <>
                    <p className="text-xs text-[var(--mimora-muted)] bg-[var(--mimora-surface-subtle)] rounded-[var(--mimora-radius-md)] px-3.5 py-2.5 leading-relaxed">
                      Tạo tài khoản riêng dành cho Phụ huynh / Người giám hộ (tách biệt hoàn toàn với tài khoản học sinh). Không tự tạo tài khoản trường học hay giáo viên.
                    </p>

                    <FormField
                      label={t.auth.guardianDisplayNameLabel}
                      htmlFor="guardian-reg-name"
                      required
                    >
                      <Input
                        id="guardian-reg-name"
                        name="displayName"
                        autoComplete="name"
                        value={guardianDisplayName}
                        onChange={(e) => setGuardianDisplayName(e.target.value)}
                        placeholder={t.auth.guardianDisplayNamePlaceholder}
                        disabled={isBusy}
                      />
                    </FormField>

                    <FormField
                      label={t.auth.guardianEmailLabel}
                      htmlFor="guardian-reg-email"
                      required
                    >
                      <Input
                        id="guardian-reg-email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        value={guardianEmail}
                        onChange={(e) => setGuardianEmail(e.target.value)}
                        placeholder={t.auth.guardianEmailPlaceholder}
                        disabled={isBusy}
                      />
                    </FormField>

                    <FormField
                      label={t.auth.passwordLabel}
                      htmlFor="guardian-reg-password"
                      hint="Tối thiểu 8 ký tự."
                      required
                    >
                      <PasswordInput
                        id="guardian-reg-password"
                        name="newPassword"
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={t.auth.passwordPlaceholder}
                        showLabel={t.auth.showPassword}
                        hideLabel={t.auth.hidePassword}
                        disabled={isBusy}
                      />
                    </FormField>

                    <FormField
                      label={t.auth.confirmPasswordLabel}
                      htmlFor="guardian-reg-confirm"
                      required
                    >
                      <PasswordInput
                        id="guardian-reg-confirm"
                        name="confirmPassword"
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder={t.auth.confirmPasswordLabel}
                        showLabel={t.auth.showPassword}
                        hideLabel={t.auth.hidePassword}
                        disabled={isBusy}
                      />
                    </FormField>

                    <div className="pt-2 space-y-3">
                      <Button
                        type="submit"
                        variant="primary"
                        size="lg"
                        fullWidth
                        loading={submitting}
                        disabled={pendingDemoPersona !== null}
                      >
                        {submitting
                          ? t.auth.guardianRegisterSubmitting
                          : t.auth.guardianRegisterSubmit}
                      </Button>

                      <div className="flex justify-center text-xs">
                        <button
                          type="button"
                          onClick={() => switchGuardianView('login')}
                          className="font-medium text-[var(--mimora-primary)] hover:underline cursor-pointer"
                        >
                          {t.auth.guardianBackToLogin}
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {mode === 'guardian' && guardianView === 'verify' && (
                  <>
                    {fromVerifyLink ? (
                      <Alert variant="info" title={t.auth.guardianVerifyTitle}>
                        <p className="leading-relaxed">{t.auth.guardianVerifyLinkNotice}</p>
                      </Alert>
                    ) : mailDeliveryStatus ? (
                      <Alert
                        variant={
                          mailDeliveryStatus.configured && mailDeliveryStatus.delivered
                            ? 'success'
                            : 'warning'
                        }
                        title={t.auth.guardianVerifyTitle}
                      >
                        {!mailDeliveryStatus.configured ? (
                          <p className="leading-relaxed">{t.auth.mailStatusUnconfigured}</p>
                        ) : mailDeliveryStatus.delivered ? (
                          <div className="space-y-1.5">
                            <p className="leading-relaxed">{t.auth.mailStatusDelivered}</p>
                            <p className="text-xs text-[var(--mimora-muted)] leading-relaxed">
                              {t.auth.guardianVerifyNotice}
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            <p className="leading-relaxed">{t.auth.mailStatusFailed}</p>
                            <p className="text-xs text-[var(--mimora-muted)] leading-relaxed">
                              {t.auth.guardianVerifyResendLoginHint}
                            </p>
                          </div>
                        )}
                      </Alert>
                    ) : (
                      <Alert variant="info" title={t.auth.guardianVerifyTitle}>
                        <p className="leading-relaxed">{t.auth.guardianVerifyNotice}</p>
                      </Alert>
                    )}

                    <FormField
                      label={t.auth.guardianVerifyTokenLabel}
                      htmlFor="guardian-verify-token"
                      required
                    >
                      <Input
                        id="guardian-verify-token"
                        name="token"
                        value={verifyToken}
                        onChange={(e) => setVerifyToken(e.target.value)}
                        placeholder={t.auth.guardianVerifyTokenPlaceholder}
                        disabled={isBusy}
                        className="font-mono"
                      />
                    </FormField>

                    <div className="pt-2 space-y-3">
                      <Button
                        type="submit"
                        variant="primary"
                        size="lg"
                        fullWidth
                        loading={submitting}
                        disabled={pendingDemoPersona !== null}
                      >
                        {t.auth.guardianVerifySubmit}
                      </Button>

                      <div className="flex justify-center text-xs">
                        <button
                          type="button"
                          onClick={() => switchGuardianView('login')}
                          className="font-medium text-[var(--mimora-primary)] hover:underline cursor-pointer"
                        >
                          {t.auth.guardianBackToLogin}
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {mode === 'admin_teacher' && (
                  <>
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
                        disabled={isBusy}
                        hasError={Boolean(fieldError && !identifier.trim())}
                      />
                    </FormField>

                    <FormField label={t.auth.passwordLabel} htmlFor="login-password-admin" required>
                      <PasswordInput
                        id="login-password-admin"
                        name="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={t.auth.passwordPlaceholder}
                        showLabel={t.auth.showPassword}
                        hideLabel={t.auth.hidePassword}
                        disabled={isBusy}
                        hasError={Boolean(fieldError && !password)}
                      />
                    </FormField>

                    <div className="pt-2">
                      <Button
                        type="submit"
                        variant="primary"
                        size="lg"
                        fullWidth
                        loading={submitting}
                        disabled={pendingDemoPersona !== null}
                      >
                        {submitting ? t.auth.submittingLogin : t.auth.submitLogin}
                      </Button>
                    </div>
                  </>
                )}
              </form>
            </Card>
          </section>
        </div>
      </main>
    </div>
  );
}
