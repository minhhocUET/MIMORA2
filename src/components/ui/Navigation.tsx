import { Menu, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconButton } from './Button.tsx';

export interface PageHeaderProps {
  title: string;
  description?: string;
  metadataLine?: string;
  action?: ReactNode;
}

export function PageHeader({
  title,
  description,
  metadataLine,
  action,
}: PageHeaderProps) {
  return (
    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-5 border-b border-[var(--mimora-border)]">
      <div className="space-y-1.5 min-w-0">
        {metadataLine && (
          <p className="text-xs font-medium text-[var(--mimora-muted)] tracking-wide">
            {metadataLine}
          </p>
        )}
        <h1 className="text-2xl sm:text-3xl font-semibold text-[var(--mimora-text)] tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="text-sm sm:text-base text-[var(--mimora-muted)] max-w-2xl leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
    </div>
  );
}

export interface NavItemProps {
  label: string;
  icon?: ReactNode;
  active?: boolean;
  size?: 'md' | 'student';
  onClick: () => void;
}

export function NavItem({
  label,
  icon,
  active = false,
  size = 'md',
  onClick,
}: NavItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={[
        'w-full flex items-center gap-3 text-left font-medium cursor-pointer transition-colors duration-150',
        'rounded-[var(--mimora-radius-md)] border',
        size === 'student' ? 'min-h-[50px] px-4 py-3 text-base' : 'min-h-[44px] px-3.5 py-2.5 text-sm',
        active
          ? 'bg-[var(--mimora-surface-mint)] text-[var(--mimora-primary)] border-[#c3dfd8]'
          : 'bg-transparent text-[var(--mimora-text)] border-transparent hover:bg-[var(--mimora-surface-subtle)]',
      ].join(' ')}
    >
      {icon && <span className="shrink-0 inline-flex">{icon}</span>}
      <span className="truncate">{label}</span>
    </button>
  );
}

export interface ResponsiveShellProps {
  brandLogo: ReactNode;
  brandTitle: string;
  portalLabel: string;
  skipLabel: string;
  navItems: Array<{
    id: string;
    label: string;
    icon?: ReactNode;
  }>;
  activeNavId: string;
  onSelectNav: (id: string) => void;
  headerRightAction: ReactNode;
  sidebarFooter?: ReactNode;
  studentFriendly?: boolean;
  children: ReactNode;
}

export function ResponsiveShell({
  brandLogo,
  brandTitle,
  portalLabel,
  skipLabel,
  navItems,
  activeNavId,
  onSelectNav,
  headerRightAction,
  sidebarFooter,
  studentFriendly = false,
  children,
}: ResponsiveShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileToggleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mobileMenuOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileMenuOpen(false);
        const btn = mobileToggleRef.current?.querySelector('button');
        btn?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [mobileMenuOpen]);

  return (
    <div className="min-h-screen flex flex-col bg-[var(--mimora-bg)] text-[var(--mimora-text)]">
      <a
        href="#mimora-main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:rounded-[var(--mimora-radius-sm)] focus:bg-[var(--mimora-primary)] focus:text-white"
      >
        {skipLabel}
      </a>

      {/* Compact single-row top bar compliant with 15% mobile sticky height limit */}
      <header className="sticky top-0 z-30 h-16 border-b border-[var(--mimora-border)] bg-[var(--mimora-surface)]/95 backdrop-blur-sm">
        <div className="max-w-[1440px] mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-4 sm:gap-8">
          <div className="flex items-center gap-3 min-w-0">
            <div ref={mobileToggleRef} className="lg:hidden">
              <IconButton
                label="Mở menu điều hướng"
                size="sm"
                variant="outline"
                aria-expanded={mobileMenuOpen}
                onClick={() => setMobileMenuOpen((prev) => !prev)}
              >
                {mobileMenuOpen ? (
                  <X className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Menu className="h-4 w-4" aria-hidden="true" />
                )}
              </IconButton>
            </div>
            <div className="flex items-center gap-2.5 min-w-0">
              {brandLogo}
              <span className="text-lg font-bold tracking-tight text-[var(--mimora-text)] whitespace-nowrap shrink-0">
                {brandTitle}
              </span>
            </div>
          </div>

          <p className="hidden md:block text-sm font-medium text-[var(--mimora-muted)] whitespace-nowrap shrink-0">
            {portalLabel}
          </p>

          <div className="flex items-center gap-2.5 shrink-0">{headerRightAction}</div>
        </div>
      </header>

      {/* Mobile slide-down drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-b border-[var(--mimora-border)] bg-[var(--mimora-surface)] px-4 py-3 space-y-2">
          <nav aria-label={portalLabel} className="space-y-1">
            {navItems.map((item) => (
              <NavItem
                key={item.id}
                label={item.label}
                icon={item.icon}
                size={studentFriendly ? 'student' : 'md'}
                active={item.id === activeNavId}
                onClick={() => {
                  onSelectNav(item.id);
                  setMobileMenuOpen(false);
                }}
              />
            ))}
          </nav>
          {sidebarFooter && <div className="pt-2 border-t border-[var(--mimora-border)]">{sidebarFooter}</div>}
        </div>
      )}

      {/* Desktop workspace grid */}
      <div className="flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col lg:flex-row gap-6 lg:gap-8">
        <aside
          aria-label={portalLabel}
          className="hidden lg:flex lg:flex-col lg:w-[260px] shrink-0 space-y-6"
        >
          <nav className="space-y-1.5">
            {navItems.map((item) => (
              <NavItem
                key={item.id}
                label={item.label}
                icon={item.icon}
                size={studentFriendly ? 'student' : 'md'}
                active={item.id === activeNavId}
                onClick={() => onSelectNav(item.id)}
              />
            ))}
          </nav>
          {sidebarFooter && (
            <div className="pt-4 border-t border-[var(--mimora-border)]">{sidebarFooter}</div>
          )}
        </aside>

        <main id="mimora-main-content" tabIndex={-1} className="flex-1 min-w-0 space-y-6 outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
