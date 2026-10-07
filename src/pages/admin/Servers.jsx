import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Ban, ExternalLink, Play, Plus, RotateCcw, SearchX, Server as ServerIcon, Square, Trash2, Undo2 } from 'lucide-react';

import { useToast } from '@/hooks/useToast.jsx';
import {
    useAdminDeleteServer,
    useAdminLifecycle,
    useAdminServers,
    useAdminStats,
    useAdminSuspendServer,
    useAdminUnsuspendServer,
} from '@/hooks/useAdminQueries.jsx';
import { ConfirmModal } from '@/components/ui/confirm-modal.jsx';
import { Select } from '@/components/ui/select.jsx';
import {
    EmptyState,
    ErrorState,
    Menu,
    PageHeader,
    Pager,
    SearchInput,
    Stat,
    StatGrid,
    StatusBadge,
    TableSkeleton,
    serverTone,
    timeAgo,
} from './components.jsx';

const actionBtn =
    'inline-flex items-center gap-1.5 rounded-md border border-hairline bg-veil px-3 py-1.5 text-[0.8rem] font-semibold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40';

const SORTS = [
    { value: 'createdAt', label: 'Created' },
    { value: 'name', label: 'Name' },
    { value: 'status', label: 'Status' },
    { value: 'runtime', label: 'Runtime' },
];

export default function AdminServers() {
    const toast = useToast();
    const [params, setParams] = useSearchParams();
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [q, setQ] = useState('');
    const [status, setStatus] = useState(() => params.get('status') ?? '');
    const [sortBy, setSortBy] = useState('createdAt');
    const [sortOrder, setSortOrder] = useState('desc');
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [suspendTarget, setSuspendTarget] = useState(null);
    const [suspendReason, setSuspendReason] = useState('');

    const { data, isLoading, error, refetch } = useAdminServers({
        page,
        limit: 20,
        search: q || undefined,
        status: status || undefined,
        sortBy,
        sortOrder,
    });
    const { data: stats } = useAdminStats();
    const lifecycle = useAdminLifecycle();
    const del = useAdminDeleteServer();
    const suspend = useAdminSuspendServer();
    const unsuspend = useAdminUnsuspendServer();

    useEffect(() => {
        setParams(
            (prev) => {
                const next = new URLSearchParams(prev);
                if (status) next.set('status', status);
                else next.delete('status');
                return next;
            },
            { replace: true },
        );
    }, [status, setParams]);

    useEffect(() => {
        const s = params.get('status') ?? '';
        if (s !== status) {
            setStatus(s);
            setPage(1);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params]);

    const submitSearch = (e) => {
        e.preventDefault();
        setPage(1);
        setQ(search.trim());
    };

    const act = async (id, action, label) => {
        try {
            await lifecycle.mutateAsync({ id, action });
            toast.success(`${label} started.`);
        } catch (e) {
            toast.error(e.message);
        }
    };

    const remove = async () => {
        await del.mutateAsync(deleteTarget.id);
        toast.success('Server deleted.');
        refetch();
    };

    const doSuspend = async () => {
        try {
            await suspend.mutateAsync({ id: suspendTarget.id, reason: suspendReason.trim() || undefined });
            toast.success('Server suspended.');
            setSuspendTarget(null);
            setSuspendReason('');
            refetch();
        } catch (e) {
            toast.error(e.message);
        }
    };

    const doUnsuspend = async (s) => {
        try {
            await unsuspend.mutateAsync(s.id);
            toast.success('Server unsuspended.');
            refetch();
        } catch (e) {
            toast.error(e.message);
        }
    };

    const sv = stats?.servers ?? {};
    const suspendedOnly = status === 'suspended';

    return (
        <div className="flex flex-col gap-5">
            <PageHeader
                title="Servers"
                description="Every sandbox on the platform — inspect, control, suspend or delete."
                actions={
                    <Link
                        to="/admin/servers/new"
                        className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:bg-gray-200"
                    >
                        <Plus className="size-4" /> New server
                    </Link>
                }
            />

            <StatGrid>
                <Stat label="Total" value={sv.total ?? '—'} context={`${sv.online ?? 0} running`} />
                <Stat label="Running" value={sv.online ?? '—'} context={`${sv.offline ?? 0} stopped`} />
                <Stat label="Suspended" value={sv.suspended ?? '—'} context="Blocked by administration" tone="warn" to="/admin/servers?status=suspended" />
                <Stat label="Error" value={sv.error ?? '—'} context="Needs attention" tone={(sv.error ?? 0) > 0 ? 'danger' : undefined} />
            </StatGrid>

            <form onSubmit={submitSearch} className="flex flex-wrap items-center gap-2" role="search">
                <SearchInput value={search} onChange={setSearch} placeholder="Search name or runtime…" />
                <Select
                    ariaLabel="Filter by status"
                    value={status}
                    onChange={(v) => {
                        setStatus(v);
                        setPage(1);
                    }}
                    options={[
                        { value: '', label: 'All statuses' },
                        { value: 'online', label: 'online' },
                        { value: 'offline', label: 'offline' },
                        { value: 'restarting', label: 'restarting' },
                        { value: 'provisioning', label: 'provisioning' },
                        { value: 'suspended', label: 'suspended' },
                        { value: 'error', label: 'error' },
                        { value: 'deleting', label: 'deleting' },
                    ]}
                    className="w-44"
                />
                <Select
                    ariaLabel="Sort servers"
                    value={`${sortBy}:${sortOrder}`}
                    onChange={(v) => {
                        const [b, o] = v.split(':');
                        setSortBy(b);
                        setSortOrder(o);
                        setPage(1);
                    }}
                    options={SORTS.flatMap((s) => [
                        { value: `${s.value}:desc`, label: `${s.label} ↓` },
                        { value: `${s.value}:asc`, label: `${s.label} ↑` },
                    ])}
                    className="w-44"
                />
                <button type="submit" className="rounded-full bg-white px-5 py-2 text-sm font-bold text-black transition hover:bg-gray-200">
                    Search
                </button>
            </form>

            {isLoading && <TableSkeleton rows={8} />}
            {error && <ErrorState message={error.message} onRetry={refetch} />}

            {data && (
                <>
                    <div className="overflow-hidden rounded-xl border border-hairline bg-card">
                        <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_110px_minmax(0,1fr)_90px_110px_48px] items-center gap-3 border-b border-hairline px-5 py-2.5 font-mono text-[0.68rem] tracking-wider text-ink-muted uppercase lg:grid">
                            <span>Server</span><span>Owner</span><span>Status</span><span>Resources</span><span>Created</span><span>Activity</span><span className="sr-only">Actions</span>
                        </div>
                        <div className="flex flex-col divide-y divide-hairline">
                            {data.data.map((s) => (
                                <div key={s.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3 transition hover:bg-white/[0.02] sm:px-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_110px_minmax(0,1fr)_90px_110px_48px] lg:gap-3">
                                    <Link to={`/admin/servers/${s.id}`} className="flex min-w-0 items-center gap-2.5">
                                        <ServerIcon size={16} className="shrink-0 text-ink-muted" />
                                        <span className="min-w-0">
                                            <span className="block truncate font-mono text-[0.87rem] font-bold">{s.name}</span>
                                            <span className="mt-0.5 block truncate text-[0.7rem] text-ink-muted lg:hidden">
                                                {s.owner?.email ?? s.ownerId} · {s.status}
                                            </span>
                                        </span>
                                    </Link>
                                    <span className="hidden min-w-0 truncate font-mono text-[0.76rem] text-ink-secondary lg:block" title={s.owner?.email ?? s.ownerId}>
                                        {s.owner?.email ?? s.ownerId}
                                    </span>
                                    <span>
                                        <StatusBadge tone={serverTone(s.status)}>{s.status}</StatusBadge>
                                    </span>
                                    <span className="hidden truncate font-mono text-[0.74rem] text-ink-muted lg:block" title={`${s.cpuMilli / 1000} vCPU · ${s.ramMb} MB · ${s.storageGb} GB`}>
                                        {s.cpuMilli / 1000} vCPU · {s.ramMb} MB · {s.storageGb} GB
                                    </span>
                                    <span className="hidden font-mono text-[0.74rem] text-ink-muted lg:block">
                                        {new Date(s.createdAt).toLocaleDateString()}
                                    </span>
                                    <span className="hidden font-mono text-[0.74rem] text-ink-muted lg:block">{timeAgo(s.updatedAt)}</span>
                                    <span className="flex items-center justify-end gap-1">
                                        <Link
                                            to={`/admin/servers/${s.id}`}
                                            aria-label={`Open ${s.name}`}
                                            title="Open server"
                                            className="hidden size-8 items-center justify-center rounded-lg text-ink-muted transition hover:bg-white/10 hover:text-foreground sm:inline-flex"
                                        >
                                            <ExternalLink size={15} />
                                        </Link>
                                        <Menu
                                            label={`Actions for ${s.name}`}
                                            items={[
                                                { key: 'open', label: 'Open server', to: `/admin/servers/${s.id}` },
                                                { key: 'start', label: 'Start', Icon: Play, disabled: s.status !== 'offline', onSelect: () => act(s.id, 'start', 'Start') },
                                                { key: 'restart', label: 'Restart', Icon: RotateCcw, disabled: s.status !== 'online', onSelect: () => act(s.id, 'restart', 'Restart') },
                                                { key: 'stop', label: 'Stop', Icon: Square, disabled: s.status !== 'online', onSelect: () => act(s.id, 'stop', 'Stop') },
                                                s.status === 'suspended'
                                                    ? { key: 'unsuspend', label: 'Unsuspend', Icon: Undo2, onSelect: () => doUnsuspend(s) }
                                                    : { key: 'suspend', label: 'Suspend', Icon: Ban, danger: true, onSelect: () => setSuspendTarget(s) },
                                                { key: 'delete', label: 'Delete', Icon: Trash2, danger: true, onSelect: () => setDeleteTarget(s) },
                                            ]}
                                        />
                                    </span>
                                </div>
                            ))}
                            {data.data.length === 0 && (
                                <EmptyState
                                    icon={suspendedOnly ? Ban : SearchX}
                                    title={suspendedOnly ? 'No suspended servers' : 'No servers found'}
                                    hint={suspendedOnly ? 'No server is currently suspended.' : 'Try a different search or filter.'}
                                />
                            )}
                        </div>
                    </div>
                    <Pager page={data.pagination.page} pages={data.pagination.pages} total={data.pagination.total} unit="servers" onPage={setPage} />
                </>
            )}

            <ConfirmModal
                open={!!suspendTarget}
                onClose={() => { setSuspendTarget(null); setSuspendReason(''); }}
                title="Suspend server"
                description="The container is stopped (if running) and every owner operation is blocked server-side. Data, files and configuration are preserved."
                confirmLabel="Suspend server"
                danger
                onConfirm={doSuspend}
            >
                <label className="flex flex-col gap-1.5 text-left text-[0.85rem] font-semibold">
                    Reason (audit log)
                    <input
                        value={suspendReason}
                        onChange={(e) => setSuspendReason(e.target.value)}
                        placeholder="e.g. abuse report #123"
                        maxLength={300}
                        className="w-full rounded-md border border-hairline bg-black/40 px-3.5 py-2.5 font-normal text-[0.88rem] text-foreground placeholder-ink-muted focus:border-primary focus:outline-none"
                    />
                </label>
                <p className="mt-2 text-[0.82rem] text-ink-secondary">
                    Server: <span className="font-mono font-bold text-ink">{suspendTarget?.name}</span>
                </p>
            </ConfirmModal>

            <ConfirmModal
                open={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                title="Delete server"
                description="This permanently deletes the server, its files and ALL its backups. This action is irreversible."
                confirmLabel="Delete server"
                confirmPhrase="DELETE"
                onConfirm={remove}
            >
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-[0.82rem] text-red-300">
                    Server: <span className="font-mono font-bold">{deleteTarget?.name}</span>
                    {deleteTarget?.owner?.email && <> · owned by <span className="font-mono">{deleteTarget.owner.email}</span></>}
                </p>
            </ConfirmModal>
        </div>
    );
}
