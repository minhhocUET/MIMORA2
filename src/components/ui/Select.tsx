import { ChevronDown } from 'lucide-react';
import { forwardRef, type SelectHTMLAttributes } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: readonly SelectOption[];
  hasError?: boolean;
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, hasError = false, placeholder, className = '', ...rest },
  ref
) {
  return (
    <div className="relative flex items-center">
      <select
        ref={ref}
        aria-invalid={hasError || undefined}
        className={[
          'w-full min-h-[46px] appearance-none rounded-[var(--mimora-radius-md)] border bg-[var(--mimora-surface)] pl-3.5 pr-10',
          'text-base sm:text-sm text-[var(--mimora-text)] cursor-pointer',
          'disabled:bg-[var(--mimora-surface-subtle)] disabled:opacity-65 disabled:cursor-not-allowed',
          hasError
            ? 'border-[var(--mimora-danger)] focus:border-[var(--mimora-danger)]'
            : 'border-[var(--mimora-border-strong)] hover:border-[var(--mimora-primary)] focus:border-[var(--mimora-primary)]',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        {...rest}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3.5 h-4 w-4 text-[var(--mimora-muted)]"
        aria-hidden="true"
      />
    </div>
  );
});
