import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Headset, Inbox, Loader2, Search, Star, Users } from 'lucide-react';

import { cn } from '@/lib/utils';
import { AvatarBadge } from '@/components/AvatarBadge.jsx';
import { Pager, Stat, StatGrid, TableSkeleton } from '@/pages/admin/components.jsx';
import { RoleBadge, TicketStatusBadge, categoryLabel, ticketNo } from '@/components/support/Badges.jsx';
import { useQueue, useSupportTeam, useMyPerformance } from '@/hooks/useSupportQueries.js';

const VIEWS = [
    { key: 'available', label: 'Available', hint: 'open tickets nobody holds' },
    { key: 'mine', label: 'Mine', hint: 'assigned to me' },
    { key: 'waiting', label: 'Waiting for user', hint: 'ball is in their court' },
    { key: 'escalated', label: 'Escalated', hint: 'admin called in' },
    { key: 'resolved', label: 'Resolved / closed', hint: 'history' },
];

const CATEGORIES = ['', 'server_issue', 'server_crash', 'performance', 'billing', 'account', 'technical', 'other'];
const PRIORITIES = ['', 'low', 'medium', 'high', 'urgent'];
const STATUSES = ['', 'open', 'in_progress', 'waiting_user', 'waiting_admin', 'resolved', 'closed'];

export default function SupportDesk() {
    const [view, setView] = useState('available');
    const [filters, setFilters] = useState({ search: '', category: '', priority: '', status: '' });
    const [page, setPage] = useState(1);
    const { data, isLoading, error, isFetching } = useQueue({ view, ...filters, page, limit: 20 });
    const { data: team } = useSupportTeam();
    const { data: perf } = useMyPerformance();

    const items = data?.items ?? [];
    const online = useMemo(() => (team ?? []).filter((m) => m.presence?.online), [team]);

    return (
        <div className="flex flex-col gap-5">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="flex items-center gap-2 text-[1.35rem] font-extrabold tracking-tight">
                        <Headset className="size-5 text-ink-secondary" aria-hidden="true" />
                        Support desk
                    </h1>
                    <p className="mt-1 max-w-2xl text-[0.87rem] text-ink-secondary">
                        Take tickets from the queue, reply in real time and call an admin when a ticket needs one.
                        Everything you do here is recorded in the ticket event log.
                    </p>
                </div>
            </header>

            <StatGrid>
                <Stat label="Open in the queue" value={String(view === 'available' ? (data?.total ?? 0) : '—')} context={view === 'available' ? 'waiting to be picked up' : 'switch to Available'} />
                <Stat label="Team online" value={`${online.length}/${(team ?? []).length || 0}`} context="live support sockets" />
                <Stat
                    label="Your rating"
                    value={perf?.count ? `${perf.avgStars?.toFixed(2) ?? '—'} ★` : '—'}
                    context={perf?.count ? `${perf.count} rating${perf.count === 1 ? '' : 's'}` : 'no ratings yet'}
                />
                <Stat
                    label="Resolution rate"
                    value={perf?.count ? `${Math.round((perf.resolutionRate ?? 0) * 100)}%` : '—'}
                    context="share of tickets marked solved"
                />
            </StatGrid>

            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Queue views">
                {VIEWS.map((v) => (
                    <button
                        key={v.key}
                        type="button"
                        onClick={() => { setView(v.key); setPage(1); }}
                        aria-pressed={view === v.key}
                        title={v.hint}
                        className={cn(
                            'rounded-full border px-3 py-1.5 text-[0.78rem] font-bold transition',
                            view === v.key ? 'border-white/25 bg-white/10 text-foreground' : 'border-hairline text-ink-secondary hover:border-hairline-hover hover:text-foreground'
                        )}
                    >
                        {v.label}
                    </button>
                ))}
                {isFetching && !isLoading && <Loader2 className="size-4 animate-spin text-ink-muted" aria-label="Updating" />}
            </div>

            <div className="flex flex-wrap items-end gap-2.5">
                <div className="relative min-w-0 flex-1 sm:max-w-xs">
                    <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
                    <input
                        value={filters.search}
                        onChange={(e) => { setFilters({ ...filters, search: e.target.value }); setPage(1); }}
                        placeholder="Ticket #1234 or subject"
                        aria-label="Search tickets"
                        className="input-field pl-9"
                    />
                </div>
                <Select label="Status" value={filters.status} options={STATUSES} onChange={(v) => { setFilters({ ...filters, status: v }); setPage(1); }} />
                <Select label="Category" value={filters.category} options={CATEGORIES} onChange={(v) => { setFilters({ ...filters, category: v }); setPage(1); }} format={categoryLabel} />
                <Select label="Priority" value={filters.priority} options={PRIORITIES} onChange={(v) => { setFilters({ ...filters, priority: v }); setPage(1); }} />
            </div>

            {isLoading ? (
                <TableSkeleton rows={5} />
            ) : error ? (
                <div className="rounded-xl border border-red-500/25 bg-red-500/5 p-5 text-[0.85rem] text-red-200" role="alert">
                    Could not load the queue: {error.message ?? 'unknown error'}
                </div>
            ) : items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-hairline bg-card/60 p-10 text-center">
                    <Inbox className="mx-auto size-8 text-ink-muted" aria-hidden="true" />
                    <p className="mt-3 text-[0.92rem] font-bold text-foreground">Nothing here</p>
                    <p className="mx-auto mt-1 max-w-md text-[0.82rem] text-ink-secondary">
                        {view === 'available'
                            ? 'No unassigned tickets right now. New tickets appear here the moment a user opens one.'
                            : 'No tickets match this view or filter.'}
                    </p>
                </div>
            ) : (
                <>
                    <ul className="flex flex-col gap-2.5">
                        {items.map((t) => (
                            <li key={t.id}>
                                <Link
                                    to={`/dashboard/support/${t.id}`}
                                    className="block rounded-xl border border-hairline bg-card p-4 transition hover:border-hairline-hover sm:p-5"
                                >
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-mono text-[0.72rem] text-ink-muted">{ticketNo(t.ticketNo)}</span>
                                        <TicketStatusBadge status={t.status} />
                                        <span className="rounded-full border border-hairline bg-veil px-2 py-0.5 text-[0.68rem] font-bold text-ink-secondary">
                                            {categoryLabel(t.category)}
                                        </span>
                                        {(t.priority === 'high' || t.priority === 'urgent') && (
                                            <span className={cn(
                                                'rounded-full border px-2 py-0.5 text-[0.68rem] font-bold',
                                                t.priority === 'urgent' ? 'border-red-500/25 bg-red-500/10 text-red-300' : 'border-amber-500/25 bg-amber-500/10 text-amber-300'
                                            )}>
                                                {t.priority === 'urgent' ? 'Critical' : 'High'}
                                            </span>
                                        )}
                                        <span className="ml-auto font-mono text-[0.7rem] text-ink-muted">
                                            updated {new Date(t.updatedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                        </span>
                                    </div>
                                    <p className="mt-2 truncate text-[0.95rem] font-bold text-foreground">{t.subject}</p>
                                    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.76rem] text-ink-secondary">
                                        <span className="inline-flex items-center gap-1.5">
                                            <AvatarBadge url={t.owner?.avatarUrl} name={t.owner?.name} size="size-5" text="text-[0.6rem]" />
                                            {t.owner?.name ?? 'Unknown requester'}
                                        </span>
                                        {t.assignee ? (
                                            <span className="inline-flex items-center gap-1.5">
                                                <span className="text-ink-muted">held by</span>
                                                {t.assignee.name}
                                                <RoleBadge role={t.assignee.role} size="xs" />
                                            </span>
                                        ) : (
                                            <span className="text-ink-muted">unassigned</span>
                                        )}
                                        {t.serverId && <span className="text-ink-muted">server linked</span>}
                                        <span className="min-w-0 flex-1 basis-48 truncate text-ink-muted">
                                            opened {new Date(t.createdAt).toLocaleDateString()}
                                        </span>
                                    </div>
                                </Link>
                            </li>
                        ))}
                    </ul>
                    <Pager page={data?.page ?? 1} pages={data?.pages ?? 1} total={data?.total ?? 0} unit="tickets" onPage={setPage} />
                </>
            )}

            <section className="rounded-xl border border-hairline bg-card" aria-label="Support team">
                <header className="flex items-center gap-2 border-b border-hairline px-4 py-3 sm:px-5">
                    <Users className="size-4 text-ink-secondary" aria-hidden="true" />
                    <h2 className="text-[0.95rem] font-bold">Team</h2>
                    <span className="ml-auto text-[0.74rem] text-ink-muted">
                        {online.length} of {(team ?? []).length} online
                    </span>
                </header>
                <ul className="divide-y divide-[color:var(--hairline)]">
                    {(team ?? []).map((m) => (
                        <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                            <AvatarBadge url={m.avatarUrl} name={m.name} size="size-8" text="text-[0.7rem]" />
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-[0.88rem] font-bold text-foreground">{m.name}</p>
                                <p className="text-[0.72rem] text-ink-muted">
                                    {m.stats?.openTickets ?? 0} open ticket{m.stats?.openTickets === 1 ? '' : 's'}
                                    {m.stats?.count != null && (
                                        <> · {m.stats.count} rating{m.stats.count === 1 ? '' : 's'} · {m.stats.avgStars?.toFixed(2) ?? '—'} <Star className="inline size-3" aria-hidden="true" /></>
                                    )}
                                </p>
                            </div>
                            <span className={cn(
                                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[0.7rem] font-bold',
                                m.presence?.online ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-hairline bg-veil text-ink-secondary'
                            )}>
                                <span className={cn('size-1.5 rounded-full', m.presence?.online ? 'bg-emerald-500' : 'bg-zinc-500')} aria-hidden="true" />
                                {m.presence?.online ? 'Online' : m.presence?.lastSeenAt ? `Last seen ${new Date(m.presence.lastSeenAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}` : 'Offline'}
                            </span>
                        </li>
                    ))}
                    {(team ?? []).length === 0 && (
                        <li className="px-4 py-6 text-center text-[0.82rem] text-ink-secondary sm:px-5">
                            No support members are configured yet — an admin assigns the Support role.
                        </li>
                    )}
                </ul>
            </section>
        </div>
    );
}

function Select({ label, value, options, onChange, format }) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-[0.68rem] font-bold tracking-[0.12em] text-ink-muted uppercase">{label}</span>
            <select value={value} onChange={(e) => onChange(e.target.value)} className="input-field sm:w-40">
                {options.map((o) => (
                    <option key={o || 'all'} value={o}>{o ? (format ? format(o) : o.replace(/_/g, ' ')) : 'Any'}</option>
                ))}
            </select>
        </label>
    );
}
