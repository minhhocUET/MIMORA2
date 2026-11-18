import { CheckCircle2, Info, Loader2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from './Button.tsx';

export function EmptyState({
  illustration,
  title,
  description,
  action,
  calmNote,
}: {
  illustration?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  calmNote?: string;
}) {
  return (
    <div className="rounded-[var(--mimora-radius-lg)] border border-dashed border-[var(--mimora-border-strong)] bg-[var(--mimora-surface)] px-6 py-8 sm:py-10 text-center space-y-4">
      {illustration && <div className="flex justify-center">{illustration}</div>}
      <div className="max-w-lg mx-auto space-y-2">
        <h3 className="text-lg font-semibold text-[var(--mimora-text)]">{title}</h3>
        <p className="text-sm text-[var(--mimora-muted)] leading-relaxed">{description}</p>
        {calmNote && (
          <p className="text-xs text-[var(--mimora-primary)] font-medium pt-1">{calmNote}</p>
        )}
      </div>
      {action && <div className="pt-2 flex justify-center">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = 'Đang tải...' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-3 py-12 px-4 text-center"
    >
      <Loader2 className="h-7 w-7 animate-spin text-[var(--mimora-primary)]" aria-hidden="true" />
      <p className="text-sm font-medium text-[var(--mimora-muted)]">{label}</p>
    </div>
  );
}

export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={['rounded-[var(--mimora-radius-sm)] bg-[var(--mimora-surface-subtle)] animate-pulse', className].join(' ')}
    />
  );
}

export function Toast({
  variant = 'info',
  message,
  onDismiss,
  dismissLabel = 'Đóng thông báo',
}: {
  variant?: 'info' | 'success';
  message: string;
  onDismiss?: () => void;
  dismissLabel?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        'rounded-[var(--mimora-radius-md)] border px-4 py-3 shadow-[var(--mimora-shadow-soft)] flex items-center gap-3 text-sm',
        variant === 'success'
          ? 'bg-[var(--mimora-success-bg)] border-[var(--mimora-success-border)] text-[var(--mimora-text)]'
          : 'bg-[var(--mimora-surface-mint)] border-[#c3dfd8] text-[var(--mimora-text)]',
      ].join(' ')}
    >
      {variant === 'success' ? (
        <CheckCircle2 className="h-4 w-4 text-[var(--mimora-success)] shrink-0" aria-hidden="true" />
      ) : (
        <Info className="h-4 w-4 text-[var(--mimora-primary)] shrink-0" aria-hidden="true" />
      )}
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <IconButton label={dismissLabel} size="sm" onClick={onDismiss}>
          <X className="h-4 w-4" aria-hidden="true" />
        </IconButton>
      )}
    </div>
  );
}
