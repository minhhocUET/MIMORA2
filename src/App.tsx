import { AuthProvider, useAuth } from './auth/AuthContext.tsx';
import { LoginPage } from './components/auth/LoginPage.tsx';
import { OrgSelectionScreen } from './components/auth/OrgSelectionScreen.tsx';
import { MimoraBrandMark } from './components/illustrations/SelIllustrations.tsx';
import { LoadingState } from './components/ui/index.ts';
import { getMessages } from './i18n/index.ts';
import { AdminLayout } from './layouts/AdminLayout.tsx';
import { GuardianLayout } from './layouts/GuardianLayout.tsx';
import { StudentLayout } from './layouts/StudentLayout.tsx';
import { TeacherLayout } from './layouts/TeacherLayout.tsx';

function AppRouter() {
  const { status, context, resolvedRole, locale } = useAuth();
  const t = getMessages(locale);

  if (status === 'restoring') {
    return (
      <div className="min-h-screen bg-[var(--mimora-bg)] text-[var(--mimora-text)] flex flex-col items-center justify-center px-4">
        <div className="flex items-center gap-2.5 mb-2">
          <MimoraBrandMark />
          <span className="text-lg font-bold tracking-tight">{t.app.brand}</span>
        </div>
        <LoadingState label={t.app.loadingSession} />
      </div>
    );
  }

  if (status === 'unauthenticated' || !context) {
    return <LoginPage />;
  }

  if (
    context.requiresOrganizationSelection ||
    (resolvedRole === 'teacher' && !context.activeOrganization)
  ) {
    return <OrgSelectionScreen />;
  }

  if (resolvedRole === 'platform_admin') {
    return <AdminLayout />;
  }

  if (resolvedRole === 'guardian') {
    return <GuardianLayout />;
  }

  if (resolvedRole === 'teacher') {
    return <TeacherLayout />;
  }

  if (resolvedRole === 'student') {
    return <StudentLayout />;
  }

  return <LoginPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}
