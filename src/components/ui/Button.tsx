import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'student';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--mimora-primary)] text-[var(--mimora-primary-ink)] border border-transparent hover:bg-[var(--mimora-primary-hover)] active:translate-y-px',
  secondary:
    'bg-[var(--mimora-surface-mint)] text-[var(--mimora-primary)] border border-[var(--mimora-border)] hover:bg-[#d8ede8] active:translate-y-px',
  outline:
    'bg-[var(--mimora-surface)] text-[var(--mimora-text)] border border-[var(--mimora-border-strong)] hover:bg-[var(--mimora-surface-subtle)] active:translate-y-px',
  ghost:
    'bg-transparent text-[var(--mimora-text)] border border-transparent hover:bg-[var(--mimora-surface-subtle)] active:translate-y-px',
  danger:
    'bg-[var(--mimora-danger)] text-white border border-transparent hover:bg-[#992727] active:translate-y-px',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'min-h-[38px] px-3.5 py-1.5 text-sm rounded-[var(--mimora-radius-sm)] gap-1.5',
  md: 'min-h-[44px] px-5 py-2.5 text-sm rounded-[var(--mimora-radius-md)] gap-2',
  lg: 'min-h-[48px] px-6 py-3 text-base rounded-[var(--mimora-radius-md)] gap-2.5',
  student:
    'min-h-[52px] px-7 py-3.5 text-base font-semibold rounded-[var(--mimora-radius-lg)] gap-3',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  leftIcon,
  rightIcon,
  fullWidth = false,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const isDisabled = Boolean(disabled || loading);

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={[
        'inline-flex items-center justify-center font-medium max-w-full text-center shrink-0 cursor-pointer',
        'transition-[background-color,border-color,color,transform] duration-150 ease-out',
        'disabled:opacity-55 disabled:cursor-not-allowed disabled:transform-none',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        fullWidth ? 'w-full' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden="true" />
      ) : (
        leftIcon && <span className="shrink-0 inline-flex">{leftIcon}</span>
      )}
      <span>{children}</span>
      {!loading && rightIcon && <span className="shrink-0 inline-flex">{rightIcon}</span>}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'student';
  loading?: boolean;
}

const ICON_SIZE_CLASSES: Record<'sm' | 'md' | 'student', string> = {
  sm: 'h-9 w-9 rounded-[var(--mimora-radius-sm)]',
  md: 'h-11 w-11 rounded-[var(--mimora-radius-md)]',
  student: 'h-12 w-12 rounded-[var(--mimora-radius-lg)]',
};

export function IconButton({
  label,
  variant = 'ghost',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const isDisabled = Boolean(disabled || loading);

  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={[
        'inline-flex items-center justify-center shrink-0 cursor-pointer',
        'transition-[background-color,border-color,color,transform] duration-150 ease-out',
        'disabled:opacity-55 disabled:cursor-not-allowed',
        VARIANT_CLASSES[variant],
        ICON_SIZE_CLASSES[size],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : children}
    </button>
  );
}
