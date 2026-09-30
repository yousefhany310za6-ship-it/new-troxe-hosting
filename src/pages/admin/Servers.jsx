import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, Plus, RotateCcw, Square, Trash2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/useToast.jsx';
import { useAdminDeleteServer, useAdminLifecycle, useAdminServers } from '@/hooks/useAdminQueries.jsx';
import { STATUS_STYLE } from '../dashboard/Overview.jsx';

const inputClass =
    'rounded-xl border border-hairline bg-white/10 px-4 py-2 text-[0.85rem] text-foreground placeholder-ink-muted transition focus:border-primary focus:outline-none';
const actionBtn =
    'inline-flex items-center gap-1.5 rounded-md border border-hairline bg-veil px-3 py-1.5 text-[0.8rem] font-semibold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40';

const STATUSES = ['', 'online', 'offline', 'restarting', 'provisioning', 'error', 'deleting'];

export default function AdminServers() {
    const toast = useToast();
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [q, setQ] = useState('');
    const [status, setStatus] = useState('');
    const { data, isLoading, error, refetch } = useAdminServers({ page, limit: 20, search: q || undefined, status: status || undefined });
    const lifecycle = useAdminLifecycle();
    const del = useAdminDeleteServer();

    const submitSearch = (e) => { e.preventDefault(); setPage(1); setQ(search.trim()); };

    const act = async (id, action, label) => {
        try { await lifecycle.mutateAsync({ id, action }); toast.success(`${label} started.`); }
        catch (e) { toast.error(e.message); }
    };

    const remove = async (id, name) => {
        if (!window.confirm(`DELETE server "${name}" and ALL its data? This cannot be undone.`)) return;
        if (window.prompt('Type DELETE to confirm:') !== 'DELETE') { toast.error('Confirmation failed. Deletion cancelled.'); return; }
        try { await del.mutateAsync(id); toast.success('Server deleted.'); refetch(); }
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
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or runtime…" className={cn(inputClass, 'w-64')} />
                <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={inputClass}>
                    {STATUSES.map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}
                </select>
                <button type="submit" className="rounded-full bg-white px-5 py-2 text-sm font-bold text-black transition hover:bg-gray-200">Search</button>
            </form>

            {isLoading && <p className="text-ink-muted">Loading…</p>}
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
                                    <span className="font-mono text-[0.75rem] capitalize text-ink-muted">{s.status}</span>
                                    <Link to={s.owner ? `/admin/users/${s.owner.id}` : '#'} className="font-mono text-[0.75rem] text-ink-secondary hover:text-foreground hover:underline">
                                        {s.owner ? s.owner.email : s.ownerId}
                                    </Link>
                                    <div className="ml-auto flex items-center gap-2">
                                        <button type="button" onClick={() => act(s.id, 'start', 'Start')} className={actionBtn}><Play className="size-3.5" /></button>
                                        <button type="button" onClick={() => act(s.id, 'restart', 'Restart')} className={actionBtn}><RotateCcw className="size-3.5" /></button>
                                        <button type="button" onClick={() => act(s.id, 'stop', 'Stop')} className={actionBtn}><Square className="size-3.5" /></button>
                                        <button type="button" onClick={() => remove(s.id, s.name)} aria-label="Delete server" className={cn(actionBtn, 'hover:!border-red-500/50 hover:!text-red-400')}>
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
        </div>
    );
}