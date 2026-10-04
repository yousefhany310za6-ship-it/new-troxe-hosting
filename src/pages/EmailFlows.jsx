import { useState } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar.jsx';
import Footer from '../components/Footer.jsx';
import { apiPost } from '@/lib/api.js';
import { useAuth } from '@/context/AuthContext.jsx';

export function VerifyEmail() {
  const { reloadUser } = useAuth();
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState({ text: '', ok: true });
  const [pending, setPending] = useState(false);

  const submit = async (e) => {
    e?.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) {
      setMsg({ text: 'Enter the 6-digit code from the email.', ok: false });
      return;
    }
    setPending(true);
    try {
      await apiPost('/auth/email-verification/verify', { code: code.trim() });
      await reloadUser();
      setMsg({ text: 'Email verified. Welcome aboard!', ok: true });
    } catch (err) {
      setMsg({ text: err?.message || 'Verification failed.', ok: false });
    } finally {
      setPending(false);
    }
  };

  const resend = async () => {
    setPending(true);
    try {
      const out = await apiPost('/auth/email-verification/send', {});
      setMsg({ text: out?.already ? 'Your email is already verified.' : 'A fresh code is on its way (check spam too).', ok: true });
    } catch (err) {
      setMsg({ text: err?.message || 'Could not resend the code.', ok: false });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <Navbar />
      <main className="container-page relative z-10 pt-28 pb-16">
        <div className="mx-auto flex w-full max-w-lg flex-col items-center rounded-3xl bg-gradient-to-r from-[#ffffff10] to-[#121212] p-10 text-center shadow-2xl sm:p-12">
          <h2 className="mb-2 text-2xl font-semibold text-white">Verify your email</h2>
          <p className="mb-6 text-base text-gray-400">We sent a 6-digit code — it expires in 10 minutes.</p>
          <form onSubmit={submit} className="flex w-full flex-col gap-4">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              inputMode="numeric"
              autoComplete="one-time-code"
              className="w-full rounded-xl bg-white/10 py-4 text-center text-2xl tracking-[0.4em] text-white placeholder-gray-500 focus:ring-2 focus:ring-gray-400 focus:outline-none"
            />
            {msg.text && <p className={msg.ok ? 'text-sm text-emerald-400' : 'text-sm text-red-400'}>{msg.text}</p>}
            <button type="submit" disabled={pending} className="w-full rounded-full bg-white px-5 py-4 text-base font-medium text-black shadow transition hover:bg-gray-200 disabled:opacity-60">
              {pending ? 'Working…' : 'Verify'}
            </button>
          </form>
          <button type="button" onClick={resend} disabled={pending} className="mt-4 text-sm text-white/80 underline hover:text-white disabled:opacity-60">
            Resend the code
          </button>
          <Link to="/dashboard" className="mt-2 text-sm text-gray-500 hover:text-gray-300">
            Skip for now
          </Link>
        </div>
      </main>
      <div className="relative z-10">
        <Footer className="bg-transparent" />
      </div>
    </div>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e?.preventDefault();
    setPending(true);
    try {
      await apiPost('/auth/password-reset/request', { email }, { auth: false });
    } catch {
      // identical screen in every case: the backend never reveals whether an
      // address exists, and neither do we (not even on transport errors)
    } finally {
      setPending(false);
      setDone(true);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <Navbar />
      <main className="container-page relative z-10 pt-28 pb-16">
        <div className="mx-auto flex w-full max-w-lg flex-col items-center rounded-3xl bg-gradient-to-r from-[#ffffff10] to-[#121212] p-10 text-center shadow-2xl sm:p-12">
          <h2 className="mb-2 text-2xl font-semibold text-white">Forgot password</h2>
          {done ? (
            <p className="text-base text-gray-400">If an account uses this email, a reset link is on its way (valid 1 hour, single use). Check spam too.</p>
          ) : (
            <>
              <p className="mb-6 text-base text-gray-400">Enter your account email and we&apos;ll send a reset link.</p>
              <form onSubmit={submit} className="flex w-full flex-col gap-4">
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  type="email"
                  autoComplete="email"
                  className="w-full rounded-xl bg-white/10 py-4 px-5 text-base text-white placeholder-gray-300 focus:ring-2 focus:ring-gray-400 focus:outline-none"
                />
                <button type="submit" disabled={pending} className="w-full rounded-full bg-white px-5 py-4 text-base font-medium text-black shadow transition hover:bg-gray-200 disabled:opacity-60">
                  {pending ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
            </>
          )}
          <Link to="/signin" className="mt-4 text-sm text-white/80 underline hover:text-white">
            Back to sign in
          </Link>
        </div>
      </main>
      <div className="relative z-10">
        <Footer className="bg-transparent" />
      </div>
    </div>
  );
}

export function ResetPassword() {
  const [pw, setPw] = useState({ next: '', confirm: '' });
  const [msg, setMsg] = useState({ text: '', ok: true });
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const token = new URLSearchParams(window.location.search).get('token') || '';

  const submit = async (e) => {
    e?.preventDefault();
    if (!token) {
      setMsg({ text: 'This reset link is invalid or has expired.', ok: false });
      return;
    }
    setPending(true);
    try {
      await apiPost('/auth/password-reset/confirm', { token, ...pw }, { auth: false });
      setDone(true);
      setMsg({ text: 'Password changed. You can sign in with it now.', ok: true });
    } catch (err) {
      setMsg({ text: err?.message || 'This reset link is invalid or has expired.', ok: false });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <Navbar />
      <main className="container-page relative z-10 pt-28 pb-16">
        <div className="mx-auto flex w-full max-w-lg flex-col items-center rounded-3xl bg-gradient-to-r from-[#ffffff10] to-[#121212] p-10 text-center shadow-2xl sm:p-12">
          <h2 className="mb-2 text-2xl font-semibold text-white">Set a new password</h2>
          {done ? (
            <Link to="/signin" className="mt-4 rounded-full bg-white px-6 py-3 text-sm font-bold text-black transition hover:bg-gray-200">
              Continue to sign in
            </Link>
          ) : (
            <form onSubmit={submit} className="flex w-full flex-col gap-4">
              <input
                value={pw.next}
                onChange={(e) => setPw({ ...pw, next: e.target.value })}
                placeholder="New password (8+ chars, letters + numbers)"
                type="password"
                autoComplete="new-password"
                className="w-full rounded-xl bg-white/10 py-4 px-5 text-base text-white placeholder-gray-300 focus:ring-2 focus:ring-gray-400 focus:outline-none"
              />
              <input
                value={pw.confirm}
                onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                placeholder="Confirm new password"
                type="password"
                autoComplete="new-password"
                className="w-full rounded-xl bg-white/10 py-4 px-5 text-base text-white placeholder-gray-300 focus:ring-2 focus:ring-gray-400 focus:outline-none"
              />
              {msg.text && <p className={msg.ok ? 'text-sm text-emerald-400' : 'text-sm text-red-400'}>{msg.text}</p>}
              <button type="submit" disabled={pending} className="w-full rounded-full bg-white px-5 py-4 text-base font-medium text-black shadow transition hover:bg-gray-200 disabled:opacity-60">
                {pending ? 'Saving…' : 'Set new password'}
              </button>
            </form>
          )}
        </div>
      </main>
      <div className="relative z-10">
        <Footer className="bg-transparent" />
      </div>
    </div>
  );
}
