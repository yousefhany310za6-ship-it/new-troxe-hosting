import { useState } from 'react';

import { cn } from '@/lib/utils';
import { useAdminAudit } from '@/hooks/useAdminQueries.jsx';
import { Select } from '@/components/ui/select.jsx';
import { Skeleton } from '@/components/ui/field.jsx';

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
                <input value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} placeholder="Filter by action (e.g. admin.server)…" className="input-field w-72" />
                <Select
                    ariaLabel="Filter by target type"
                    value={targetType}
                    onChange={(v) => { setTargetType(v); setPage(1); }}
                    options={[
                        { value: '', label: 'All targets' },
                        { value: 'user', label: 'user' },
                        { value: 'server', label: 'server' },
                        { value: 'plan', label: 'plan' },
                        { value: 'backup', label: 'backup' },
                    ]}
                    className="w-44"
                />
                <button type="submit" className="rounded-full bg-white px-5 py-2 text-sm font-bold text-black transition hover:bg-gray-200">Filter</button>
            </form>

            {isLoading && (
                <div className="flex flex-col gap-2">
                    {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-11 rounded-lg" />)}
                </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
                {[
                    ['admin.server', 'Server admin'],
                    ['admin.user', 'User admin'],
                    ['server.', 'Server activity'],
                    ['auth.', 'Auth'],
                ].map(([prefix, label]) => (
                    <button
                        key={prefix}
                        type="button"
                        onClick={() => { setAction(prefix); setQ(prefix); setPage(1); }}
                        className={'rounded-full border px-3 py-1 text-[0.74rem] font-semibold transition ' + (q === prefix ? 'border-white bg-white text-black' : 'border-hairline text-ink-secondary hover:text-foreground')}
                    >
                        {label}
                    </button>
                ))}
                {q && (
                    <button type="button" onClick={() => { setAction(''); setQ(''); setPage(1); }} className="font-mono text-[0.74rem] text-ink-secondary hover:text-foreground">
                        Clear
                    </button>
                )}
            </div>

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