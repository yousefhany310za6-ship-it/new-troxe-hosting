import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, Loader2, Server as ServerIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { apiGet, apiPost } from '@/lib/api.js';
import { useRuntimeCatalog } from '@/hooks/useQueries.jsx';

const inputClass =
    'w-full rounded-xl border border-hairline bg-white/10 px-4 py-2.5 text-[0.88rem] text-foreground placeholder-ink-muted transition focus:border-primary focus:ring-2 focus:ring-ring/40 focus:outline-none';

const actionBtn =
    'inline-flex items-center gap-1.5 rounded-md border border-hairline bg-veil px-3 py-1.5 text-[0.8rem] font-semibold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40';

export default function CreateServer({ adminMode = false }) {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [name, setName] = useState('');
    const [runtime, setRuntime] = useState('Node.js');
    const [version, setVersion] = useState('');
    const [startup, setStartup] = useState('');
    const [vars, setVars] = useState({});
    const [env, setEnv] = useState([{ k: '', v: '' }]);
    const [autoRestart, setAutoRestart] = useState(true);
    const [autoBackup, setAutoBackup] = useState(true);
    const [msg, setMsg] = useState({ text: '', ok: true });
    const [creating, setCreating] = useState(false);
    // admin mode: the owner is required and explicit — never silently the admin
    const [ownerSearch, setOwnerSearch] = useState('');
    const [ownerOptions, setOwnerOptions] = useState([]);
    const [ownerId, setOwnerId] = useState('');

    const { data: catalog } = useRuntimeCatalog();
    const entry = (catalog ?? []).find((c) => c.runtime === runtime);
    const runtimeDefault = entry?.defaultStartup ?? '';

    // reset version + variables when the runtime changes
    useEffect(() => {
        if (!entry) return;
        setVersion((v) => (entry.versions.some((x) => x.version === v) ? v : (entry.versions[0]?.version ?? '')));
        setVars((prev) => {
            const next = {};
            for (const x of entry.variables) next[x.key] = prev[x.key] ?? x.defaultValue;
            return next;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [runtime, catalog]);

    // ?owner=<id> e.g. from the user-detail page — skip the picker entirely
    useEffect(() => {
        if (!adminMode) return;
        const preset = searchParams.get('owner');
        if (!preset) return;
        (async () => {
            try {
                const u = await apiGet(`/admin/users/${preset}`);
                setOwnerId(u.id);
                setOwnerSearch(`${u.name} <${u.email}>`);
            } catch { /* invalid id — fall back to picker */ }
        })();
    }, []);

    const searchOwners = async (term) => {
        setOwnerSearch(term);
        if (term.trim().length < 2) { setOwnerOptions([]); return; }
        try {
            const res = await apiGet(`/admin/users?search=${encodeURIComponent(term.trim())}&limit=5`);
            setOwnerOptions(res.data ?? []);
        } catch { setOwnerOptions([]); }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!name.trim()) {
            setMsg({ text: 'Server name is required.', ok: false });
            return;
        }
        if (!/^[a-z0-9-]{3,32}$/.test(name)) {
            setMsg({ text: 'Name must be 3-32 lowercase letters, digits, or dashes.', ok: false });
            return;
        }
        // startup is optional — the backend falls back to the runtime default
        if (adminMode && !ownerId) {
            setMsg({ text: 'Please select the owning user first.', ok: false });
            return;
        }
        for (const x of entry?.variables ?? []) {
            if (x.required && !(vars[x.key] ?? '').trim()) {
                setMsg({ text: `${x.name} (${x.key}) is required.`, ok: false });
                return;
            }
        }
        setCreating(true);
        setMsg({ text: '', ok: true });
        try {
            const varEnv = Object.entries(vars)
                .filter(([, v]) => v !== undefined && v !== '')
                .map(([k, v]) => ({ k, v }));
            const filteredEnv = [...varEnv, ...env.filter(r => r.k.trim() && r.v.trim())];
            const payload = {
                name: name.trim(),
                runtime,
                env: filteredEnv,
                autoRestart,
                autoBackup,
            };
            if (version) payload.version = version;
            if (startup.trim()) payload.startup = startup.trim();
            const res = adminMode
                ? await apiPost('/admin/servers', { ...payload, ownerId })
                : await apiPost('/servers', payload);
            setMsg({ text: 'Server created. Provisioning…', ok: true });
            setTimeout(() => navigate(adminMode ? '/admin/servers' : `/dashboard/servers/${res.id}`), 1000);
        } catch (err) {
            setMsg({ text: err.message, ok: false });
        } finally {
            setCreating(false);
        }
    };

    const backTo = adminMode ? '/admin/servers' : '/dashboard/servers';

    return (
        <div className="flex flex-col gap-6">
            <Link
                to={backTo}
                className="inline-flex w-fit items-center gap-1.5 text-[0.85rem] font-semibold text-ink-secondary transition hover:text-foreground"
            >
                <ArrowLeft className="size-4" /> {adminMode ? 'All servers' : 'All servers'}
            </Link>

            <div>
                <h1 className="text-[1.6rem] font-extrabold tracking-tight">{adminMode ? 'New server for user' : 'New server'}</h1>
                <p className="mt-1 text-[0.92rem] text-ink-secondary">
                    {adminMode ? 'Quotas apply to the owner\u2019s plan, not yours.' : 'Configure and provision a new sandbox.'}
                </p>
            </div>

            {msg.text && (
                <p className={cn('text-sm', msg.ok ? 'text-emerald-400' : 'text-red-400')}>{msg.text}</p>
            )}

            <form onSubmit={handleSubmit} className="rounded-xl border border-hairline bg-card p-6 space-y-6">
                {adminMode && (
                    <label className="flex flex-col gap-1.5 text-[0.85rem] font-semibold">
                        Owning user (required)
                        <input
                            value={ownerSearch}
                            onChange={(e) => searchOwners(e.target.value)}
                            placeholder="Type 2+ letters of name or email…"
                            className={inputClass}
                            disabled={creating}
                        />
                        {ownerOptions.length > 0 && (
                            <div className="overflow-hidden rounded-xl border border-hairline">
                                {ownerOptions.map((o) => (
                                    <button
                                        key={o.id}
                                        type="button"
                                        onClick={() => { setOwnerId(o.id); setOwnerSearch(`${o.name} <${o.email}>`); setOwnerOptions([]); }}
                                        className={cn('block w-full px-4 py-2 text-left font-mono text-[0.82rem] transition hover:bg-veil', ownerId === o.id && 'bg-veil')}
                                    >
                                        {o.name} &lt;{o.email}&gt;
                                    </button>
                                ))}
                            </div>
                        )}
                        {ownerId && <p className="font-mono text-[0.72rem] text-emerald-400">owner: {ownerId}</p>}
                    </label>
                )}
                <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
                    <label className="flex flex-col gap-1.5 text-[0.85rem] font-semibold">
                        Server name
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="my-app-1"
                            className={inputClass}
                            disabled={creating}
                        />
                        <p className="text-[0.75rem] text-ink-muted">3-32 chars, lowercase, digits, dashes</p>
                    </label>
                    <div className="grid grid-cols-2 gap-4">
                        <label className="flex flex-col gap-1.5 text-[0.85rem] font-semibold">
                            Runtime
                            <select
                                value={runtime}
                                onChange={(e) => setRuntime(e.target.value)}
                                className={inputClass}
                                disabled={creating}
                            >
                                {(catalog ?? []).map((c) => (
                                    <option key={c.runtime} value={c.runtime}>{c.label}</option>
                                ))}
                            </select>
                        </label>
                        <label className="flex flex-col gap-1.5 text-[0.85rem] font-semibold">
                            Version
                            <select
                                value={version}
                                onChange={(e) => setVersion(e.target.value)}
                                className={inputClass}
                                disabled={creating}
                            >
                                {(entry?.versions ?? []).map((v) => (
                                    <option key={v.version} value={v.version}>{v.label}</option>
                                ))}
                            </select>
                        </label>
                    </div>
                </div>

                {(entry?.variables ?? []).length > 0 && (
                    <div>
                        <p className="text-[0.85rem] font-semibold">Startup variables</p>
                        <p className="mt-0.5 text-[0.75rem] text-ink-muted">Usable as <span className="font-mono">{'{{KEY}}'}</span> in the startup command.</p>
                        <div className="mt-3 grid grid-cols-2 gap-4 max-md:grid-cols-1">
                            {(entry?.variables ?? []).map((x) => (
                                <label key={x.key} className="flex flex-col gap-1.5 text-[0.85rem] font-semibold">
                                    {x.name} <span className="font-mono text-[0.72rem] text-ink-muted">{x.key}{x.required ? ' (required)' : ''}</span>
                                    <input
                                        value={vars[x.key] ?? ''}
                                        onChange={(e) => setVars((prev) => ({ ...prev, [x.key]: e.target.value }))}
                                        placeholder={x.defaultValue}
                                        className={cn(inputClass, 'font-mono')}
                                        disabled={creating}
                                    />
                                    <span className="text-[0.72rem] font-normal text-ink-muted">{x.description}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                )}

                <label className="flex flex-col gap-1.5 text-[0.85rem] font-semibold">
                    Startup command
                    <input
                        value={startup}
                        onChange={(e) => setStartup(e.target.value)}
                        placeholder={runtimeDefault}
                        className={cn(inputClass, 'font-mono')}
                        disabled={creating}
                    />
                    <p className="text-[0.75rem] text-ink-muted">
                        Optional — defaults to <span className="font-mono">{runtimeDefault}</span>. Supports <span className="font-mono">{'{{VARIABLE}}'}</span> placeholders. Must stay in foreground.
                    </p>
                </label>

                <div>
                    <div className="flex items-center justify-between">
                        <p className="text-[0.85rem] font-semibold">Environment variables</p>
                        <button
                            type="button"
                            onClick={() => setEnv((rows) => [...rows, { k: '', v: '' }])}
                            disabled={creating}
                            className={actionBtn}
                        >
                            <Plus className="size-3.5" /> Add variable
                        </button>
                    </div>
                    <p className="mt-1 text-[0.75rem] text-ink-muted">Values are encrypted at rest. Keys must be alphanumeric/underscore starting with a letter.</p>
                    <div className="mt-3 flex flex-col gap-2">
                        {env.map((row, i) => (
                            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 max-md:grid-cols-1">
                                <input
                                    placeholder="KEY"
                                    value={row.k}
                                    onChange={(e) => setEnv((rows) => rows.map((r, j) => (j === i ? { ...r, k: e.target.value } : r)))}
                                    className={cn(inputClass, 'font-mono')}
                                    disabled={creating}
                                />
                                <input
                                    placeholder="value"
                                    value={row.v}
                                    onChange={(e) => setEnv((rows) => rows.map((r, j) => (j === i ? { ...r, v: e.target.value } : r)))}
                                    className={cn(inputClass, 'font-mono')}
                                    disabled={creating}
                                />
                                <button
                                    type="button"
                                    aria-label="Remove variable"
                                    onClick={() => setEnv((rows) => rows.filter((_, j) => j !== i))}
                                    disabled={creating}
                                    className={cn(actionBtn, 'max-md:w-fit')}
                                >
                                    <Check className="size-3.5" /> Remove
                                </button>
                            </div>
                        ))}
                        {env.length === 0 && (
                            <p className="text-[0.85rem] text-ink-muted">No variables yet.</p>
                        )}
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                    <label className="flex cursor-pointer items-center gap-2 text-[0.88rem] font-semibold">
                        <input
                            type="checkbox"
                            checked={autoRestart}
                            onChange={(e) => setAutoRestart(e.target.checked)}
                            disabled={creating}
                            className="size-4 accent-white"
                        />
                        Auto-restart on crash
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-[0.88rem] font-semibold">
                        <input
                            type="checkbox"
                            checked={autoBackup}
                            onChange={(e) => setAutoBackup(e.target.checked)}
                            disabled={creating}
                            className="size-4 accent-white"
                        />
                        Daily automatic backups
                    </label>
                </div>

                <div className="flex items-center gap-4 pt-4 border-t border-hairline">
                    <button
                        type="submit"
                        disabled={creating}
                        className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-2.5 text-sm font-bold text-black transition hover:bg-gray-200 disabled:opacity-50"
                    >
                        {creating ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                        {creating ? 'Provisioning…' : 'Create server'}
                    </button>
                    <Link
                        to={backTo}
                        className="text-[0.88rem] font-semibold text-ink-secondary hover:text-foreground hover:underline hover:underline-offset-4"
                    >
                        Cancel
                    </Link>
                </div>
            </form>
        </div>
    );
}