import React from 'react';
import axios from 'axios';
import { api, authTokenStore } from '../services/api';
import type { AuthSession, AuthUser } from '../types';
import { AuthContext } from './context';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  status: AuthStatus;
  bootstrapRequired: boolean;
  user: AuthUser | null;
  session: AuthSession | null;
  scopes: string[];
  login: (email: string, password: string) => Promise<void>;
  bootstrap: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const DEVICE_NAME = 'mony web';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<AuthStatus>('loading');
  const [bootstrapRequired, setBootstrapRequired] = React.useState(false);
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [session, setSession] = React.useState<AuthSession | null>(null);
  const [scopes, setScopes] = React.useState<string[]>([]);
  const refreshTimerRef = React.useRef<number | null>(null);

  const clearRefreshTimer = React.useCallback(() => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  const applyAuthResponse = React.useCallback(
    (response: Awaited<ReturnType<typeof api.login>>) => {
      authTokenStore.set(response.access_token);
      setUser(response.user);
      setSession(response.session);
      setScopes(response.scopes);
      setBootstrapRequired(false);
      setStatus('authenticated');

      clearRefreshTimer();
      const refreshInMs = Math.max((response.expires_in - 60) * 1000, 30_000);
      refreshTimerRef.current = window.setTimeout(async () => {
        try {
          const refreshed = await api.refreshAuth();
          applyAuthResponse(refreshed);
        } catch {
          authTokenStore.clear();
          setUser(null);
          setSession(null);
          setScopes([]);
          setStatus('anonymous');
        }
      }, refreshInMs);
    },
    [clearRefreshTimer],
  );

  const clearAuth = React.useCallback(() => {
    clearRefreshTimer();
    authTokenStore.clear();
    setUser(null);
    setSession(null);
    setScopes([]);
    setStatus('anonymous');
  }, [clearRefreshTimer]);

  React.useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      try {
        const bootstrap = await api.bootstrapStatus();
        if (cancelled) {
          return;
        }

        setBootstrapRequired(bootstrap.bootstrap_required);

        if (bootstrap.bootstrap_required) {
          clearAuth();
          return;
        }

        try {
          const refreshed = await api.refreshAuth();
          if (!cancelled) {
            applyAuthResponse(refreshed);
          }
        } catch {
          if (!cancelled) {
            clearAuth();
          }
        }
      } catch {
        if (!cancelled) {
          clearAuth();
        }
      }
    };

    void initialize();

    return () => {
      cancelled = true;
      clearRefreshTimer();
    };
  }, [applyAuthResponse, clearAuth, clearRefreshTimer]);

  const login = React.useCallback(
    async (email: string, password: string) => {
      const response = await api.login(email, password, DEVICE_NAME);
      applyAuthResponse(response);
    },
    [applyAuthResponse],
  );

  const bootstrap = React.useCallback(
    async (email: string, password: string) => {
      const response = await api.bootstrap(email, password, DEVICE_NAME);
      applyAuthResponse(response);
    },
    [applyAuthResponse],
  );

  const logout = React.useCallback(async () => {
    try {
      await api.logout();
    } catch (error) {
      if (!axios.isAxiosError(error) || error.response?.status !== 401) {
        throw error;
      }
    } finally {
      clearAuth();
    }
  }, [clearAuth]);

  const value = React.useMemo<AuthContextValue>(
    () => ({
      status,
      bootstrapRequired,
      user,
      session,
      scopes,
      login,
      bootstrap,
      logout,
    }),
    [bootstrapRequired, bootstrap, login, logout, scopes, session, status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
