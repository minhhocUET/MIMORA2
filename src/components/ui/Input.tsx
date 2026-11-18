import { Eye, EyeOff } from 'lucide-react';
import {
  forwardRef,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';

export interface FormFieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function FormField({
  label,
  htmlFor,
  hint,
  error,
  required = false,
  children,
  className = '',
}: FormFieldProps) {
  return (
    <div className={['space-y-1.5', className].filter(Boolean).join(' ')}>
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-[var(--mimora-text)]"
      >
        <span>{label}</span>
        {required && (
          <span className="ml-1 text-[var(--mimora-danger)]" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && (
        <p className="text-xs text-[var(--mimora-muted)] leading-relaxed">{hint}</p>
      )}
      {error && (
        <p
          role="alert"
          className="text-xs font-medium text-[var(--mimora-danger)] leading-relaxed"
        >
          {error}
        </p>
      )}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean;
  leftAdornment?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { hasError = false, leftAdornment, className = '', ...rest },
  ref
) {
  return (
    <div className="relative flex items-center">
      {leftAdornment && (
        <span className="pointer-events-none absolute left-3.5 text-[var(--mimora-muted)] inline-flex">
          {leftAdornment}
        </span>
      )}
      <input
        ref={ref}
        aria-invalid={hasError || undefined}
        className={[
          'w-full min-h-[46px] rounded-[var(--mimora-radius-md)] border bg-[var(--mimora-surface)]',
          'text-base sm:text-sm text-[var(--mimora-text)] placeholder:text-[var(--mimora-muted)]/75',
          'transition-[border-color,box-shadow] duration-150',
          'disabled:bg-[var(--mimora-surface-subtle)] disabled:opacity-65 disabled:cursor-not-allowed',
          leftAdornment ? 'pl-10 pr-3.5' : 'px-3.5',
          hasError
            ? 'border-[var(--mimora-danger)] focus:border-[var(--mimora-danger)]'
            : 'border-[var(--mimora-border-strong)] hover:border-[var(--mimora-primary)] focus:border-[var(--mimora-primary)]',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        {...rest}
      />
    </div>
  );
});

export interface PasswordInputProps extends Omit<InputProps, 'type'> {
  showLabel?: string;
  hideLabel?: string;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput(
    {
      hasError = false,
      showLabel = 'Hiện mật khẩu',
      hideLabel = 'Ẩn mật khẩu',
      className = '',
      id,
      ...rest
    },
    ref
  ) {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const [visible, setVisible] = useState(false);

    return (
      <div className="relative flex items-center">
        <input
          ref={ref}
          id={inputId}
          type={visible ? 'text' : 'password'}
          aria-invalid={hasError || undefined}
          className={[
            'w-full min-h-[46px] rounded-[var(--mimora-radius-md)] border bg-[var(--mimora-surface)] pl-3.5 pr-12',
            'text-base sm:text-sm text-[var(--mimora-text)] placeholder:text-[var(--mimora-muted)]/75',
            'transition-[border-color,box-shadow] duration-150',
            'disabled:bg-[var(--mimora-surface-subtle)] disabled:opacity-65 disabled:cursor-not-allowed',
            hasError
              ? 'border-[var(--mimora-danger)] focus:border-[var(--mimora-danger)]'
              : 'border-[var(--mimora-border-strong)] hover:border-[var(--mimora-primary)] focus:border-[var(--mimora-primary)]',
            className,
          ]
            .filter(Boolean)
            .join(' ')}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setVisible((prev) => !prev)}
          aria-label={visible ? hideLabel : showLabel}
          aria-pressed={visible}
          className="absolute right-1.5 inline-flex h-9 w-9 items-center justify-center rounded-[var(--mimora-radius-sm)] text-[var(--mimora-muted)] hover:bg-[var(--mimora-surface-subtle)] hover:text-[var(--mimora-text)] cursor-pointer"
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    );
  }
);
