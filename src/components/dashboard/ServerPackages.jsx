import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, HelpCircle, Loader2, Package, RefreshCw, Search, Trash2 } from 'lucide-react';

import { apiGet, apiPost } from '@/lib/api.js';
import { cn } from '@/lib/utils';

/**
 * Package manager for a server.
 *
 * Everything shown here is real: the manager comes from the server's runtime,
 * the installed list is read from the server's own manifest files inside the
 * container, and an install/remove runs the real package manager there. The
 * client only ever supplies a package NAME — no commands, no shell.
 */
export default function ServerPackages({ server }) {
    const [info, setInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [name, setName] = useState('');
    const [op, setOp] = useState(null); // { kind, name }
    const [result, setResult] = useState(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await apiGet(`/servers/${server.id}/packages`);
            setInfo(res);
        } catch (e) {
            setError(e?.message ?? 'Could not load the package list.');
            setInfo(null);
        } finally {
            setLoading(false);
        }
    }, [server.id]);

    useEffect(() => {
        if (server?.id) load();
    }, [server?.id, load]);

    const run = async (kind, pkg) => {
        const value = (pkg ?? name).trim();
        if (!value) return;
        setBusy(true);
        setOp({ kind, name: value });
        setResult(null);
        try {
            const res = await apiPost(`/servers/${server.id}/packages/${kind}`, { name: value });
            setResult({ ok: !!res?.ok, ...res });
            if (res?.ok) {
                setName('');
                await load();
            }
        } catch (e) {
            setResult({ ok: false, error: e?.message ?? 'The operation failed.' });
        } finally {
            setBusy(false);
        }
    };

    const packages = info?.packages ?? [];
    const manager = info?.manager ?? null;
    const managerLabel = manager === 'npm' ? 'npm' : manager === 'bun' ? 'bun' : manager === 'pip' ? 'pip' : manager === 'go' ? 'Go modules' : null;

    return (
        <section className="console-card flex flex-col gap-4 p-5 sm:p-6" aria-label="Package manager">
            <header className="flex flex-wrap items-center gap-2">
                <Package className="size-4 text-ink-muted" aria-hidden="true" />
                <h2 className="flex-1 text-lead font-semibold">Package manager</h2>
                {managerLabel && (
                    <span className="chip font-mono font-bold">
                        {managerLabel}
                    </span>
                )}
                <button
                    type="button"
                    onClick={load}
                    className="btn btn-secondary btn-sm"
                >
                    <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} aria-hidden="true" />
                    Refresh
                </button>
            </header>

            {!manager ? (
                <div className="rounded-lg border border-dashed border-hairline px-4 py-6 text-center">
                    <HelpCircle className="mx-auto size-5 text-ink-muted" aria-hidden="true" />
                    <p className="mt-2 text-small font-bold text-foreground">No package manager for this runtime</p>
                    <p className="mx-auto mt-1 max-w-md text-tiny text-ink-secondary">
                        This platform packages {server.runtime} projects with their own dependencies — upload your vendor files
                        from the Files tab instead.
                    </p>
                </div>
            ) : (
                <>
                    <form
                        onSubmit={(e) => { e.preventDefault(); run('install'); }}
                        className="flex flex-col gap-2 sm:flex-row sm:items-end"
                    >
                        <label className="min-w-0 flex-1">
                            <span className="mb-1.5 block text-small font-semibold text-ink-secondary">
                                Install a package with {managerLabel}
                            </span>
                            <span className="relative block">
                                <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
                                <input
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder={manager === 'pip' ? 'requests' : 'express'}
                                    className="input-field pl-9 font-mono"
                                    dir="ltr"
                                    maxLength={214}
                                    disabled={busy}
                                />
                            </span>
                        </label>
                        <button
                            type="submit"
                            disabled={busy || !name.trim()}
                            className="btn btn-primary h-11 shrink-0 px-5"
                        >
                            {busy && op?.kind === 'install' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Package className="size-4" aria-hidden="true" />}
                            Install
                        </button>
                    </form>

                    <p className="text-tiny text-ink-muted">
                        The server must be running. The command is run inside your own container with {managerLabel} — you only
                        choose the package.
                    </p>

                    {result && !result.ok && (
                        <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3.5 py-3 text-small text-amber-200" role="alert">
                            <p className="font-bold">
                                {result.error ? `Could not ${op?.kind === 'uninstall' ? 'remove' : 'install'} ${op?.name}` : `The operation failed${result.timedOut ? ' (timed out)' : ''}`}
                            </p>
                            {result.error && <p className="mt-1">{result.error}</p>}
                            {result.stderr && <pre className="mt-2 max-h-32 overflow-auto font-mono text-tiny whitespace-pre-wrap">{result.stderr.trim()}</pre>}
                            {!result.error && result.exitCode !== null && !result.timedOut && (
                                <p className="mt-1">Exit code {result.exitCode} — check the console for the full output.</p>
                            )}
                        </div>
                    )}

                    {result?.ok && (
                        <p className="rounded-lg border border-hairline bg-veil px-3.5 py-2.5 text-small text-emerald-300" role="status">
                            {op?.name} {op?.kind === 'uninstall' ? 'removed' : 'installed'} successfully.
                        </p>
                    )}

                    <div className="border-t border-hairline pt-4">
                        <div className="mb-3 flex items-center justify-between">
                            <h3 className="text-small font-semibold">Managed packages</h3>
                            <span className="text-tiny text-ink-muted">
                                {info?.manifest ? `from ${info.manifest}` : 'no manifest yet'}
                            </span>
                        </div>

                        {loading ? (
                            <div className="flex flex-col gap-2">
                                {[0, 1, 2].map((i) => <div key={i} className="h-11 animate-pulse rounded-xl border border-hairline bg-console" />)}
                            </div>
                        ) : error ? (
                            <p className="flex items-center gap-2 rounded-lg border border-hairline bg-veil px-3.5 py-3 text-small text-ink-secondary" role="alert">
                                <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                                {error}
                            </p>
                        ) : packages.length === 0 ? (
                            <p className="rounded-lg border border-dashed border-hairline px-4 py-8 text-center text-small text-ink-secondary">
                                No packages listed yet. Install one above, or add it to your{' '}
                                <span className="font-mono">{info?.manifest ?? 'manifest'}</span> from the Files tab.
                            </p>
                        ) : (
                            <ul className="flex flex-col gap-2">
                                {packages.map((p) => (
                                    <li
                                        key={`${p.name}@${p.version ?? ''}`}
                                        className="console-lift flex flex-wrap items-center gap-3 rounded-xl border border-hairline bg-veil/50 px-3.5 py-2.5"
                                    >
                                        <span className="min-w-0 flex-1 truncate font-mono text-small font-bold text-foreground" dir="ltr">
                                            {p.name}
                                        </span>
                                        {p.version && (
                                            <span className="rounded-full border border-hairline px-2 py-0.5 font-mono text-tiny text-ink-muted" dir="ltr">
                                                {p.version}
                                            </span>
                                        )}
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => run('uninstall', p.name)}
                                            className="btn btn-secondary btn-sm hover:border-red-500/40! hover:text-red-300!"
                                        >
                                            {busy && op?.kind === 'uninstall' && op?.name === p.name ? (
                                                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                                            ) : (
                                                <Trash2 className="size-3.5" aria-hidden="true" />
                                            )}
                                            Uninstall
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </>
            )}
        </section>
    );
}
