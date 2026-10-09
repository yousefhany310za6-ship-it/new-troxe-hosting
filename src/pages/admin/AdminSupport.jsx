import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, Check, Headset, Link2, Loader2, Search, Star, Ticket as TicketIcon, Users } from 'lucide-react';

import { cn } from '@/lib/utils';
import { AvatarBadge } from '@/components/AvatarBadge.jsx';
import { Modal } from '@/components/ui/modal.jsx';
import { Pager, Stat, StatGrid, StatusBadge, TableSkeleton, timeAgo } from '@/pages/admin/components.jsx';
import { RoleBadge, TicketStatusBadge, categoryLabel, ticketNo } from '@/components/support/Badges.jsx';
import {
    useAckEscalation,
    useAdminQueue,
    useAdminRatings,
    useAssignTicket,
    useEscalations,
    useSupportTeam,
} from '@/hooks/useSupportQueries.js';

const VIEWS = [
    { key: 'all', label: 'All tickets' },
    { key: 'available', label: 'Unassigned' },
    { key: 'escalated', label: 'Escalated' },
    { key: 'resolved', label: 'Resolved / closed' },
];

export default function AdminSupport() {
    const [view, setView] = useState('all');
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [tab, setTab] = useState('tickets');

    const queue = useAdminQueue({ view, search, page, limit: 20 });
    const escalations = useEscalations('pending');
    const team = useSupportTeam();
    const ratings = useAdminRatings({ page: 1 });
    const ack = useAckEscalation();

    const pendingEsc = escalations.data ?? [];
    const items = queue.data?.items ?? [];

    return (
        <div className="flex flex-col gap-5">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="flex items-center gap-2 text-[1.35rem] font-extrabold tracking-tight">
                        <Headset className="size-5 text-ink-secondary" aria-hidden="true" />
                        Support centre
                    </h1>
                    <p className="mt-1 max-w-2xl text-[0.87rem] text-ink-secondary">
                        Assign the Support role, watch escalations, join any ticket as an administrator, and review the rating
                        trail. Admin actions are logged with your identity.
                    </p>
                </div>
            </header>

            <StatGrid>
                <Stat label="Tickets in view" value={String(queue.data?.total ?? 0)} context={VIEWS.find((v) => v.key === view)?.label} />
                <Stat label="Pending escalations" value={String(pendingEsc.length)} tone={pendingEsc.length ? 'warn' : undefined} context="waiting for an admin" />
                <Stat label="Support team" value={String((team.data ?? []).length)} context="members with the Support role" />
                <Stat label="Ratings recorded" value={String((ratings.data?.items ?? []).length)} context="unique, one per ticket" />
            </StatGrid>

            {pendingEsc.length > 0 && (
                <section className="rounded-xl border border-violet-500/25 bg-violet-500/5" aria-label="Pending admin escalations">
                    <header className="flex items-center gap-2 border-b border-violet-500/20 px-4 py-3 sm:px-5">
                        <BellRing className="size-4 text-violet-300" aria-hidden="true" />
                        <h2 className="text-[0.95rem] font-bold text-violet-100">Admin called in</h2>
                        <span className="ml-auto text-[0.74rem] text-violet-200/70">{pendingEsc.length} waiting</span>
                    </header>
                    <ul className="divide-y divide-[color:var(--hairline)]">
                        {pendingEsc.map((e) => (
                            <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                                <div className="min-w-0 flex-1">
                                    <p className="text-[0.86rem] font-bold text-foreground">{e.reason}</p>
                                    <p className="text-[0.74rem] text-ink-muted">
                                        raised {timeAgo(e.createdAt)} · ticket {e.ticketId?.slice(0, 8)}…
                                    </p>
                                </div>
                                <Link
                                    to={`/dashboard/support/${e.ticketId}`}
                                    className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3.5 py-1.5 text-[0.76rem] font-bold text-foreground transition hover:border-hairline-hover"
                                >
                                    <Link2 className="size-3.5" aria-hidden="true" />
                                    Open ticket
                                </Link>
                                <button
                                    type="button"
                                    disabled={ack.isPending}
                                    onClick={() => ack.mutate(e.id)}
                                    className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-[0.76rem] font-bold text-black transition hover:bg-white/90 disabled:opacity-60"
                                >
                                    {ack.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
                                    Acknowledge
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Support sections">
                {[
                    { key: 'tickets', label: 'Tickets', icon: TicketIcon },
                    { key: 'team', label: 'Team', icon: Users },
                    { key: 'ratings', label: 'Ratings', icon: Star },
                ].map((t) => (
                    <button
                        key={t.key}
                        type="button"
                        role="tab"
                        aria-selected={tab === t.key}
                        onClick={() => setTab(t.key)}
                        className={cn(
                            'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[0.78rem] font-bold transition',
                            tab === t.key ? 'border-white/25 bg-white/10 text-foreground' : 'border-hairline text-ink-secondary hover:border-hairline-hover hover:text-foreground'
                        )}
                    >
                        <t.icon className="size-3.5" aria-hidden="true" />
                        {t.label}
                    </button>
                ))}
            </div>

            {tab === 'tickets' && (
                <>
                    <div className="flex flex-wrap items-end gap-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                            {VIEWS.map((v) => (
                                <button
                                    key={v.key}
                                    type="button"
                                    onClick={() => { setView(v.key); setPage(1); }}
                                    aria-pressed={view === v.key}
                                    className={cn(
                                        'rounded-full border px-3 py-1.5 text-[0.76rem] font-bold transition',
                                        view === v.key ? 'border-white/25 bg-white/10 text-foreground' : 'border-hairline text-ink-secondary hover:text-foreground'
                                    )}
                                >
                                    {v.label}
                                </button>
                            ))}
                        </div>
                        <div className="relative min-w-0 flex-1 sm:max-w-xs">
                            <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
                            <input
                                value={search}
                                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                                placeholder="Ticket #1234 or subject"
                                aria-label="Search tickets"
                                className="input-field pl-9"
                            />
                        </div>
                    </div>

                    {queue.isLoading ? (
                        <TableSkeleton rows={5} />
                    ) : queue.error ? (
                        <p className="rounded-xl border border-red-500/25 bg-red-500/5 p-5 text-[0.85rem] text-red-200" role="alert">
                            Could not load tickets: {queue.error.message ?? 'unknown error'}
                        </p>
                    ) : items.length === 0 ? (
                        <p className="rounded-xl border border-dashed border-hairline bg-card/60 p-10 text-center text-[0.86rem] text-ink-secondary">
                            No tickets in this view.
                        </p>
                    ) : (
                        <>
                            <ul className="flex flex-col gap-2.5">
                                {items.map((t) => (
                                    <li key={t.id} className="rounded-xl border border-hairline bg-card p-4">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-mono text-[0.72rem] text-ink-muted">{ticketNo(t.ticketNo)}</span>
                                            <TicketStatusBadge status={t.status} />
                                            <span className="rounded-full border border-hairline bg-veil px-2 py-0.5 text-[0.68rem] font-bold text-ink-secondary">
                                                {categoryLabel(t.category)}
                                            </span>
                                            <span className="ml-auto font-mono text-[0.7rem] text-ink-muted">{timeAgo(t.updatedAt)}</span>
                                        </div>
                                        <p className="mt-2 text-[0.92rem] font-bold text-foreground">{t.subject}</p>
                                        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.76rem] text-ink-secondary">
                                            <span className="inline-flex items-center gap-1.5">
                                                <AvatarBadge url={t.owner?.avatarUrl} name={t.owner?.name} size="size-5" text="text-[0.6rem]" />
                                                {t.owner?.name ?? 'Unknown'}
                                            </span>
                                            <span>
                                                {t.assignee ? (
                                                    <span className="inline-flex items-center gap-1.5">
                                                        <span className="text-ink-muted">held by</span>
                                                        {t.assignee.name}
                                                        <RoleBadge role={t.assignee.role} size="xs" />
                                                    </span>
                                                ) : (
                                                    <span className="text-ink-muted">unassigned</span>
                                                )}
                                            </span>
                                            <span className="ml-auto flex items-center gap-2">
                                                <AssignButton ticket={t} />
                                                <Link
                                                    to={`/dashboard/support/${t.id}`}
                                                    className="rounded-full border border-hairline px-3 py-1 font-bold text-foreground transition hover:border-hairline-hover"
                                                >
                                                    Open as admin
                                                </Link>
                                            </span>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                            <Pager page={queue.data?.page ?? 1} pages={queue.data?.pages ?? 1} total={queue.data?.total ?? 0} unit="tickets" onPage={setPage} />
                        </>
                    )}
                </>
            )}

            {tab === 'team' && (
                <section className="rounded-xl border border-hairline bg-card" aria-label="Support team">
                    <header className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-3 sm:px-5">
                        <Users className="size-4 text-ink-secondary" aria-hidden="true" />
                        <h2 className="text-[0.95rem] font-bold">Support team</h2>
                        <p className="ml-auto text-[0.74rem] text-ink-muted">
                            Assign or remove the role from a user&apos;s page — the change takes effect immediately.
                        </p>
                    </header>
                    {team.isLoading ? (
                        <div className="p-5"><TableSkeleton rows={3} /></div>
                    ) : (team.data ?? []).length === 0 ? (
                        <p className="p-6 text-center text-[0.86rem] text-ink-secondary">
                            Nobody holds the Support role yet. Open a user and set their role to Support.
                        </p>
                    ) : (
                        <ul className="divide-y divide-[color:var(--hairline)]">
                            {(team.data ?? []).map((m) => (
                                <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5">
                                    <AvatarBadge url={m.avatarUrl} name={m.name} size="size-9" text="text-[0.72rem]" />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-[0.9rem] font-bold text-foreground">{m.name}</p>
                                        <p className="text-[0.74rem] text-ink-muted">
                                            {m.stats?.openTickets ?? 0} open · {m.stats?.count ?? 0} ratings
                                        </p>
                                    </div>
                                    <span className="text-[0.78rem] text-ink-secondary tabular-nums">
                                        {m.stats?.avgStars != null ? `${m.stats.avgStars.toFixed(2)} ★` : '—'}
                                    </span>
                                    <span className="text-[0.76rem] text-ink-muted tabular-nums">
                                        {m.stats?.resolutionRate != null ? `${Math.round(m.stats.resolutionRate * 100)}% solved` : '—'}
                                    </span>
                                    <StatusBadge tone={m.presence?.online ? 'emerald' : 'zinc'}>
                                        {m.presence?.online ? 'Online' : 'Offline'}
                                    </StatusBadge>
                                    <Link
                                        to={`/admin/users/${m.id}`}
                                        className="rounded-full border border-hairline px-3 py-1 text-[0.74rem] font-bold text-ink-secondary transition hover:text-foreground"
                                    >
                                        Manage
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            )}

            {tab === 'ratings' && (
                <section className="rounded-xl border border-hairline bg-card" aria-label="Ticket ratings">
                    <header className="flex items-center gap-2 border-b border-hairline px-4 py-3 sm:px-5">
                        <Star className="size-4 text-ink-secondary" aria-hidden="true" />
                        <h2 className="text-[0.95rem] font-bold">Rating trail</h2>
                        <p className="ml-auto text-[0.74rem] text-ink-muted">One rating per ticket · immutable once submitted</p>
                    </header>
                    {ratings.isLoading ? (
                        <div className="p-5"><TableSkeleton rows={4} /></div>
                    ) : (ratings.data?.items ?? []).length === 0 ? (
                        <p className="p-6 text-center text-[0.86rem] text-ink-secondary">No ratings have been submitted yet.</p>
                    ) : (
                        <ul className="divide-y divide-[color:var(--hairline)]">
                            {(ratings.data?.items ?? []).map((r) => (
                                <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5">
                                    <span className="font-mono text-[0.72rem] text-ink-muted">{r.ticketId.slice(0, 8)}…</span>
                                    <span className="text-[0.86rem] font-bold text-amber-300 tabular-nums">
                                        {'★'.repeat(r.stars)}{'☆'.repeat(5 - r.stars)}
                                    </span>
                                    <span className="rounded-full border border-hairline bg-veil px-2.5 py-0.5 text-[0.7rem] font-bold text-ink-secondary">
                                        {r.resolved === 'yes' ? 'solved' : r.resolved === 'partial' ? 'partly' : 'not solved'}
                                    </span>
                                    <span className="min-w-0 flex-1 basis-48 truncate text-[0.8rem] text-ink-secondary">
                                        {r.comment || <span className="text-ink-muted">no comment</span>}
                                    </span>
                                    <span className="text-[0.74rem] text-ink-muted">{timeAgo(r.createdAt)}</span>
                                    <Link
                                        to={`/dashboard/support/${r.ticketId}`}
                                        className="rounded-full border border-hairline px-3 py-1 text-[0.74rem] font-bold text-ink-secondary transition hover:text-foreground"
                                    >
                                        Open ticket
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            )}
        </div>
    );
}

function AssignButton({ ticket }) {
    const assign = useAssignTicket();
    const { data: team } = useSupportTeam();
    const [open, setOpen] = useState(false);
    const [supportId, setSupportId] = useState('');
    const [error, setError] = useState(null);

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="rounded-full border border-hairline px-3 py-1 font-bold text-ink-secondary transition hover:text-foreground"
            >
                {ticket.assignee ? 'Reassign' : 'Assign'}
            </button>
            <Modal open={open} onClose={() => setOpen(false)} title="Assign ticket" description="The specialist is notified immediately and the ticket moves to in progress.">
                <div className="flex flex-col gap-3">
                    <label htmlFor="assign-support" className="text-[0.78rem] font-bold text-ink-secondary">Specialist</label>
                    <select id="assign-support" value={supportId} onChange={(e) => setSupportId(e.target.value)} className="input-field">
                        <option value="">Choose…</option>
                        {(team ?? []).map((m) => (
                            <option key={m.id} value={m.id}>{m.name}{m.presence?.online ? ' (online)' : ''}</option>
                        ))}
                    </select>
                    {error && <p className="text-[0.78rem] text-red-300">{error}</p>}
                    <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setOpen(false)} className="rounded-full border border-hairline px-4 py-2 text-[0.82rem] font-bold text-ink-secondary transition hover:text-foreground">
                            Cancel
                        </button>
                        <button
                            type="button"
                            disabled={!supportId || assign.isPending}
                            onClick={async () => {
                                setError(null);
                                try {
                                    await assign.mutateAsync({ id: ticket.id, supportId });
                                    setOpen(false);
                                } catch (e) {
                                    setError(e?.message ?? 'Could not assign the ticket.');
                                }
                            }}
                            className="rounded-full bg-white px-4 py-2 text-[0.82rem] font-bold text-black transition hover:bg-white/90 disabled:opacity-60"
                        >
                            Assign
                        </button>
                    </div>
                </div>
            </Modal>
        </>
    );
}
