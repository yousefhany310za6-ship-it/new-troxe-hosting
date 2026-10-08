"use client";

import * as React from "react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertCircle, Eye, EyeOff, Lock, Mail, ShieldCheck } from "lucide-react";

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
        "relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden rounded-xl bg-transparent px-4 py-12",
        className
      )}
    >
      {/* Centered glass card */}
      <div className="relative z-10 flex w-full max-w-lg flex-col items-center rounded-3xl bg-gradient-to-r from-[#ffffff10] to-[#121212] p-10 shadow-2xl backdrop-blur-sm sm:p-12">
        {/* Site logo */}
        <div className="mb-5 flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl bg-black p-2 shadow-lg">
          <img src="./favicon.png" alt="Troxe Hosting logo" className="h-full w-full object-contain" />
        </div>
        {/* Title */}
        <h2 className="mb-2 text-center text-3xl font-semibold text-white">{brandName}</h2>
        <p className="mb-8 text-center text-base text-gray-400">Welcome back — sign in to continue</p>

        {/* Form */}
        <form onSubmit={handleSignIn} className="flex w-full flex-col gap-5">
          <div className="flex w-full flex-col gap-4">
            <label className="relative block">
              <Mail className="pointer-events-none absolute top-1/2 left-5 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <input
                placeholder="Email"
                type="email"
                autoComplete="email"
                value={email}
                className="w-full rounded-xl bg-white/10 py-4 pr-5 pl-13 text-base text-white placeholder-gray-300 focus:ring-2 focus:ring-gray-400 focus:outline-none"
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="relative block">
              <Lock className="pointer-events-none absolute top-1/2 left-5 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <input
                placeholder="Password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                className="w-full rounded-xl bg-white/10 py-4 pr-13 pl-13 text-base text-white placeholder-gray-300 focus:ring-2 focus:ring-gray-400 focus:outline-none"
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute top-1/2 right-4 -translate-y-1/2 rounded-full p-1 text-gray-400 transition hover:text-white"
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </label>
            <div className="flex justify-end">
              <Link to="/forgot-password" className="text-sm text-gray-400 underline hover:text-white">
                Forgot password?
              </Link>
            </div>
            {error && (
              <div className="flex items-center gap-2 text-sm text-red-400" role="alert">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}
            {success && !error && (
              <div className="text-sm text-emerald-400">Sign in successful! Redirecting…</div>
            )}
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-full bg-white px-5 py-4 text-base font-medium text-black shadow transition hover:bg-gray-200 disabled:opacity-60"
            >
              {pending ? "Signing in…" : "Sign in"}
            </button>
          </div>

          <hr className="opacity-10" />

          <div>
            {/* Google Sign In */}
            <button
              type="button"
              onClick={handleGoogle}
              className="mb-3 flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-b from-[#232526] to-[#2d2e30] px-5 py-4 text-base font-medium text-white shadow transition hover:brightness-110"
            >
              <GoogleIcon className="h-5 w-5" />
              Continue with Google
            </button>
            {/* Discord Sign In */}
            <button
              type="button"
              onClick={handleDiscord}
              className="mb-3 flex w-full items-center justify-center gap-2 rounded-full bg-[#5865F2] px-5 py-4 text-base font-medium text-white shadow transition hover:brightness-110"
            >
              <IconDiscordSm className="h-5 w-5" />
              Continue with Discord
            </button>
            <div className="mt-3 w-full text-center">
              <span className="text-sm text-gray-400">
                Don&apos;t have an account?{" "}
                <Link to="/signup" className="text-white/80 underline hover:text-white">
                  Sign up, it&apos;s free!
                </Link>
              </span>
            </div>
            <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-gray-500">
              <ShieldCheck className="h-4 w-4 text-gray-400" />
              Secured by Troxe
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export { SignIn1 };

export default SignIn1;
