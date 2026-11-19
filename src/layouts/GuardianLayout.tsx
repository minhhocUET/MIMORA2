import { BarChart3, Home, KeyRound, LogOut, Settings, Users } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.tsx';
import { ChangePasswordModal } from '../components/auth/ChangePasswordModal.tsx';
import { GuardianProgressPage } from '../components/guardian/GuardianProgressPage.tsx';
import { GuardianSettingsPage } from '../components/guardian/GuardianSettingsPage.tsx';
import { GuardianStudentsPage } from '../components/guardian/GuardianStudentsPage.tsx';
import { GuardianVerificationCard } from '../components/guardian/GuardianVerificationCard.tsx';
import { GuardianWorkspacesPage } from '../components/guardian/GuardianWorkspacesPage.tsx';
import { MimoraBrandMark } from '../components/illustrations/SelIllustrations.tsx';
import { Avatar, Dropdown, ResponsiveShell, Toast } from '../components/ui/index.ts';
import { getMessages } from '../i18n/index.ts';

type GuardianSection = 'workspaces' | 'students' | 'progress' | 'settings';

export function GuardianLayout() {
  const { context, logout, locale } = useAuth();
  const t = getMessages(locale);

  const [section, setSection] = useState<GuardianSection>('workspaces');
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  if (!context) {
    return null;
  }

  const emailVerified = Boolean(context.user.emailVerified);

  const navItems: Array<{ id: GuardianSection; label: string; icon: React.ReactNode }> = [
    {
      id: 'workspaces',
      label: t.guardian.navWorkspaces,
      icon: <Home className="h-4 w-4" aria-hidden="true" />,
    },
    {
      id: 'students',
      label: t.guardian.navStudents,
      icon: <Users className="h-4 w-4" aria-hidden="true" />,
    },
    {
      id: 'progress',
      label: t.guardian.navProgress,
      icon: <BarChart3 className="h-4 w-4" aria-hidden="true" />,
    },
    {
      id: 'settings',
      label: t.guardian.navSettings,
      icon: <Settings className="h-4 w-4" aria-hidden="true" />,
    },
  ];

  return (
    <ResponsiveShell
      brandLogo={<MimoraBrandMark />}
      brandTitle={t.app.brand}
      portalLabel={t.guardian.portalName}
      skipLabel={t.app.skipToContent}
      navItems={navItems}
      activeNavId={section}
      onSelectNav={(id) => setSection(id as GuardianSection)}
      headerRightAction={
        <Dropdown
          triggerLabel={context.user.displayName}
          triggerIcon={<Avatar name={context.user.displayName} tone="peach" size="sm" />}
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
        <div className="space-y-2 text-xs text-[var(--mimora-muted)]">
          <p className="font-medium text-[var(--mimora-text)]">{t.roles.guardian}</p>
          <p className="leading-relaxed">
            {emailVerified ? 'Email đã xác minh · Không gian gia đình an toàn' : 'Chờ xác minh email'}
          </p>
        </div>
      }
    >
      {toastMsg && (
        <Toast variant="success" message={toastMsg} onDismiss={() => setToastMsg(null)} />
      )}

      {!emailVerified && section !== 'settings' ? (
        <GuardianVerificationCard onToast={setToastMsg} />
      ) : (
        <>
          {section === 'workspaces' && (
            <GuardianWorkspacesPage
              locale={locale}
              onToast={setToastMsg}
              onNavigateToStudents={() => setSection('students')}
            />
          )}
          {section === 'students' && (
            <GuardianStudentsPage locale={locale} onToast={setToastMsg} />
          )}
          {section === 'progress' && (
            <GuardianProgressPage locale={locale} onToast={setToastMsg} />
          )}
          {section === 'settings' && (
            <GuardianSettingsPage onOpenChangePassword={() => setChangePwdOpen(true)} />
          )}
        </>
      )}

      <ChangePasswordModal
        open={changePwdOpen}
        onClose={() => setChangePwdOpen(false)}
        onSuccess={(msg) => setToastMsg(msg)}
      />
    </ResponsiveShell>
  );
}
