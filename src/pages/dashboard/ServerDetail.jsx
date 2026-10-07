import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
    ArrowLeft,
    Check,
    Database,
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
import { ConfirmModal } from '@/components/ui/confirm-modal.jsx';
import { Select } from '@/components/ui/select.jsx';
import ServerFiles from './ServerFiles.jsx';
import ExecTerminal, { ConsoleOffline } from './ExecTerminal.jsx';
import ResourceMonitor from './ResourceMonitor.jsx';
import ServerOverview from './ServerOverview.jsx';

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
    const [reinstallOpen, setReinstallOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [restoreTarget, setRestoreTarget] = useState(null);
    const [deleteBackupTarget, setDeleteBackupTarget] = useState(null);


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

    // Only used for the offline console view (the live console streams over
    // its own socket). Works for stopped containers too: their output is kept.
    const fetchLogs = async () => {
        if (!server?.containerId) return;
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
            if (tab === 'console' && status !== 'online') fetchLogs();
        }, 5000);
        return () => { alive = false; clearInterval(interval); };
    }, [server, tab, status]);

    useEffect(() => {
        if (server) setStatus(server.status);
    }, [server]);

    useEffect(() => {
        if (tab === 'console' && status !== 'online') fetchLogs();
    }, [tab, status, id, server?.containerId]);

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
        setLogs('');
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
        setLogs('');
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
        await apiPost(`/servers/${id}/backups/${backupId}/restore`);
        setMsg({ text: 'Restore started', ok: true });
        fetchBackups();
        fetchServer();
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
        await apiPost(`/servers/${id}/reinstall`);
        setMsg({ text: 'Reinstall started', ok: true });
        fetchServer();
    };

    const deleteServer = async () => {
        await apiDelete(`/servers/${id}`);
        navigate('/dashboard/servers');
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
                        {server.runtimeLabel ?? server.runtime}
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
                <ServerOverview
                    server={server}
                    status={status}
                    stats={stats}
                    usage={usage}
                    backups={backups}
                    onTab={(t) => { setTab(t); setMsg({ text: '', ok: true }); }}
                    onCreateBackup={createBackup}
                />
            )}

            {tab === 'console' && (
                <>
                    {online ? (
                        <ExecTerminal key={server.id} server={server} />
                    ) : (
                        <ConsoleOffline server={server} status={status} logs={logs} onStart={start} />
                    )}
                    <ResourceMonitor server={server} status={status} usage={usage} />
                </>
            )}

            {tab === 'files' && <ServerFiles server={server} />}

            {tab === 'backups' && (
                <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-hairline bg-card p-5">
                        <Database className="size-5 shrink-0 text-ink-muted" />
                        <div className="min-w-0 flex-1">
                            <p className="text-[0.92rem] font-bold">Automatic backups</p>
                            <p className="mt-0.5 text-[0.8rem] text-ink-secondary">
                                {server.autoBackup
                                    ? `Daily snapshot, keeping the newest ${server.autoBackupRetain ?? 7}.`
                                    : 'Off — only manual snapshots.'}
                            </p>
                        </div>
                        <label className="flex cursor-pointer items-center gap-2 text-[0.85rem] font-semibold">
                            <input
                                type="checkbox"
                                checked={!!server.autoBackup}
                                onChange={async (e) => {
                                    try {
                                        await apiPatch(`/servers/${id}`, { autoBackup: e.target.checked });
                                        setMsg({ text: `Automatic backups ${e.target.checked ? 'enabled' : 'disabled'}.`, ok: true });
                                        fetchServer();
                                    } catch (err) { setMsg({ text: err.message, ok: false }); }
                                }}
                                className="size-4 accent-white"
                            />
                            Auto
                        </label>
                        {server.autoBackup && (
                            <span className="flex items-center gap-2 text-[0.85rem] font-semibold">
                                Keep
                                <Select
                                    ariaLabel="Backup retention"
                                    value={String(server.autoBackupRetain ?? 7)}
                                    onChange={async (v) => {
                                        try {
                                            await apiPatch(`/servers/${id}`, { autoBackupRetain: Number(v) });
                                            setMsg({ text: `Retention set to ${v} snapshots.`, ok: true });
                                            fetchServer();
                                        } catch (err) { setMsg({ text: err.message, ok: false }); }
                                    }}
                                    options={[1, 3, 7, 14, 30].map((n) => ({ value: String(n), label: `${n} snapshot${n === 1 ? '' : 's'}` }))}
                                    buttonClassName="px-2.5 py-1.5 font-mono text-[0.82rem]"
                                />
                            </span>
                        )}
                    </div>
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
                                    onClick={() => setRestoreTarget(backup)}
                                    disabled={backup.status !== 'ready'}
                                    className={cn(actionBtn, backup.status !== 'ready' && 'opacity-50')}
                                >
                                    <History className="size-3.5" /> Restore
                                </button>
                                <button
                                    type="button"
                                    aria-label={`Delete ${backup.name}`}
                                    onClick={() => setDeleteBackupTarget(backup)}
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
                                onClick={() => setReinstallOpen(true)}
                                className="rounded-full border border-hairline px-5 py-2 text-[0.83rem] font-bold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground"
                            >
                                Reinstall server
                            </button>
                            <button
                                type="button"
                                onClick={() => setDeleteOpen(true)}
                                className="rounded-full border border-red-500/40 px-5 py-2 text-[0.83rem] font-bold text-red-400 transition hover:bg-red-500 hover:text-white"
                            >
                                Delete server
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ---------- destructive-action modals ---------- */}
            <ConfirmModal
                open={reinstallOpen}
                onClose={() => setReinstallOpen(false)}
                title="Reinstall server"
                description="This wipes the server's filesystem and re-provisions it from scratch. Environment variables are kept; all files and data are lost."
                confirmLabel="Reinstall"
                confirmPhrase={server?.name ?? ''}
                phraseHint={server ? <>Type the server name <span className="font-mono font-bold text-ink">{server.name}</span> to confirm</> : null}
                onConfirm={reinstall}
            >
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[0.82rem] text-amber-300">
                    Server: <span className="font-mono font-bold">{server?.name}</span> — all current files will be permanently erased.
                </p>
            </ConfirmModal>

            <ConfirmModal
                open={deleteOpen}
                onClose={() => setDeleteOpen(false)}
                title="Delete server"
                description="This permanently deletes the server, its files and ALL its backups. This action is irreversible."
                confirmLabel="Delete server"
                confirmPhrase="DELETE"
                onConfirm={deleteServer}
            >
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-[0.82rem] text-red-300">
                    Server: <span className="font-mono font-bold">{server?.name}</span> — files, data and backups will all be destroyed.
                </p>
            </ConfirmModal>

            <ConfirmModal
                open={!!restoreTarget}
                onClose={() => setRestoreTarget(null)}
                title="Restore backup"
                description="The server's current files will be replaced with this snapshot. Files created after the snapshot are lost."
                confirmLabel="Restore"
                onConfirm={() => restoreBackup(restoreTarget.id)}
            >
                <p className="text-[0.85rem] text-ink-secondary">
                    Snapshot: <span className="font-mono font-bold text-ink">{restoreTarget?.name}</span>
                    {' '}({restoreTarget && new Date(restoreTarget.createdAt).toLocaleString()})
                </p>
            </ConfirmModal>

            <ConfirmModal
                open={!!deleteBackupTarget}
                onClose={() => setDeleteBackupTarget(null)}
                title="Delete backup"
                description="This snapshot will be permanently removed. The server itself is not affected."
                confirmLabel="Delete backup"
                onConfirm={() => deleteBackup(deleteBackupTarget.id)}
            >
                <p className="text-[0.85rem] text-ink-secondary">
                    Snapshot: <span className="font-mono font-bold text-ink">{deleteBackupTarget?.name}</span>
                </p>
            </ConfirmModal>
        </div>
    );
}
