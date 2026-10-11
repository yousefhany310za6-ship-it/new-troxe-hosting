import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Cpu, Loader2, RefreshCw } from 'lucide-react';

import { apiGet, apiPost } from '@/lib/api.js';
import { cn } from '@/lib/utils';

const inputClass =
    'w-full rounded-xl border border-hairline bg-white/10 px-4 py-2.5 text-[0.88rem] text-foreground placeholder-ink-muted transition focus:border-primary focus:ring-2 focus:ring-ring/40 focus:outline-none';

/**
 * Runtime switching.
 *
 * The list of runtimes and versions comes from the platform's own allowlist
 * (GET /servers/runtimes/catalog) — the client can never name an image. Before
 * anything is applied the user sees exactly what will change and what may
 * break (from the server's own answer), and the files in the server are never
 * touched: only the image and the runtime settings are re-derived.
 */
export default function RuntimeSwitcher({ server, onChanged }) {
    const [catalog, setCatalog] = useState(null);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const [draft, setDraft] = useState(null); // { runtime, version, startupMode, warnings }

    useEffect(() => {
        let alive = true;
        apiGet('/servers/runtimes/catalog')
            .then((rows) => { if (alive) setCatalog(Array.isArray(rows) ? rows : []); })
            .catch(() => { if (alive) setCatalog([]); });
        return () => { alive = false; };
    }, []);

    const current = catalog?.find((r) => r.runtime === server.runtime) ?? null;
    const currentVersion = server.runtimeVersion
        ? current?.versions?.find((v) => v.image === server.runtimeVersion)?.version ?? null
        : current?.versions?.[0]?.version ?? null;

    const openDraft = () => {
        setResult(null);
        setError(null);
        setDraft({
            runtime: server.runtime,
            version: currentVersion ?? current?.versions?.[0]?.version ?? '',
            startupMode: 'recommended',
        });
    };

    const apply = async () => {
        if (!draft) return;
        setBusy(true);
        setError(null);
        try {
            const res = await apiPost(`/servers/${server.id}/runtime`, {
                runtime: draft.runtime,
                version: draft.version || undefined,
                startupMode: draft.startupMode,
            });
            setResult(res);
            setDraft(null);
            onChanged?.();
        } catch (e) {
            setError(e?.message ?? 'Could not change the runtime.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="flex flex-col gap-4 rounded-2xl border border-hairline bg-card p-5 sm:p-6" aria-label="Runtime">
            <header className="flex flex-wrap items-center gap-2">
                <Cpu className="size-4 text-ink-muted" aria-hidden="true" />
                <h2 className="flex-1 text-[0.95rem] font-semibold">Runtime</h2>
                <button
                    type="button"
                    onClick={openDraft}
                    className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3.5 py-1.5 text-[0.78rem] font-bold text-ink-secondary transition hover:text-foreground"
                >
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                    Change runtime
                </button>
            </header>

            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
                <div>
                    <p className="text-[0.78rem] text-ink-muted">Runtime</p>
                    <p className="mt-0.5 text-[0.95rem] font-bold text-foreground">{server.runtimeLabel ?? server.runtime}</p>
                </div>
                <div>
                    <p className="text-[0.78rem] text-ink-muted">Version</p>
                    <p className="mt-0.5 font-mono text-[0.95rem] font-bold text-foreground" dir="ltr">
                        {currentVersion ?? '—'}
                    </p>
                </div>
                <div>
                    <p className="text-[0.78rem] text-ink-muted">Main file</p>
                    <p className="mt-0.5 font-mono text-[0.95rem] font-bold text-foreground" dir="ltr">
                        {server.mainFile ?? '—'}
                    </p>
                </div>
            </div>

            {error && (
                <p className="flex items-center gap-2 rounded-lg border border-hairline bg-veil px-3.5 py-2.5 text-[0.82rem] text-ink-secondary" role="alert">
                    <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                    {error}
                </p>
            )}

            {result?.status === 'error' && (
                <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3.5 py-2.5 text-[0.82rem] text-red-200" role="alert">
                    The runtime changed but the server failed to start: {result.error}
                </p>
            )}

            {result?.status === 'online' && (
                <p className="rounded-lg border border-hairline bg-veil px-3.5 py-2.5 text-[0.82rem] text-emerald-300" role="status">
                    Runtime switched and the server is running.
                </p>
            )}

            {draft && (
                <div className="flex flex-col gap-4 rounded-xl border border-hairline bg-veil/60 p-4">
                    <p className="text-[0.84rem] font-semibold text-foreground">
                        Changing the runtime rebuilds the container with a different image. Your files stay exactly where they
                        are — they are never deleted.
                    </p>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <label className="block">
                            <span className="mb-1.5 block text-[0.82rem] font-semibold text-ink-secondary">New runtime</span>
                            <select
                                value={draft.runtime}
                                onChange={(e) => setDraft({ ...draft, runtime: e.target.value, version: catalog?.find((r) => r.runtime === e.target.value)?.versions?.[0]?.version ?? '' })}
                                className={inputClass}
                            >
                                {(catalog ?? []).map((r) => (
                                    <option key={r.runtime} value={r.runtime}>{r.label}</option>
                                ))}
                            </select>
                        </label>
                        <label className="block">
                            <span className="mb-1.5 block text-[0.82rem] font-semibold text-ink-secondary">Version</span>
                            <select
                                value={draft.version}
                                onChange={(e) => setDraft({ ...draft, version: e.target.value })}
                                className={inputClass}
                            >
                                {(catalog?.find((r) => r.runtime === draft.runtime)?.versions ?? []).map((v) => (
                                    <option key={v.version} value={v.version}>{v.label}</option>
                                ))}
                            </select>
                        </label>
                    </div>

                    <fieldset className="flex flex-col gap-2">
                        <legend className="text-[0.82rem] font-semibold text-ink-secondary">Startup command</legend>
                        {[
                            { value: 'recommended', label: 'Use the recommended startup for this runtime' },
                            { value: 'keep', label: 'Keep my current startup command' },
                        ].map((o) => (
                            <label key={o.value} className="flex cursor-pointer items-center gap-2 text-[0.84rem]">
                                <input
                                    type="radio"
                                    name="startup-mode"
                                    value={o.value}
                                    checked={draft.startupMode === o.value}
                                    onChange={() => setDraft({ ...draft, startupMode: o.value })}
                                    className="size-3.5 accent-white"
                                />
                                {o.label}
                            </label>
                        ))}
                        <p className="text-[0.75rem] text-ink-muted">
                            Your environment variables (tokens, secrets) are always kept — only the previous runtime's own
                            variables are dropped.
                        </p>
                    </fieldset>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => setDraft(null)}
                            className="rounded-full border border-hairline px-4 py-2 text-[0.82rem] font-bold text-ink-secondary transition hover:text-foreground"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={apply}
                            className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[0.82rem] font-bold text-black transition hover:bg-white/90 disabled:opacity-60"
                        >
                            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
                            Change runtime
                        </button>
                    </div>
                </div>
            )}

            {result?.warnings?.length > 0 && (
                <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3.5 py-3 text-[0.82rem] text-amber-200">
                    <p className="font-bold">Check these before your server works</p>
                    <ul className="mt-1.5 list-disc space-y-1 pl-5">
                        {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                </div>
            )}
        </section>
    );
}
