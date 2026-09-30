import { useState } from 'react';

import { cn } from '@/lib/utils';
import { useAdminAudit } from '@/hooks/useAdminQueries.jsx';

const inputClass =
    'rounded-xl border border-hairline bg-white/10 px-4 py-2 text-[0.85rem] text-foreground placeholder-ink-muted transition focus:border-primary focus:outline-none';

export default function AdminAudit() {
    const [page, setPage] = useState(1);
    const [action, setAction] = useState('');
    const [q, setQ] = useState('');
    const [targetType, setTargetType] = useState('');

    const { data, isLoading, error } = useAdminAudit({ page, limit: 50, action: q || undefined, targetType: targetType || undefined });

    const submit = (e) => { e.preventDefault(); setPage(1); setQ(action.trim()); };

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-[1.6rem] font-extrabold tracking-tight">Audit log</h1>
                <p className="mt-1 text-[0.92rem] text-ink-secondary">Every admin and user action — who did what, and when.</p>
            </div>

            <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
                <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Filter by action (e.g. admin.server)…" className={cn(inputClass, 'w-72')} />
                <select value={targetType} onChange={(e) => { setTargetType(e.target.value); setPage(1); }} className={inputClass}>
                    <option value="">All targets</option>
                    <option value="user">user</option>
                    <option value="server">server</option>
                    <option value="plan">plan</option>
                    <option value="backup">backup</option>
                </select>
                <button type="submit" className="rounded-full bg-white px-5 py-2 text-sm font-bold text-black transition hover:bg-gray-200">Filter</button>
            </form>

            {isLoading && <p className="text-ink-muted">Loading…</p>}
            {error && <p className="text-red-400">Failed to load: {error.message}</p>}

            {data && (
                <>
                    <div className="overflow-hidden rounded-xl border border-hairline bg-card">
                        <div className="hidden grid-cols-[220px_1fr_130px_130px_180px] gap-4 border-b border-hairline px-6 py-3 font-mono text-[0.7rem] uppercase tracking-wider text-ink-muted lg:grid">
                            <span>Action</span><span>Actor</span><span>Target</span><span>Target ID</span><span>Date</span>
                        </div>
                        <div className="flex flex-col divide-y divide-hairline">
                            {data.data.map((a) => (
                                <div key={a.id} className="grid grid-cols-1 gap-1 px-6 py-3 lg:grid-cols-[220px_1fr_130px_130px_180px] lg:items-center lg:gap-4">
                                    <span className={cn(
                                        'w-fit rounded-full px-2 py-0.5 font-mono text-[0.7rem] font-bold',
                                        a.action.startsWith('admin.') ? 'bg-red-500/15 text-red-400' : 'bg-white/10 text-ink-secondary'
                                    )}>{a.action}</span>
                                    <span className="truncate font-mono text-[0.78rem] text-ink-secondary" title={a.actorId}>{a.actorEmail || a.actorId}</span>
                                    <span className="font-mono text-[0.78rem] text-ink-secondary">{a.targetType ?? '—'}</span>
                                    <span className="truncate font-mono text-[0.75rem] text-ink-muted" title={a.targetId}>{a.targetId ? `${a.targetId.slice(0, 8)}…` : '—'}</span>
                                    <span className="font-mono text-[0.75rem] text-ink-muted">{new Date(a.createdAt).toLocaleString()}</span>
                                </div>
                            ))}
                            {data.data.length === 0 && <p className="px-6 py-8 text-center text-ink-muted">No entries.</p>}
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-full border border-hairline px-5 py-2 text-sm font-bold text-ink-secondary transition hover:text-foreground disabled:opacity-40">Prev</button>
                        <span className="font-mono text-[0.8rem] text-ink-muted">Page {data.pagination.page} / {Math.max(1, data.pagination.pages)} · {data.pagination.total} entries</span>
                        <button type="button" disabled={page >= data.pagination.pages} onClick={() => setPage((p) => p + 1)} className="rounded-full border border-hairline px-5 py-2 text-sm font-bold text-ink-secondary transition hover:text-foreground disabled:opacity-40">Next</button>
                    </div>
                </>
            )}
        </div>
    );
}