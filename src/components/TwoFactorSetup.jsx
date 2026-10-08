import { useState, useRef, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Check, ShieldCheck, AlertTriangle, RefreshCw } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

/**
 * 2FA setup flow: QR code → manual key → TOTP verification → recovery codes.
 * Adapted from the shadcn two-factor-1 design to Troxe's dark theme.
 */
export function TwoFactorSetup({ setupData, onConfirm, onCancel, busy }) {
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [step, setStep] = useState("setup"); // "setup" | "recovery"
  const [recoveryCodes, setRecoveryCodes] = useState(null);

  const copySecret = useCallback(() => {
    navigator.clipboard.writeText(setupData.secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [setupData.secret]);

  const handleVerify = async () => {
    if (code.length !== 6) return;
    setError(null);
    try {
      const res = await onConfirm(code);
      setRecoveryCodes(res.recoveryCodes);
      setStep("recovery");
    } catch (err) {
      setError(err.message || "Invalid code. Try again.");
    }
  };

  if (step === "recovery" && recoveryCodes) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-400" />
          <div>
            <p className="text-sm font-semibold text-emerald-300">2FA enabled</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              Save these recovery codes in a safe place. Each code can be used once.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-hairline bg-black/40 p-3">
          {recoveryCodes.map((c, i) => (
            <code key={i} className="font-mono text-xs text-ink-secondary">{c}</code>
          ))}
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
          <p className="text-xs text-amber-200/80">
            If you lose your authenticator and these codes, you may lose access to your account.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="mt-1 inline-flex items-center justify-center rounded-full bg-white px-5 py-2 text-sm font-bold text-black transition hover:bg-gray-200"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* QR Code */}
      <div className="flex flex-col items-center gap-3">
        <div className="relative">
          <div className="flex size-40 items-center justify-center overflow-hidden rounded-2xl bg-white p-2 shadow-lg">
            <QRCodeSVG value={setupData.otpauthUrl} size={144} level="M" />
          </div>
          {/* Corner brackets */}
          <span className="pointer-events-none absolute -top-1 -left-1 size-5 border-t-2 border-l-2 border-ink-muted" />
          <span className="pointer-events-none absolute -top-1 -right-1 size-5 border-t-2 border-r-2 border-ink-muted" />
          <span className="pointer-events-none absolute -bottom-1 -left-1 size-5 border-b-2 border-l-2 border-ink-muted" />
          <span className="pointer-events-none absolute -right-1 -bottom-1 size-5 border-r-2 border-b-2 border-ink-muted" />
        </div>
      </div>

      {/* Manual key */}
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-ink-muted">Can&apos;t scan? Enter manually:</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-lg border border-hairline bg-black/40 px-3 py-2 font-mono text-xs text-ink-secondary">
            {setupData.secret}
          </code>
          <button
            type="button"
            onClick={copySecret}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-hairline text-ink-muted transition hover:border-hairline-hover hover:text-foreground"
            aria-label="Copy secret"
          >
            {copied ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
          </button>
        </div>
      </div>

      {/* TOTP input */}
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => { e.preventDefault(); handleVerify(); }}
      >
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

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex flex-1 items-center justify-center rounded-full border border-hairline px-5 py-2.5 text-sm font-bold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="inline-flex flex-1 items-center justify-center rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:bg-gray-200 disabled:opacity-50"
          >
            {busy ? <RefreshCw className="size-4 animate-spin" /> : "Verify & Enable"}
          </button>
        </div>
      </form>
    </div>
  );
}
