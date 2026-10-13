import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Check, Hourglass, Loader2, ShieldCheck } from 'lucide-react';

import { apiGet } from '@/lib/api.js';
import { cn } from '@/lib/utils';

/**
 * Landing page for the return trip from Work.ink.
 *
 * It deliberately does NOTHING on arrival. The key in the query string is only
 * *held* here; it is never trusted, never rendered as verified and never
 * exchanged from this page. The user pastes it into the server's renewal panel
 * (or we prefill it), and the backend decides whether it is worth anything.
 *
 * Why not auto-submit? Because "the browser came back from work.ink" is
 * exactly the thing the brief says must not count as proof. Auto-submitting
 * would also make a reload replay the request.
 */
export default function RenewalReturn() {
  const [params] = useSearchParams();
  const session = params.get('session') ?? '';
  const key = params.get('key') ?? '';
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(!!session);

  useEffect(() => {
    if (!session) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    apiGet(`/renewal/renewal/return?session=${encodeURIComponent(session)}`)
      .then((res) => {
        if (!cancelled) setInfo(res);
      })
      .catch(() => {
        if (!cancelled) setInfo({ hasSession: true, sessionKnown: false, hasKey: !!key });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, key]);

  const serverPath = useMemo(() => {
    // the session row knows its server; until it resolves we cannot link deeper
    return info?.serverId ? `/dashboard/servers/${info.serverId}` : '/dashboard/servers';
  }, [info]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-10">
      <header className="flex flex-col gap-2 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-hairline bg-veil">
          <Hourglass className="size-6 text-ink-secondary" aria-hidden="true" />
        </span>
        <h1 className="text-display font-extrabold tracking-tight">Back from Work.ink</h1>
        <p className="text-body text-ink-secondary">
          {key
            ? 'Paste your key on the server page to claim the extra 24 hours.'
            : 'We did not receive a key. Open your server and start the renewal again.'}
        </p>
      </header>

      {loading ? (
        <p className="flex items-center justify-center gap-2 text-small text-ink-muted">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Checking your renewal…
        </p>
      ) : (
        <div className="console-card flex flex-col gap-4 p-5 sm:p-6">
          <dl className="flex flex-col gap-2 text-small">
            <Row label="Renewal attempt" value={session ? 'Found' : 'Missing'} ok={!!session} />
            <Row label="Belongs to you" value={info?.sessionKnown ? 'Yes' : 'No'} ok={!!info?.sessionKnown} />
            <Row label="Key received" value={key ? 'Yes' : 'No'} ok={!!key} />
          </dl>

          {key ? (
            <div className="flex flex-col gap-2">
              <span className="text-tiny font-semibold text-ink-secondary">Your key</span>
              <code className="block break-all rounded-xl border border-hairline bg-veil px-3 py-2 font-mono text-tiny">
                {key}
              </code>
              <p className="text-micro text-ink-muted">
                Copy it into the renewal panel on your server page. It is only accepted there, and only once.
              </p>
            </div>
          ) : (
            <p className="flex items-start gap-2 rounded-xl border border-hairline bg-veil px-4 py-3 text-tiny text-ink-secondary">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>No key came back with the redirect. Start the renewal again to get a fresh link.</span>
            </p>
          )}

          <p className="flex items-start gap-2 border-t border-hairline pt-4 text-micro text-ink-muted">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              Coming back from Work.ink does not by itself renew anything. Your server is extended only after our backend has
              verified the key directly with Work.ink.
            </span>
          </p>

          <Link to={serverPath} className="btn btn-primary w-fit">
            <Check className="size-4" aria-hidden="true" /> Go to my server
          </Link>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, ok }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={cn('font-mono text-tiny', ok ? 'text-foreground' : 'text-ink-muted')}>{value}</dd>
    </div>
  );
}