import {
  BookOpen,
  Building2,
  ClipboardList,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { ApiClientError } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import { getMessages, resolveLocalizedErrorMessage } from '../i18n/index.ts';
import { ChangePasswordModal } from '../components/auth/ChangePasswordModal.tsx';
import { MimoraBrandMark } from '../components/illustrations/SelIllustrations.tsx';
import { TeacherAssignmentsPage } from '../components/teacher/TeacherAssignmentsPage.tsx';
import { TeacherClassesPage } from '../components/teacher/TeacherClassesPage.tsx';
import { TeacherLibraryPage } from '../components/teacher/TeacherLibraryPage.tsx';
import { TeacherOverviewPage, type TeacherSection } from '../components/teacher/TeacherOverviewPage.tsx';
import { TeacherStudentsPage } from '../components/teacher/TeacherStudentsPage.tsx';
import {
  Alert,
  Avatar,
  Dropdown,
  ResponsiveShell,
  Select,
  Toast,
} from '../components/ui/index.ts';

export function TeacherLayout() {
  const { context, switchOrganization, logout, locale } = useAuth();
  const t = getMessages(locale);

  const [section, setSection] = useState<TeacherSection>('overview');
  const [preselectedStudentId, setPreselectedStudentId] = useState<string | null>(null);
  const [switchingOrg, setSwitchingOrg] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  if (!context) {
    return null;
  }

  const activeOrg = context.activeOrganization;
  const orgKey = activeOrg?.organizationId ?? 'no-org';

  const navItems: Array<{ id: TeacherSection; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: t.teacher.navOverview, icon: <LayoutDashboard className="h-4 w-4" aria-hidden="true" /> },
    { id: 'classes', label: t.teacher.navClasses, icon: <GraduationCap className="h-4 w-4" aria-hidden="true" /> },
    { id: 'students', label: t.teacher.navStudents, icon: <Users className="h-4 w-4" aria-hidden="true" /> },
    { id: 'library', label: t.teacher.navLibrary, icon: <BookOpen className="h-4 w-4" aria-hidden="true" /> },
    { id: 'assignments', label: t.teacher.navAssignments, icon: <ClipboardList className="h-4 w-4" aria-hidden="true" /> },
  ];

  const handleOrgChange = async (nextOrgId: string) => {
    if (!nextOrgId || nextOrgId === activeOrg?.organizationId) {
      return;
    }
    setSwitchingOrg(true);
    setSwitchError(null);
    try {
      const updated = await switchOrganization(nextOrgId);
      setPreselectedStudentId(null);
      setToastMsg(
        `Đã chuyển sang trường ${updated.activeOrganization?.name ?? nextOrgId}.`
      );
    } catch (err) {
      if (err instanceof ApiClientError) {
        setSwitchError(resolveLocalizedErrorMessage(err.info, locale));
      } else {
        setSwitchError(t.errors.UNKNOWN);
      }
    } finally {
      setSwitchingOrg(false);
    }
  };

  return (
    <ResponsiveShell
      brandLogo={<MimoraBrandMark />}
      brandTitle={t.app.brand}
      portalLabel={t.teacher.portalName}
      skipLabel={t.app.skipToContent}
      navItems={navItems}
      activeNavId={section}
      onSelectNav={(id) => setSection(id as TeacherSection)}
      headerRightAction={
        <Dropdown
          triggerLabel={context.user.displayName}
          triggerIcon={<Avatar name={context.user.displayName} tone="mint" size="sm" />}
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
        <div className="space-y-3">
          <div className="space-y-1 text-xs text-[var(--mimora-muted)]">
            <p className="font-medium text-[var(--mimora-text)] flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 text-[var(--mimora-primary)] shrink-0" aria-hidden="true" />
              <span className="truncate">{activeOrg?.name ?? 'Chưa chọn trường'}</span>
            </p>
            {activeOrg && (
              <p className="font-mono">
                {activeOrg.code} · {t.roles.teacher}
              </p>
            )}
          </div>

          {context.organizations.length > 1 && (
            <div className="space-y-1.5">
              <label
                htmlFor="teacher-org-switcher"
                className="block text-xs font-medium text-[var(--mimora-muted)]"
              >
                {t.auth.switchOrgMenuLabel}
              </label>
              <Select
                id="teacher-org-switcher"
                value={activeOrg?.organizationId ?? ''}
                disabled={switchingOrg}
                onChange={(e) => void handleOrgChange(e.target.value)}
                options={context.organizations.map((org) => ({
                  value: org.organizationId,
                  label: `${org.name} (${org.code})`,
                }))}
              />
            </div>
          )}
        </div>
      }
    >
      {toastMsg && (
        <Toast variant="success" message={toastMsg} onDismiss={() => setToastMsg(null)} />
      )}
      {switchError && <Alert variant="danger">{switchError}</Alert>}

      {/* Keyed by active organization ID so switching schools resets and refreshes all org-scoped views */}
      <div key={orgKey}>
        {section === 'overview' && (
          <TeacherOverviewPage
            activeOrg={activeOrg}
            locale={locale}
            onNavigate={setSection}
          />
        )}
        {section === 'classes' && (
          <TeacherClassesPage
            locale={locale}
            onToast={setToastMsg}
            onOpenStudentDetail={(stuId) => {
              setPreselectedStudentId(stuId);
              setSection('students');
            }}
          />
        )}
        {section === 'students' && (
          <TeacherStudentsPage
            locale={locale}
            initialStudentMembershipId={preselectedStudentId}
            onToast={setToastMsg}
          />
        )}
        {section === 'library' && <TeacherLibraryPage locale={locale} />}
        {section === 'assignments' && (
          <TeacherAssignmentsPage locale={locale} onToast={setToastMsg} />
        )}
      </div>

      <ChangePasswordModal
        open={changePwdOpen}
        onClose={() => setChangePwdOpen(false)}
        onSuccess={(msg) => setToastMsg(msg)}
      />
    </ResponsiveShell>
  );
}
