import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Loader2, Server as ServerIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { apiPost } from '@/lib/api.js';

const RUNTIME_OPTS = [
    { value: 'Node.js', label: 'Node.js', hint: 'LTS (20.x)' },
    { value: 'Python', label: 'Python', hint: '3.11 slim' },
    { value: 'Bun', label: 'Bun', hint: '1.2.x' },
    { value: 'PHP', label: 'PHP', hint: '8.3 CLI' },
];

const inputClass =
    'w-full rounded-xl border border-hairline bg-white/10 px-4 py-2.5 text-[0.88rem] text-foreground placeholder-ink-muted transition focus:border-primary focus:ring-2 focus:ring-ring/40 focus:outline-none';

const actionBtn =
    'inline-flex items-center gap-1.5 rounded-md border border-hairline bg-veil px-3 py-1.5 text-[0.8rem] font-semibold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40';

export default function CreateServer() {
    const navigate = useNavigate();
    const [name, setName] = useState('');
    const [runtime, setRuntime] = useState('Node.js');
    const [startup, setStartup] = useState('');
    const [env, setEnv] = useState([{ k: '', v: '' }]);
    const [autoRestart, setAutoRestart] = useState(true);
    const [autoBackup, setAutoBackup] = useState(true);
    const [msg, setMsg] = useState({ text: '', ok: true });
    const [creating, setCreating] = useState(false);

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
        if (!startup.trim()) {
            setMsg({ text: 'Startup command is required.', ok: false });
            return;
        }
        setCreating(true);
        setMsg({ text: '', ok: true });
        try {
            const filteredEnv = env.filter(r => r.k.trim() && r.v.trim());
            const res = await apiPost('/servers', {
                name: name.trim(),
                runtime,
                startup: startup.trim(),
                env: filteredEnv,
                autoRestart,
                autoBackup,
            });
            setMsg({ text: 'Server created. Provisioning…', ok: true });
            setTimeout(() => navigate(`/dashboard/servers/${res.id}`), 1000);
        } catch (err) {
            setMsg({ text: err.message, ok: false });
        } finally {
            setCreating(false);
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <Link
                to="/dashboard/servers"
                className="inline-flex w-fit items-center gap-1.5 text-[0.85rem] font-semibold text-ink-secondary transition hover:text-foreground"
            >
                <ArrowLeft className="size-4" /> All servers
            </Link>

            <div>
                <h1 className="text-[1.6rem] font-extrabold tracking-tight">New server</h1>
                <p className="mt-1 text-[0.92rem] text-ink-secondary">
                    Configure and provision a new sandbox.
                </p>
            </div>

            {msg.text && (
                <p className={cn('text-sm', msg.ok ? 'text-emerald-400' : 'text-red-400')}>{msg.text}</p>
            )}

            <form onSubmit={handleSubmit} className="rounded-xl border border-hairline bg-card p-6 space-y-6">
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
                    <label className="flex flex-col gap-1.5 text-[0.85rem] font-semibold">
                        Runtime
                        <select
                            value={runtime}
                            onChange={(e) => setRuntime(e.target.value)}
                            className={inputClass}
                            disabled={creating}
                        >
                            {RUNTIME_OPTS.map(opt => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label} — {opt.hint}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>

                <label className="flex flex-col gap-1.5 text-[0.85rem] font-semibold">
                    Startup command
                    <input
                        value={startup}
                        onChange={(e) => setStartup(e.target.value)}
                        placeholder="node server.js"
                        className={cn(inputClass, 'font-mono')}
                        disabled={creating}
                    />
                    <p className="text-[0.75rem] text-ink-muted">
                        The command that starts your application. Must stay in foreground.
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
                        to="/dashboard/servers"
                        className="text-[0.88rem] font-semibold text-ink-secondary hover:text-foreground hover:underline hover:underline-offset-4"
                    >
                        Cancel
                    </Link>
                </div>
            </form>
        </div>
    );
}