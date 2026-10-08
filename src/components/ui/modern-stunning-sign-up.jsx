"use client";

import * as React from "react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertCircle, ArrowRight, Check, Eye, EyeOff, Lock, Mail, ShieldCheck, User } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { IconDiscordSm } from "../icons.jsx";
import { PasswordStrength } from "./password-strength.jsx";

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

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[0.8rem] font-semibold text-ink-secondary">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-xl border border-hairline bg-white/[0.04] py-3 pr-4 pl-11 text-[0.95rem] text-foreground placeholder:text-ink-muted transition focus:border-white/40 focus:bg-white/[0.06] focus:ring-2 focus:ring-white/15 focus:outline-none";

function SignUp1({
  className,
  onSignUp,
  onGoogleSignIn,
  onDiscordSignIn,
  brandName = "Troxe Hosting",
}) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();

  const showStrength = passwordFocused || password.length > 0;

  const handleSignUp = async (e) => {
    e?.preventDefault();
    if (!username.trim() || !email || !password || !confirmPassword) {
      setError("Please fill in all fields.");
      setSuccess(false);
      return;
    }
    if (username.trim().length < 3) {
      setError("Username must be at least 3 characters.");
      setSuccess(false);
      return;
    }
    if (!validateEmail(email)) {
      setError("Please enter a valid email address.");
      setSuccess(false);
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      setSuccess(false);
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      setSuccess(false);
      return;
    }
    setError("");
    setSuccess(false);
    setPending(true);
    try {
      if (onSignUp) {
        await onSignUp({ username: username.trim(), email, password });
      }
      setSuccess(true);
      // Real auth — head to the dashboard so the session shows.
      setTimeout(() => navigate("/dashboard"), 600);
    } catch (err) {
      setError(err?.message || "Sign up failed. Please try again.");
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
            <p className="font-mono text-[0.7rem] tracking-widest text-ink-muted uppercase">Free to start</p>
          </div>
        </div>

        <h2 className="text-[1.7rem] leading-tight font-extrabold tracking-tight text-foreground">
          Create your account
        </h2>
        <p className="mt-2 text-[0.9rem] text-ink-secondary">
          Deploy your first server in minutes — no credit card required.
        </p>

        <form onSubmit={handleSignUp} className="mt-8 flex w-full flex-col gap-4" noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Username">
              <span className="relative block">
                <User className="pointer-events-none absolute top-1/2 left-3.5 h-[18px] w-[18px] -translate-y-1/2 text-ink-muted" />
                <input
                  placeholder="hacker123"
                  type="text"
                  autoComplete="username"
                  value={username}
                  className={inputCls}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </span>
            </Field>
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
          </div>
          <div>
            <Field label="Password">
              <span className="relative block">
                <Lock className="pointer-events-none absolute top-1/2 left-3.5 h-[18px] w-[18px] -translate-y-1/2 text-ink-muted" />
                <input
                  placeholder="8+ characters, letters & numbers"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  className={cn(inputCls, "pr-11")}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
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
            <AnimatePresence initial={false}>
              {showStrength && (
                <motion.div
                  key="strength"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 320, damping: 32 }}
                  className="overflow-hidden"
                >
                  <PasswordStrength value={password} className="mt-3" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <Field label="Confirm password">
            <span className="relative block">
              <Lock className="pointer-events-none absolute top-1/2 left-3.5 h-[18px] w-[18px] -translate-y-1/2 text-ink-muted" />
              <input
                placeholder="Repeat your password"
                type={showConfirm ? "text" : "password"}
                autoComplete="new-password"
                value={confirmPassword}
                className={cn(inputCls, "pr-11")}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              <button
                type="button"
                aria-label={showConfirm ? "Hide password" : "Show password"}
                onClick={() => setShowConfirm((v) => !v)}
                className="absolute top-1/2 right-3 -translate-y-1/2 rounded-lg p-1.5 text-ink-muted transition hover:bg-veil hover:text-foreground"
              >
                {showConfirm ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
              </button>
            </span>
          </Field>

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/[0.07] px-3.5 py-2.5 text-[0.83rem] text-red-300" role="alert">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
          {success && !error && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] px-3.5 py-2.5 text-[0.83rem] text-emerald-300">
              <span className="size-2 shrink-0 animate-pulse rounded-full bg-emerald-400" />
              Account created! Redirecting…
            </div>
          )}

          <button
            type="submit"
            disabled={pending}
            className="group mt-1 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-5 py-3.5 text-[0.95rem] font-bold text-black shadow-[0_10px_40px_-10px_rgba(255,255,255,0.4)] transition hover:bg-gray-200 disabled:opacity-60"
          >
            {pending ? "Creating account…" : (<>Create account <ArrowRight className="size-4 transition group-hover:translate-x-0.5" /></>)}
          </button>
          <p className="text-center text-[0.75rem] text-ink-muted">
            By signing up you agree to the Terms and Privacy Policy.
          </p>
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
          Already have an account?{" "}
          <Link to="/signin" className="font-bold text-foreground underline-offset-4 hover:underline">
            Sign in
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
          <p className="font-mono text-[0.7rem] tracking-[0.2em] text-ink-muted uppercase">Why Troxe</p>
          <p className="mt-3 text-[1.65rem] leading-[1.2] font-extrabold tracking-tight text-foreground">
            Consoles, deploys
            <br />
            <span className="text-ink-secondary">and zero DevOps.</span>
          </p>
        </div>

        <div className="relative flex flex-col gap-2.5">
          {[
            ["Pick a runtime", "Node.js, Python, Bun or PHP — live in one click."],
            ["Watch it boot", "Real-time console, logs and usage meters."],
            ["Scale when ready", "Upgrade plans without touching a server."],
          ].map(([t, d], i) => (
            <div key={t} className="flex items-start gap-3 rounded-2xl border border-hairline bg-white/[0.03] p-4">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white font-mono text-[0.8rem] font-extrabold text-black">
                {i + 1}
              </span>
              <span>
                <span className="block text-[0.9rem] font-bold text-foreground">{t}</span>
                <span className="mt-0.5 block text-[0.78rem] text-ink-secondary">{d}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="relative flex items-center gap-2 text-[0.75rem] text-ink-muted">
          <Check className="size-4 text-emerald-400" />
          Free plan included — upgrade only when you grow.
        </div>
      </div>
    </div>
  );
}

export { SignUp1 };

export default SignUp1;
