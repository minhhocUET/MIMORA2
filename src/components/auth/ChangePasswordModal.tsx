import { useState, type FormEvent } from 'react';
import { ApiClientError } from '../../api/client.ts';
import { useAuth } from '../../auth/AuthContext.tsx';
import { getMessages, resolveLocalizedErrorMessage } from '../../i18n/index.ts';
import type { ApiErrorInfo } from '../../types/auth.ts';
import { Alert, Button, Dialog, FormField, PasswordInput } from '../ui/index.ts';

export function ChangePasswordModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const { changePassword, locale } = useAuth();
  const t = getMessages(locale);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<ApiErrorInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const resetAndClose = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setValidationError(null);
    setApiError(null);
    onClose();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setValidationError(null);
    setApiError(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setValidationError(t.auth.validationRequired);
      return;
    }
    if (newPassword !== confirmPassword) {
      setValidationError(t.auth.passwordMismatch);
      return;
    }

    setSubmitting(true);
    try {
      await changePassword({ currentPassword, newPassword });
      resetAndClose();
      onSuccess(t.auth.passwordChangedSuccess);
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

  return (
    <Dialog
      open={open}
      onClose={resetAndClose}
      title={t.auth.changePassword}
      description="Cập nhật mật khẩu mới sẽ tự động xoay vòng mã phiên làm việc an toàn."
    >
      <form id="mimora-change-password-form" onSubmit={handleSubmit} className="space-y-4">
        {apiError && (
          <Alert variant="danger">{resolveLocalizedErrorMessage(apiError, locale)}</Alert>
        )}
        {validationError && <Alert variant="danger">{validationError}</Alert>}

        <FormField
          label={t.auth.currentPasswordLabel}
          htmlFor="cp-current-password"
          required
        >
          <PasswordInput
            id="cp-current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            disabled={submitting}
            showLabel={t.auth.showPassword}
            hideLabel={t.auth.hidePassword}
          />
        </FormField>

        <FormField label={t.auth.newPasswordLabel} htmlFor="cp-new-password" required>
          <PasswordInput
            id="cp-new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            disabled={submitting}
            showLabel={t.auth.showPassword}
            hideLabel={t.auth.hidePassword}
          />
        </FormField>

        <FormField
          label={t.auth.confirmPasswordLabel}
          htmlFor="cp-confirm-password"
          required
        >
          <PasswordInput
            id="cp-confirm-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={submitting}
            showLabel={t.auth.showPassword}
            hideLabel={t.auth.hidePassword}
          />
        </FormField>

        <div className="pt-2 flex justify-end gap-2">
          <Button variant="outline" onClick={resetAndClose} disabled={submitting}>
            Hủy
          </Button>
          <Button type="submit" variant="primary" loading={submitting}>
            {t.auth.changePassword}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
