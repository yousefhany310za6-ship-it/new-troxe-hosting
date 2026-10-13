import { useEffect, useState } from 'react';
import { Plus, Save, Terminal, Trash2 } from 'lucide-react';

import { apiPatch } from '@/lib/api.js';
import { cn } from '@/lib/utils';

const labelClass = 'mb-1.5 block text-small font-semibold text-foreground';
const hintClass = 'mt-1.5 block text-tiny text-ink-muted';

/**
 * Startup settings only: the command the platform runs and the variables it is
 * given. Server identity and the main file live on the Settings tab — the two
 * are deliberately separate so a change to one never silently rewrites the
 * other.
 *
 * Values are masked by the API (•••). A masked value sent back means "keep
 * what is stored" — never "store bullets".
 */
export default function ServerStartup({ server, onSaved, onTab }) {
    const [startup, setStartup] = useState('');
    const [env, setEnv] = useState([]);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(null);

    useEffect(() => {
        if (!server) return;
        setStartup(server.startup ?? '');
        setEnv(server.env ?? []);
    }, [server?.id, server?.startup, server?.env]);

    const dirty =
        !!server &&
        (startup.trim() !== (server.startup ?? '') ||
            JSON.stringify(env.filter((e) => e.k.trim())) !==
                JSON.stringify((server.env ?? []).filter((e) => e.k.trim())));

    const save = async (e) => {
        e.preventDefault();
        if (!startup.trim()) return setMsg({ text: 'Startup command is required.', ok: false });
        setBusy(true);
        setMsg(null);
        try {
            await apiPatch(`/servers/${server.id}`, { startup: startup.trim(), env });
            setMsg({ text: 'Startup settings saved. Restart the server to apply them.', ok: true });
            onSaved?.();
        } catch (err) {
            setMsg({ text: err.message, ok: false });
        } finally {
            setBusy(false);
        }
    };

    if (!server) return null;

    return (
        <form onSubmit={save} className="console-card flex flex-col gap-5 p-5 sm:p-6">
            <header className="flex items-center gap-2.5">
                <Terminal className="size-4 text-ink-muted" aria-hidden="true" />
                <h2 className="text-lead font-semibold">Startup</h2>
            </header>

            <label className="block">
                <span className={labelClass}>Startup command</span>
                <input
                    value={startup}
                    onChange={(e) => setStartup(e.target.value)}
                    className="input-field font-mono"
                    dir="ltr"
                    maxLength={500}
                />
                <span className={hintClass}>
                    Variables from the table below are substituted at start, e.g. <code className="font-mono">node {'{{MAIN_FILE}}'}</code>. Unknown
                    variables are rejected when saving.
                </span>
            </label>

            <div className="flex items-center justify-between">
                <p className="text-small font-semibold">Environment variables</p>
                <button type="button" onClick={() => setEnv((rows) => [...rows, { k: '', v: '' }])} className="btn btn-secondary btn-sm">
                    <Plus className="size-3.5" /> Add variable
                </button>
            </div>
            <p className={hintClass}>Values are masked (••••••••••••). Editing overwrites the stored value.</p>

            <div className="flex flex-col gap-2">
                {env.map((row, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 max-md:grid-cols-1">
                        <input
                            placeholder="KEY"
                            value={row.k}
                            onChange={(e) => setEnv((rows) => rows.map((r, j) => (j === i ? { ...r, k: e.target.value } : r)))}
                            className="input-field font-mono"
                        />
                        <input
                            placeholder="value"
                            value={row.v}
                            onChange={(e) => setEnv((rows) => rows.map((r, j) => (j === i ? { ...r, v: e.target.value } : r)))}
                            className="input-field font-mono"
                        />
                        <button
                            type="button"
                            aria-label="Remove variable"
                            onClick={() => setEnv((rows) => rows.filter((_, j) => j !== i))}
                            className="btn btn-secondary btn-sm max-md:w-fit"
                        >
                            <Trash2 className="size-3.5" />
                        </button>
                    </div>
                ))}
                {env.length === 0 && <p className="text-small text-ink-muted">No variables yet.</p>}
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
                <button
                    type="submit"
                    disabled={busy || !dirty}
                    className="btn btn-primary"
                >
                    <Save className="size-4" aria-hidden="true" />
                    {busy ? 'Saving…' : 'Save startup'}
                </button>
                <button
                    type="button"
                    onClick={() => onTab?.('settings')}
                    className="text-small font-bold text-ink-secondary underline decoration-dotted transition hover:text-foreground"
                >
                    Go to server settings
                </button>
                {msg && (
                    <span className={cn('text-tiny', msg.ok ? 'text-emerald-300' : 'text-red-300')} role="status">
                        {msg.text}
                    </span>
                )}
            </div>
        </form>
    );
}
