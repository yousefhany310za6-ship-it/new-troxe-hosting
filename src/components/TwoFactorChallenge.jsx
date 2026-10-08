import { useState, useCallback } from "react";
import { ShieldCheck, RefreshCw } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

/**
 * 2FA challenge screen shown after password/OAuth verification when 2FA is enabled.
 * User enters a 6-digit TOTP code or a recovery code to complete login.
 */
export function TwoFactorChallenge({ challengeId, onComplete, onCancel, error: externalError }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (code.length < 6) return;
    setBusy(true);
    setError(null);
    try {
      await onComplete(challengeId, code);
    } catch (err) {
      setError(err.message || "Invalid code. Try again.");
      setCode("");
    } finally {
      setBusy(false);
    }
  }, [code, challengeId, onComplete]);

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-white/5">
        <ShieldCheck className="size-7 text-white" />
      </div>
      <div className="text-center">
        <h2 className="text-lg font-bold text-foreground">Two-factor authentication</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Enter the 6-digit code from your authenticator app, or a recovery code.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
        <InputOTP
          maxLength={6}
          value={code}
          onChange={setCode}
          containerClassName="w-full justify-between"
        >
          <InputOTPGroup className="flex w-full gap-2 *:aspect-square *:h-auto *:min-h-0 *:flex-1 *:rounded-lg *:border-l *:text-lg">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <InputOTPSlot key={i} index={i} />
            ))}
          </InputOTPGroup>
        </InputOTP>

        {(error || externalError) && (
          <p className="text-center text-xs text-red-400">{error || externalError}</p>
        )}

        <button
          type="submit"
          disabled={busy || code.length !== 6}
          className="inline-flex w-full items-center justify-center rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:bg-gray-200 disabled:opacity-50"
        >
          {busy ? <RefreshCw className="size-4 animate-spin" /> : "Verify"}
        </button>
      </form>

      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-ink-muted underline-offset-4 transition hover:text-foreground hover:underline"
        >
          Cancel and sign in with another method
        </button>
      )}
    </div>
  );
}
