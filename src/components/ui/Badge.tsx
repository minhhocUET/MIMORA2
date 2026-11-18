import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';

export type BadgeVariant = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface BadgeProps {
  variant?: BadgeVariant;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  neutral: 'bg-[var(--mimora-surface-subtle)] text-[var(--mimora-text)] border-[var(--mimora-border)]',
  info: 'bg-[var(--mimora-surface-mint)] text-[var(--mimora-primary)] border-[#c3dfd8]',
  success: 'bg-[var(--mimora-success-bg)] text-[var(--mimora-success)] border-[var(--mimora-success-border)]',
  warning: 'bg-[var(--mimora-warning-bg)] text-[var(--mimora-warning)] border-[var(--mimora-warning-border)]',
  danger: 'bg-[var(--mimora-danger-bg)] text-[var(--mimora-danger)] border-[var(--mimora-danger-border)]',
};

const DEFAULT_ICONS: Record<BadgeVariant, ReactNode> = {
  neutral: null,
  info: <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />,
  success: <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />,
  warning: <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />,
  danger: <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />,
};

/**
 * Semantic status indicator combining explicit text and an icon cue
 * so color is never the sole carrier of status.
 */
export function Badge({
  variant = 'neutral',
  icon,
  children,
  className = '',
}: BadgeProps) {
  const renderedIcon = icon !== undefined ? icon : DEFAULT_ICONS[variant];

  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-[var(--mimora-radius-sm)] border px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0',
        VARIANT_CLASSES[variant],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {renderedIcon}
      <span>{children}</span>
    </span>
  );
}
