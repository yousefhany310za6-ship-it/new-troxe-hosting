import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, Inbox, LifeBuoy, Loader2, Plus, Server } from 'lucide-react';

import { cn } from '@/lib/utils';
import { AvatarBadge } from '@/components/AvatarBadge.jsx';
import { Modal } from '@/components/ui/modal.jsx';
import { RoleBadge, TicketStatusBadge, categoryLabel, ticketNo } from '@/components/support/Badges.jsx';
import { useMyTickets } from '@/hooks/useSupportQueries.js';
import { CreateTicketForm } from '@/components/support/CreateTicketForm.jsx';

const FILTERS = [
    { key: '', label: 'All' },
    { key: 'open', label: 'Open' },
    { key: 'in_progress', label: 'In progress' },
    { key: 'waiting_user', label: 'Waiting for you' },
    { key: 'waiting_admin', label: 'Waiting for admin' },
    { key: 'resolved', label: 'Resolved' },
    { key: 'closed', label: 'Closed' },
];

export default function MyTickets() {
    const [status, setStatus] = useState('');
    const [page, setPage] = useState(1);
    const [creating, setCreating] = useState(false);
    const { data, isLoading, error, isFetching } = useMyTickets({ status, page, limit: 20 });

    const tickets = data?.items ?? [];
    const pages = data?.pages ?? 1;

    const counts = useMemo(() => {
        const map = {};
        for (const t of tickets) map[t.status] = (map[t.status] ?? 0) + 1;
        return map;
    }, [tickets]);

    return (
        <div className="flex flex-col gap-5">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="flex items-center gap-2 text-[1.35rem] font-extrabold tracking-tight">
                        <LifeBuoy className="size-5 text-ink-secondary" aria-hidden="true" />
                        Support tickets
                    </h1>
                    <p className="mt-1 max-w-2xl text-[0.87rem] text-ink-secondary">
                        Open a ticket about a server, billing or your account. A specialist replies in the ticket — answers stay in
                        one place and nothing is lost on refresh.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-black transition hover:bg-white/90"
                >
                    <Plus className="size-4" aria-hidden="true" />
                    New ticket
                </button>
            </header>

            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter tickets by status">
                {FILTERS.map((f) => (
                    <button
                        key={f.key || 'all'}
                        type="button"
                        onClick={() => { setStatus(f.key); setPage(1); }}
                        aria-pressed={status === f.key}
                        className={cn(
                            'rounded-full border px-3 py-1.5 text-[0.78rem] font-bold transition',
                            status === f.key
                                ? 'border-white/25 bg-white/10 text-foreground'
                                : 'border-hairline text-ink-secondary hover:border-hairline-hover hover:text-foreground'
                        )}
                    >
                        {f.label}
                        {f.key && counts[f.key] ? <span className="ml-1.5 tabular-nums text-ink-muted">{counts[f.key]}</span> : null}
                    </button>
                ))}
                {isFetching && !isLoading && <Loader2 className="size-4 animate-spin text-ink-muted" aria-label="Updating" />}
            </div>

            {isLoading ? (
                <div className="flex flex-col gap-2" aria-busy="true">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="h-[86px] animate-pulse rounded-xl border border-hairline bg-card" />
                    ))}
                </div>
            ) : error ? (
                <div className="rounded-xl border border-red-500/25 bg-red-500/5 p-5 text-[0.85rem] text-red-200" role="alert">
                    Could not load your tickets: {error.message ?? 'unknown error'}
                </div>
            ) : tickets.length === 0 ? (
                <div className="rounded-xl border border-dashed border-hairline bg-card/60 p-10 text-center">
                    <Inbox className="mx-auto size-8 text-ink-muted" aria-hidden="true" />
                    <p className="mt-3 text-[0.92rem] font-bold text-foreground">No tickets here yet</p>
                    <p className="mx-auto mt-1 max-w-md text-[0.82rem] text-ink-secondary">
                        {status
                            ? 'Nothing matches this filter. Try another status.'
                            : 'Something wrong with a server? Open a ticket and attach it with the server contact ID.'}
                    </p>
                    {!status && (
                        <button
                            type="button"
                            onClick={() => setCreating(true)}
                            className="mt-4 inline-flex items-center gap-2 rounded-full border border-hairline px-4 py-2 text-[0.8rem] font-bold text-foreground transition hover:border-hairline-hover"
                        >
                            <Plus className="size-4" aria-hidden="true" />
                            Open your first ticket
                        </button>
                    )}
                </div>
            ) : (
                <ul className="flex flex-col gap-2.5">
                    {tickets.map((t) => (
                        <li key={t.id}>
                            <Link
                                to={`/dashboard/support/${t.id}`}
                                className={cn(
                                    'block rounded-xl border bg-card p-4 transition hover:border-hairline-hover sm:p-5',
                                    t.unreadCount > 0 ? 'border-white/20' : 'border-hairline',
                                )}
                            >
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-mono text-[0.72rem] text-ink-muted">{ticketNo(t.ticketNo)}</span>
                                    <TicketStatusBadge status={t.status} />
                                    <span className="rounded-full border border-hairline bg-veil px-2 py-0.5 text-[0.68rem] font-bold text-ink-secondary">
                                        {categoryLabel(t.category)}
                                    </span>
                                    {t.unreadCount > 0 && (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[0.66rem] font-extrabold text-black tabular-nums">
                                            <BellRing className="size-3" aria-hidden="true" />
                                            {t.unreadCount} new
                                        </span>
                                    )}
                                    <span className="ml-auto text-right font-mono text-[0.7rem] text-ink-muted">
                                        {t.lastMessage
                                            ? `last reply ${new Date(t.lastMessage.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
                                            : `opened ${new Date(t.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`}
                                    </span>
                                </div>
                                <p className="mt-2 truncate text-[0.95rem] font-bold text-foreground">{t.subject}</p>
                                <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.76rem] text-ink-secondary">
                                    {t.assignee ? (
                                        <span className="inline-flex items-center gap-1.5">
                                            <AvatarBadge url={t.assignee.avatarUrl} name={t.assignee.name} size="size-5" text="text-[0.6rem]" />
                                            <span className="font-semibold">{t.assignee.name}</span>
                                            <RoleBadge role={t.assignee.role} size="xs" />
                                        </span>
                                    ) : (
                                        <span className="text-ink-muted">Not assigned yet</span>
                                    )}
                                    {t.serverId && (
                                        <span className="inline-flex items-center gap-1 text-ink-muted">
                                            <Server className="size-3.5" aria-hidden="true" />
                                            Linked server
                                        </span>
                                    )}
                                    {t.rated && <span className="text-emerald-300">Rated</span>}
                                    {t.lastMessage && (
                                        <span className="min-w-0 flex-1 basis-48 truncate text-ink-muted">
                                            {t.lastMessage.authorRole === 'user' ? 'You' : t.lastMessage.authorRole === 'admin' ? 'Admin' : 'Support'}:{' '}
                                            {t.lastMessage.body}
                                        </span>
                                    )}
                                </div>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}

            {pages > 1 && (
                <div className="flex items-center gap-3">
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

            <Modal open={creating} onClose={() => setCreating(false)} title="Open a support ticket" description="Tell us what is going on. Attaching the server makes the first reply much faster.">
                <CreateTicketForm
                    onDone={() => setCreating(false)}
                    onCancel={() => setCreating(false)}
                />
            </Modal>
        </div>
    );
}

