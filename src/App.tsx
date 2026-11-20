import { useEffect, useState } from 'react';
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
import { extractAndCleanVerifyToken } from './utils/verification-link.ts';

function AppRouter() {
  const { status, context, resolvedRole, locale } = useAuth();
  const t = getMessages(locale);
  const [pendingVerifyToken, setPendingVerifyToken] = useState<string | null>(null);

  useEffect(() => {
    const extracted = extractAndCleanVerifyToken();
    if (extracted) {
      setPendingVerifyToken(extracted);
    }
  }, []);

  const clearPendingVerifyToken = () => setPendingVerifyToken(null);

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
    return (
      <LoginPage
        initialVerifyToken={pendingVerifyToken}
        onConsumeInitialVerifyToken={clearPendingVerifyToken}
      />
    );
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
    return (
      <GuardianLayout
        initialVerifyToken={pendingVerifyToken}
        onConsumeInitialVerifyToken={clearPendingVerifyToken}
      />
    );
  }

  if (resolvedRole === 'teacher') {
    return <TeacherLayout />;
  }

  if (resolvedRole === 'student') {
    return <StudentLayout />;
  }

  return (
    <LoginPage
      initialVerifyToken={pendingVerifyToken}
      onConsumeInitialVerifyToken={clearPendingVerifyToken}
    />
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}
