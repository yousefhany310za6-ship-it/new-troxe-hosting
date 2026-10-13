import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  Clock,
  Hourglass,
  Loader2,
  Lock,
  RefreshCw,
  Timer,
} from 'lucide-react';

import { apiGet, apiPost } from '@/lib/api.js';
import { cn } from '@/lib/utils';

/**
 * Free-plan renewal panel.
 *
 * Rules this component obeys:
 *  - it renders whatever the backend says and never decides eligibility itself;
 *  - it NEVER shows success before the backend confirms the grant — the only
 *    "renewed" copy appears after POST /renewal-sessions/:id/complete returns
 *    200 with an `expiresAt` the server issued;
 *  - the Work.ink URL always comes from the API. The browser cannot choose a
 *    destination, and no key/secret is ever handled here beyond the value
 *    Work.ink hands back on return;
 *  - buttons disable while a request is in flight, but that is a convenience —
 *    the server-side session/ledger uniqueness is what actually prevents a
 *    double renewal.
 */

const RENEWAL_KEYS = {
  status: (id) => ['renewal', 'status', id],
  history: (id) => ['renewal', 'history', id],
};

function fmtCountdown(minutes) {
  if (minutes === null || minutes === undefined) return null;
  if (minutes <= 0) return 'expired';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export function useRenewalStatus(serverId, enabled = true) {
  return useQuery({
    queryKey: RENEWAL_KEYS.status(serverId),
    queryFn: () => apiGet(`/renewal/servers/${serverId}/renewal`),
    enabled: !!serverId && enabled,
    refetchInterval: (q) => (q.state.data?.expiryState === 'expiring_soon' ? 30_000 : false),
  });
}

export function useRenewalHistory(serverId, enabled = true) {
  return useQuery({
    queryKey: RENEWAL_KEYS.history(serverId),
    queryFn: () => apiGet(`/renewal/servers/${serverId}/renewal-history`),
    enabled: !!serverId && enabled,
  });
}

/** POST the completion. The 200 body IS the confirmation. */
export function useCompleteRenewal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, token }) => apiPost(`/renewal/renewal-sessions/${sessionId}/complete`, { token }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['renewal'] });
      qc.invalidateQueries({ queryKey: ['servers'] });
      if (v?.serverId) qc.invalidateQueries({ queryKey: RENEWAL_KEYS.status(v.serverId) });
    },
  });
}

export function useStartRenewal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (serverId) => apiPost(`/renewal/servers/${serverId}/renewal-sessions`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['renewal'] }),
  });
}

const STEP_COPY = {
  idle: 'Start the renewal to get another 24 hours of runtime.',
  redirecting: 'Opening Work.ink — complete the steps there, then come back.',
  waiting: 'Waiting for you to return from Work.ink with your key.',
  verifying: 'Checking your key with Work.ink…',
  success: 'Renewed. Your server has another 24 hours.',
  failed: 'That did not work. Your server was not extended.',
  expired: 'This attempt timed out. Start a new one.',
  provider: 'We could not reach Work.ink. Your server was not extended — try again.',
  restart_issue: 'Renewed, but the server could not be started automatically.',
};

export default function RenewalPanel({ serverId, onRenewed, className }) {
  const { data, isLoading, error } = useRenewalStatus(serverId);
  const start = useStartRenewal();
  const complete = useCompleteRenewal();
  const [step, setStep] = useState('idle');
  const [key, setKey] = useState('');
  const [notice, setNotice] = useState(null);

  // a fresh backend answer always wins over the local step
  useEffect(() => {
    if (!data) return;
    if (data.expiryState !== 'expired' && step !== 'success' && step !== 'restart_issue') setStep('idle');
  }, [data, step]);

  if (isLoading) {
    return (
      <div className={cn('console-card flex items-center gap-2 p-4 text-small text-ink-muted', className)}>
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Checking your server’s runtime…
      </div>
    );
  }
  if (error || !data) return null;

  // Paid plans never expire — the panel has nothing to say.
  if (data.expiryState === 'not_expiring') return null;

  const expired = data.expiryState === 'expired';
  const soon = data.expiryState === 'expiring_soon';
  const countdown = fmtCountdown(data.server.minutesRemaining);
  const blocked = !data.provider.available;

  const doStart = async () => {
    setNotice(null);
    try {
      const res = await start.mutateAsync(serverId);
      setStep('redirecting');
      // The destination is chosen by the backend, never assembled here.
      if (res?.redirectUrl) window.location.assign(res.redirectUrl);
    } catch (e) {
      setStep('failed');
      setNotice(e.message);
    }
  };

  const doComplete = async () => {
    setNotice(null);
    setStep('verifying');
    try {
      const res = await complete.mutateAsync({ sessionId: data.session.id, token: key.trim() });
      // Success copy is only reachable because the backend returned a grant.
      setStep(res?.restarted === false ? 'restart_issue' : 'success');
      setKey('');
      onRenewed?.(res);
    } catch (e) {
      if (e.code === 'RENEWAL_PROVIDER_UNAVAILABLE') setStep('provider');
      else if (e.code === 'RENEWAL_SESSION_EXPIRED') setStep('expired');
      else setStep('failed');
      setNotice(e.message);
    }
  };

  return (
    <section className={cn('console-card flex flex-col gap-4 p-5', className)} aria-live="polite">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-lead font-semibold">
          {expired ? <Hourglass className="size-4 text-ink-muted" aria-hidden="true" /> : <Clock className="size-4 text-ink-muted" aria-hidden="true" />}
          Free-plan runtime
        </h2>
        <span
          className={cn(
            'rounded-full border px-2.5 py-0.5 text-tiny font-bold capitalize',
            expired
              ? 'border-white/30 bg-white/10 text-foreground'
              : soon
                ? 'border-hairline bg-veil text-ink-secondary'
                : 'border-hairline bg-veil text-ink-muted',
          )}
        >
          {expired ? 'expired' : `${countdown} left`}
        </span>
      </header>

      <dl className="grid grid-cols-1 gap-2 text-small sm:grid-cols-2">
        <div className="flex items-baseline justify-between gap-3 sm:block">
          <dt className="text-ink-muted">Expires</dt>
          <dd className="font-mono text-tiny sm:mt-0.5 sm:text-small">{fmtDate(data.server.expiresAt)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 sm:block">
          <dt className="text-ink-muted">Server status</dt>
          <dd className="font-mono text-tiny capitalize sm:mt-0.5 sm:text-small">
            {data.server.status}
            {data.server.suspendedReason === 'expired' ? ' (expired)' : ''}
          </dd>
        </div>
      </dl>

      {expired && (
        <p className="rounded-xl border border-hairline bg-veil px-4 py-3 text-tiny leading-relaxed text-ink-secondary">
          This server’s 24 hours are up, so it has been stopped. Everything in <span className="font-mono">/data</span> is
          kept — renewing brings it straight back.
        </p>
      )}

      {blocked && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-tiny text-ink-secondary">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            Renewals are switched off on this deployment right now. Your server and its files are safe — contact support if
            you need the runtime extended.
          </span>
        </p>
      )}

      {/* ---- the three states that matter ---- */}
      {expired && !data.session && (
        <div className="flex flex-col gap-3">
          <p className="text-small text-ink-secondary">{STEP_COPY.idle}</p>
          <ol className="flex flex-col gap-1.5 text-tiny text-ink-muted">
            <li className="flex gap-2">
              <span className="font-mono">1.</span> Start the renewal below.
            </li>
            <li className="flex gap-2">
              <span className="font-mono">2.</span> Complete the steps on Work.ink — you will be sent back here automatically.
            </li>
            <li className="flex gap-2">
              <span className="font-mono">3.</span> Paste the key you receive to claim 24 more hours.
            </li>
          </ol>
          <button
            type="button"
            onClick={doStart}
            disabled={start.isPending || blocked}
            className="btn btn-primary w-fit"
          >
            {start.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-4" aria-hidden="true" />}
            {start.isPending ? 'Starting…' : 'Start renewal'}
          </button>
        </div>
      )}

      {data.session && step !== 'success' && step !== 'restart_issue' && (
        <div className="flex flex-col gap-3">
          <p className="text-tiny text-ink-secondary">{STEP_COPY.waiting}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Paste the key from Work.ink"
              aria-label="Work.ink key"
              autoComplete="off"
              spellCheck={false}
              className="input-field font-mono"
              disabled={complete.isPending || blocked}
            />
            <button
              type="button"
              onClick={doComplete}
              disabled={complete.isPending || !key.trim() || blocked}
              className="btn btn-primary shrink-0"
            >
              {complete.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
              Verify
            </button>
          </div>
          <p className="flex items-center gap-1.5 text-micro text-ink-muted">
            <Timer className="size-3" aria-hidden="true" />
            This attempt expires at {fmtDate(data.session.expiresAt)}.
            {data.providerKeyTtlMinutes
              ? ` Work.ink keys stay valid for about ${data.providerKeyTtlMinutes} minutes — if yours expired, start again.`
              : ''}
          </p>
        </div>
      )}

      {step === 'success' && (
        <div className="rounded-xl border border-hairline bg-veil px-4 py-3">
          <p className="flex items-center gap-2 text-small font-semibold">
            <Check className="size-4" aria-hidden="true" /> Renewed for another 24 hours.
          </p>
          <p className="mt-1 text-tiny text-ink-secondary">New expiry: {fmtDate(data.server.expiresAt)}</p>
        </div>
      )}

      {step === 'restart_issue' && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3">
          <p className="flex items-center gap-2 text-small font-semibold">
            <AlertTriangle className="size-4" aria-hidden="true" /> Renewed, but the server did not start automatically.
          </p>
          <p className="mt-1 text-tiny text-ink-secondary">
            Your 24 hours are saved (new expiry {fmtDate(data.server.expiresAt)}). Start the server whenever you are ready —
            your files are untouched.
          </p>
        </div>
      )}

      {(step === 'failed' || step === 'expired' || step === 'provider') && (
        <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-veil px-4 py-3">
          <p className="flex items-start gap-2 text-tiny text-ink-secondary">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>{notice || STEP_COPY.failed}</span>
          </p>
          <button type="button" onClick={doStart} disabled={start.isPending || blocked} className="btn btn-secondary w-fit">
            <RefreshCw className="size-4" aria-hidden="true" />
            {start.isPending ? 'Starting…' : 'Try again'}
          </button>
        </div>
      )}

      {/* never-eligible copy is shown even before the server expires */}
      {!expired && data.plan?.lifetimeHours && (
        <p className="text-micro text-ink-muted">
          This plan’s servers run for {data.plan.lifetimeHours}h at a time and can be renewed while they are active.
        </p>
      )}

      <RenewalHistory serverId={serverId} />
    </section>
  );
}

function RenewalHistory({ serverId }) {
  const { data, isLoading } = useRenewalHistory(serverId);
  if (isLoading || !data?.length) return null;
  return (
    <details className="border-t border-hairline pt-4">
      <summary className="cursor-pointer text-tiny font-semibold text-ink-secondary">
        Renewal history ({data.length})
      </summary>
      <ul className="mt-3 flex flex-col gap-2">
        {data.map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 font-mono text-micro text-ink-muted">
            <span>+{r.hours}h</span>
            <span>{fmtDate(r.createdAt)}</span>
            <span className="tabular-nums">
              {fmtDate(r.expiresBefore)} → {fmtDate(r.expiresAfter)}
            </span>
            {!r.restarted && <span className="text-ink-secondary">(restart failed)</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}