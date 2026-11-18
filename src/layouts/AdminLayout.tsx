import {
  BarChart3,
  BookOpenCheck,
  Building2,
  ClipboardCheck,
  FileSpreadsheet,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.tsx';
import { getMessages } from '../i18n/index.ts';
import { ChangePasswordModal } from '../components/auth/ChangePasswordModal.tsx';
import { MimoraBrandMark } from '../components/illustrations/SelIllustrations.tsx';
import { AdminAccountsPage } from '../components/admin/AdminAccountsPage.tsx';
import { AdminApprovalQueuePage } from '../components/admin/AdminApprovalQueuePage.tsx';
import { AdminClassesPage } from '../components/admin/AdminClassesPage.tsx';
import { AdminContentLibraryPage } from '../components/admin/AdminContentLibraryPage.tsx';
import { AdminCsvImportPage } from '../components/admin/AdminCsvImportPage.tsx';
import { AdminInsightsPage } from '../components/admin/AdminInsightsPage.tsx';
import { AdminOrganizationsPage } from '../components/admin/AdminOrganizationsPage.tsx';
import { AdminOverviewPage, type AdminSection } from '../components/admin/AdminOverviewPage.tsx';
import {
  Avatar,
  Dropdown,
  ResponsiveShell,
  Toast,
} from '../components/ui/index.ts';

export function AdminLayout() {
  const { context, logout, locale } = useAuth();
  const t = getMessages(locale);

  const [section, setSection] = useState<AdminSection>('overview');
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  if (!context) {
    return null;
  }

  const navItems: Array<{ id: AdminSection; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: t.admin.navOverview, icon: <LayoutDashboard className="h-4 w-4" aria-hidden="true" /> },
    { id: 'organizations', label: t.admin.navOrganizations, icon: <Building2 className="h-4 w-4" aria-hidden="true" /> },
    { id: 'accounts', label: t.admin.navAccounts, icon: <Users className="h-4 w-4" aria-hidden="true" /> },
    { id: 'classes', label: t.admin.navClasses, icon: <GraduationCap className="h-4 w-4" aria-hidden="true" /> },
    { id: 'csv_import', label: t.admin.navCsvImport, icon: <FileSpreadsheet className="h-4 w-4" aria-hidden="true" /> },
    { id: 'content', label: t.admin.navContent, icon: <BookOpenCheck className="h-4 w-4" aria-hidden="true" /> },
    { id: 'approval_queue', label: t.admin.navApprovalQueue, icon: <ClipboardCheck className="h-4 w-4" aria-hidden="true" /> },
    { id: 'insights', label: t.admin.navInsights, icon: <BarChart3 className="h-4 w-4" aria-hidden="true" /> },
  ];

  return (
    <ResponsiveShell
      brandLogo={<MimoraBrandMark />}
      brandTitle={t.app.brand}
      portalLabel={t.admin.portalName}
      skipLabel={t.app.skipToContent}
      navItems={navItems}
      activeNavId={section}
      onSelectNav={(id) => setSection(id as AdminSection)}
      headerRightAction={
        <Dropdown
          triggerLabel={context.user.displayName}
          triggerIcon={<Avatar name={context.user.displayName} tone="lavender" size="sm" />}
          items={[
            {
              id: 'change-password',
              label: t.auth.changePassword,
              icon: <KeyRound className="h-4 w-4" aria-hidden="true" />,
              onSelect: () => setChangePwdOpen(true),
            },
            {
              id: 'logout',
              label: t.auth.logout,
              icon: <LogOut className="h-4 w-4" aria-hidden="true" />,
              danger: true,
              onSelect: () => void logout(),
            },
          ]}
        />
      }
      sidebarFooter={
        <div className="space-y-1 text-xs text-[var(--mimora-muted)]">
          <p className="font-medium text-[var(--mimora-text)]">{context.user.displayName}</p>
          <p>{t.roles.platform_admin}</p>
        </div>
      }
    >
      {toastMsg && (
        <Toast variant="success" message={toastMsg} onDismiss={() => setToastMsg(null)} />
      )}

      {section === 'overview' && (
        <AdminOverviewPage user={context.user} locale={locale} onNavigate={setSection} />
      )}
      {section === 'organizations' && (
        <AdminOrganizationsPage locale={locale} onToast={setToastMsg} />
      )}
      {section === 'accounts' && (
        <AdminAccountsPage locale={locale} onToast={setToastMsg} />
      )}
      {section === 'classes' && (
        <AdminClassesPage locale={locale} onToast={setToastMsg} />
      )}
      {section === 'csv_import' && (
        <AdminCsvImportPage locale={locale} onToast={setToastMsg} />
      )}
      {section === 'content' && (
        <AdminContentLibraryPage locale={locale} onToast={setToastMsg} />
      )}
      {section === 'approval_queue' && (
        <AdminApprovalQueuePage locale={locale} onToast={setToastMsg} />
      )}
      {section === 'insights' && <AdminInsightsPage locale={locale} />}

      <ChangePasswordModal
        open={changePwdOpen}
        onClose={() => setChangePwdOpen(false)}
        onSuccess={(msg) => setToastMsg(msg)}
      />
    </ResponsiveShell>
  );
}
