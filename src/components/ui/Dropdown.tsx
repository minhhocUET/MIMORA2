import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface DropdownItem {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export interface DropdownProps {
  triggerLabel: string;
  triggerIcon?: ReactNode;
  items: readonly DropdownItem[];
  align?: 'left' | 'right';
}

export function Dropdown({
  triggerLabel,
  triggerIcon,
  items,
  align = 'right',
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusOnOpenRef = useRef<'first' | 'last' | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    if (focusOnOpenRef.current) {
      const enabledIndices = items
        .map((it, idx) => (!it.disabled ? idx : -1))
        .filter((idx) => idx >= 0);
      if (enabledIndices.length > 0) {
        const targetIdx =
          focusOnOpenRef.current === 'last'
            ? enabledIndices[enabledIndices.length - 1]
            : enabledIndices[0];
        itemRefs.current[targetIdx]?.focus();
      }
      focusOnOpenRef.current = null;
    }

    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, items]);

  const moveItemFocus = (currentIdx: number, step: 1 | -1) => {
    for (let offset = 1; offset <= items.length; offset += 1) {
      const next = (currentIdx + step * offset + items.length) % items.length;
      if (!items[next]?.disabled) {
        itemRefs.current[next]?.focus();
        return;
      }
    }
  };

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            focusOnOpenRef.current = 'first';
            setOpen(true);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            focusOnOpenRef.current = 'last';
            setOpen(true);
          }
        }}
        className="inline-flex items-center gap-2 min-h-[42px] px-3.5 py-2 rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border-strong)] bg-[var(--mimora-surface)] text-sm font-medium text-[var(--mimora-text)] hover:bg-[var(--mimora-surface-subtle)] whitespace-nowrap shrink-0 cursor-pointer"
      >
        {triggerIcon && <span className="shrink-0 inline-flex">{triggerIcon}</span>}
        <span className="truncate max-w-[160px]">{triggerLabel}</span>
        <ChevronDown
          className={`h-4 w-4 text-[var(--mimora-muted)] transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          className={[
            'absolute z-40 mt-2 min-w-[220px] rounded-[var(--mimora-radius-md)] border border-[var(--mimora-border)]',
            'bg-[var(--mimora-surface)] shadow-[var(--mimora-shadow-pop)] py-1.5',
            align === 'right' ? 'right-0' : 'left-0',
          ].join(' ')}
        >
          {items.map((item, idx) => (
            <button
              key={item.id}
              ref={(el) => {
                itemRefs.current[idx] = el;
              }}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  moveItemFocus(idx, 1);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  moveItemFocus(idx, -1);
                } else if (e.key === 'Home') {
                  e.preventDefault();
                  const first = items.findIndex((it) => !it.disabled);
                  if (first >= 0) itemRefs.current[first]?.focus();
                } else if (e.key === 'End') {
                  e.preventDefault();
                  for (let i = items.length - 1; i >= 0; i -= 1) {
                    if (!items[i].disabled) {
                      itemRefs.current[i]?.focus();
                      break;
                    }
                  }
                }
              }}
              className={[
                'w-full text-left px-3.5 py-2.5 text-sm flex items-center gap-2.5 cursor-pointer',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                item.danger
                  ? 'text-[var(--mimora-danger)] hover:bg-[var(--mimora-danger-bg)]'
                  : 'text-[var(--mimora-text)] hover:bg-[var(--mimora-surface-subtle)]',
              ].join(' ')}
            >
              {item.icon && <span className="shrink-0 inline-flex">{item.icon}</span>}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
