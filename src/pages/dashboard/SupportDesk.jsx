import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    AlertTriangle,
    BellRing,
    Check,
    Filter,
    Headset,
    Inbox,
    Loader2,
    RefreshCw,
    Search,
    WifiOff,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { AvatarBadge } from '@/components/AvatarBadge.jsx';
import { RoleBadge, TicketStatusBadge, categoryLabel, ticketNo } from '@/components/support/Badges.jsx';
import { useQueue, useSupportTeam } from '@/hooks/useSupportQueries.js';
import { useQueueSummary } from '@/hooks/useSupportDesk.js';
import { useSupportSocket } from '@/hooks/useSupportSocket.js';

const TABS = [
    { key: 'available', label: 'Available', hint: 'New tickets nobody holds yet' },
    { key: 'mine', label: 'Mine', hint: 'Tickets assigned to me' },
    { key: 'team', label: 'Team', hint: 'Held by other specialists (view only)' },
    { key: 'escalated', label: 'Admin', hint: 'Waiting for an administrator' },
    { key: 'resolved', label: 'Resolved', hint: 'Resolved and closed history' },
];

const STATUSES = ['', 'open', 'in_progress', 'waiting_user', 'waiting_admin', 'resolved', 'closed'];
const CATEGORIES = ['', 'server_issue', 'server_crash', 'performance', 'billing', 'account', 'technical', 'other'];
const PRIORITIES = ['', 'low', 'medium', 'high', 'urgent'];

const PRIORITY_STYLE = {
    low: 'border-hairline bg-veil text-ink-secondary',
    medium: 'border-hairline bg-veil text-ink-secondary',
    high: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
    urgent: 'border-red-500/25 bg-red-500/10 text-red-300',
};

const relative = (iso) => {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '—';
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
};

/**
 * The support workbench. Every list here is also pushed live: the gateway
 * joins each support/admin socket to the shared team room and emits
 * `queue:changed` whenever a ticket is created, claimed, released, assigned,
 * re-prioritised, re-stated or removed — so this page never needs a reload.
 * A slow poll remains as a safety net, because the database (not the socket)
 * is the source of truth.
 */
export default function SupportDesk() {
    const [tab, setTab] = useState('available');
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('');
    const [category, setCategory] = useState('');
    const [priority, setPriority] = useState('');
    const [page, setPage] = useState(1);
    const [live, setLive] = useState(false);
    const [lastPush, setLastPush] = useState(null);
    const [flash, setFlash] = useState(null);
    const scrollRestore = useRef(null);

    const filters = useMemo(
        () => ({ view: tab, search: search.trim(), status, category, priority, page, limit: 20 }),
        [tab, search, status, category, priority, page],
    );
    const { data, isLoading, isError, error, isFetching, refetch } = useQueue(filters);
    const summary = useQueueSummary();

    // live queue updates + a 20s safety net while the tab is open
    const onEvent = useCallback(
        (type, payload) => {
            if (type === 'queue:changed') {
                setLive(true);
                setLastPush(new Date());
                setFlash(`${payload?.reason ?? 'queue'} changed`);
                window.setTimeout(() => setFlash(null), 2500);
                void refetch();
                void summary.refetch();
            }
        },
        [refetch, summary],
    );
    const { connected } = useSupportSocket({ listenOnly: true, onEvent });

    useEffect(() => {
        if (!connected) return undefined;
        const timer = window.setInterval(() => { void refetch(); }, 20_000);
        return () => window.clearInterval(timer);
    }, [connected, refetch]);

    // reset paging whenever the view changes
    useEffect(() => { setPage(1); }, [tab, status, category, priority, search]);

    const items = data?.items ?? [];
    const pages = data?.pages ?? 1;
    const counts = summary.data ?? {};

    const EmptyState = () => {
        const copy = {
            available: ['No unassigned tickets', 'New customer tickets appear here the moment they are created.'],
            mine: ['Nothing assigned to you', 'Take a ticket from the Available tab and it moves here.'],
            team: ['The team holds nothing', 'When another specialist takes a ticket, you can see it here (read-only).'],
            escalated: ['No admin calls waiting', 'Escalations from the team land here.'],
            resolved: ['No history yet', 'Resolved and closed tickets are listed here.'],
        }[tab];
        return (
            <div className="rounded-xl border border-dashed border-hairline bg-card/60 px-6 py-12 text-center">
                <Inbox className="mx-auto size-8 text-ink-muted" aria-hidden="true" />
                <p className="mt-3 text-[0.95rem] font-bold text-foreground">{copy[0]}</p>
                <p className="mx-auto mt-1 max-w-sm text-[0.84rem] text-ink-secondary">{copy[1]}</p>
            </div>
        );
    };

    return (
        <div className="flex flex-col gap-4">
            <header className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="flex items-center gap-2 text-[1.35rem] font-extrabold tracking-tight">
                        <Headset className="size-5 text-ink-secondary" aria-hidden="true" />
                        Support desk
                    </h1>
                    <p className="mt-1 text-[0.86rem] text-ink-secondary">
                        Take tickets, answer customers, call an admin when you need one.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <span
                        className={cn(
                            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.72rem] font-bold',
                            connected ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/25 bg-amber-500/10 text-amber-300',
                        )}
                        title={lastPush ? `Last live update ${relative(lastPush.toISOString())}` : 'Live updates over the support channel'}
                    >
                        {connected ? <span className="size-1.5 animate-beat rounded-full bg-emerald-400" aria-hidden="true" /> : <WifiOff className="size-3.5" aria-hidden="true" />}
                        {connected ? 'Live' : 'Reconnecting…'}
                    </span>
                    <button
                        type="button"
                        onClick={() => { void refetch(); void summary.refetch(); }}
                        className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-[0.74rem] font-bold text-ink-secondary transition hover:text-foreground"
                    >
                        <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} aria-hidden="true" />
                        Refresh
                    </button>
                </div>
            </header>

            {/* queue tabs with live counts */}
            <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Queue views">
                {TABS.map((t) => {
                    const n = counts[t.key] ?? 0;
                    const active = tab === t.key;
                    return (
                        <button
                            key={t.key}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            title={t.hint}
                            onClick={() => setTab(t.key)}
                            className={cn(
                                'inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[0.8rem] font-bold transition',
                                active ? 'border-white/25 bg-white/10 text-foreground' : 'border-hairline text-ink-secondary hover:border-hairline-hover hover:text-foreground',
                            )}
                        >
                            {t.label}
                            {n > 0 && (
                                <span className={cn('rounded-full px-1.5 py-0.5 text-[0.68rem] tabular-nums', active ? 'bg-white/15 text-foreground' : 'bg-veil text-ink-muted')}>
                                    {n}
                                </span>
                            )}
                        </button>
                    );
                })}
                {flash && (
                    <span className="ml-auto inline-flex items-center gap-1.5 text-[0.72rem] font-bold text-emerald-300">
                        <Check className="size-3.5" aria-hidden="true" />
                        {flash}
                    </span>
                )}
            </div>

            {/* filters */}
            <div className="flex flex-wrap items-end gap-2.5">
                <div className="relative min-w-0 flex-1 sm:max-w-xs">
                    <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Ticket #1234 or subject"
                        aria-label="Search tickets"
                        className="input-field pl-9"
                    />
                </div>
                <Pick label="Status" value={status} options={STATUSES} onChange={setStatus} />
                <Pick label="Category" value={category} options={CATEGORIES} onChange={setCategory} format={categoryLabel} />
                <Pick label="Priority" value={priority} options={PRIORITIES} onChange={setPriority} />
            </div>

            {/* list */}
            {isLoading ? (
                <div className="flex flex-col gap-2" aria-busy="true">
                    {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-[92px] animate-pulse rounded-xl border border-hairline bg-card" />)}
                </div>
            ) : isError ? (
                <div className="flex flex-col items-start gap-3 rounded-xl border border-red-500/25 bg-red-500/5 p-5" role="alert">
                    <p className="flex items-center gap-2 text-[0.88rem] font-bold text-red-200">
                        <AlertTriangle className="size-4" aria-hidden="true" />
                        Could not load this queue
                    </p>
                    <p className="text-[0.82rem] text-red-200/80">{error?.message ?? 'Unknown error'}</p>
                    <button type="button" onClick={() => refetch()} className="rounded-full border border-hairline px-4 py-1.5 text-[0.78rem] font-bold text-foreground">
                        Try again
                    </button>
                </div>
            ) : items.length === 0 ? (
                <EmptyState />
            ) : (
                <ul className="flex flex-col gap-2.5">
                    {items.map((t) => (
                        <li key={t.id}>
                            <QueueRow ticket={t} readOnly={tab === 'team' && t.assigneeId && t.assigneeId !== t.assigneeId} />
                        </li>
                    ))}
                </ul>
            )}

            {pages > 1 && (
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => p - 1)}
                        className="rounded-full border border-hairline px-5 py-2 text-sm font-bold text-ink-secondary transition hover:text-foreground disabled:opacity-40"
                    >
                        Prev
                    </button>
                    <span className="font-mono text-[0.78rem] text-ink-muted tabular-nums">
                        Page {page} / {pages} · {data?.total ?? 0} tickets
                    </span>
                    <button
                        type="button"
                        disabled={page >= pages}
                        onClick={() => setPage((p) => p + 1)}
                        className="rounded-full border border-hairline px-5 py-2 text-sm font-bold text-ink-secondary transition hover:text-foreground disabled:opacity-40"
                    >
                        Next
                    </button>
                </div>
            )}

            {/* team presence strip */}
            <TeamStrip />
        </div>
    );
}

function QueueRow({ ticket, readOnly }) {
    const unread = ticket.unreadCount ?? 0;
    const last = ticket.lastMessage;
    const lastFrom = last?.authorRole === 'user' ? 'Customer' : last?.authorRole === 'admin' ? 'Admin' : 'Specialist';
    return (
        <Link
            to={`/dashboard/support/${ticket.id}`}
            className={cn(
                'block rounded-xl border bg-card p-4 transition hover:border-hairline-hover',
                unread > 0 ? 'border-white/20' : 'border-hairline',
            )}
        >
            <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[0.72rem] text-ink-muted">{ticketNo(ticket.ticketNo)}</span>
                <TicketStatusBadge status={ticket.status} />
                <span className={cn('rounded-full border px-2 py-0.5 text-[0.68rem] font-bold', PRIORITY_STYLE[ticket.priority] ?? PRIORITY_STYLE.medium)}>
                    {ticket.priority === 'urgent' ? 'Critical' : ticket.priority === 'high' ? 'High' : ticket.priority === 'medium' ? 'Medium' : 'Low'}
                </span>
                <span className="rounded-full border border-hairline bg-veil px-2 py-0.5 text-[0.68rem] font-bold text-ink-secondary">
                    {categoryLabel(ticket.category)}
                </span>
                {unread > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[0.66rem] font-extrabold text-black tabular-nums">
                        <BellRing className="size-3" aria-hidden="true" />
                        {unread} new
                    </span>
                )}
                <span className="ml-auto font-mono text-[0.7rem] text-ink-muted">{relative(ticket.updatedAt)}</span>
            </div>

            <p className="mt-2 truncate text-[0.95rem] font-bold text-foreground">{ticket.subject}</p>

            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.76rem] text-ink-secondary">
                <span className="inline-flex items-center gap-1.5">
                    <AvatarBadge url={ticket.owner?.avatarUrl} name={ticket.owner?.name} size="size-5" text="text-[0.6rem]" />
                    {ticket.owner?.name ?? 'Unknown'}
                </span>
                {ticket.assignee ? (
                    <span className="inline-flex items-center gap-1.5">
                        <span className="text-ink-muted">held by</span>
                        <span className="font-semibold text-foreground">{ticket.assignee.name}</span>
                        <RoleBadge role={ticket.assignee.role} size="xs" />
                        {ticket.presence && (
                            <span className={cn('size-1.5 rounded-full', ticket.presence.online ? 'bg-emerald-400' : 'bg-zinc-600')} aria-hidden="true" />
                        )}
                    </span>
                ) : (
                    <span className="text-ink-muted">unassigned</span>
                )}
                {last ? (
                    <span className="min-w-0 flex-1 basis-48 truncate text-ink-muted">
                        <span className="text-ink-secondary">{lastFrom}:</span> {last.body}
                        <span className="ml-1.5 font-mono text-[0.68rem]">{relative(last.createdAt)}</span>
                    </span>
                ) : (
                    <span className="text-ink-muted">no messages yet</span>
                )}
                {readOnly && <span className="text-ink-muted">view only</span>}
            </div>
        </Link>
    );
}

function TeamStrip() {
    const { data: team } = useSupportTeam();
    const members = team ?? [];
    const online = members.filter((m) => m.presence?.online);
    return (
        <section className="rounded-xl border border-hairline bg-card" aria-label="Support team">
            <header className="flex items-center gap-2 border-b border-hairline px-4 py-3 sm:px-5">
                <Headset className="size-4 text-ink-secondary" aria-hidden="true" />
                <h2 className="text-[0.95rem] font-bold">Team</h2>
                <span className="ml-auto text-[0.74rem] text-ink-muted">
                    {online.length} of {members.length} online
                </span>
            </header>
            {members.length === 0 ? (
                <p className="px-4 py-6 text-center text-[0.84rem] text-ink-secondary sm:px-5">
                    No support members are configured yet — an admin assigns the Support role.
                </p>
            ) : (
                <ul className="flex flex-wrap gap-x-6 gap-y-2 px-4 py-3.5 sm:px-5">
                    {members.map((m) => (
                        <li key={m.id} className="flex items-center gap-2">
                            <span className="relative">
                                <AvatarBadge url={m.avatarUrl} name={m.name} size="size-8" text="text-[0.7rem]" />
                                <span
                                    className={cn(
                                        'absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card',
                                        m.presence?.online ? 'bg-emerald-400' : 'bg-zinc-600',
                                    )}
                                    aria-hidden="true"
                                />
                            </span>
                            <span className="min-w-0">
                                <span className="block truncate text-[0.85rem] font-bold text-foreground">{m.name}</span>
                                <span className="block text-[0.7rem] text-ink-muted">
                                    {m.stats?.openTickets ?? 0} open · {m.presence?.online ? 'online' : 'offline'}
                                </span>
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function Pick({ label, value, options, onChange, format }) {
    return (
        <label className="flex flex-col gap-1">
            <span className="flex items-center gap-1 text-[0.68rem] font-bold tracking-[0.12em] text-ink-muted uppercase">
                <Filter className="size-3" aria-hidden="true" />
                {label}
            </span>
            <select value={value} onChange={(e) => onChange(e.target.value)} className="input-field sm:w-40">
                {options.map((o) => (
                    <option key={o || 'all'} value={o}>{o ? (format ? format(o) : o.replace(/_/g, ' ')) : 'Any'}</option>
                ))}
            </select>
        </label>
    );
}
