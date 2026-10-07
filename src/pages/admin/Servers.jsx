import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, ExternalLink, Play, Plus, RotateCcw, Square, Trash2, Undo2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/useToast.jsx';
import { useAdminDeleteServer, useAdminLifecycle, useAdminServers, useAdminSuspendServer, useAdminUnsuspendServer } from '@/hooks/useAdminQueries.jsx';
import { ConfirmModal } from '@/components/ui/confirm-modal.jsx';
import { Select } from '@/components/ui/select.jsx';
import { Skeleton } from '@/components/ui/field.jsx';
import { STATUS_STYLE } from '../dashboard/Overview.jsx';

const actionBtn =
    'inline-flex items-center gap-1.5 rounded-md border border-hairline bg-veil px-3 py-1.5 text-[0.8rem] font-semibold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40';

const STATUSES = ['online', 'offline', 'restarting', 'provisioning', 'error', 'suspended', 'deleting'];

export default function AdminServers() {
    const toast = useToast();
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [q, setQ] = useState('');
    const [status, setStatus] = useState('');
    const [deleteTarget, setDeleteTarget] = useState(null);
    const { data, isLoading, error, refetch } = useAdminServers({ page, limit: 20, search: q || undefined, status: status || undefined });
    const lifecycle = useAdminLifecycle();
    const del = useAdminDeleteServer();
    const suspend = useAdminSuspendServer();
    const unsuspend = useAdminUnsuspendServer();

    const submitSearch = (e) => { e.preventDefault(); setPage(1); setQ(search.trim()); };

    const act = async (id, action, label) => {
        try { await lifecycle.mutateAsync({ id, action }); toast.success(`${label} started.`); }
        catch (e) { toast.error(e.message); }
    };

    const remove = async () => {
        await del.mutateAsync(deleteTarget.id);
        toast.success('Server deleted.');
        refetch();
    };

    const doSuspend = async (s) => {
        try { await suspend.mutateAsync({ id: s.id }); toast.success(`Server suspended.`); refetch(); }
        catch (e) { toast.error(e.message); }
    };

    const doUnsuspend = async (s) => {
        try { await unsuspend.mutateAsync(s.id); toast.success('Server unsuspended.'); refetch(); }
        catch (e) { toast.error(e.message); }
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-[1.6rem] font-extrabold tracking-tight">Servers</h1>
                    <p className="mt-1 text-[0.92rem] text-ink-secondary">{data?.pagination.total ?? '—'} sandboxes platform-wide</p>
                </div>
                <Link to="/admin/servers/new" className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:bg-gray-200">
                    <Plus className="size-4" /> New server
                </Link>
            </div>

            <form onSubmit={submitSearch} className="flex flex-wrap items-center gap-2">
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or runtime…" className="input-field w-64" />
                <Select
                    ariaLabel="Filter by status"
                    value={status}
                    onChange={(v) => { setStatus(v); setPage(1); }}
                    options={[{ value: '', label: 'All statuses' }, ...STATUSES.map((s) => ({ value: s, label: s }))]}
                    className="w-44"
                />
                <button type="submit" className="rounded-full bg-white px-5 py-2 text-sm font-bold text-black transition hover:bg-gray-200">Search</button>
            </form>

            {isLoading && (
                <div className="flex flex-col gap-3">
                    {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[72px] rounded-xl" />)}
                </div>
            )}
            {error && <p className="text-red-400">Failed to load: {error.message}</p>}

            {data && (
                <>
                    <div className="flex flex-col gap-3">
                        {data.data.map((s) => (
                            <div key={s.id} className="rounded-xl border border-hairline bg-card p-5">
                                <div className="flex flex-wrap items-center gap-3">
                                    <span className={cn('size-2.5 shrink-0 rounded-full', STATUS_STYLE[s.status])} />
                                    <span className="font-mono text-[0.95rem] font-bold">{s.name}</span>
                                    <span className="rounded-full border border-hairline bg-veil px-2 py-0.5 text-[0.72rem] text-ink-secondary">{s.runtime}</span>
                                    <span className={cn('rounded-full border px-2 py-0.5 font-mono text-[0.7rem] font-semibold capitalize', s.status === 'suspended' ? 'border-red-500/40 bg-red-500/10 text-red-300' : 'border-hairline bg-veil text-ink-muted')}>{s.status}</span>
                                    <Link to={s.owner ? `/admin/users/${s.owner.id}` : '#'} className="font-mono text-[0.75rem] text-ink-secondary hover:text-foreground hover:underline">
                                        {s.owner ? s.owner.email : s.ownerId}
                                    </Link>
                                    <div className="ml-auto flex items-center gap-2">
                                        <Link to={`/admin/servers/${s.id}`} aria-label={`Open ${s.name}`} title="Open server" className={actionBtn}><ExternalLink className="size-3.5" /></Link>
                                        <button type="button" onClick={() => act(s.id, 'start', 'Start')} className={actionBtn}><Play className="size-3.5" /></button>
                                        <button type="button" onClick={() => act(s.id, 'restart', 'Restart')} className={actionBtn}><RotateCcw className="size-3.5" /></button>
                                        <button type="button" onClick={() => act(s.id, 'stop', 'Stop')} className={actionBtn}><Square className="size-3.5" /></button>
                                        {s.status === 'suspended'
                                            ? <button type="button" onClick={() => doUnsuspend(s)} aria-label="Unsuspend server" title="Unsuspend" className={cn(actionBtn, 'border-emerald-500/40 text-emerald-300')}><Undo2 className="size-3.5" /></button>
                                            : <button type="button" onClick={() => doSuspend(s)} aria-label="Suspend server" title="Suspend" className={cn(actionBtn, 'border-amber-500/40 text-amber-300')}><Ban className="size-3.5" /></button>}
                                        <button type="button" onClick={() => setDeleteTarget(s)} aria-label="Delete server" className={cn(actionBtn, 'hover:!border-red-500/50 hover:!text-red-400')}>
                                            <Trash2 className="size-3.5" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                        {data.data.length === 0 && <p className="text-center text-ink-muted">No servers found.</p>}
                    </div>

                    <div className="flex items-center gap-3">
                        <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-full border border-hairline px-5 py-2 text-sm font-bold text-ink-secondary transition hover:text-foreground disabled:opacity-40">Prev</button>
                        <span className="font-mono text-[0.8rem] text-ink-muted">Page {data.pagination.page} / {Math.max(1, data.pagination.pages)}</span>
                        <button type="button" disabled={page >= data.pagination.pages} onClick={() => setPage((p) => p + 1)} className="rounded-full border border-hairline px-5 py-2 text-sm font-bold text-ink-secondary transition hover:text-foreground disabled:opacity-40">Next</button>
                    </div>
                </>
            )}

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