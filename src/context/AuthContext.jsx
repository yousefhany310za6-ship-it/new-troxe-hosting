import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiGet, setAccessToken } from '@/lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading'); // 'loading' | 'guest' | 'authed'
  const [user, setUser] = useState(null);

  const loadUser = useCallback(async () => {
    const me = await apiGet('/users/me');
    setUser(me);
    setStatus('authed');
    return me;
  }, []);

  // Boot: try the refresh cookie once — silent session restore.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await loadUser();
      } catch {
        if (alive) { setUser(null); setStatus('guest'); }
      }
    })();
    return () => { alive = false; };
  }, [loadUser]);

  const signIn = useCallback(async (email, password) => {
    // Import dynamically to avoid circular deps
    const { authPost } = await import('@/lib/api.js');
    const out = await authPost('/auth/login', { email, password });
    setAccessToken(out.accessToken);
    try { await loadUser(); } catch { setUser({ ...out.user }); }
    return out.user;
  }, [loadUser]);

  const signUp = useCallback(async ({ name, email, password }) => {
    const { authPost } = await import('@/lib/api.js');
    const out = await authPost('/auth/signup', { name, email, password });
    setAccessToken(out.accessToken);
    try { await loadUser(); } catch { setUser({ ...out.user }); }
    return out.user;
  }, [loadUser]);

  const signOut = useCallback(async () => {
    try { await apiGet('/auth/logout', { method: 'POST', auth: false }); } catch { /* cookie may be gone */ }
    setAccessToken(null);
    setUser(null);
    setStatus('guest');
  }, []);

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