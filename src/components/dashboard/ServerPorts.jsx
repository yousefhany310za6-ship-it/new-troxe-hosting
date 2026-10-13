import { useEffect, useState } from 'react';
import { AlertTriangle, Check, CircleAlert, CircleDot, Loader2, Network, RefreshCw, ShieldQuestion, Wrench } from 'lucide-react';

import { apiGet, apiPost } from '@/lib/api.js';
import { cn } from '@/lib/utils';

/**
 * Connection panel.
 *
 * Everything here comes from `GET /servers/:id/ports` and nothing is inferred
 * client-side. In particular it does NOT read `server.status` and print
 * "online" next to an address: a running container whose app never called
 * listen() is online, unreachable, and must not look healthy.
 *
 * The health block reports five SEPARATE facts, because they fail
 * independently and a single green badge cannot represent any of them:
 *
 *   allocated   the database holds a live allocation for this server
 *   published   docker has that host port bound, with this protocol
 *   running     the container is up
 *   listening   something actually accepted a connection inside the sandbox
 *   reachable   the published host port answered from the node itself
 *
 * `external` is reported as "not verified" and always will be: the node can
 * only ever measure a path that begins and ends inside itself.
 */
const FACTS = [
    { key: 'allocated', label: 'Port allocated', ok: 'Reserved for this server', bad: 'No port reserved' },
    { key: 'published', label: 'Published by Docker', ok: 'Bound on the host with the right protocol', bad: 'Not bound on the host' },
    { key: 'containerRunning', label: 'Container running', ok: 'The sandbox is up', bad: 'The sandbox is not running' },
    { key: 'containerListening', label: 'App listening', ok: 'Something is accepting connections inside the container', bad: 'Nothing is listening inside the container', unknown: 'Could not be measured' },
    { key: 'hostReachable', label: 'Host port reachable', ok: 'The published port answered from the node', bad: 'The published port did not answer', unknown: 'Cannot be measured for a remote node' },
];

export default function ServerPorts({ server, adminMode = false }) {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const [repairing, setRepairing] = useState(false);
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
    const health = data?.health ?? null;

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

    /** The one status word, derived from the worst fact rather than guessed. */
    const verdict = (() => {
        if (!health) return null;
        if (health.drift === 'missing') return { tone: 'bad', word: 'Not published', hint: health.note };
        if (health.allocated && health.published && health.containerRunning && health.containerListening === false)
            return { tone: 'bad', word: 'Not listening', hint: health.note };
        if (health.allocated && health.published && health.containerRunning && health.hostReachable === false)
            return { tone: 'bad', word: 'Unreachable', hint: health.note };
        if (health.allocated && health.published && health.containerRunning && health.containerListening && health.hostReachable === false)
            return { tone: 'bad', word: 'Unreachable', hint: health.note };
        if (health.allocated && health.published && health.containerRunning && health.containerListening && health.hostReachable !== false)
            return { tone: 'good', word: 'Reachable', hint: health.note };
        if (health.allocated && health.published && !health.containerRunning)
            return { tone: 'idle', word: 'Reserved', hint: health.note };
        return { tone: 'idle', word: 'Checking', hint: health.note };
    })();

    const repair = async () => {
        setRepairing(true);
        setError(null);
        try {
            const res = await apiPost(`/servers/${server.id}/ports/reconcile`);
            if (res?.ok === false) setError(res.reason);
            await load();
        } catch (e) {
            setError(e?.message ?? 'Could not re-apply the port.');
        } finally {
            setRepairing(false);
        }
    };

    return (
        <section className="console-card p-5" aria-label="Connection address">
            <header className="flex flex-wrap items-center gap-2">
                <Network className="size-4 text-ink-muted" aria-hidden="true" />
                <h2 className="flex-1 text-md font-semibold">Connection address</h2>
                {busy && <Loader2 className="size-3.5 animate-spin text-ink-muted" aria-hidden="true" />}
                <button type="button" onClick={load} className="btn btn-secondary btn-sm">
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                    Refresh
                </button>
            </header>

            {error ? (
                <p className="mt-4 flex items-start gap-2 rounded-lg border border-hairline bg-veil px-3 py-2.5 text-small text-ink-secondary" role="alert">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    {error}
                </p>
            ) : !address ? (
                <div className="mt-4 rounded-lg border border-dashed border-hairline px-4 py-6 text-center">
                    <p className="text-small font-bold text-foreground">No published port</p>
                    <p className="mx-auto mt-1 max-w-md text-tiny text-ink-secondary">
                        This server has no host port allocated, so nothing outside the platform can connect to it. Restarting the
                        server after it was created by the platform allocates one automatically.
                    </p>
                </div>
            ) : (
                <>
                    <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-4">
                        <div className="min-w-0">
                            <p className="text-tiny font-semibold text-ink-secondary">Address</p>
                            <p className="mt-1.5 font-mono text-display-lg leading-none font-extrabold break-all text-foreground tabular-nums" dir="ltr">
                                <span className="text-ink-muted">http://</span>{address.host}:{address.port}
                            </p>
                            <p className="mt-2 text-tiny text-ink-muted">
                                Plain HTTP on a custom port — open it with <code className="font-mono">http://</code> explicitly, otherwise
                                browsers try <code className="font-mono">https://</code> and fail (there is no TLS certificate on custom
                                ports, same as any game-server panel).
                            </p>
                            <p className="mt-1.5 text-tiny text-ink-muted">
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
                                    'btn btn-sm',
                                    copied === 'addr'
                                        ? 'border-emerald-500/30! bg-emerald-500/15 text-emerald-300'
                                        : 'btn-primary'
                                )}
                            >
                                {copied === 'addr' ? <Check className="size-3.5" aria-hidden="true" /> : null}
                                {copied === 'addr' ? 'Copied' : 'Copy address'}
                            </button>
                            <button
                                type="button"
                                onClick={() => copy(String(address.port), 'port')}
                                className="btn btn-secondary btn-sm"
                            >
                                {copied === 'port' ? <Check className="size-3.5" aria-hidden="true" /> : null}
                                Copy port
                            </button>
                        </div>
                    </div>

                    {/* ---- the part that used to be a lie ---- */}
                    {health && (
                        <div className="mt-5 border-t border-hairline pt-4">
                            <div className="flex flex-wrap items-center gap-2">
                                <p className="text-tiny font-semibold text-ink-secondary">Connection status</p>
                                {verdict && (
                                    <span
                                        className={cn(
                                            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.7rem] font-bold',
                                            verdict.tone === 'good' && 'bg-emerald-500/15 text-emerald-300',
                                            verdict.tone === 'bad' && 'bg-red-500/15 text-red-300',
                                            verdict.tone === 'idle' && 'bg-white/10 text-ink-secondary',
                                        )}
                                    >
                                        {verdict.tone === 'good' ? (
                                            <CircleDot className="size-3" aria-hidden="true" />
                                        ) : verdict.tone === 'bad' ? (
                                            <CircleAlert className="size-3" aria-hidden="true" />
                                        ) : (
                                            <CircleDot className="size-3" aria-hidden="true" />
                                        )}
                                        {verdict.word}
                                    </span>
                                )}
                                {repairing && <Loader2 className="size-3.5 animate-spin text-ink-muted" aria-hidden="true" />}
                            </div>

                            <ul className="mt-3 grid grid-cols-1 gap-1.5 text-tiny sm:grid-cols-2">
                                {FACTS.map((f) => {
                                    const v = health[f.key];
                                    const state = v === true ? 'ok' : v === false ? 'bad' : 'unknown';
                                    return (
                                        <li key={f.key} className="flex items-start gap-2">
                                            <span
                                                className={cn(
                                                    'mt-1 size-1.5 shrink-0 rounded-full',
                                                    state === 'ok' && 'bg-emerald-400',
                                                    state === 'bad' && 'bg-red-400',
                                                    state === 'unknown' && 'bg-ink-muted/60',
                                                )}
                                                aria-hidden="true"
                                            />
                                            <span className="min-w-0">
                                                <span className={cn('font-bold', state === 'ok' && 'text-foreground', state !== 'ok' && 'text-ink-secondary')}>
                                                    {f.label}
                                                </span>
                                                <span className="text-ink-muted">
                                                    {' — '}
                                                    {v === true ? f.ok : v === false ? f.bad : (f.unknown ?? 'Unknown')}
                                                </span>
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>

                            {verdict?.hint && (
                                <p
                                    className={cn(
                                        'mt-3 rounded-lg border border-hairline bg-veil px-3 py-2.5 text-tiny',
                                        verdict.tone === 'bad' ? 'text-red-200' : 'text-ink-secondary',
                                    )}
                                >
                                    {verdict.hint}
                                </p>
                            )}

                            <p className="mt-3 flex items-start gap-2 text-tiny text-ink-muted">
                                <ShieldQuestion className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                                <span>
                                    Reachability from the public internet is <strong className="font-bold text-ink-secondary">not verified</strong>{' '}
                                    here. This panel measures from the node itself; only a probe from a third network can settle
                                    reachability from the internet, and the platform does not claim otherwise.
                                </span>
                            </p>

                            {(health.drift || health.published === false) && (
                                <button
                                    type="button"
                                    onClick={repair}
                                    disabled={repairing}
                                    className="btn btn-secondary btn-sm mt-3"
                                >
                                    <Wrench className="size-3.5" aria-hidden="true" />
                                    {repairing ? 'Re-applying…' : 'Re-apply published port'}
                                </button>
                            )}
                        </div>
                    )}

                    {pool && (
                        <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-hairline pt-4 text-tiny sm:grid-cols-4">
                            <div>
                                <dt className="text-ink-muted">Port</dt>
                                <dd className="mt-0.5 font-mono font-bold text-foreground tabular-nums" dir="ltr">
                                    {address.port}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-ink-muted">Protocol</dt>
                                <dd className="mt-0.5 font-bold text-foreground">{address.protocol.toUpperCase()}</dd>
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
                        <p className="mt-4 text-tiny text-amber-300">
                            Only {pool.free} port(s) left on this node — new servers will start failing to allocate.
                        </p>
                    )}
                </>
            )}
        </section>
    );
}