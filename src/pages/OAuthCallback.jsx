import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar.jsx';
import Footer from '../components/Footer.jsx';
import { refreshAccess, sanitizeNextPath } from '@/lib/api.js';
import { useAuth } from '@/context/AuthContext.jsx';

const ERROR_TEXT = {
  OAUTH_DENIED: 'You declined the authorization — no account was created. You can try again whenever you like.',
  OAUTH_LINK_REQUIRED:
    'An account with this email already exists. Sign in with your original method first, then link the provider from Settings → Linked accounts.',
  OAUTH_STATE: 'The sign-in request expired or was tampered with. Please start again from the sign-in page.',
  OAUTH_DISABLED: 'This sign-in method is not enabled right now.',
  OAUTH_PROVIDER: 'Unknown sign-in provider.',
};

export default function OAuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { reloadUser } = useAuth();
  const [state, setState] = useState({ phase: 'working', message: 'Signing you in…' });

  useEffect(() => {
    let alive = true;
    (async () => {
      const status = params.get('status');
      const next = sanitizeNextPath(params.get('next'));
      if (status !== 'ok') {
        const code = params.get('code') || 'OAUTH_FAILED';
        if (alive) {
          setState({
            phase: 'error',
            message: ERROR_TEXT[code] || 'Sign-in failed. Please try again from the sign-in page.',
            linkRequired: code === 'OAUTH_LINK_REQUIRED',
          });
        }
        return;
      }
      try {
        // The backend set the httpOnly refresh cookie on the 302; mint the
        // in-memory access token and load the profile through the normal flow.
        await refreshAccess();
        await reloadUser();
        if (alive) navigate(next, { replace: true });
      } catch {
        if (alive) setState({ phase: 'error', message: 'Your session could not be completed. Please sign in again.' });
      }
    })();
    return () => {
      alive = false;
    };
  }, [params, navigate, reloadUser]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <Navbar />
      <main className="container-page relative z-10 pt-28 pb-16">
        <div className="mx-auto flex w-full max-w-lg flex-col items-center rounded-3xl bg-gradient-to-r from-[#ffffff10] to-[#121212] p-10 text-center shadow-2xl sm:p-12">
          {state.phase === 'working' ? (
            <>
              <h2 className="mb-2 text-2xl font-semibold text-white">Almost there</h2>
              <p className="text-base text-gray-400">{state.message}</p>
            </>
          ) : (
            <>
              <h2 className="mb-2 text-2xl font-semibold text-white">Sign-in didn&apos;t complete</h2>
              <p className="mb-6 text-base text-gray-400">{state.message}</p>
              <Link
                to={state.linkRequired ? '/signin' : '/signin'}
                className="rounded-full bg-white px-6 py-3 text-sm font-bold text-black transition hover:bg-gray-200"
              >
                Back to sign in
              </Link>
            </>
          )}
        </div>
      </main>
      <div className="relative z-10">
        <Footer className="bg-transparent" />
      </div>
    </div>
  );
}
