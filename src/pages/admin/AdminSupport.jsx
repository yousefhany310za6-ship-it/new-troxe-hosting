import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    BadgeCheck,
    BellRing,
    Check,
    ChevronRight,
    Clock,
    Headset,
    LogIn,
    Star,
    Ticket as TicketIcon,
    Users,
    X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { AvatarBadge } from '@/components/AvatarBadge.jsx';
import { Modal } from '@/components/ui/modal.jsx';
import { Pager, Stat, StatGrid, StatusBadge, TableSkeleton, timeAgo } from '@/pages/admin/components.jsx';
import { RoleBadge, TicketStatusBadge, categoryLabel, ticketNo } from '@/components/support/Badges.jsx';
import { useNavigate } from 'react-router-dom';
import {
    useAckEscalation,
    useAcceptEscalation,
    useAdminQueue,
    useAdminRatings,
    useAssignTicket,
    useDeclineEscalation,
    useEscalations,
    useSupportTeam,
    useTeamPerformance,
} from '@/hooks/useSupportQueries.js';

const VIEWS = [
    { key: 'all', label: 'All tickets' },
    { key: 'available', label: 'Unassigned' },
    { key: 'escalated', label: 'Escalated' },
    { key: 'resolved', label: 'Resolved / closed' },
];

const RANGES = [
    { key: 'today', label: 'Today' },
    { key: '7d', label: 'Last 7 days' },
    { key: '30d', label: 'Last 30 days' },
    { key: 'custom', label: 'Custom' },
];

function windowFor(range, custom) {
    if (range === 'today') {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return { from: d.toISOString(), to: undefined, label: 'Today' };
    }
    if (range === '7d' || range === '30d') {
        const days = range === '7d' ? 7 : 30;
        const d = new Date(Date.now() - days * 86400_000);
        return { from: d.toISOString(), to: undefined, label: `Last ${days} days` };
    }
    return { from: custom.from || undefined, to: custom.to || undefined, label: 'Custom range' };
}

const ms = (n) => {
    const v = Number(n) || 0;
    if (v <= 0) return '—';
    const h = Math.floor(v / 3600_000);
    const m = Math.round((v % 3600_000) / 60_000);
    if (h <= 0) return `${m}m`;
    return `${h}h ${m}m`;
};

export default function AdminSupport() {
    const navigate = useNavigate();
    const [view, setView] = useState('all');
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [tab, setTab] = useState('tickets');
    const [range, setRange] = useState('7d');
    const [custom, setCustom] = useState({ from: '', to: '' });

    const queue = useAdminQueue({ view, search, page, limit: 20 });
    const escalations = useEscalations('pending');
    const team = useSupportTeam();
    const ratings = useAdminRatings({ page: 1 });
    const accept = useAcceptEscalation();
    const decline = useDeclineEscalation();
    const win = useMemo(() => windowFor(range, custom), [range, custom]);
    const perf = useTeamPerformance({ from: win.from, to: win.to });

    const pendingEsc = escalations.data ?? [];
    const items = queue.data?.items ?? [];
    const teamRows = perf.data ?? [];

    const openTicket = (id) => navigate(`/dashboard/support/${id}`);

    return (
        <div className="flex flex-col gap-5">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="flex items-center gap-2 text-[1.35rem] font-extrabold tracking-tight">
                        <Headset className="size-5 text-ink-secondary" aria-hidden="true" />
                        Support centre
                    </h1>
                    <p className="mt-1 max-w-2xl text-[0.87rem] text-ink-secondary">
                        Answer admin calls, assign tickets, join any conversation with your admin identity, and audit the team's
                        workload and response times.
                    </p>
                </div>
            </header>

            <StatGrid>
                <Stat label="Tickets in view" value={String(queue.data?.total ?? 0)} context={VIEWS.find((v) => v.key === view)?.label} />
                <Stat label="Pending admin calls" value={String(pendingEsc.length)} tone={pendingEsc.length ? 'warn' : undefined} context="waiting for you" />
                <Stat label="Support team" value={String((team.data ?? []).length)} context="members with the Support role" />
                <Stat label="Ratings recorded" value={String((ratings.data?.items ?? []).length)} context="one per ticket" />
            </StatGrid>

            {pendingEsc.length > 0 && (
                <section className="rounded-xl border border-violet-500/25 bg-violet-500/5" aria-label="Pending admin calls">
                    <header className="flex flex-wrap items-center gap-2 border-b border-violet-500/20 px-4 py-3 sm:px-5">
                        <BellRing className="size-4 text-violet-300" aria-hidden="true" />
                        <h2 className="text-[0.95rem] font-bold text-violet-100">You were called in</h2>
                        <span className="ml-auto text-[0.74rem] text-violet-200/70">{pendingEsc.length} waiting</span>
                    </header>
                    <ul className="divide-y divide-[color:var(--hairline)]">
                        {pendingEsc.map((e) => (
                            <li key={e.id} className="flex flex-wrap items-start gap-3 px-4 py-3.5 sm:px-5">
                                <div className="min-w-0 flex-1">
                                    <p className="text-[0.88rem] font-bold text-foreground">
                                        {e.requester?.name ?? 'A support specialist'} called you in ticket{' '}
                                        <span className="font-mono">{ticketNo(e.ticket?.ticketNo)}</span>
                                    </p>
                                    <p className="mt-0.5 text-[0.84rem] text-ink-secondary">“{e.ticket?.subject}”</p>
                                    {e.reason && <p className="mt-1 text-[0.8rem] text-violet-200/90">Reason: {e.reason}</p>}
                                    <p className="mt-1 font-mono text-[0.7rem] text-ink-muted">
                                        requested {timeAgo(e.createdAt)} · {new Date(e.createdAt).toLocaleString()}
                                    </p>
                                </div>
                                <div className="flex shrink-0 flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        disabled={accept.isPending}
                                        onClick={async () => {
                                            try {
                                                await accept.mutateAsync(e.id);
                                                openTicket(e.ticketId);
                                            } catch (err) {
                                                window.alert(err?.message ?? 'Could not accept this call.');
                                            }
                                        }}
                                        className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-[0.76rem] font-bold text-black transition hover:bg-white/90 disabled:opacity-60"
                                    >
                                        <LogIn className="size-3.5" aria-hidden="true" />
                                        Join ticket
                                    </button>
                                    <DeclineButton id={e.id} onDecline={(reason) => decline.mutateAsync({ id: e.id, reason })} pending={decline.isPending} />
                                </div>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Support sections">
                {[
                    { key: 'tickets', label: 'Tickets', icon: TicketIcon },
                    { key: 'performance', label: 'Performance', icon: Star },
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
                            <input
                                value={search}
                                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                                placeholder="Ticket #1234 or subject"
                                aria-label="Search tickets"
                                className="input-field"
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
                                                <button
                                                    type="button"
                                                    onClick={() => openTicket(t.id)}
                                                    className="rounded-full border border-hairline px-3 py-1 font-bold text-foreground transition hover:border-hairline-hover"
                                                >
                                                    Open as admin
                                                </button>
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

            {tab === 'performance' && (
                <section className="flex flex-col gap-4 rounded-xl border border-hairline bg-card p-4 sm:p-5" aria-label="Team performance">
                    <header className="flex flex-wrap items-center gap-3">
                        <div className="min-w-0">
                            <h2 className="text-[0.95rem] font-bold">Team performance</h2>
                            <p className="mt-0.5 text-[0.78rem] text-ink-secondary">
                                Everything below is computed from recorded ticket events — nothing is self-reported.
                            </p>
                        </div>
                        <div className="ml-auto flex flex-wrap items-center gap-1.5">
                            {RANGES.map((r) => (
                                <button
                                    key={r.key}
                                    type="button"
                                    onClick={() => setRange(r.key)}
                                    aria-pressed={range === r.key}
                                    className={cn(
                                        'rounded-full border px-3 py-1 text-[0.74rem] font-bold transition',
                                        range === r.key ? 'border-white/25 bg-white/10 text-foreground' : 'border-hairline text-ink-secondary hover:text-foreground'
                                    )}
                                >
                                    {r.label}
                                </button>
                            ))}
                        </div>
                    </header>

                    {range === 'custom' && (
                        <div className="flex flex-wrap items-end gap-3">
                            <label className="flex flex-col gap-1">
                                <span className="text-[0.7rem] font-bold tracking-[0.12em] text-ink-muted uppercase">From</span>
                                <input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className="input-field" />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-[0.7rem] font-bold tracking-[0.12em] text-ink-muted uppercase">To</span>
                                <input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className="input-field" />
                            </label>
                        </div>
                    )}

                    <p className="text-[0.74rem] text-ink-muted">
                        Window: {win.label} {win.from ? `· from ${new Date(win.from).toLocaleString()}` : ''} {win.to ? `· to ${new Date(win.to).toLocaleString()}` : ''} · times shown in your local timezone
                    </p>

                    {perf.isLoading ? (
                        <TableSkeleton rows={3} />
                    ) : perf.error ? (
                        <p className="text-[0.84rem] text-red-300" role="alert">{perf.error.message ?? 'Could not load the performance data.'}</p>
                    ) : teamRows.length === 0 ? (
                        <p className="py-6 text-center text-[0.85rem] text-ink-secondary">No support members yet.</p>
                    ) : (
                        <div className="flex flex-col gap-3">
                            {teamRows.map((p) => (
                                <article key={String(p.supportId)} className="rounded-xl border border-hairline bg-veil/50 p-4">
                                    <header className="flex flex-wrap items-center gap-2.5">
                                        <span className="text-[0.92rem] font-bold text-foreground">{p.name ?? 'Specialist'}</span>
                                        <StatusBadge tone={p.presence?.online ? 'emerald' : 'zinc'}>
                                            {p.presence?.online ? 'Online' : p.presence?.lastSeenAt ? `Last seen ${timeAgo(new Date(p.presence.lastSeenAt).toISOString())}` : 'Never seen'}
                                        </StatusBadge>
                                        <span className="ml-auto font-mono text-[0.72rem] text-ink-muted">
                                            {p.workflow.claimed} claimed · {p.workflow.assignedNow} assigned now · {p.workflow.openNow} open
                                        </span>
                                    </header>
                                    <dl className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                                        <Figure label="First reply (avg)" value={ms(p.timing.avgFirstResponseMs)} hint={`${p.workflow.answered} answered · SLA ${p.timing.firstResponseSlaHours}h`} />
                                        <Figure label="Resolution (avg)" value={ms(p.timing.avgResolutionMs)} hint="excludes customer wait" />
                                        <Figure label="Resolved / closed" value={`${p.workflow.resolved} / ${p.workflow.closed}`} hint={`${p.workflow.reopened} reopened`} />
                                        <Figure
                                            label="Rating"
                                            value={p.ratings.count ? `${Number(p.ratings.avgStars).toFixed(2)} ★` : '—'}
                                            hint={`${p.ratings.count} rating${p.ratings.count === 1 ? '' : 's'} · ${p.ratings.resolutionRate != null ? `${Math.round(p.ratings.resolutionRate * 100)}% solved` : '—'}`}
                                        />
                                    </dl>
                                    {p.timing.overdueFirstResponse > 0 && (
                                        <p className="mt-2 inline-flex items-center gap-1.5 text-[0.76rem] text-amber-300">
                                            <Clock className="size-3.5" aria-hidden="true" />
                                            {p.timing.overdueFirstResponse} ticket{p.timing.overdueFirstResponse === 1 ? '' : 's'} past the first-reply SLA
                                        </p>
                                    )}
                                </article>
                            ))}
                        </div>
                    )}
                    <p className="text-[0.72rem] text-ink-muted">
                        Method: counts use distinct tickets; response and resolution times are averaged per ticket from real
                        timestamps; connected time is never treated as working time.
                    </p>
                </section>
            )}

            {tab === 'team' && (
                <section className="rounded-xl border border-hairline bg-card" aria-label="Support team">
                    <header className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-3 sm:px-5">
                        <Users className="size-4 text-ink-secondary" aria-hidden="true" />
                        <h2 className="text-[0.95rem] font-bold">Support team</h2>
                        <p className="ml-auto text-[0.74rem] text-ink-muted">Assign or remove the role from a user page.</p>
                    </header>
                    {team.isLoading ? (
                        <div className="p-5"><TableSkeleton rows={3} /></div>
                    ) : (team.data ?? []).length === 0 ? (
                        <p className="p-6 text-center text-[0.86rem] text-ink-secondary">
                            Nobody holds the Support role yet.
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
                                        {m.stats?.avgStars != null ? `${Number(m.stats.avgStars).toFixed(2)} ★` : '—'}
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
                                    <button
                                        type="button"
                                        onClick={() => openTicket(r.ticketId)}
                                        className="rounded-full border border-hairline px-3 py-1 text-[0.74rem] font-bold text-ink-secondary transition hover:text-foreground"
                                    >
                                        Open ticket
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            )}
        </div>
    );
}

function Figure({ label, value, hint }) {
    return (
        <div className="rounded-lg border border-hairline bg-card p-3">
            <dt className="text-[0.72rem] font-semibold text-ink-secondary">{label}</dt>
            <dd className="mt-1 text-[1.05rem] leading-none font-extrabold tabular-nums text-foreground">{value}</dd>
            {hint && <p className="mt-1 truncate text-[0.68rem] text-ink-muted">{hint}</p>}
        </div>
    );
}

function DeclineButton({ id, onDecline, pending }) {
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState('');
    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3.5 py-1.5 text-[0.76rem] font-bold text-ink-secondary transition hover:text-foreground"
            >
                <X className="size-3.5" aria-hidden="true" />
                Decline
            </button>
            <Modal open={open} onClose={() => setOpen(false)} title="Decline this call" description="The specialist is told you could not take it, and the request stays open for another administrator.">
                <div className="flex flex-col gap-3">
                    <label htmlFor="decline-reason" className="text-[0.78rem] font-bold text-ink-secondary">Reason (optional)</label>
                    <textarea
                        id="decline-reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={3}
                        maxLength={300}
                        className="input-field resize-y"
                        placeholder="e.g. I am already handling a production incident."
                    />
                    <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setOpen(false)} className="rounded-full border border-hairline px-4 py-2 text-[0.82rem] font-bold text-ink-secondary transition hover:text-foreground">
                            Cancel
                        </button>
                        <button
                            type="button"
                            disabled={pending}
                            onClick={async () => { await onDecline(reason); setOpen(false); setReason(''); }}
                            className="rounded-full bg-white px-4 py-2 text-[0.82rem] font-bold text-black transition hover:bg-white/90 disabled:opacity-60"
                        >
                            Decline
                        </button>
                    </div>
                </div>
            </Modal>
        </>
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
            <Modal open={open} onClose={() => setOpen(false)} title="Assign ticket" description="The specialist is notified immediately and the ticket becomes private to them.">
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
                                try { await assign.mutateAsync({ id: ticket.id, supportId }); setOpen(false); }
                                catch (e) { setError(e?.message ?? 'Could not assign the ticket.'); }
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
