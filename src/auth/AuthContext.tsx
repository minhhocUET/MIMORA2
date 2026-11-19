import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ApiClientError,
  authApi,
  clearInMemoryCsrfToken,
  subscribeUnauthorized,
} from '../api/client.ts';
import type {
  ApiErrorInfo,
  AuthContextPayload,
  ChangePasswordRequest,
  LoginRequest,
  MvpRole,
} from '../types/auth.ts';
import { DEFAULT_APP_LOCALE, type AppLocale } from '../i18n/index.ts';

export type AuthStatus = 'restoring' | 'authenticated' | 'unauthenticated';

export interface AuthState {
  status: AuthStatus;
  context: AuthContextPayload | null;
  resolvedRole: MvpRole | null;
  authNotice: ApiErrorInfo | null;
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  refreshMe: () => Promise<AuthContextPayload | null>;
  login: (input: LoginRequest) => Promise<AuthContextPayload>;
  switchOrganization: (organizationId: string) => Promise<AuthContextPayload>;
  changePassword: (input: ChangePasswordRequest) => Promise<void>;
  logout: () => Promise<void>;
  clearAuthNotice: () => void;
}

export type AuthContextValue = AuthState;

export const AuthContext = createContext<AuthState | null>(null);

export function deriveResolvedRole(ctx: AuthContextPayload | null): MvpRole | null {
  if (!ctx) {
    return null;
  }
  if (
    ctx.user.platformRole === 'platform_admin' &&
    ctx.session.scope === 'platform_admin'
  ) {
    return 'platform_admin';
  }
  if (ctx.user.platformRole === 'guardian' && ctx.session.scope === 'guardian') {
    return 'guardian';
  }
  if (ctx.session.scope === 'teacher' && ctx.user.platformRole === null) {
    return 'teacher';
  }
  if (ctx.session.scope === 'student' && ctx.user.platformRole === null) {
    return 'student';
  }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('restoring');
  const [context, setContext] = useState<AuthContextPayload | null>(null);
  const [authNotice, setAuthNotice] = useState<ApiErrorInfo | null>(null);
  const [locale, setLocale] = useState<AppLocale>(DEFAULT_APP_LOCALE);

  const refreshMe = useCallback(async (): Promise<AuthContextPayload | null> => {
    try {
      const payload = await authApi.getMe();
      setContext(payload);
      setStatus('authenticated');
      setAuthNotice(null);
      return payload;
    } catch (err) {
      clearInMemoryCsrfToken();
      setContext(null);
      setStatus('unauthenticated');
      if (err instanceof ApiClientError && err.info.httpStatus !== 401) {
        setAuthNotice(err.info);
      }
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    return subscribeUnauthorized((info) => {
      setContext((prev) => {
        if (!prev) {
          return prev;
        }
        setStatus('unauthenticated');
        setAuthNotice(info);
        return null;
      });
    });
  }, []);

  const login = useCallback(async (input: LoginRequest) => {
    setAuthNotice(null);
    const payload = await authApi.login(input);
    setContext(payload);
    setStatus('authenticated');
    return payload;
  }, []);

  const switchOrganization = useCallback(async (organizationId: string) => {
    try {
      const payload = await authApi.switchOrganization(organizationId);
      setContext(payload);
      setStatus('authenticated');
      return payload;
    } catch (err) {
      if (err instanceof ApiClientError && err.info.httpStatus === 401) {
        clearInMemoryCsrfToken();
        setContext(null);
        setStatus('unauthenticated');
        setAuthNotice(err.info);
      }
      throw err;
    }
  }, []);

  const changePassword = useCallback(async (input: ChangePasswordRequest) => {
    try {
      await authApi.changePassword(input);
    } catch (err) {
      if (err instanceof ApiClientError && err.info.httpStatus === 401) {
        clearInMemoryCsrfToken();
        setContext(null);
        setStatus('unauthenticated');
        setAuthNotice(err.info);
      }
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Even if session already expired server-side, ensure frontend memory state is cleared
      clearInMemoryCsrfToken();
    } finally {
      setContext(null);
      setStatus('unauthenticated');
      setAuthNotice(null);
    }
  }, []);

  const clearAuthNotice = useCallback(() => {
    setAuthNotice(null);
  }, []);

  const resolvedRole = useMemo(() => deriveResolvedRole(context), [context]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      context,
      resolvedRole,
      authNotice,
      locale,
      setLocale,
      refreshMe,
      login,
      switchOrganization,
      changePassword,
      logout,
      clearAuthNotice,
    }),
    [
      status,
      context,
      resolvedRole,
      authNotice,
      locale,
      refreshMe,
      login,
      switchOrganization,
      changePassword,
      logout,
      clearAuthNotice,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
