import type { HTMLAttributes, ReactNode } from 'react';

export type CardTone = 'default' | 'subtle' | 'mint' | 'peach' | 'lavender' | 'butter';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'section' | 'article' | 'div';
  tone?: CardTone;
  elevated?: boolean;
  padding?: 'sm' | 'md' | 'lg';
}

const TONE_CLASSES: Record<CardTone, string> = {
  default: 'bg-[var(--mimora-surface)] border-[var(--mimora-border)]',
  subtle: 'bg-[var(--mimora-surface-subtle)] border-[var(--mimora-border)]',
  mint: 'bg-[var(--mimora-surface-mint)] border-[#c3dfd8]',
  peach: 'bg-[var(--mimora-surface-peach)] border-[#ecc9be]',
  lavender: 'bg-[var(--mimora-surface-lavender)] border-[#d3cbe9]',
  butter: 'bg-[var(--mimora-surface-butter)] border-[#eadba9]',
};

const PADDING_CLASSES: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'p-4',
  md: 'p-5 sm:p-6',
  lg: 'p-6 sm:p-8',
};

export function Card({
  as: Tag = 'div',
  tone = 'default',
  elevated = false,
  padding = 'md',
  className = '',
  children,
  ...rest
}: CardProps) {
  return (
    <Tag
      className={[
        'rounded-[var(--mimora-radius-lg)] border',
        TONE_CLASSES[tone],
        PADDING_CLASSES[padding],
        elevated ? 'shadow-[var(--mimora-shadow-soft)]' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className = '',
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={['flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3', className]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="space-y-1 min-w-0">
        <h2 className="text-lg font-semibold text-[var(--mimora-text)] leading-snug">
          {title}
        </h2>
        {description && (
          <p className="text-sm text-[var(--mimora-muted)] leading-relaxed">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardContent({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={['mt-4', className].filter(Boolean).join(' ')}>{children}</div>;
}

export function CardFooter({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        'mt-5 pt-4 border-t border-[var(--mimora-border)] flex flex-wrap items-center justify-between gap-3',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}
