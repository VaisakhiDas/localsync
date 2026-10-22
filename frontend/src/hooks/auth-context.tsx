import type { UserDto } from '@localsync/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, NetworkError } from '../lib/api';
import { clearCachedUser, loadCachedUser, saveCachedUser } from '../lib/authCache';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; notice?: string }
  | { status: 'signedIn'; user: UserDto };

export interface AuthContextValue {
  state: AuthState;
  signIn: (email: string, password: string) => Promise<void>;
  register: (input: { email: string; displayName: string; password: string }) => Promise<void>;
  /** Needs the network (the server must revoke the session). Throws NetworkError when offline. */
  signOut: () => Promise<void>;
  /** The server stopped recognising our session (it expired or was revoked). */
  sessionExpired: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let ignore = false;
    api.me().then(
      async ({ user }) => {
        await saveCachedUser(user);
        if (!ignore) setState({ status: 'signedIn', user });
      },
      async (err: unknown) => {
        if (err instanceof NetworkError) {
          // Offline (or server down): open with the remembered identity so local work stays reachable.
          // The server still has the last word: every sync and WebSocket connect re-checks the real cookie.
          const cached = await loadCachedUser();
          if (!ignore) setState(cached ? { status: 'signedIn', user: cached } : { status: 'signedOut' });
        } else {
          if (err instanceof ApiError && err.status === 401) await clearCachedUser();
          if (!ignore) setState({ status: 'signedOut' });
        }
      },
    );
    return () => {
      ignore = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { user } = await api.login({ email, password });
    await saveCachedUser(user);
    setState({ status: 'signedIn', user });
  }, []);

  const register = useCallback(async (input: { email: string; displayName: string; password: string }) => {
    const { user } = await api.register(input);
    await saveCachedUser(user);
    setState({ status: 'signedIn', user });
  }, []);

  const signOut = useCallback(async () => {
    await api.logout(); // may throw NetworkError: signing out must really revoke the session
    await clearCachedUser();
    setState({ status: 'signedOut' });
  }, []);

  const sessionExpired = useCallback(() => {
    void clearCachedUser();
    setState({ status: 'signedOut', notice: 'Your session expired. Sign in again: the documents on this device are kept.' });
  }, []);

  const value = useMemo(() => ({ state, signIn, register, signOut, sessionExpired }), [state, signIn, register, signOut, sessionExpired]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** For components that only render when signed in. */
export function useUser(): UserDto {
  const { state } = useAuth();
  if (state.status !== 'signedIn') throw new Error('useUser called while signed out');
  return state.user;
}
