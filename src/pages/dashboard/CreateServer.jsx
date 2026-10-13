import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
    AlertTriangle,
    ArrowLeft,
    ArrowRight,
    Check,
    Cpu,
    Loader2,
    Plus,
    Server as ServerIcon,
    Trash2,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { apiGet, apiPost } from '@/lib/api.js';
import { useCreateLimits, useRuntimeCatalog } from '@/hooks/useQueries.jsx';
import { useAdminUserCreateLimits } from '@/hooks/useAdminQueries.jsx';
import { useToast } from '@/hooks/useToast.jsx';
import { Select } from '@/components/ui/select.jsx';
import ResourcePicker, { RESOURCE_META, ResourceGauge, formatResource } from '@/components/dashboard/ResourcePicker.jsx';
import { IconBun, IconNode, IconPhp, IconPython } from '@/components/icons.jsx';

const RUNTIME_ICONS = { 'Node.js': IconNode, Bun: IconBun, Python: IconPython, PHP: IconPhp };

const STEPS = [
    { id: 'basics', title: 'Basics', hint: 'Name & runtime' },
    { id: 'resources', title: 'Resources', hint: 'CPU, memory, storage' },
    { id: 'startup', title: 'Startup', hint: 'Command & variables' },
];

const NAME_RE = /^[a-z0-9-]{3,32}$/;

const inputClass = 'input-field';
const labelClass = 'mb-1.5 block text-small font-semibold text-foreground';
const hintClass = 'mt-1.5 block text-tiny text-ink-muted';
const actionBtn =
    'btn btn-secondary btn-sm';

/**
 * New server — a three-step wizard (Basics → Resources → Startup) with a live
 * summary rail.
 *
 * The resource step is driven entirely by the limits endpoint: the plan's
 * per-server ceiling and the account pool (what the owner's other servers
 * already hold) both come from the API, so the UI can never offer a number the
 * backend would refuse with QUOTA_*.
 */
export default function CreateServer({ adminMode = false }) {
    const navigate = useNavigate();
    const toast = useToast();
    const [searchParams] = useSearchParams();

    const [step, setStep] = useState(0);
    const [name, setName] = useState('');
    const [runtime, setRuntime] = useState('Node.js');
    const [version, setVersion] = useState('');
    const [startup, setStartup] = useState('');
    const [vars, setVars] = useState({});
    const [env, setEnv] = useState([{ k: '', v: '' }]);
    const [autoRestart, setAutoRestart] = useState(true);
    const [autoBackup, setAutoBackup] = useState(true);
    const [res, setRes] = useState(null);
    const [msg, setMsg] = useState({ text: '', ok: true });
    const [creating, setCreating] = useState(false);

    // admin mode: the owner is required and explicit — never silently the admin
    const [ownerSearch, setOwnerSearch] = useState('');
    const [ownerOptions, setOwnerOptions] = useState([]);
    const [ownerId, setOwnerId] = useState('');
    const [override, setOverride] = useState(false);

    const { data: catalog } = useRuntimeCatalog();
    // in admin mode the ceilings come from the OWNER's plan, so the admin's own
  // limits are never fetched.
  const { data: myLimits } = useCreateLimits(!adminMode);
    const { data: ownerLimits } = useAdminUserCreateLimits(adminMode ? ownerId : undefined);
    const limits = adminMode ? ownerLimits : myLimits;

    const entry = (catalog ?? []).find((c) => c.runtime === runtime);
    const runtimeDefault = entry?.defaultStartup ?? '';
    const backTo = adminMode ? '/admin/servers' : '/dashboard/servers';

    // Seed the picker from the API's suggestion as soon as it arrives.
    useEffect(() => {
        if (!limits?.defaults) return;
        setRes((prev) => prev ?? { ...limits.defaults });
    }, [limits?.defaults]);

    // A different owner means different ceilings — re-seed once.
    useEffect(() => {
        if (adminMode && ownerId && limits?.defaults) setRes({ ...limits.defaults });
    }, [ownerId, adminMode, limits?.defaults]);

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

    const problems = useMemo(() => {
        const out = {};
        if (adminMode && !ownerId) out.owner = 'Select the owning user first.';
        if (!name.trim()) out.name = 'Server name is required.';
        else if (!NAME_RE.test(name.trim())) out.name = '3–32 characters: lowercase letters, digits or dashes.';
        for (const x of entry?.variables ?? []) {
            if (x.required && !(vars[x.key] ?? '').trim()) out[`var_${x.key}`] = `${x.name} is required.`;
        }
        return out;
    }, [adminMode, ownerId, name, entry, vars]);

    const stepValid = (i) => {
        if (i === 0) return !problems.owner && !problems.name;
        if (i === 1) return !!res && !limits?.servers?.exhausted;
        return true;
    };

    const next = () => {
        if (step === 0 && (problems.owner || problems.name)) {
            setMsg({ text: problems.owner ?? problems.name, ok: false });
            return;
        }
        setMsg({ text: '', ok: true });
        setStep((s) => Math.min(STEPS.length - 1, s + 1));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (adminMode && !ownerId) {
            setStep(0);
            setMsg({ text: 'Please select the owning user first.', ok: false });
            return;
        }
        if (!name.trim() || !NAME_RE.test(name.trim())) {
            setStep(0);
            setMsg({ text: 'Server name must be 3-32 lowercase letters, digits or dashes.', ok: false });
            return;
        }
        for (const x of entry?.variables ?? []) {
            if (x.required && !(vars[x.key] ?? '').trim()) {
                setStep(2);
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
            const filteredEnv = [...varEnv, ...env.filter((r) => r.k.trim() && r.v.trim())];
            const payload = {
                name: name.trim(),
                runtime,
                env: filteredEnv,
                autoRestart,
                autoBackup,
                ...(res ? { cpuMilli: res.cpuMilli, ramMb: res.ramMb, storageGb: res.storageGb } : {}),
            };
            if (version) payload.version = version;
            if (startup.trim()) payload.startup = startup.trim();
            const created = adminMode
                ? await apiPost('/admin/servers', { ...payload, ownerId, ...(override ? { resourcesOverride: true } : {}) })
                : await apiPost('/servers', payload);
            toast.success('Server created — provisioning…');
            navigate(adminMode ? '/admin/servers' : `/dashboard/servers/${created.id}`);
        } catch (err) {
            setMsg({ text: err.message, ok: false });
            toast.error(err.message);
            // a QUOTA_* refusal means the limits moved — refresh them
            if (/^QUOTA_|STORAGE_BELOW_USAGE/.test(err.code ?? '')) {
                setStep(adminMode && !ownerId ? 0 : 1);
            }
        } finally {
            setCreating(false);
        }
    };

    const RuntimeIcon = RUNTIME_ICONS[runtime];

    return (
        <div className="flex flex-col gap-5">
            <Link to={backTo} className="inline-flex w-fit items-center gap-1.5 text-small font-semibold text-ink-secondary transition hover:text-foreground">
                <ArrowLeft className="size-4" /> All servers
            </Link>

            <header>
                <h1 className="text-display font-extrabold tracking-tight">{adminMode ? 'New server for a user' : 'Create a server'}</h1>
                <p className="mt-1 text-body text-ink-secondary">
                    {adminMode
                        ? 'Quotas apply to the owner\u2019s plan, not yours.'
                        : 'Pick a runtime, size it to your plan, then set the startup command.'}
                </p>
            </header>

            <ol className="flex flex-wrap items-center gap-2" aria-label="Progress">
                {STEPS.map((s, i) => {
                    const state = i === step ? 'current' : i < step ? 'done' : 'todo';
                    return (
                        <li key={s.id} className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => i < step && setStep(i)}
                                disabled={i > step}
                                aria-current={state === 'current' ? 'step' : undefined}
                                className={cn(
                                    'flex items-center gap-2 rounded-xl border px-3 py-1.5 text-left transition',
                                    state === 'current' && 'border-white/40 bg-white/10',
                                    state === 'done' && 'border-hairline bg-veil hover:border-hairline-hover',
                                    state === 'todo' && 'border-hairline bg-transparent opacity-60',
                                )}
                            >
                                <span
                                    className={cn(
                                        'flex size-5 shrink-0 items-center justify-center rounded-full border font-mono text-micro',
                                        state === 'done' ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300' : 'border-hairline text-ink-secondary',
                                    )}
                                >
                                    {state === 'done' ? <Check className="size-3" /> : i + 1}
                                </span>
                                <span className="text-tiny font-bold">{s.title}</span>
                                <span className="hidden text-micro text-ink-muted sm:inline">{s.hint}</span>
                            </button>
                            {i < STEPS.length - 1 && <ArrowRight className="size-3.5 text-ink-muted" aria-hidden="true" />}
                        </li>
                    );
                })}
            </ol>

            <form onSubmit={handleSubmit} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
                <div className="console-card flex flex-col gap-5 p-5 sm:p-6">
                    {msg.text && (
                        <p className={cn('flex items-start gap-2 text-small', msg.ok ? 'text-emerald-300' : 'text-red-300')} role="status">
                            {!msg.ok && <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
                            {msg.text}
                        </p>
                    )}

                    {step === 0 && (
                        <section className="flex flex-col gap-5">
                            {adminMode && (
                                <div className="flex flex-col gap-1.5">
                                    <span className={labelClass}>Owning user (required)</span>
                                    <input
                                        value={ownerSearch}
                                        onChange={(e) => searchOwners(e.target.value)}
                                        placeholder="Type 2+ letters of name or email…"
                                        className={inputClass}
                                        disabled={creating}
                                        aria-invalid={!!problems.owner}
                                    />
                                    {ownerOptions.length > 0 && (
                                        <div className="mt-1 overflow-hidden rounded-xl border border-hairline">
                                            {ownerOptions.map((o) => (
                                                <button
                                                    key={o.id}
                                                    type="button"
                                                    onClick={() => {
                                                        setOwnerId(o.id);
                                                        setOwnerSearch(`${o.name} <${o.email}>`);
                                                        setOwnerOptions([]);
                                                    }}
                                                    className={cn(
                                                        'block w-full px-4 py-2 text-left font-mono text-tiny transition hover:bg-veil',
                                                        ownerId === o.id && 'bg-veil',
                                                    )}
                                                >
                                                    {o.name} &lt;{o.email}&gt;
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    {ownerId ? (
                                        <p className="font-mono text-micro text-emerald-300">owner: {ownerId}</p>
                                    ) : (
                                        <p className={hintClass}>{problems.owner ?? 'The server is created for this account, with their quotas.'}</p>
                                    )}
                                </div>
                            )}

                            <label className="block">
                                <span className={labelClass}>Server name</span>
                                <input
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="my-app-1"
                                    className={cn(inputClass, 'font-mono')}
                                    disabled={creating}
                                    aria-invalid={!!problems.name}
                                />
                                <span className={hintClass}>
                                    {problems.name ?? '3–32 characters: lowercase letters, digits or dashes. Must be unique on the account.'}
                                </span>
                            </label>

                            <div className="grid gap-4 sm:grid-cols-2">
                                <div>
                                    <span className={labelClass}>Runtime</span>
                                    <Select
                                        ariaLabel="Runtime"
                                        value={runtime}
                                        onChange={setRuntime}
                                        disabled={creating}
                                        loading={!catalog}
                                        searchable
                                        options={(catalog ?? []).map((c) => ({ value: c.runtime, label: c.label }))}
                                        className="w-full"
                                    />
                                </div>
                                <div>
                                    <span className={labelClass}>Version</span>
                                    <Select
                                        ariaLabel="Version"
                                        value={version}
                                        onChange={setVersion}
                                        disabled={creating || !entry}
                                        options={(entry?.versions ?? []).map((v) => ({ value: v.version, label: v.label }))}
                                        className="w-full"
                                    />
                                </div>
                            </div>
                        </section>
                    )}

                    {step === 1 && (
                        <section className="flex flex-col gap-4">
                            <header className="flex flex-wrap items-baseline justify-between gap-2">
                                <h2 className="text-lead font-semibold">Resources</h2>
                                {limits?.plan && (
                                    <p className="text-tiny text-ink-secondary">
                                        <span className="font-bold text-foreground">{limits.plan.name}</span> plan
                                        {adminMode && limits.plan.id !== 'free' ? ' (owner)' : ''} ·{' '}
                                        {limits.servers.max - limits.servers.used} of {limits.servers.max} servers free
                                    </p>
                                )}
                            </header>

                            {!adminMode || ownerId ? (
                                <ResourcePicker limits={limits?.resources} value={res} onChange={setRes} disabled={creating} />
                            ) : (
                                <p className="rounded-xl border border-hairline bg-veil px-4 py-3 text-small text-ink-secondary">
                                    Pick the owning user first — the plan decides these limits.
                                </p>
                            )}

                            {adminMode && ownerId && (
                                <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3.5 py-3">
                                    <input
                                        type="checkbox"
                                        checked={override}
                                        onChange={(e) => setOverride(e.target.checked)}
                                        disabled={creating}
                                        className="mt-0.5 size-4 accent-white"
                                    />
                                    <span className="text-tiny text-ink-secondary">
                                        <span className="font-bold text-foreground">Override the owner’s plan</span> — allow more than their
                                        quota (still capped by the platform maximum). Recorded in the audit log.
                                    </span>
                                </label>
                            )}

                            <p className="text-tiny text-ink-muted">
                                CPU and memory become hard container limits. You can change them later from the server’s settings;
                                changing them restarts the container (your files are never touched).
                            </p>
                        </section>
                    )}

                    {step === 2 && (
                        <section className="flex flex-col gap-5">
                            {(entry?.variables ?? []).length > 0 && (
                                <div>
                                    <p className={labelClass}>Startup variables</p>
                                    <p className={hintClass}>
                                        Usable as <span className="font-mono">{'{{KEY}}'}</span> in the startup command.
                                    </p>
                                    <div className="mt-3 grid gap-4 sm:grid-cols-2">
                                        {(entry?.variables ?? []).map((x) => (
                                            <label key={x.key} className="block">
                                                <span className="mb-1.5 block text-small font-semibold">
                                                    {x.name} <span className="font-mono text-micro text-ink-muted">{x.key}{x.required ? ' (required)' : ''}</span>
                                                </span>
                                                <input
                                                    value={vars[x.key] ?? ''}
                                                    onChange={(e) => setVars((prev) => ({ ...prev, [x.key]: e.target.value }))}
                                                    placeholder={x.defaultValue}
                                                    className={cn(inputClass, 'font-mono')}
                                                    disabled={creating}
                                                    aria-invalid={!!problems[`var_${x.key}`]}
                                                />
                                                <span className={hintClass}>{problems[`var_${x.key}`] ?? x.description}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <label className="block">
                                <span className={labelClass}>Startup command</span>
                                <input
                                    value={startup}
                                    onChange={(e) => setStartup(e.target.value)}
                                    placeholder={runtimeDefault}
                                    className={cn(inputClass, 'font-mono')}
                                    disabled={creating}
                                />
                                <span className={hintClass}>
                                    Optional — defaults to <span className="font-mono">{runtimeDefault}</span>. Must stay in the foreground.
                                </span>
                            </label>

                            <div>
                                <div className="flex items-center justify-between gap-2">
                                    <p className={labelClass}>Environment variables</p>
                                    <button type="button" onClick={() => setEnv((rows) => [...rows, { k: '', v: '' }])} disabled={creating} className={actionBtn}>
                                        <Plus className="size-3.5" /> Add variable
                                    </button>
                                </div>
                                <p className={hintClass}>Encrypted at rest. Keys start with a letter and use letters, digits or underscores.</p>
                                <div className="mt-3 flex flex-col gap-2">
                                    {env.map((row, i) => (
                                        <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 max-md:grid-cols-1">
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
                                                aria-label={`Remove variable ${row.k || i + 1}`}
                                                onClick={() => setEnv((rows) => rows.filter((_, j) => j !== i))}
                                                disabled={creating}
                                                className={cn(actionBtn, 'max-md:w-fit')}
                                            >
                                                <Trash2 className="size-3.5" /> Remove
                                            </button>
                                        </div>
                                    ))}
                                    {env.length === 0 && <p className="text-small text-ink-muted">No variables yet.</p>}
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-5">
                                <Toggle checked={autoRestart} onChange={setAutoRestart} disabled={creating} label="Restart automatically if it crashes" />
                                <Toggle checked={autoBackup} onChange={setAutoBackup} disabled={creating} label="Daily automatic backups" />
                            </div>
                        </section>
                    )}

                    <div className="flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
                        {step > 0 && (
                            <button type="button" onClick={() => setStep((s) => s - 1)} disabled={creating} className="btn btn-secondary">
                                <ArrowLeft className="size-4" /> Back
                            </button>
                        )}
                        {step < STEPS.length - 1 ? (
                            <button type="button" onClick={next} disabled={creating || !stepValid(step)} className="btn btn-primary">
                                Next <ArrowRight className="size-4" />
                            </button>
                        ) : (
                            <button type="submit" disabled={creating} className="btn btn-primary">
                                {creating ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                                {creating ? 'Provisioning…' : 'Create server'}
                            </button>
                        )}
                        <Link to={backTo} className="text-small font-semibold text-ink-secondary transition hover:text-foreground hover:underline hover:underline-offset-4">
                            Cancel
                        </Link>
                    </div>
                </div>

                <aside className="console-card flex flex-col gap-4 p-5 lg:sticky lg:top-6">
                    <h2 className="flex items-center gap-2 text-small font-bold tracking-wider text-ink-secondary uppercase">
                        <ServerIcon className="size-4" aria-hidden="true" /> Summary
                    </h2>

                    <dl className="flex flex-col gap-2 text-small">
                        <Row label="Name" value={name.trim() || '—'} mono />
                        <Row
                            label="Runtime"
                            value={version ? `${runtime} ${version}` : runtime || '—'}
                            icon={RuntimeIcon ? <RuntimeIcon className="size-3.5" /> : null}
                        />
                        <Row label="Plan" value={limits?.plan?.name ?? '—'} badge={limits?.plan?.id} />
                        <Row
                            label="Servers"
                            value={limits ? `${limits.servers.used}/${limits.servers.max} used` : '—'}
                        />
                    </dl>

                    <div className="flex flex-col gap-3 border-t border-hairline pt-4">
                        {res && limits?.resources ? (
                            Object.keys(RESOURCE_META).map((key) => (
                                <ResourceGauge
                                    key={key}
                                    label={RESOURCE_META[key].label}
                                    current={res[key] ?? 0}
                                    total={limits.resources[key].poolMax}
                                    format={(v) => formatResource(key, v)}
                                />
                            ))
                        ) : (
                            <p className="flex items-center gap-2 text-tiny text-ink-muted">
                                <Loader2 className="size-3.5 animate-spin" /> Loading your plan limits…
                            </p>
                        )}
                    </div>

                    {res && (
                        <p className="flex items-start gap-2 border-t border-hairline pt-4 text-micro text-ink-muted">
                            <Cpu className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                            <span>
                                Roughly {(res.cpuMilli / 1000).toFixed(2)} core and {formatResource('ramMb', res.ramMb)} reserved for this server.
                            </span>
                        </p>
                    )}
                </aside>
            </form>
        </div>
    );
}

function Row({ label, value, mono, icon, badge }) {
    return (
        <div className="flex items-baseline justify-between gap-3">
            <dt className="text-ink-muted">{label}</dt>
            <dd className={cn('flex min-w-0 items-center gap-1.5 truncate text-right font-semibold', mono && 'font-mono')}>
                {icon}
                {value}
                {badge && <span className="chip font-mono text-micro">{badge}</span>}
            </dd>
        </div>
    );
}

function Toggle({ checked, onChange, disabled, label }) {
    return (
        <label className="flex cursor-pointer items-center gap-2.5 text-small font-semibold">
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                disabled={disabled}
                className="size-4 accent-white"
            />
            {label}
        </label>
    );
}