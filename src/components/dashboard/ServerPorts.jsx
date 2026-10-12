import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, Network, RefreshCw } from 'lucide-react';

import { apiGet } from '@/lib/api.js';
import { cn } from '@/lib/utils';

/**
 * Connection address panel: the host port the platform allocated for this
 * server, the address to reach it on, and the state of the allocation. All of
 * it comes from the API (`GET /servers/:id/ports`) — nothing is guessed and
 * no port is shown that the backend has not actually allocated and published.
 */
export default function ServerPorts({ server, adminMode = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(null);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiGet(`/servers/${server.id}/ports`);
      setData(res);
    } catch (e) {
      setError(e?.message ?? 'Could not load the port information.');
      setData(null);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (server?.id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server?.id]);

  const address = data?.address ?? null;
  const ports = data?.ports ?? [];
  const pool = data?.pool ?? null;

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = document.createElement('textarea');
      t.value = text;
      document.body.appendChild(t);
      t.select();
      try { document.execCommand('copy'); } catch { /* clipboard unavailable */ }
      t.remove();
    }
    setCopied(key);
    setTimeout(() => setCopied(null), 1600);
  };

  return (
    <section className="rounded-2xl border border-hairline bg-card p-5" aria-label="Connection address">
      <header className="flex flex-wrap items-center gap-2">
        <Network className="size-4 text-ink-muted" aria-hidden="true" />
        <h2 className="flex-1 text-[0.92rem] font-semibold">Connection address</h2>
        {busy && <Loader2 className="size-3.5 animate-spin text-ink-muted" aria-hidden="true" />}
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 text-[0.7rem] font-bold text-ink-secondary transition hover:text-foreground"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Refresh
        </button>
      </header>

      {error ? (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-hairline bg-veil px-3 py-2.5 text-[0.82rem] text-ink-secondary" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : !address ? (
        <div className="mt-4 rounded-lg border border-dashed border-hairline px-4 py-6 text-center">
          <p className="text-[0.88rem] font-bold text-foreground">No published port</p>
          <p className="mx-auto mt-1 max-w-md text-[0.8rem] text-ink-secondary">
            This server has no host port allocated, so nothing outside the platform can connect to it. Restarting the
            server after it was created by the platform allocates one automatically.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-4">
            <div className="min-w-0">
              <p className="text-[0.78rem] font-semibold text-ink-secondary">Address</p>
              <p className="mt-1.5 font-mono text-[1.35rem] leading-none font-extrabold break-all text-foreground tabular-nums" dir="ltr">
                <span className="text-ink-muted">http://</span>{address.host}:{address.port}
              </p>
              <p className="mt-2 text-[0.75rem] text-ink-muted">
                Plain HTTP on a custom port — open it with <code className="font-mono">http://</code> explicitly, otherwise
                browsers try <code className="font-mono">https://</code> and fail (there is no TLS certificate on custom
                ports, same as any game-server panel).
              </p>
              <p className="mt-1.5 text-[0.75rem] text-ink-muted">
                {address.protocol.toUpperCase()} · your app must listen on port{' '}
                <span className="font-mono">{ports[0]?.containerPort ?? '—'}</span> inside the container
                (e.g. <code className="font-mono">process.env.PORT</code>) — the platform maps it to this address
                automatically. <code className="font-mono">SERVER_PORT</code> only tells your code this public
                number for display (invite links, status pages); binding it hangs.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => copy(`http://${address.host}:${address.port}`, 'addr')}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[0.78rem] font-bold transition',
                  copied === 'addr'
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-white text-black hover:bg-white/90'
                )}
              >
                {copied === 'addr' ? <Check className="size-3.5" aria-hidden="true" /> : null}
                {copied === 'addr' ? 'Copied' : 'Copy address'}
              </button>
              <button
                type="button"
                onClick={() => copy(String(address.port), 'port')}
                className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3.5 py-1.5 text-[0.78rem] font-bold text-ink-secondary transition hover:text-foreground"
              >
                {copied === 'port' ? <Check className="size-3.5" aria-hidden="true" /> : null}
                Copy port
              </button>
            </div>
          </div>

          {pool && (
            <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-hairline pt-4 text-[0.8rem] sm:grid-cols-4">
              <div>
                <dt className="text-ink-muted">Port state</dt>
                <dd className="mt-0.5 font-bold text-foreground">Allocated</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Port</dt>
                <dd className="mt-0.5 font-mono font-bold text-foreground tabular-nums" dir="ltr">
                  {address.port}
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">Pool used</dt>
                <dd className="mt-0.5 font-bold text-foreground tabular-nums">
                  {pool.used}/{pool.capacity}
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">Allowed range</dt>
                <dd className="mt-0.5 font-mono font-bold text-foreground tabular-nums" dir="ltr">
                  {pool.from}–{pool.to}
                </dd>
              </div>
            </dl>
          )}

          {!adminMode && pool && pool.free <= 5 && (
            <p className="mt-4 text-[0.78rem] text-amber-300">
              Only {pool.free} port(s) left on this node — new servers will start failing to allocate.
            </p>
          )}
        </>
      )}
    </section>
  );
}
