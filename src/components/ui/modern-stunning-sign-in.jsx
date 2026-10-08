"use client";

import * as React from "react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertCircle, ArrowRight, Eye, EyeOff, Lock, Mail, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import { IconDiscordSm } from "../icons.jsx";

function GoogleIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function Field({ label, error, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[0.8rem] font-semibold text-ink-secondary">{label}</span>
      {children}
      {error && (
        <span className="mt-1.5 block text-[0.78rem] text-red-400" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

const inputCls =
  "w-full rounded-xl border border-hairline bg-white/[0.04] py-3 pr-4 pl-11 text-[0.95rem] text-foreground placeholder:text-ink-muted transition focus:border-white/40 focus:bg-white/[0.06] focus:ring-2 focus:ring-white/15 focus:outline-none";

function SignIn1({ className, onSignIn, onGoogleSignIn, onDiscordSignIn, brandName = "Troxe Hosting" }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  const handleSignIn = async (e) => {
    e?.preventDefault();
    if (!email || !password) {
      setError("Please enter both email and password.");
      setSuccess(false);
      return;
    }
    if (!validateEmail(email)) {
      setError("Please enter a valid email address.");
      setSuccess(false);
      return;
    }
    setError("");
    setSuccess(false);
    setPending(true);
    try {
      if (onSignIn) {
        const out = await onSignIn({ email, password });
        // 2FA challenge: the parent swaps to the verification screen — do NOT
        // navigate away (the success + auto-advance below is for full logins only).
        if (out?.mfaRequired) return;
      }
      setSuccess(true);
      // Real auth — head to the dashboard after a beat so the success shows.
      setTimeout(() => navigate("/dashboard"), 600);
    } catch (err) {
      setError(err?.message || "Sign in failed. Please try again.");
      setSuccess(false);
    } finally {
      setPending(false);
    }
  };

  const handleGoogle = () => {
    if (onGoogleSignIn) {
      onGoogleSignIn();
    }
  };

  const handleDiscord = () => {
    if (onDiscordSignIn) {
      onDiscordSignIn();
    }
  };

  return (
    <div
      className={cn(
        "relative mx-auto grid w-full max-w-5xl overflow-hidden rounded-3xl border border-hairline bg-card shadow-[0_40px_120px_-30px_rgba(255,255,255,0.12)] lg:grid-cols-[1.05fr_1fr]",
        className
      )}
    >
      {/* ---- form side ---- */}
      <div className="relative p-7 sm:p-10 lg:p-12">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex size-11 items-center justify-center overflow-hidden rounded-xl border border-hairline bg-black p-1.5">
            <img src="./favicon.png" alt="Troxe Hosting logo" className="size-full object-contain" />
          </div>
          <div>
            <p className="text-[1.05rem] font-extrabold tracking-tight text-foreground">{brandName}</p>
            <p className="font-mono text-[0.7rem] tracking-widest text-ink-muted uppercase">Welcome back</p>
          </div>
        </div>

        <h2 className="text-[1.7rem] leading-tight font-extrabold tracking-tight text-foreground">
          Sign in to continue
        </h2>
        <p className="mt-2 text-[0.9rem] text-ink-secondary">
          Your servers, consoles and billing are one password away.
        </p>

        <form onSubmit={handleSignIn} className="mt-8 flex w-full flex-col gap-4" noValidate>
          <Field label="Email">
            <span className="relative block">
              <Mail className="pointer-events-none absolute top-1/2 left-3.5 h-[18px] w-[18px] -translate-y-1/2 text-ink-muted" />
              <input
                placeholder="you@example.com"
                type="email"
                autoComplete="email"
                value={email}
                className={inputCls}
                onChange={(e) => setEmail(e.target.value)}
              />
            </span>
          </Field>
          <Field label="Password">
            <span className="relative block">
              <Lock className="pointer-events-none absolute top-1/2 left-3.5 h-[18px] w-[18px] -translate-y-1/2 text-ink-muted" />
              <input
                placeholder="••••••••••"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                className={cn(inputCls, "pr-11")}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute top-1/2 right-3 -translate-y-1/2 rounded-lg p-1.5 text-ink-muted transition hover:bg-veil hover:text-foreground"
              >
                {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
              </button>
            </span>
          </Field>

          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-[0.75rem] text-ink-muted">
              <ShieldCheck className="h-3.5 w-3.5" /> Encrypted session
            </span>
            <Link to="/forgot-password" className="text-[0.8rem] font-semibold text-ink-secondary underline-offset-4 transition hover:text-foreground hover:underline">
              Forgot password?
            </Link>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/[0.07] px-3.5 py-2.5 text-[0.83rem] text-red-300" role="alert">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
          {success && !error && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] px-3.5 py-2.5 text-[0.83rem] text-emerald-300">
              <span className="size-2 shrink-0 animate-pulse rounded-full bg-emerald-400" />
              Sign in successful! Redirecting…
            </div>
          )}

          <button
            type="submit"
            disabled={pending}
            className="group mt-1 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-5 py-3.5 text-[0.95rem] font-bold text-black shadow-[0_10px_40px_-10px_rgba(255,255,255,0.4)] transition hover:bg-gray-200 disabled:opacity-60"
          >
            {pending ? "Signing in…" : (<>Sign in <ArrowRight className="size-4 transition group-hover:translate-x-0.5" /></>)}
          </button>
        </form>

        <div className="my-6 flex items-center gap-3 text-[0.72rem] font-mono tracking-widest text-ink-muted uppercase">
          <span className="h-px flex-1 bg-hairline" /> or continue with <span className="h-px flex-1 bg-hairline" />
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <button
            type="button"
            onClick={handleGoogle}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-hairline bg-veil px-4 py-3 text-[0.87rem] font-semibold text-foreground transition hover:border-hairline-hover hover:bg-white/[0.07]"
          >
            <GoogleIcon className="h-[18px] w-[18px]" />
            Google
          </button>
          <button
            type="button"
            onClick={handleDiscord}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#5865F2] px-4 py-3 text-[0.87rem] font-semibold text-white transition hover:brightness-110"
          >
            <IconDiscordSm className="h-[18px] w-[18px]" />
            Discord
          </button>
        </div>

        <p className="mt-6 text-center text-[0.85rem] text-ink-secondary">
          Don&apos;t have an account?{" "}
          <Link to="/signup" className="font-bold text-foreground underline-offset-4 hover:underline">
            Sign up, it&apos;s free!
          </Link>
        </p>
      </div>

      {/* ---- brand side ---- */}
      <div className="relative hidden flex-col justify-between overflow-hidden border-l border-hairline bg-black p-10 lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(500px circle at 85% 10%, rgba(255,255,255,0.09), transparent 60%), radial-gradient(400px circle at 10% 90%, rgba(255,255,255,0.05), transparent 60%), linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
            backgroundSize: "auto, auto, 32px 32px, 32px 32px",
          }}
        />
        <div className="relative">
          <p className="font-mono text-[0.7rem] tracking-[0.2em] text-ink-muted uppercase">Troxe Hosting — live</p>
          <p className="mt-3 text-[1.65rem] leading-[1.2] font-extrabold tracking-tight text-foreground">
            Ship tonight.
            <br />
            <span className="text-ink-secondary">Scale tomorrow.</span>
          </p>
        </div>

        <div className="relative rounded-2xl border border-hairline bg-white/[0.03] p-4 font-mono text-[0.76rem] leading-relaxed backdrop-blur-sm">
          <div className="mb-3 flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-[#ff5f57]" />
            <span className="size-2.5 rounded-full bg-[#febc2e]" />
            <span className="size-2.5 rounded-full bg-[#28c840]" />
            <span className="ml-2 text-ink-muted">deploy — zsh</span>
          </div>
          <p className="text-ink-secondary"><span className="text-foreground">$</span> troxe deploy --prod</p>
          <p className="text-emerald-300">✓ Build finished in 41s</p>
          <p className="text-emerald-300">✓ 3 replicas live · fra</p>
          <p className="flex items-center gap-2 text-ink-secondary">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" /> api · 200 OK · 38ms
          </p>
        </div>

        <div className="relative grid grid-cols-3 gap-3">
          {[
            ["99.99%", "uptime SLA"],
            ["<40ms", "median API"],
            ["NVMe", "7 regions"],
          ].map(([v, l]) => (
            <div key={l} className="rounded-xl border border-hairline bg-white/[0.03] px-3 py-2.5">
              <p className="text-[0.95rem] font-extrabold text-foreground tabular-nums">{v}</p>
              <p className="mt-0.5 text-[0.68rem] text-ink-muted">{l}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export { SignIn1 };

export default SignIn1;
