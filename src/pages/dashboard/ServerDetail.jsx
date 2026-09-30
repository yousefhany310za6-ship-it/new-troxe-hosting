import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
    ArrowLeft,
    Check,
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
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api.js';
import { STATUS_STYLE } from './Overview.jsx';
import { RUNTIME_ICONS } from './Servers.jsx';
import ServerFiles from './ServerFiles.jsx';
import ExecTerminal from './ExecTerminal.jsx';

const TABS = [
    { id: 'overview', label: 'Overview', Icon: LayoutDashboard },
    { id: 'console', label: 'Console', Icon: Terminal },
    { id: 'files', label: 'Files', Icon: Folder },
    { id: 'backups', label: 'Backups', Icon: Database },
    { id: 'settings', label: 'Settings', Icon: SettingsIcon },
];

const inputClass =
    'w-full rounded-xl border border-hairline bg-white/10 px-4 py-2.5 text-[0.88rem] text-foreground placeholder-ink-muted transition focus:border-primary focus:ring-2 focus:ring-ring/40 focus:outline-none';

const actionBtn =
    'inline-flex items-center gap-1.5 rounded-md border border-hairline bg-veil px-3 py-1.5 text-[0.8rem] font-semibold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40';

export default function ServerDetail() {
    const { id } = useParams();
    const navigate = useNavigate();

    const [server, setServer] = useState(null);
    const [stats, setStats] = useState(null);
    const [usage, setUsage] = useState(null);
    const [backups, setBackups] = useState([]);
    const [logs, setLogs] = useState('');
    const [tab, setTab] = useState('overview');
    const [status, setStatus] = useState('offline');
    const [msg, setMsg] = useState({ text: '', ok: true });

    const logRef = useRef(null);

    const [name, setName] = useState('');
    const [startup, setStartup] = useState('');
    const [env, setEnv] = useState([]);
    const [autoRestart, setAutoRestart] = useState(true);
    const [autoBackup, setAutoBackup] = useState(true);

    const fetchServer = async () => {
        try {
            const data = await apiGet(`/servers/${id}`);
            setServer(data);
            setStatus(data.status);
            if (!name) setName(data.name);
            if (!startup) setStartup(data.startup ?? '');
            if (env.length === 0) setEnv(data.env ?? []);
            if (autoRestart !== data.autoRestart) setAutoRestart(data.autoRestart);
            if (autoBackup !== data.autoBackup) setAutoBackup(data.autoBackup);
        } catch (e) {
            setMsg({ text: e.message, ok: false });
        }
    };

    const fetchStats = async () => {
        if (!server?.containerId) { setStats(null); return; }
        try {
            const data = await apiGet(`/servers/${id}/stats`);
            setStats(data);
        } catch { setStats(null); }
    };

    const fetchUsage = async () => {
        try {
            const data = await apiGet(`/servers/${id}/usage`);
            setUsage(data);
        } catch { setUsage(null); }
    };

    const fetchBackups = async () => {
        try {
            const data = await apiGet(`/servers/${id}/backups`);
            setBackups(data);
        } catch { setBackups([]); }
    };

    const fetchLogs = async () => {
        if (!server?.containerId || status !== 'online') return;
        try {
            const data = await apiGet(`/servers/${id}/logs?tail=200`);
            setLogs(data.logs ?? '');
        } catch { /* ignore */ }
    };

    useEffect(() => {
        fetchServer();
        fetchBackups();
    }, [id]);

    useEffect(() => {
        if (!server) return;
        let alive = true;
        const interval = setInterval(() => {
            if (!alive) return;
            fetchServer();
            fetchStats();
            fetchUsage();
            fetchBackups();
            if (tab === 'console' && status === 'online') fetchLogs();
        }, 5000);
        return () => { alive = false; clearInterval(interval); };
    }, [server, tab, status]);

    useEffect(() => {
        if (server) setStatus(server.status);
    }, [server]);

    useEffect(() => {
        if (tab !== 'console' || status !== 'online') return;
        const timer = setInterval(() => fetchLogs(), 3000);
        return () => clearInterval(timer);
    }, [tab, status, id]);

    useEffect(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [logs]);

    if (!server) {
        return (
            <div className="flex flex-col items-center gap-4 py-20 text-center">
                <p className="text-[1.1rem] font-bold">Loading…</p>
            </div>
        );
    }

    const RuntimeIcon = RUNTIME_ICONS[server.runtime];
    const online = status === 'online';

    const start = async () => {
        setStatus('restarting');
        try {
            await apiPost(`/servers/${id}/start`);
            await fetchServer();
        } catch (e) {
            setMsg({ text: e.message, ok: false });
        }
    };
    const stop = async () => {
        try {
            await apiPost(`/servers/${id}/stop`);
            await fetchServer();
        } catch (e) {
            setMsg({ text: e.message, ok: false });
        }
    };
    const restart = async () => {
        setStatus('restarting');
        try {
            await apiPost(`/servers/${id}/restart`);
            await fetchServer();
        } catch (e) {
            setMsg({ text: e.message, ok: false });
        }
    };

    const createBackup = async () => {
        setMsg({ text: 'Creating backup…', ok: true });
        try {
            await apiPost(`/servers/${id}/backups`);
            setMsg({ text: 'Backup started', ok: true });
            fetchBackups();
        } catch (e) {
            setMsg({ text: e.message, ok: false });
        }
    };

    const restoreBackup = async (backupId) => {
        setMsg({ text: 'Restoring backup…', ok: true });
        try {
            await apiPost(`/servers/${id}/backups/${backupId}/restore`);
            setMsg({ text: 'Restore started', ok: true });
            fetchBackups();
            fetchServer();
        } catch (e) {
            setMsg({ text: e.message, ok: false });
        }
    };

    const deleteBackup = async (backupId) => {
        try {
            await apiDelete(`/servers/${id}/backups/${backupId}`);
            setMsg({ text: 'Backup deleted', ok: true });
            fetchBackups();
        } catch (e) {
            setMsg({ text: e.message, ok: false });
        }
    };

    const saveSettings = async (e) => {
        e.preventDefault();
        if (!name.trim() || !startup.trim()) {
            setMsg({ text: 'Server name and startup command are required.', ok: false });
            return;
        }
        try {
            await apiPatch(`/servers/${id}`, {
                name: name.trim(),
                startup: startup.trim(),
                env,
                autoRestart,
                autoBackup,
            });
            setMsg({ text: 'Server settings saved. Restart to apply.', ok: true });
            fetchServer();
        } catch (e) {
            setMsg({ text: e.message, ok: false });
        }
    };

    const reinstall = async () => {
        if (!window.confirm('Reinstall will WIPE all data on this server. Type the server name to confirm.')) return;
        const confirmName = window.prompt('Confirm server name:');
        if (confirmName !== server.name) {
            setMsg({ text: 'Name mismatch. Reinstall cancelled.', ok: false });
            return;
        }
        setMsg({ text: 'Reinstalling…', ok: true });
        try {
            await apiPost(`/servers/${id}/reinstall`);
            setMsg({ text: 'Reinstall started', ok: true });
            fetchServer();
        } catch (e) {
            setMsg({ text: e.message, ok: false });
        }
    };

    const deleteServer = async () => {
        if (!window.confirm('This will DELETE the server and ALL its data permanently. Type DELETE to confirm.')) return;
        const confirm = window.prompt('Type DELETE to confirm:');
        if (confirm !== 'DELETE') {
            setMsg({ text: 'Confirmation failed. Deletion cancelled.', ok: false });
            return;
        }
        setMsg({ text: 'Deleting server…', ok: true });
        try {
            await apiDelete(`/servers/${id}`);
            navigate('/dashboard/servers');
        } catch (e) {
            setMsg({ text: e.message, ok: false });
        }
    };

    const fmtBytes = (bytes, limit) => {
        if (!bytes) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let i = 0;
        let v = bytes;
        while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
        const pct = limit ? Math.min(100, Math.round((bytes / limit) * 100)) : null;
        return `${v.toFixed(1)} ${units[i]}${pct !== null ? ` (${pct}%)` : ''}`;
    };

    return (
        <div className="flex flex-col gap-6">
            <Link
                to="/dashboard/servers"
                className="inline-flex w-fit items-center gap-1.5 text-[0.85rem] font-semibold text-ink-secondary transition hover:text-foreground"
            >
                <ArrowLeft className="size-4" /> All servers
            </Link>

            <div className="relative overflow-hidden rounded-xl border border-hairline bg-card p-6">
                {RuntimeIcon && (
                    <div aria-hidden="true" className="pointer-events-none absolute top-1/2 -right-10 size-52 -translate-y-1/2 opacity-[0.07]">
                        <RuntimeIcon className="size-full" />
                    </div>
                )}
                <div className="relative flex flex-wrap items-center gap-3">
                    <span className={cn('size-3 rounded-full', STATUS_STYLE[status])} />
                    <h1 className="font-mono text-[1.4rem] font-extrabold">{server.name}</h1>
                    <span className="rounded-full border border-hairline bg-veil px-2.5 py-0.5 text-[0.75rem] font-semibold text-ink-secondary">
                        {server.runtimeVersion}
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

            {tab === 'overview' && (
                <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
                    {[
                        ['Status', status],
                        ['Runtime', server.runtimeVersion],
                        ['Plan', server.planId],
                        ['Region', server.region],
                        ['CPU limit', `${server.cpuMilli / 1000} vCPU`],
                        ['RAM limit', `${server.ramMb} MB`],
                        ['Storage limit', `${server.storageGb} GB`],
                        ['Startup', server.startup || '—'],
                        ['Storage used', usage ? fmtBytes(usage.usedBytes, usage.limitBytes) : '—'],
                        ['Auto-restart', server.autoRestart ? 'On' : 'Off'],
                        ['Auto-backup', server.autoBackup ? 'On' : 'Off'],
                    ].map(([label, value]) => (
                        <div key={label} className="rounded-xl border border-hairline bg-card p-5">
                            <p className="text-[0.8rem] text-ink-muted">{label}</p>
                            <p className="mt-1 font-mono text-[0.95rem] font-bold capitalize">{value}</p>
                        </div>
                    ))}
                    {stats && (
                        <>
                            <div className="rounded-xl border border-hairline bg-card p-5">
                                <p className="text-[0.8rem] text-ink-muted">CPU usage</p>
                                <p className="mt-1 font-mono text-[1.2rem] font-bold">{Math.min(100, Math.round(stats.cpuPercent ?? 0))}%</p>
                            </div>
                            <div className="rounded-xl border border-hairline bg-card p-5">
                                <p className="text-[0.8rem] text-ink-muted">RAM usage</p>
                                <p className="mt-1 font-mono text-[1.2rem] font-bold">
                                    {stats.memBytes && stats.memLimitBytes
                                        ? Math.min(100, Math.round((stats.memBytes / stats.memLimitBytes) * 100))
                                        : 0}%
                                </p>
                            </div>
                        </>
                    )}
                </div>
            )}

            {tab === 'console' && (
                <div className="overflow-hidden rounded-xl border border-hairline bg-card">
                    <div className="flex items-center gap-2 border-b border-hairline px-5 py-3">
                        <Terminal className="size-4 text-ink-muted" />
                        <span className="font-mono text-[0.85rem] font-semibold">
                            {online ? 'Interactive shell' : 'Live output'}
                        </span>
                        <span className={cn('ml-2 size-2 rounded-full', online ? 'animate-beat bg-emerald-500' : 'bg-zinc-600')} />
                    </div>
                    <div className="p-5">
                        {online ? (
                            <ExecTerminal key={server.id} server={server} />
                        ) : (
                            <>
                                <div ref={logRef} className="flex h-[320px] flex-col gap-1.5 overflow-y-auto font-mono text-[0.8rem] leading-relaxed text-ink-secondary">
                                    {logs
                                        ? logs.split('\n').filter(Boolean).map((line, i) => (
                                            <p key={i} className={cn(line.startsWith('$') && 'text-foreground')}>{line}</p>
                                        ))
                                        : <p className="text-ink-muted">Start the server to open an interactive shell.</p>
                                    }
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {tab === 'files' && <ServerFiles server={server} />}

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
                                    {fmtBytes(backup.sizeBytes)} • {new Date(backup.createdAt).toLocaleString()} {backup.type === 'auto' ? '• automatic' : '• manual'}
                                </p>
                            </div>
                            <div className="ml-auto flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => restoreBackup(backup.id)}
                                    disabled={backup.status !== 'ready'}
                                    className={cn(actionBtn, backup.status !== 'ready' && 'opacity-50')}
                                >
                                    <History className="size-3.5" /> Restore
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setMsg({ text: 'Downloads are not implemented yet.', ok: false })}
                                    className={actionBtn}
                                >
                                    <Download className="size-3.5" /> Download
                                </button>
                                <button
                                    type="button"
                                    aria-label={`Delete ${backup.name}`}
                                    onClick={() => deleteBackup(backup.id)}
                                    className={cn(actionBtn, 'hover:!border-red-500/50 hover:!text-red-400')}
                                >
                                    <Trash2 className="size-3.5" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

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
                        <p className="mt-1 text-[0.75rem] text-ink-muted">Values are masked (••••••••••••). Editing overwrites the stored value.</p>
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
                                onClick={reinstall}
                                className="rounded-full border border-hairline px-5 py-2 text-[0.83rem] font-bold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground"
                            >
                                Reinstall server
                            </button>
                            <button
                                type="button"
                                onClick={deleteServer}
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
