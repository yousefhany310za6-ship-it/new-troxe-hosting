import { useState } from 'react';
import { Link } from 'react-router-dom';

import { useAdminAudit } from '@/hooks/useAdminQueries.jsx';
import { Select } from '@/components/ui/select.jsx';
import { EmptyState, ErrorState, Menu, Pager, SearchInput, StatusBadge, TableSkeleton, formatTargetLink, timeAgo } from './components.jsx';

const TARGETS = [
    { value: '', label: 'All targets' },
    { value: 'user', label: 'user' },
    { value: 'server', label: 'server' },
    { value: 'plan', label: 'plan' },
    { value: 'backup', label: 'backup' },
];

const PRESETS = [
    ['admin.server', 'Server admin'],
    ['admin.user', 'User admin'],
    ['server.', 'Server activity'],
    ['auth.', 'Auth'],
];

export default function AdminAudit() {
    const [page, setPage] = useState(1);
    const [action, setAction] = useState('');
    const [q, setQ] = useState('');
    const [targetType, setTargetType] = useState('');

    const { data, isLoading, error, refetch } = useAdminAudit({ page, limit: 50, action: q || undefined, targetType: targetType || undefined });

    const submit = (e) => {
        e.preventDefault();
        setPage(1);
        setQ(action.trim());
    };

    return (
        <div className="flex flex-col gap-5">
            <div>
                <h1 className="text-[1.35rem] font-extrabold tracking-tight">Audit log</h1>
                <p className="mt-1 max-w-2xl text-[0.87rem] text-ink-secondary">Every admin and user action — who did what, and when.</p>
            </div>

            <form onSubmit={submit} className="flex flex-wrap items-center gap-2" role="search">
                <SearchInput value={action} onChange={(v) => { setAction(v); setPage(1); }} placeholder="Filter by action (e.g. admin.server)…" />
                <Select
                    ariaLabel="Filter by target type"
                    value={targetType}
                    onChange={(v) => { setTargetType(v); setPage(1); }}
                    options={TARGETS}
                    className="w-44"
                />
                <button type="submit" className="rounded-full bg-white px-5 py-2 text-sm font-bold text-black transition hover:bg-gray-200">
                    Filter
                </button>
            </form>

            <div className="flex flex-wrap items-center gap-1.5" aria-label="Quick filters">
                {PRESETS.map(([prefix, label]) => (
                    <button
                        key={prefix}
                        type="button"
                        onClick={() => { setAction(prefix); setQ(prefix); setPage(1); }}
                        aria-pressed={q === prefix}
                        className={'rounded-full border px-3 py-1 text-[0.74rem] font-semibold transition focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ' + (q === prefix ? 'border-white bg-white text-black' : 'border-hairline text-ink-secondary hover:text-foreground')}
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

            {isLoading && <TableSkeleton rows={10} />}
            {error && <ErrorState message={error.message} onRetry={refetch} />}

            {data && (
                <>
                    <div className="overflow-hidden rounded-xl border border-hairline bg-card">
                        <div className="hidden grid-cols-[210px_minmax(0,1fr)_90px_minmax(0,1fr)_160px] items-center gap-3 border-b border-hairline px-5 py-2.5 font-mono text-[0.68rem] tracking-wider text-ink-muted uppercase lg:grid">
                            <span>Action</span><span>Actor</span><span>Target</span><span>Detail</span><span>Date</span>
                        </div>
                        <div className="flex flex-col divide-y divide-hairline">
                            {data.data.map((a) => {
                                const target = formatTargetLink(a.targetType, a.targetId);
                                return (
                                    <div key={a.id} className="grid grid-cols-1 gap-1 px-4 py-3 sm:px-5 lg:grid-cols-[210px_minmax(0,1fr)_90px_minmax(0,1fr)_160px] lg:items-center lg:gap-3">
                                        <span>
                                            <StatusBadge tone={String(a.action).startsWith('admin.') ? 'red' : 'zinc'}>
                                                {a.action}
                                            </StatusBadge>
                                        </span>
                                        <span className="truncate font-mono text-[0.76rem] text-ink-secondary" title={a.actorEmail || a.actorId}>
                                            {a.actorEmail || (a.actorId ? `${a.actorId.slice(0, 8)}…` : '—')}
                                        </span>
                                        <span className="font-mono text-[0.76rem] text-ink-secondary">{a.targetType ?? '—'}</span>
                                        <span className="min-w-0 truncate font-mono text-[0.74rem] text-ink-muted">
                                            {target ? (
                                                <Link to={target.to} className="transition hover:text-foreground hover:underline" title={a.targetId}>
                                                    {target.label}
                                                </Link>
                                            ) : (
                                                <span title={a.targetId}>{a.targetId ? `${String(a.targetId).slice(0, 8)}…` : '—'}</span>
                                            )}
                                        </span>
                                        <span className="font-mono text-[0.72rem] text-ink-muted" title={a.createdAt ? new Date(a.createdAt).toLocaleString() : ''}>
                                            {a.createdAt ? timeAgo(a.createdAt) : '—'}
                                        </span>
                                    </div>
                                );
                            })}
                            {data.data.length === 0 && (
                                <EmptyState title="No entries" hint="No audit events match these filters." />
                            )}
                        </div>
                    </div>
                    <Pager page={data.pagination.page} pages={data.pagination.pages} total={data.pagination.total} unit="entries" onPage={setPage} />
                </>
            )}
        </div>
    );
}
