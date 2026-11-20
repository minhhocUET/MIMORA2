import { MailCheck, RefreshCw } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiClientError, authApi } from '../../api/client.ts';
import { useAuth } from '../../auth/AuthContext.tsx';
import { getMessages, resolveLocalizedErrorMessage } from '../../i18n/index.ts';
import type { MailDeliveryStatus } from '../../types/auth.ts';
import { Alert, Button, Card, CardContent, CardHeader, FormField, Input } from '../ui/index.ts';

export interface GuardianVerificationCardProps {
  onToast: (msg: string) => void;
  initialToken?: string | null;
  onConsumeInitialToken?: () => void;
}

export function GuardianVerificationCard({
  onToast,
  initialToken,
  onConsumeInitialToken,
}: GuardianVerificationCardProps) {
  const { context, refreshMe, locale } = useAuth();
  const t = getMessages(locale);

  const [token, setToken] = useState('');
  const [fromVerifyLink, setFromVerifyLink] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [alreadyVerifiedMsg, setAlreadyVerifiedMsg] = useState<string | null>(null);
  const [resendStatus, setResendStatus] = useState<MailDeliveryStatus | null>(null);

  useEffect(() => {
    if (!initialToken) {
      return;
    }
    setToken(initialToken);
    setFromVerifyLink(true);
    setErrorMsg(null);
    onConsumeInitialToken?.();
  }, [initialToken, onConsumeInitialToken]);

  const handleAlreadyVerified = async () => {
    setErrorMsg(null);
    setResendStatus(null);
    setAlreadyVerifiedMsg(t.auth.guardianAlreadyVerifiedNotice);
    await refreshMe();
    onToast(t.auth.guardianAlreadyVerifiedNotice);
  };

  const handleVerify = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setAlreadyVerifiedMsg(null);
    if (!token.trim()) {
      setErrorMsg(t.auth.validationRequired);
      return;
    }

    setSubmitting(true);
    try {
      await authApi.verifyGuardianEmail({ token: token.trim() });
      setToken('');
      setFromVerifyLink(false);
      await refreshMe();
      onToast(t.auth.guardianVerifySuccess);
    } catch (err) {
      if (err instanceof ApiClientError && err.info.code === 'EMAIL_ALREADY_VERIFIED') {
        await handleAlreadyVerified();
      } else if (err instanceof ApiClientError) {
        setErrorMsg(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setErrorMsg(t.errors.UNKNOWN);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    setErrorMsg(null);
    setAlreadyVerifiedMsg(null);
    setResendStatus(null);
    setResending(true);
    try {
      const res = await authApi.resendGuardianVerification();
      if (res.alreadyVerified) {
        await handleAlreadyVerified();
        return;
      }
      setResendStatus(res.mailDelivery);
    } catch (err) {
      if (err instanceof ApiClientError && err.info.code === 'EMAIL_ALREADY_VERIFIED') {
        await handleAlreadyVerified();
      } else if (err instanceof ApiClientError) {
        setErrorMsg(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setErrorMsg(t.errors.UNKNOWN);
      }
    } finally {
      setResending(false);
    }
  };

  return (
    <Card tone="subtle" padding="lg" className="max-w-2xl">
      <CardHeader
        title={t.guardian.verificationPendingTitle}
        description={t.guardian.verificationPendingBody}
      />
      <CardContent className="space-y-4">
        <Alert
          variant={fromVerifyLink ? 'info' : 'warning'}
          title={t.auth.guardianVerifyTitle}
        >
          <p className="leading-relaxed">
            {fromVerifyLink ? t.auth.guardianVerifyLinkNotice : t.auth.guardianVerifyNotice}
          </p>
          {context?.user.email && (
            <p className="mt-1 font-mono text-xs text-[var(--mimora-muted)]">
              Email tài khoản: {context.user.email}
            </p>
          )}
        </Alert>

        {alreadyVerifiedMsg && <Alert variant="success">{alreadyVerifiedMsg}</Alert>}

        {resendStatus && (
          <Alert
            variant={
              resendStatus.configured && resendStatus.delivered ? 'success' : 'warning'
            }
          >
            {!resendStatus.configured
              ? t.auth.mailStatusUnconfigured
              : resendStatus.delivered
                ? t.auth.mailStatusDelivered
                : t.auth.mailStatusFailed}
          </Alert>
        )}

        {errorMsg && <Alert variant="danger">{errorMsg}</Alert>}

        <form onSubmit={(e) => void handleVerify(e)} className="space-y-4">
          <FormField label={t.auth.guardianVerifyTokenLabel} htmlFor="portal-verify-token" required>
            <Input
              id="portal-verify-token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={t.auth.guardianVerifyTokenPlaceholder}
              className="font-mono"
              disabled={submitting}
            />
          </FormField>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              variant="primary"
              loading={submitting}
              leftIcon={<MailCheck className="h-4 w-4" aria-hidden="true" />}
            >
              {t.auth.guardianVerifySubmit}
            </Button>

            <Button
              type="button"
              variant="outline"
              loading={resending}
              onClick={() => void handleResend()}
              leftIcon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
            >
              {t.auth.guardianVerifyResendSubmit}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
