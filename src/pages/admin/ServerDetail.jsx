import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowLeft,
  Ban,
  Database,
  Folder,
  LayoutDashboard,
  Play,
  RotateCcw,
  Square,
  Terminal,
  Undo2,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { apiDelete, apiPatch, apiPost } from '@/lib/api.js';
import { useToast } from '@/hooks/useToast.jsx';
import {
  adminKeys,
  useAdminServer,
  useAdminServerAccess,
  useAdminServerBackups,
  useAdminServerLogs,
  useAdminServerQuota,
  useAdminServerStats,
  useAdminServerUsage,
  useAdminSuspendServer,
  useAdminUnsuspendServer,
} from '@/hooks/useAdminQueries.jsx';
import { ConfirmModal } from '@/components/ui/confirm-modal.jsx';
import { AvatarBadge } from '@/components/AvatarBadge.jsx';
import { STATUS_STYLE } from '../dashboard/Overview.jsx';
import ServerOverview from '../dashboard/ServerOverview.jsx';
import ExecTerminal, { ConsoleOffline } from '../dashboard/ExecTerminal.jsx';
import ResourceMonitor from '../dashboard/ResourceMonitor.jsx';
import ServerFiles from '../dashboard/ServerFiles.jsx';
import ServerBackups from '../dashboard/ServerBackups.jsx';
import ServerActivity from '../dashboard/ServerActivity.jsx';

const TABS = [
    { id: 'overview', label: 'Overview', Icon: LayoutDashboard },
    { id: 'console', label: 'Console', Icon: Terminal },
    { id: 'files', label: 'Files', Icon: Folder },
    { id: 'backups', label: 'Backups', Icon: Database },
    { id: 'activity', label: 'Activity', Icon: Activity },
];

const actionBtn =
    'inline-flex items-center gap-1.5 rounded-md border border-hairline bg-veil px-3 py-1.5 text-[0.8rem] font-semibold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40';

/**
 * Admin management view of a user's server: the same tabs the owner sees,
 * served by the audited admin mirror endpoints — never the user's session.
 * A short-lived access grant (minted on open, audited server-side) authorizes
 * the live socket channels.
 */
export default function AdminServerDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const toast = useToast();
    const qc = useQueryClient();
    const [tab, setTab] = useState('overview');
    const [grant, setGrant] = useState(null);
    const [suspendOpen, setSuspendOpen] = useState(false);
    const [reason, setReason] = useState('');

    const { data: server, isLoading, error, refetch: refetchServer } = useAdminServer(id);
    const { data: stats } = useAdminServerStats(id, !!server);
    const { data: usage } = useAdminServerUsage(id, !!server);
    const { data: logsData } = useAdminServerLogs(id, !!server && tab === 'console' && server?.status !== 'online');
    const { data: backups } = useAdminServerBackups(id);
    const { data: quota } = useAdminServerQuota(id);
    const access = useAdminServerAccess(id);
    const suspend = useAdminSuspendServer();
    const unsuspend = useAdminUnsuspendServer();

    // Open Server: mint the audited access grant (also re-minted periodically
    // so long-lived console sessions keep a fresh grant for reconnects).
    useEffect(() => {
        let alive = true;
        let timer = null;
        const mint = async () => {
            try {
                const out = await access.mutateAsync();
                if (alive) setGrant(out.grant);
            } catch (e) {
                if (alive) toast.error(e.message);
            }
            if (alive) timer = setTimeout(mint, 4 * 60 * 1000);
        };
        mint();
        return () => {
            alive = false;
            if (timer) clearTimeout(timer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    if (isLoading) return <div className="flex h-64 items-center justify-center text-ink-muted">Loading…</div>;
    if (error || !server) return <div className="text-red-400">Failed to load: {error?.message ?? 'not found'}</div>;

    const status = server.status;
    const online = status === 'online';
    const suspended = status === 'suspended';
    const logs = logsData?.logs ?? '';

    const runLifecycle = async (action, label) => {
        try {
            await apiPost(`/admin/servers/${id}/${action}`);
            toast.success(`${label} started.`);
            qc.invalidateQueries({ queryKey: adminKeys.server(id) });
            refetchServer();
        } catch (e) {
            toast.error(e.message);
        }
    };

    const doSuspend = async () => {
        try {
            await suspend.mutateAsync({ id, reason: reason.trim() || undefined });
            toast.success('Server suspended.');
            setSuspendOpen(false);
            setReason('');
            refetchServer();
        } catch (e) {
            toast.error(e.message);
        }
    };

    const doUnsuspend = async () => {
        try {
            await unsuspend.mutateAsync(id);
            toast.success('Server unsuspended — it stays stopped until the owner starts it.');
            refetchServer();
        } catch (e) {
            toast.error(e.message);
        }
    };

    const doDelete = async () => {
        try {
            await apiDelete(`/admin/servers/${id}`);
            toast.success('Server deleted.');
            navigate('/admin/servers');
        } catch (e) {
            toast.error(e.message);
        }
    };

    const createBackup = async () => {
        try {
            await apiPost(`/admin/servers/${id}/backups`);
            toast.success('Backup started.');
            qc.invalidateQueries({ queryKey: [...adminKeys.server(id), 'backups'] });
        } catch (e) {
            toast.error(e.message);
        }
    };

    const setAuto = async (patch) => {
        try {
            await apiPatch(`/admin/servers/${id}`, patch);
            toast.success('Saved.');
            refetchServer();
        } catch (e) {
            toast.error(e.message);
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <Link to="/admin/servers" className="inline-flex w-fit items-center gap-1.5 text-[0.85rem] font-semibold text-ink-secondary transition hover:text-foreground">
                <ArrowLeft className="size-4" /> All servers
            </Link>

            <div className="relative overflow-hidden rounded-xl border border-hairline bg-card p-6">
                <div className="relative flex flex-wrap items-center gap-3">
                    <span className={cn('size-3 rounded-full', STATUS_STYLE[status] ?? STATUS_STYLE.offline)} />
                    <h1 className="font-mono text-[1.4rem] font-extrabold">{server.name}</h1>
                    <span className="rounded-full border border-hairline bg-veil px-2.5 py-0.5 text-[0.75rem] font-semibold text-ink-secondary">
                        {server.runtimeLabel ?? server.runtime}
                    </span>
                    <span className="font-mono text-[0.75rem] text-ink-muted capitalize">{status}</span>
                    {server.owner && (
                        <Link to={`/admin/users/${server.owner.id}`} className="inline-flex items-center gap-2 font-mono text-[0.75rem] text-ink-secondary hover:text-foreground hover:underline">
                            <AvatarBadge url={null} name={server.owner.name} size="size-5" text="text-[0.6rem]" />
                            {server.owner.email}
                        </Link>
                    )}
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                        <button type="button" disabled={status !== 'offline'} onClick={() => runLifecycle('start', 'Start')} className={actionBtn}>
                            <Play className="size-3.5" /> Start
                        </button>
                        <button type="button" disabled={!online} onClick={() => runLifecycle('restart', 'Restart')} className={actionBtn}>
                            <RotateCcw className="size-3.5" /> Restart
                        </button>
                        <button type="button" disabled={!online} onClick={() => runLifecycle('stop', 'Stop')} className={actionBtn}>
                            <Square className="size-3.5" /> Stop
                        </button>
                        {suspended ? (
                            <button type="button" onClick={doUnsuspend} className={cn(actionBtn, 'border-emerald-500/40 text-emerald-300 hover:!border-emerald-500/60')}>
                                <Undo2 className="size-3.5" /> Unsuspend
                            </button>
                        ) : (
                            <button type="button" onClick={() => setSuspendOpen(true)} className={cn(actionBtn, 'border-amber-500/40 text-amber-300 hover:!border-amber-500/60')}>
                                <Ban className="size-3.5" /> Suspend
                            </button>
                        )}
                    </div>
                </div>
                {suspended && (
                    <p className="relative mt-3 rounded-xl border border-red-500/25 bg-red-500/[0.06] px-4 py-2.5 text-[0.82rem] text-red-300">
                        Suspended — the owner sees the suspension screen and every operation is blocked server-side.
                        Files below are read-only; Unsuspend returns it to stopped.
                    </p>
                )}
            </div>

            <div className="flex gap-1 overflow-x-auto border-b border-hairline">
                {TABS.map(({ id: tabId, label, Icon }) => (
                    <button
                        key={tabId}
                        type="button"
                        onClick={() => setTab(tabId)}
                        className={cn(
                            'flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-[0.88rem] font-semibold transition',
                            tab === tabId ? 'border-white text-foreground' : 'border-transparent text-ink-secondary hover:text-foreground',
                        )}
                    >
                        <Icon className="size-4" />
                        {label}
                    </button>
                ))}
            </div>

            {tab === 'overview' && (
                <ServerOverview server={server} status={status} stats={stats} usage={usage} backups={backups} quota={quota} onTab={setTab} onCreateBackup={createBackup} adminMode />
            )}

            {tab === 'console' && (
                <>
                    {online ? (
                        <ExecTerminal key={`${server.id}:${grant ?? 'nogrt'}`} server={server} apiBase="/admin/servers" grant={grant} />
                    ) : (
                        <ConsoleOffline server={server} status={status} logs={logs} />
                    )}
                    <ResourceMonitor server={server} status={status} usage={usage} liveOpts={grant ? { grant } : undefined} />
                </>
            )}

            {tab === 'files' && <ServerFiles server={server} apiBase="/admin/servers" readOnly />}

            {tab === 'backups' && (
                <ServerBackups
                    server={server}
                    backups={backups ?? []}
                    quota={quota}
                    creating={false}
                    onCreateBackup={createBackup}
                    onToggleAuto={(on) => setAuto({ autoBackup: on })}
                    onRetain={(n) => setAuto({ autoBackupRetain: n })}
                    onRestore={async (b) => {
                        try {
                            await apiPost(`/admin/servers/${id}/backups/${b.id}/restore`);
                            toast.success('Restore started.');
                            qc.invalidateQueries({ queryKey: [...adminKeys.server(id), 'backups'] });
                        } catch (e) {
                            toast.error(e.message);
                        }
                    }}
                    onDelete={async (b) => {
                        try {
                            await apiDelete(`/admin/servers/${id}/backups/${b.id}`);
                            toast.success('Backup deleted.');
                            qc.invalidateQueries({ queryKey: [...adminKeys.server(id), 'backups'] });
                        } catch (e) {
                            toast.error(e.message);
                        }
                    }}
                />
            )}

            {tab === 'activity' && <ServerActivity server={server} apiBase="/admin/servers" />}

            <ConfirmModal
                open={suspendOpen}
                onClose={() => { setSuspendOpen(false); setReason(''); }}
                title="Suspend server"
                description="The container is stopped (if running) and every owner operation — start, restart, console, files, backups — is blocked server-side. Data, files and configuration are preserved."
                confirmLabel="Suspend server"
                danger
                onConfirm={doSuspend}
            >
                <label className="flex flex-col gap-1.5 text-left text-[0.85rem] font-semibold">
                    Reason (shown in the audit log)
                    <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="e.g. abuse report #123"
                        maxLength={300}
                        className="w-full rounded-md border border-hairline bg-black/40 px-3.5 py-2.5 font-normal text-[0.88rem] text-foreground placeholder-ink-muted focus:border-primary focus:outline-none"
                    />
                </label>
                <p className="mt-2 text-[0.82rem] text-ink-secondary">
                    Server: <span className="font-mono font-bold text-ink">{server.name}</span>
                    {server.owner && <> · owned by <span className="font-mono">{server.owner.email}</span></>}
                </p>
            </ConfirmModal>
        </div>
    );
}
