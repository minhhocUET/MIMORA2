import { MailCheck, RefreshCw } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiClientError, authApi } from '../../api/client.ts';
import { useAuth } from '../../auth/AuthContext.tsx';
import { getMessages, resolveLocalizedErrorMessage } from '../../i18n/index.ts';
import { Alert, Button, Card, CardContent, CardHeader, FormField, Input } from '../ui/index.ts';

export interface GuardianVerificationCardProps {
  onToast: (msg: string) => void;
}

export function GuardianVerificationCard({ onToast }: GuardianVerificationCardProps) {
  const { context, refreshMe, locale } = useAuth();
  const t = getMessages(locale);

  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resendInfo, setResendInfo] = useState<string | null>(null);

  const handleVerify = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!token.trim()) {
      setErrorMsg('Vui lòng nhập mã xác minh email.');
      return;
    }

    setSubmitting(true);
    try {
      await authApi.verifyGuardianEmail({ token: token.trim() });
      setToken('');
      await refreshMe();
      onToast(t.auth.guardianVerifySuccess);
    } catch (err) {
      if (err instanceof ApiClientError) {
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
    setResendInfo(null);
    setResending(true);
    try {
      const res = await authApi.resendGuardianVerification();
      if (res.alreadyVerified) {
        await refreshMe();
        onToast('Email của bạn đã được xác minh.');
        return;
      }
      setResendInfo(
        'Đã tạo yêu cầu mã xác minh mới (trạng thái: pending_verification). Máy chủ hiện chưa cấu hình dịch vụ gửi email tự động.'
      );
    } catch (err) {
      if (err instanceof ApiClientError) {
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
        <Alert variant="warning" title="Trạng thái: Chờ xác minh email (pending_verification)">
          <p className="leading-relaxed">{t.auth.guardianVerifyNotice}</p>
          {context?.user.email && (
            <p className="mt-1 font-mono text-xs text-[var(--mimora-muted)]">
              Email tài khoản: {context.user.email}
            </p>
          )}
        </Alert>

        {resendInfo && <Alert variant="info">{resendInfo}</Alert>}
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
              Yêu cầu cấp lại mã xác minh
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
