import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { IconButton } from './Button.tsx';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  closeLabel?: string;
  children: ReactNode;
  footer?: ReactNode;
  maxWidthClass?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  closeLabel = 'Đóng hộp thoại',
  children,
  footer,
  maxWidthClass = 'max-w-lg',
}: DialogProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const getFocusableElements = (): HTMLElement[] => {
      const panel = panelRef.current;
      if (!panel) {
        return [];
      }
      const selector = [
        'a[href]',
        'button:not([disabled])',
        'input:not([disabled]):not([type="hidden"])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
      ].join(',');
      return Array.from(panel.querySelectorAll<HTMLElement>(selector)).filter(
        (el) => !el.hasAttribute('aria-hidden')
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key === 'Tab' && panelRef.current) {
        const focusable = getFocusableElements();
        if (focusable.length === 0) {
          event.preventDefault();
          panelRef.current.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;

        if (event.shiftKey) {
          if (!active || active === first || active === panelRef.current || !panelRef.current.contains(active)) {
            event.preventDefault();
            last.focus();
          }
        } else if (!active || active === last || !panelRef.current.contains(active)) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocused?.focus?.();
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/35"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onCloseRef.current();
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={[
          'w-full max-h-[90vh] overflow-y-auto rounded-[var(--mimora-radius-xl)] bg-[var(--mimora-surface)] border border-[var(--mimora-border)]',
          'shadow-[var(--mimora-shadow-pop)] p-6 space-y-5 outline-none',
          maxWidthClass,
        ].join(' ')}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 id={titleId} className="text-lg font-semibold text-[var(--mimora-text)]">
              {title}
            </h2>
            {description && (
              <p id={descId} className="text-sm text-[var(--mimora-muted)] leading-relaxed">
                {description}
              </p>
            )}
          </div>
          <IconButton label={closeLabel} size="sm" onClick={() => onCloseRef.current()}>
            <X className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        </div>

        <div>{children}</div>

        {footer && (
          <div className="pt-4 border-t border-[var(--mimora-border)] flex flex-wrap justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
