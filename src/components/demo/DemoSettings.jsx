import { useEffect, useRef, useState } from 'react';
import { Cpu, RefreshCw, Save, Server as ServerIcon, Terminal, TriangleAlert, Wrench } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/useToast.jsx';
import { DEMO_RUNTIMES, DEMO_VERSIONS } from '@/data/demoData.js';

/* Class constants copied verbatim from ServerSettings.jsx. */
const inputClass =
    'w-full rounded-xl border border-hairline bg-white/10 px-4 py-2.5 text-[0.88rem] text-foreground placeholder-ink-muted transition focus:border-primary focus:ring-2 focus:ring-ring/40 focus:outline-none';
const labelClass = 'mb-1.5 block text-[0.85rem] font-semibold text-foreground';
const hintClass = 'mt-1.5 text-[0.75rem] text-ink-muted';

const submitBtn =
    'inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[0.84rem] font-bold text-black transition hover:bg-white/90 disabled:opacity-40';
const ghostBtn =
    'inline-flex items-center gap-1.5 rounded-full border border-hairline px-3.5 py-1.5 text-[0.78rem] font-bold text-ink-secondary transition hover:text-foreground';

const STARTUPS = ['node {{MAIN_FILE}}', 'bun {{MAIN_FILE}}', 'python3 {{MAIN_FILE}}'];

export default function DemoSettings({ settings, onSave }) {
    const toast = useToast();

    /* Drafts are local component state; nothing is submitted anywhere until
     * the visitor presses Save, and then it only updates the demo's own state. */
    const [draft, setDraft] = useState(settings);
    const [editingRuntime, setEditingRuntime] = useState(false);
    const [runtimeDraft, setRuntimeDraft] = useState(settings);
    const [msg, setMsg] = useState(null);

    /* The runtime panel writes straight to the shared demo settings, so the
     * main form's draft would otherwise go stale and silently roll the runtime
     * back on the next Save. Changes we pushed up ourselves are ignored —
     * otherwise our own save would clear its own confirmation message. */
    const ownSave = useRef(false);
    useEffect(() => {
        if (ownSave.current) {
            ownSave.current = false;
            return;
        }
        setDraft(settings);
        setMsg(null);
    }, [settings]);

    const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));
    const setRuntime = (key) => (e) => setRuntimeDraft((d) => ({ ...d, [key]: e.target.value }));

    const dirty =
        draft.name !== settings.name ||
        draft.mainFile !== settings.mainFile ||
        draft.startup !== settings.startup ||
        draft.autoRestart !== settings.autoRestart;

    const save = (e) => {
        e.preventDefault();
        const name = draft.name.trim();
        if (!name) {
            setMsg({ ok: false, text: 'Server name cannot be empty.' });
            return;
        }
        ownSave.current = true;
        onSave({ ...draft, name });
        setMsg({ ok: true, text: 'Changes applied to the demo server.' });
        toast.success('Demo settings saved');
    };

    const applyRuntime = () => {
        onSave(runtimeDraft);
        setEditingRuntime(false);
        toast.success(`Runtime set to ${runtimeDraft.runtimeLabel}`);
    };

    const blocked = (what) =>
        toast.info(`${what} needs a real account — it is disabled in the interactive demo.`);

    return (
        <div className="flex flex-col gap-4">
            <p className="flex items-start gap-2 rounded-xl border border-hairline bg-white/[0.02] px-4 py-3 text-[0.78rem] leading-relaxed text-ink-secondary">
                <TriangleAlert size={14} className="mt-0.5 shrink-0 text-amber-300" aria-hidden="true" />
                <span>
                    These fields are editable so you can feel the interface, but they are stored in this browser tab
                    only. No server is created or modified.
                </span>
            </p>

            {/* ---- server settings ---- */}
            <form onSubmit={save} className="flex flex-col gap-5 rounded-2xl border border-hairline bg-card p-5 sm:p-6">
                <div className="flex items-center gap-2.5">
                    <ServerIcon className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                    <h3 className="text-[0.95rem] font-semibold">Server settings</h3>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                    <label className="block">
                        <span className={labelClass}>Server name</span>
                        <input
                            value={draft.name}
                            onChange={set('name')}
                            placeholder="my-bot"
                            spellCheck={false}
                            className={inputClass}
                        />
                        <span className={hintClass}>Lowercase letters, numbers and dashes.</span>
                    </label>

                    <label className="block">
                        <span className={labelClass}>Main file</span>
                        <input
                            value={draft.mainFile}
                            onChange={set('mainFile')}
                            placeholder="index.js"
                            spellCheck={false}
                            dir="ltr"
                            className={cn(inputClass, 'font-mono')}
                        />
                        <span className={hintClass}>
                            The file passed to the startup command as <code className="font-mono">{'{{MAIN_FILE}}'}</code>.
                        </span>
                    </label>

                    <label className="block sm:col-span-2">
                        <span className={labelClass}>Startup command</span>
                        <input
                            value={draft.startup}
                            onChange={set('startup')}
                            placeholder="node {{MAIN_FILE}}"
                            spellCheck={false}
                            dir="ltr"
                            className={cn(inputClass, 'font-mono')}
                        />
                        <span className={hintClass}>Runs on every start and restart.</span>
                    </label>
                </div>

                <label className="flex cursor-pointer items-center gap-2.5 text-[0.88rem] font-semibold">
                    <input
                        type="checkbox"
                        checked={draft.autoRestart}
                        onChange={(e) => setDraft((d) => ({ ...d, autoRestart: e.target.checked }))}
                        className="size-4 accent-white"
                    />
                    Restart automatically if the process exits with an error
                </label>

                <div className="flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
                    <button type="submit" disabled={!dirty} className={submitBtn}>
                        <Save size={16} aria-hidden="true" />
                        Save changes
                    </button>
                    {msg && (
                        <p className={cn('text-[0.8rem]', msg.ok ? 'text-emerald-300' : 'text-red-300')} role="status">
                            {msg.text}
                        </p>
                    )}
                    {!dirty && !msg && <p className="text-[0.8rem] text-ink-muted">No unsaved changes.</p>}
                </div>
            </form>

            {/* ---- runtime (RuntimeSwitcher.jsx) ---- */}
            <section aria-label="Runtime" className="flex flex-col gap-4 rounded-2xl border border-hairline bg-card p-5 sm:p-6">
                <div className="flex flex-wrap items-center gap-2">
                    <Cpu className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                    <h3 className="flex-1 text-[0.95rem] font-semibold">Runtime</h3>
                    <button
                        type="button"
                        onClick={() => {
                            setRuntimeDraft(settings);
                            setEditingRuntime(true);
                        }}
                        className={ghostBtn}
                    >
                        <RefreshCw size={14} aria-hidden="true" />
                        Change runtime
                    </button>
                </div>

                <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
                    <div>
                        <p className="text-[0.78rem] text-ink-muted">Runtime</p>
                        <p className="mt-0.5 text-[0.95rem] font-bold text-foreground">{settings.runtimeLabel}</p>
                    </div>
                    <div>
                        <p className="text-[0.78rem] text-ink-muted">Version</p>
                        <p className="mt-0.5 font-mono text-[0.95rem] font-bold text-foreground">
                            {settings.runtimeVersion}
                        </p>
                    </div>
                    <div>
                        <p className="text-[0.78rem] text-ink-muted">Main file</p>
                        <p className="mt-0.5 font-mono text-[0.95rem] font-bold text-foreground">
                            {settings.mainFile}
                        </p>
                    </div>
                </div>

                {editingRuntime && (
                    <div className="flex flex-col gap-4 rounded-xl border border-hairline bg-veil/60 p-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <label className="block">
                                <span className="mb-1.5 block text-[0.82rem] font-semibold text-ink-secondary">
                                    Runtime
                                </span>
                                <select
                                    value={runtimeDraft.runtime}
                                    onChange={(e) => {
                                        const picked = DEMO_RUNTIMES.find((r) => r.value === e.target.value);
                                        setRuntimeDraft((d) => ({
                                            ...d,
                                            runtime: picked.value,
                                            runtimeLabel: picked.label,
                                        }));
                                    }}
                                    className={inputClass}
                                >
                                    {DEMO_RUNTIMES.map((r) => (
                                        <option key={r.value} value={r.value}>
                                            {r.label}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label className="block">
                                <span className="mb-1.5 block text-[0.82rem] font-semibold text-ink-secondary">
                                    Language version
                                </span>
                                <select
                                    value={settings.runtimeVersion}
                                    onChange={setRuntime('runtimeVersion')}
                                    className={cn(inputClass, 'font-mono')}
                                >
                                    {DEMO_VERSIONS.map((v) => (
                                        <option key={v} value={v}>
                                            {v}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </div>

                        <fieldset className="flex flex-col gap-2">
                            <legend className="text-[0.82rem] font-semibold text-ink-secondary">Startup command</legend>
                            {STARTUPS.map((cmd) => (
                                <label key={cmd} className="flex cursor-pointer items-center gap-2 text-[0.84rem]">
                                    <input
                                        type="radio"
                                        name="demo-startup"
                                        checked={runtimeDraft.startup === cmd}
                                        onChange={() => setRuntimeDraft((d) => ({ ...d, startup: cmd }))}
                                        className="size-3.5 accent-white"
                                    />
                                    <code className="font-mono">{cmd}</code>
                                </label>
                            ))}
                        </fieldset>

                        <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-[0.82rem] text-amber-200">
                            Demo only. A real runtime change reinstalls the server container, which is why it is
                            disabled here.
                        </p>

                        <div className="flex flex-wrap items-center justify-end gap-2">
                            <button type="button" onClick={() => setEditingRuntime(false)} className={ghostBtn}>
                                Cancel
                            </button>
                            <button type="button" onClick={applyRuntime} className={submitBtn}>
                                Apply runtime
                            </button>
                        </div>
                    </div>
                )}
            </section>

            {/* ---- environment ---- */}
            <section className="flex flex-col gap-4 rounded-2xl border border-hairline bg-card p-5 sm:p-6">
                <div className="flex items-center gap-2.5">
                    <Terminal className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                    <h3 className="text-[0.95rem] font-semibold">Environment variables</h3>
                </div>

                <dl className="flex flex-col gap-2">
                    {[
                        ['DISCORD_TOKEN', '••••••••••••••••'],
                        ['PREFIX', '!'],
                        ['NODE_ENV', 'production'],
                    ].map(([key, value]) => (
                        <div
                            key={key}
                            className="flex items-center justify-between gap-4 rounded-xl border border-hairline bg-white/[0.02] px-4 py-3"
                        >
                            <dt className="font-mono text-[0.8rem] font-semibold">{key}</dt>
                            <dd className="truncate font-mono text-[0.8rem] text-ink-muted">{value}</dd>
                        </div>
                    ))}
                </dl>

                <p className="text-[0.78rem] text-ink-muted">
                    Values are hidden and read-only in the demo.
                </p>
            </section>

            {/* ---- danger zone (ServerDetail.jsx) ---- */}
            <div className="rounded-xl border border-red-500/30 bg-card p-6">
                <h3 className="font-bold text-red-400">Danger zone</h3>
                <p className="mt-1 text-[0.8rem] text-ink-secondary">
                    Reinstalling or deleting a server is destructive, so it stays disabled in the demo.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => blocked('Reinstalling a server')}
                        className="rounded-full border border-hairline px-5 py-2 text-[0.83rem] font-bold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground"
                    >
                        <Wrench size={14} className="mr-1.5 inline" aria-hidden="true" />
                        Reinstall server
                    </button>
                    <button
                        type="button"
                        onClick={() => blocked('Deleting a server')}
                        className="rounded-full border border-red-500/40 px-5 py-2 text-[0.83rem] font-bold text-red-400 transition hover:bg-red-500 hover:text-white"
                    >
                        Delete server
                    </button>
                </div>
            </div>
        </div>
    );
}