import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
    ArrowLeft,
    Check,
    ChevronRight,
    Database,
    Download,
    FileText,
    Folder,
    History,
    LayoutDashboard,
    Play,
    Plus,
    RotateCcw,
    Settings as SettingsIcon,
    Square,
    Terminal,
    Trash2,
    Upload,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { CONSOLE_POOL, SERVER_LOGS, getServerDetail } from '@/data/dashboard.js';
import { STATUS_STYLE } from './Overview.jsx';
import { RUNTIME_ICONS } from './Servers.jsx';

const TABS = [
    { id: 'overview', label: 'Overview', Icon: LayoutDashboard },
    { id: 'console', label: 'Console', Icon: Terminal },
    { id: 'files', label: 'Files', Icon: Folder },
    { id: 'backups', label: 'Backups', Icon: Database },
    { id: 'settings', label: 'Settings', Icon: SettingsIcon },
];

const inputClass =
    'w-full rounded-xl border border-hairline bg-white/10 px-4 py-2.5 text-[0.88rem] text-foreground placeholder-ink-muted transition focus:border-primary focus:ring-2 focus:ring-ring/40 focus:outline-none';

function timeNow() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fullDateNow() {
    return (
        new Date().toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        }) + ' — ' + timeNow()
    );
}

export default function ServerDetail() {
    const { id } = useParams();
    const detail = getServerDetail(id);

    const [tab, setTab] = useState('overview');
    const [status, setStatus] = useState(detail?.status ?? 'offline');
    const [msg, setMsg] = useState({ text: '', ok: true });

    // Console
    const [lines, setLines] = useState(SERVER_LOGS[id] ?? []);
    const [cmd, setCmd] = useState('');
    const logRef = useRef(null);

    // Files
    const [path, setPath] = useState([]);

    // Backups
    const [backups, setBackups] = useState(detail?.backups ?? []);

    // Settings
    const [name, setName] = useState(detail?.name ?? '');
    const [startup, setStartup] = useState(detail?.startup ?? '');
    const [env, setEnv] = useState(detail?.env ?? []);
    const [autoRestart, setAutoRestart] = useState(true);
    const [autoBackup, setAutoBackup] = useState(true);

    // Reset everything when switching servers
    useEffect(() => {
        setTab('overview');
        setStatus(detail?.status ?? 'offline');
        setMsg({ text: '', ok: true });
        setLines(SERVER_LOGS[id] ?? []);
        setCmd('');
        setPath([]);
        setBackups(detail?.backups ?? []);
        setName(detail?.name ?? '');
        setStartup(detail?.startup ?? '');
        setEnv(detail?.env ?? []);
        setAutoRestart(true);
        setAutoBackup(true);
    }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

    // Live console feed
    useEffect(() => {
        if (tab !== 'console' || status !== 'online') return undefined;
        const timer = setInterval(() => {
            const line = CONSOLE_POOL[Math.floor(Math.random() * CONSOLE_POOL.length)];
            setLines((prev) => [...prev.slice(-99), `[${timeNow()}] ${line}`]);
        }, 2500);
        return () => clearInterval(timer);
    }, [tab, status]);

    useEffect(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [lines, tab]);

    if (!detail) {
        return (
            <div className="flex flex-col items-center gap-4 py-20 text-center">
                <p className="text-[1.1rem] font-bold">Server not found</p>
                <Link to="/dashboard/servers" className="text-sm text-ink-secondary hover:text-foreground hover:underline hover:underline-offset-4">
                    Back to servers
                </Link>
            </div>
        );
    }

    const RuntimeIcon = RUNTIME_ICONS[detail.runtime];
    const online = status === 'online';

    const start = () => {
        setStatus('online');
        setLines((prev) => [...prev, `[${timeNow()}] Server started — streaming output`]);
    };
    const stop = () => setStatus('offline');
    const restart = () => {
        setStatus('restarting');
        setTimeout(() => {
            setStatus('online');
            setLines((prev) => [...prev, `[${timeNow()}] Server restarted`]);
        }, 2000);
    };

    const sendCommand = (e) => {
        e.preventDefault();
        const c = cmd.trim();
        if (!c) return;
        if (c === 'clear') {
            setLines([]);
        } else if (c === 'help') {
            setLines((prev) => [...prev, `$ ${c}`, 'Available: help, clear, status, restart']);
        } else if (c === 'status') {
            setLines((prev) => [...prev, `$ ${c}`, `Status: ${status} — uptime ${detail.uptime}`]);
        } else if (c === 'restart') {
            setLines((prev) => [...prev, `$ ${c}`, 'Restart requested...']);
            restart();
        } else {
            setLines((prev) => [...prev, `$ ${c}`, 'Command sent to server. (Demo)']);
        }
        setCmd('');
    };

    const dirAt = (trail) => trail.reduce((node, seg) => node[seg]?.children ?? {}, detail.files ?? {});
    const entries = Object.entries(dirAt(path));

    const createBackup = () => {
        const n = backups.length + 1;
        setBackups((list) => [
            { id: `manual-${Date.now()}`, name: `manual-backup-${n}`, size: '1.2 GB', date: fullDateNow(), auto: false },
            ...list,
        ]);
        setMsg({ text: 'Backup created. (Demo)', ok: true });
    };

    const saveSettings = (e) => {
        e.preventDefault();
        if (!name.trim() || !startup.trim()) {
            setMsg({ text: 'Server name and startup command are required.', ok: false });
            return;
        }
        setMsg({ text: 'Server settings saved. Restart to apply. (Demo)', ok: true });
    };

    const actionBtn =
        'inline-flex items-center gap-1.5 rounded-md border border-hairline bg-veil px-3 py-1.5 text-[0.8rem] font-semibold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40';

    return (
        <div className="flex flex-col gap-6">
            <Link
                to="/dashboard/servers"
                className="inline-flex w-fit items-center gap-1.5 text-[0.85rem] font-semibold text-ink-secondary transition hover:text-foreground"
            >
                <ArrowLeft className="size-4" /> All servers
            </Link>

            {/* Header */}
            <div className="relative overflow-hidden rounded-xl border border-hairline bg-card p-6">
                {RuntimeIcon && (
                    <div aria-hidden="true" className="pointer-events-none absolute top-1/2 -right-10 size-52 -translate-y-1/2 opacity-[0.07]">
                        <RuntimeIcon className="size-full" />
                    </div>
                )}
                <div className="relative flex flex-wrap items-center gap-3">
                    <span className={cn('size-3 rounded-full', STATUS_STYLE[status])} />
                    <h1 className="font-mono text-[1.4rem] font-extrabold">{detail.name}</h1>
                    <span className="rounded-full border border-hairline bg-veil px-2.5 py-0.5 text-[0.75rem] font-semibold text-ink-secondary">
                        {detail.runtimeVersion}
                    </span>
                    <span className="font-mono text-[0.75rem] text-ink-muted capitalize">{status}</span>
                    <div className="ml-auto flex items-center gap-2">
                        <button type="button" disabled={status !== 'offline'} onClick={start} className={actionBtn}>
                            <Play className="size-3.5" /> Start
                        </button>
                        <button type="button" disabled={status !== 'online'} onClick={restart} className={actionBtn}>
                            <RotateCcw className="size-3.5" /> Restart
                        </button>
                        <button type="button" disabled={status !== 'online'} onClick={stop} className={actionBtn}>
                            <Square className="size-3.5" /> Stop
                        </button>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 overflow-x-auto border-b border-hairline">
                {TABS.map(({ id: tabId, label, Icon }) => (
                    <button
                        key={tabId}
                        type="button"
                        onClick={() => { setTab(tabId); setMsg({ text: '', ok: true }); }}
                        className={cn(
                            'flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-[0.88rem] font-semibold transition',
                            tab === tabId
                                ? 'border-white text-foreground'
                                : 'border-transparent text-ink-secondary hover:text-foreground'
                        )}
                    >
                        <Icon className="size-4" />
                        {label}
                    </button>
                ))}
            </div>

            {msg.text && (
                <p className={cn('text-sm', msg.ok ? 'text-emerald-400' : 'text-red-400')}>{msg.text}</p>
            )}

            {/* OVERVIEW */}
            {tab === 'overview' && (
                <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
                    {[
                        ['Status', status],
                        ['Runtime', detail.runtimeVersion],
                        ['Plan', detail.plan],
                        ['Region', detail.region],
                        ['IP address', detail.ip],
                        ['Uptime', online ? detail.uptime : '—'],
                        ['Startup', detail.startup || '—'],
                        ['Storage', detail.storageUsed],
                    ].map(([label, value]) => (
                        <div key={label} className="rounded-xl border border-hairline bg-card p-5">
                            <p className="text-[0.8rem] text-ink-muted">{label}</p>
                            <p className="mt-1 font-mono text-[0.95rem] font-bold capitalize">{value}</p>
                        </div>
                    ))}
                </div>
            )}

            {/* CONSOLE */}
            {tab === 'console' && (
                <div className="overflow-hidden rounded-xl border border-hairline bg-card">
                    <div className="flex items-center gap-2 border-b border-hairline px-5 py-3">
                        <Terminal className="size-4 text-ink-muted" />
                        <span className="font-mono text-[0.85rem] font-semibold">Live output</span>
                        <span className={cn('ml-2 size-2 rounded-full', online ? 'animate-beat bg-emerald-500' : 'bg-zinc-600')} />
                    </div>
                    <div ref={logRef} className="flex h-[320px] flex-col gap-1.5 overflow-y-auto p-5 font-mono text-[0.8rem] leading-relaxed text-ink-secondary">
                        {lines.length === 0 && <p className="text-ink-muted">No output yet.</p>}
                        {lines.map((line, i) => (
                            <p key={i} className={cn(line.startsWith('$') && 'text-foreground')}>{line}</p>
                        ))}
                    </div>
                    <form onSubmit={sendCommand} className="flex items-center gap-2 border-t border-hairline px-5 py-3">
                        <span className="font-mono text-[0.85rem] text-emerald-400">$</span>
                        <input
                            value={cmd}
                            onChange={(e) => setCmd(e.target.value)}
                            placeholder={online ? 'Type a command (help, clear, status, restart)...' : 'Start the server to send commands'}
                            disabled={!online}
                            className="w-full bg-transparent font-mono text-[0.85rem] text-foreground placeholder-ink-muted focus:outline-none disabled:opacity-50"
                        />
                    </form>
                </div>
            )}

            {/* FILES */}
            {tab === 'files' && (
                <div className="overflow-hidden rounded-xl border border-hairline bg-card">
                    <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-5 py-3">
                        <button type="button" onClick={() => setPath([])} className="font-mono text-[0.85rem] font-bold hover:underline hover:underline-offset-4">
                            {detail.name}
                        </button>
                        {path.map((seg, i) => (
                            <span key={i} className="flex items-center gap-2">
                                <ChevronRight className="size-3.5 text-ink-muted" />
                                <button
                                    type="button"
                                    onClick={() => setPath(path.slice(0, i + 1))}
                                    className="font-mono text-[0.85rem] text-ink-secondary hover:text-foreground hover:underline hover:underline-offset-4"
                                >
                                    {seg}
                                </button>
                            </span>
                        ))}
                        <div className="ml-auto flex items-center gap-2">
                            <button type="button" onClick={() => setMsg({ text: 'Uploads are disabled in demo mode.', ok: false })} className={actionBtn}>
                                <Upload className="size-3.5" /> Upload
                            </button>
                            <button type="button" onClick={() => setMsg({ text: 'File creation is disabled in demo mode.', ok: false })} className={actionBtn}>
                                <Plus className="size-3.5" /> New file
                            </button>
                        </div>
                    </div>
                    <div className="flex flex-col divide-y divide-hairline">
                        {entries.length === 0 && (
                            <p className="px-5 py-8 text-center text-[0.88rem] text-ink-muted">Empty folder.</p>
                        )}
                        {entries.map(([entryName, entry]) => (
                            <button
                                key={entryName}
                                type="button"
                                onClick={() => entry.type === 'dir' && setPath([...path, entryName])}
                                className={cn(
                                    'flex items-center gap-3 px-5 py-3 text-left transition',
                                    entry.type === 'dir' && 'hover:bg-veil'
                                )}
                            >
                                {entry.type === 'dir' ? (
                                    <Folder className="size-[18px] shrink-0 text-ink-muted" />
                                ) : (
                                    <FileText className="size-[18px] shrink-0 text-ink-muted" />
                                )}
                                <span className="font-mono text-[0.88rem] font-semibold">{entryName}</span>
                                <span className="ml-auto font-mono text-[0.78rem] text-ink-muted">
                                    {entry.type === 'dir' ? `${Object.keys(entry.children ?? {}).length} items` : entry.size}
                                </span>
                                <span className="hidden font-mono text-[0.78rem] text-ink-muted sm:block">
                                    {entry.modified ?? '—'}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* BACKUPS */}
            {tab === 'backups' && (
                <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-[0.9rem] text-ink-secondary">
                            {backups.length} snapshot{backups.length === 1 ? '' : 's'} stored
                        </p>
                        <button
                            type="button"
                            onClick={createBackup}
                            className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:bg-gray-200"
                        >
                            <Plus className="size-4" /> Create backup
                        </button>
                    </div>
                    {backups.length === 0 && (
                        <div className="rounded-xl border border-dashed border-hairline bg-card p-10 text-center">
                            <History className="mx-auto mb-3 size-8 text-ink-muted" />
                            <p className="text-[0.92rem] font-semibold">No backups yet</p>
                            <p className="mt-1 text-[0.85rem] text-ink-secondary">Create your first snapshot to protect this server.</p>
                        </div>
                    )}
                    {backups.map((backup) => (
                        <div key={backup.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-hairline bg-card p-5">
                            <Database className="size-5 shrink-0 text-ink-muted" />
                            <div>
                                <p className="font-mono text-[0.9rem] font-bold">{backup.name}</p>
                                <p className="mt-0.5 font-mono text-[0.75rem] text-ink-muted">
                                    {backup.size} • {backup.date} {backup.auto ? '• automatic' : '• manual'}
                                </p>
                            </div>
                            <div className="ml-auto flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setMsg({ text: `Restoring "${backup.name}"... (Demo)`, ok: true })}
                                    className={actionBtn}
                                >
                                    <History className="size-3.5" /> Restore
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setMsg({ text: 'Downloads are disabled in demo mode.', ok: false })}
                                    className={actionBtn}
                                >
                                    <Download className="size-3.5" /> Download
                                </button>
                                <button
                                    type="button"
                                    aria-label={`Delete ${backup.name}`}
                                    onClick={() => {
                                        setBackups((list) => list.filter((b) => b.id !== backup.id));
                                        setMsg({ text: 'Backup deleted. (Demo)', ok: true });
                                    }}
                                    className={cn(actionBtn, 'hover:!border-red-500/50 hover:!text-red-400')}
                                >
                                    <Trash2 className="size-3.5" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* SETTINGS */}
            {tab === 'settings' && (
                <div className="flex flex-col gap-4">
                    <form onSubmit={saveSettings} className="rounded-xl border border-hairline bg-card p-6">
                        <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
                            <label className="flex flex-col gap-1.5 text-[0.85rem] font-semibold">
                                Server name
                                <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
                            </label>
                            <label className="flex flex-col gap-1.5 text-[0.85rem] font-semibold">
                                Startup command
                                <input value={startup} onChange={(e) => setStartup(e.target.value)} className={inputClass} />
                            </label>
                        </div>
                        <div className="mt-4 flex items-center justify-between">
                            <p className="text-[0.85rem] font-semibold">Environment variables</p>
                            <button
                                type="button"
                                onClick={() => setEnv((rows) => [...rows, { k: '', v: '' }])}
                                className={actionBtn}
                            >
                                <Plus className="size-3.5" /> Add variable
                            </button>
                        </div>
                        <div className="mt-3 flex flex-col gap-2">
                            {env.map((row, i) => (
                                <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 max-md:grid-cols-1">
                                    <input
                                        placeholder="KEY"
                                        value={row.k}
                                        onChange={(e) => setEnv((rows) => rows.map((r, j) => (j === i ? { ...r, k: e.target.value } : r)))}
                                        className={cn(inputClass, 'font-mono')}
                                    />
                                    <input
                                        placeholder="value"
                                        value={row.v}
                                        onChange={(e) => setEnv((rows) => rows.map((r, j) => (j === i ? { ...r, v: e.target.value } : r)))}
                                        className={cn(inputClass, 'font-mono')}
                                    />
                                    <button
                                        type="button"
                                        aria-label="Remove variable"
                                        onClick={() => setEnv((rows) => rows.filter((_, j) => j !== i))}
                                        className={cn(actionBtn, 'max-md:w-fit')}
                                    >
                                        <Trash2 className="size-3.5" />
                                    </button>
                                </div>
                            ))}
                            {env.length === 0 && (
                                <p className="text-[0.85rem] text-ink-muted">No variables yet.</p>
                            )}
                        </div>
                        <div className="mt-5 flex flex-wrap items-center gap-4">
                            <label className="flex cursor-pointer items-center gap-2 text-[0.88rem] font-semibold">
                                <input
                                    type="checkbox"
                                    checked={autoRestart}
                                    onChange={(e) => setAutoRestart(e.target.checked)}
                                    className="size-4 accent-white"
                                />
                                Auto-restart on crash
                            </label>
                            <label className="flex cursor-pointer items-center gap-2 text-[0.88rem] font-semibold">
                                <input
                                    type="checkbox"
                                    checked={autoBackup}
                                    onChange={(e) => setAutoBackup(e.target.checked)}
                                    className="size-4 accent-white"
                                />
                                Daily automatic backups
                            </label>
                        </div>
                        <button
                            type="submit"
                            className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-6 py-2.5 text-sm font-bold text-black transition hover:bg-gray-200"
                        >
                            <Check className="size-4" /> Save settings
                        </button>
                    </form>

                    <div className="rounded-xl border border-red-500/30 bg-card p-6">
                        <h3 className="font-bold text-red-400">Danger zone</h3>
                        <div className="mt-4 flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => setMsg({ text: 'Reinstall is disabled in demo mode.', ok: false })}
                                className="rounded-full border border-hairline px-5 py-2 text-[0.83rem] font-bold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground"
                            >
                                Reinstall server
                            </button>
                            <button
                                type="button"
                                onClick={() => setMsg({ text: 'Deletion is disabled in demo mode.', ok: false })}
                                className="rounded-full border border-red-500/40 px-5 py-2 text-[0.83rem] font-bold text-red-400 transition hover:bg-red-500 hover:text-white"
                            >
                                Delete server
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
