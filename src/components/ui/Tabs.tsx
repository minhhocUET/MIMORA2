import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps<T extends string> {
  ariaLabel: string;
  options: readonly TabOption<T>[];
  value: T;
  onChange: (next: T) => void;
  size?: 'md' | 'student';
  fullWidth?: boolean;
}

export function Tabs<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
  size = 'md',
  fullWidth = false,
}: TabsProps<T>) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const findNextEnabledIndex = (startIdx: number, step: 1 | -1): number => {
    for (let offset = 1; offset <= options.length; offset += 1) {
      const candidate = (startIdx + step * offset + options.length) % options.length;
      if (!options[candidate]?.disabled) {
        return candidate;
      }
    }
    return startIdx;
  };

  const activateIndex = (targetIdx: number) => {
    const target = options[targetIdx];
    if (!target || target.disabled) {
      return;
    }
    onChange(target.value);
    tabRefs.current[targetIdx]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (options.every((o) => o.disabled)) {
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      activateIndex(findNextEnabledIndex(idx, 1));
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      activateIndex(findNextEnabledIndex(idx, -1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      const firstIdx = options.findIndex((o) => !o.disabled);
      if (firstIdx >= 0) {
        activateIndex(firstIdx);
      }
    } else if (event.key === 'End') {
      event.preventDefault();
      for (let i = options.length - 1; i >= 0; i -= 1) {
        if (!options[i].disabled) {
          activateIndex(i);
          break;
        }
      }
    }
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={[
        'inline-flex max-w-full overflow-x-auto items-center gap-1 rounded-[var(--mimora-radius-md)] bg-[var(--mimora-surface-subtle)] p-1 border border-[var(--mimora-border)]',
        fullWidth ? 'w-full' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {options.map((opt, idx) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              tabRefs.current[idx] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            disabled={opt.disabled}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={[
              'inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap shrink-0 cursor-pointer',
              'rounded-[calc(var(--mimora-radius-md)-4px)] transition-colors duration-150',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              size === 'student' ? 'min-h-[46px] px-4 py-2 text-base' : 'min-h-[38px] px-3.5 py-1.5 text-sm',
              fullWidth ? 'flex-1' : '',
              active
                ? 'bg-[var(--mimora-surface)] text-[var(--mimora-text)] shadow-[var(--mimora-shadow-soft)] border border-[var(--mimora-border)]'
                : 'text-[var(--mimora-muted)] hover:text-[var(--mimora-text)] border border-transparent',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {opt.icon && <span className="shrink-0 inline-flex">{opt.icon}</span>}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
