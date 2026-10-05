import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, setAccessToken, authPost } from '@/lib/api.js';
import { keys } from '@/hooks/useQueries.jsx';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading'); // 'loading' | 'guest' | 'authed'
  const [user, setUser] = useState(null);
  const qc = useQueryClient();

  const loadUser = useCallback(async () => {
    const me = await apiGet('/users/me');
    setUser(me);
    qc.setQueryData(keys.user(), me);
    setStatus('authed');
    return me;
  }, [qc]);

  // Boot: try the refresh cookie once — silent session restore.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Check for impersonation token first
        const impersonationToken = localStorage.getItem('impersonation_token');
        if (impersonationToken) {
          // Use impersonation token to authenticate
          localStorage.removeItem('impersonation_token');
          setAccessToken(impersonationToken);
          await loadUser();
          return;
        }
        await loadUser();
      } catch {
        if (alive) { setUser(null); setStatus('guest'); }
      }
    })();
    return () => { alive = false; };
  }, [loadUser]);

  const signIn = useCallback(async (email, password) => {
    const out = await authPost('/auth/login', { email, password });
    setAccessToken(out.accessToken);
    try { await loadUser(); } catch { setUser({ ...out.user }); }
    return out.user;
  }, [loadUser]);

  const signUp = useCallback(async ({ name, email, password }) => {
    const out = await authPost('/auth/signup', { name, email, password });
    setAccessToken(out.accessToken);
    try { await loadUser(); } catch { setUser({ ...out.user }); }
    return out.user;
  }, [loadUser]);

  const signOut = useCallback(async () => {
    // POST (not apiGet — it forces GET and would 404, leaving the httpOnly
    // cookie alive while the UI pretends the session is dead)
    try { await apiPost('/auth/logout', null, { auth: false }); } catch { /* cookie may be gone */ }
    setAccessToken(null);
    setUser(null);
    qc.removeQueries({ queryKey: keys.user() });
    qc.removeQueries({ queryKey: keys.servers() });
    qc.removeQueries({ queryKey: keys.authSessions() });
    qc.removeQueries({ queryKey: keys.activeSessions() });
    setStatus('guest');
  }, [qc]);

  const value = useMemo(() => ({
    user,
    setUser,
    status,
    signIn,
    signUp,
    signOut,
    reloadUser: loadUser,
  }), [user, status, signIn, signUp, signOut, loadUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};