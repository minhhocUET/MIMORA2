import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';

export type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

export interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  children: ReactNode;
  action?: ReactNode;
  role?: 'alert' | 'status';
  className?: string;
}

const ALERT_CLASSES: Record<AlertVariant, string> = {
  info: 'bg-[var(--mimora-surface-mint)] border-[#c3dfd8] text-[var(--mimora-text)]',
  success: 'bg-[var(--mimora-success-bg)] border-[var(--mimora-success-border)] text-[var(--mimora-text)]',
  warning: 'bg-[var(--mimora-warning-bg)] border-[var(--mimora-warning-border)] text-[var(--mimora-text)]',
  danger: 'bg-[var(--mimora-danger-bg)] border-[var(--mimora-danger-border)] text-[var(--mimora-text)]',
};

const ALERT_ICON_CLASSES: Record<AlertVariant, string> = {
  info: 'text-[var(--mimora-primary)]',
  success: 'text-[var(--mimora-success)]',
  warning: 'text-[var(--mimora-warning)]',
  danger: 'text-[var(--mimora-danger)]',
};

const ALERT_ICONS: Record<AlertVariant, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
};

export function Alert({
  variant = 'info',
  title,
  children,
  action,
  role,
  className = '',
}: AlertProps) {
  const Icon = ALERT_ICONS[variant];
  const computedRole = role ?? (variant === 'danger' || variant === 'warning' ? 'alert' : 'status');

  return (
    <div
      role={computedRole}
      aria-live={computedRole === 'alert' ? 'assertive' : 'polite'}
      className={[
        'rounded-[var(--mimora-radius-md)] border p-4 flex items-start gap-3',
        ALERT_CLASSES[variant],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Icon
        className={['h-5 w-5 shrink-0 mt-0.5', ALERT_ICON_CLASSES[variant]].join(' ')}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0 space-y-1 text-sm leading-relaxed">
        {title && <p className="font-semibold text-[var(--mimora-text)]">{title}</p>}
        <div className="text-[var(--mimora-text)]/90">{children}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
