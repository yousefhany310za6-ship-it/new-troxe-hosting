import { useMemo, useState } from 'react';import { Link, useNavigate, useParams } from 'react-router-dom';
import {
    ArrowLeft,
    BadgeCheck,
    Bell,
    Check,
    Clock,
    Crown,
    Headset,
    Loader2,
    Mail,
    Trash2,
    UserRound,
    X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { AvatarBadge } from '@/components/AvatarBadge.jsx';
import { Modal } from '@/components/ui/modal.jsx';
import { RoleBadge, PresenceDot, TicketStatusBadge, categoryLabel, ticketNo } from '@/components/support/Badges.jsx';
import { ServerCard } from '@/components/support/ServerCard.jsx';
import { TicketChat } from '@/components/support/TicketChat.jsx';
import { RatingForm } from '@/components/support/RatingForm.jsx';
import { StaffTicketActions } from '@/components/support/StaffTicketActions.jsx';
import { PriorityControl } from '@/components/support/PriorityControl.jsx';
import { useTicket, useRatingEligibility, useDeleteTicket, useTimeline } from '@/hooks/useSupportQueries.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { ApiError } from '@/lib/api.js';

/**
 * One ticket, shared by every audience:
 * - the owner sees the conversation, the status and (once resolved) the rating
 *   form, and can close/reopen a fresh ticket;
 * - support staff see the read-only linked-server panel, the escalation
 *   button and the assignment actions;
 * - admins additionally see the ticket timeline and the requester's email.
 * Which of those is offered is decided by the server payload (`myRole`,
 * `assignee`), not by a client-side guess.
 */
export default function TicketDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const { data: ticket, isLoading, error, refetch } = useTicket(id);
    const isStaffView = user?.role === 'support' || user?.role === 'admin';
    const eligibility = useRatingEligibility(id);
    const remove = useDeleteTicket(id);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [actionError, setActionError] = useState(null);

    const isStaff = ticket?.myRole === 'support' || ticket?.myRole === 'admin';
    const isAdmin = ticket?.myRole === 'admin';

    const participants = useMemo(() => {
        if (!ticket) return [];
        const list = [];
        if (ticket.owner) list.push({ ...ticket.owner, kind: 'owner' });
        if (ticket.assignee) list.push({ ...ticket.assignee, kind: 'staff' });
        return list;
    }, [ticket]);

    if (isLoading) {
        return (
            <div className="flex items-center gap-2 text-[0.85rem] text-ink-secondary" aria-busy="true">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading ticket…
            </div>
        );
    }

    if (error || !ticket) {
        const code = error instanceof ApiError ? error.code : null;
        const staff = isStaffView;
        return (
            <div className="flex flex-col items-start gap-3 rounded-xl border border-hairline bg-card p-6" role="alert">
                <p className="text-[0.95rem] font-bold text-foreground">
                    {code === 'TICKET_NOT_YOURS' ? 'This ticket is being handled by another specialist' : 'This ticket is not available'}
                </p>
                <p className="max-w-lg text-[0.84rem] text-ink-secondary">
                    {code === 'TICKET_NOT_YOURS'
                        ? staff
                            ? 'The conversation stays private to the specialist who took it. You can see it in the queue as a summary, and it is visible to you again if it is released or reassigned to you.'
                            : 'The conversation stays private to the specialist who took it.'
                        : code === 'TICKET_NOT_FOUND'
                            ? 'It may have been deleted, or the link is wrong.'
                            : 'You do not have access to this ticket.'}
                </p>
                <Link
                    to={staff ? '/dashboard/support/queue' : '/dashboard/support'}
                    className="inline-flex items-center gap-2 rounded-full border border-hairline px-4 py-2 text-[0.82rem] font-bold text-foreground transition hover:border-hairline-hover"
                >
                    <ArrowLeft className="size-4" aria-hidden="true" />
                    {staff ? 'Back to the queue' : 'Back to tickets'}
                </Link>
            </div>
        );
    }

    const canRate = eligibility.data?.eligible === true && (ticket.status === 'resolved' || ticket.status === 'closed') && !ticket.rating;

    return (
        <div className="flex flex-col gap-5">
            <Link
                to={isStaff ? '/dashboard/support/queue' : '/dashboard/support'}
                className="inline-flex w-fit items-center gap-1.5 text-[0.8rem] font-bold text-ink-secondary transition hover:text-foreground"
            >
                <ArrowLeft className="size-4" aria-hidden="true" />
                {isStaff ? 'Back to queue' : 'Back to my tickets'}
            </Link>

            <header className="flex flex-col gap-3 rounded-xl border border-hairline bg-card p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[0.74rem] text-ink-muted">{ticketNo(ticket.ticketNo)}</span>
                    <TicketStatusBadge status={ticket.status} />
                    <span className="rounded-full border border-hairline bg-veil px-2.5 py-0.5 text-[0.7rem] font-bold text-ink-secondary">
                        {categoryLabel(ticket.category)}
                    </span>
                    <span className={cn(
                        'rounded-full border px-2.5 py-0.5 text-[0.7rem] font-bold',
                        ticket.priority === 'high' ? 'border-amber-500/25 bg-amber-500/10 text-amber-300'
                            : ticket.priority === 'urgent' ? 'border-red-500/25 bg-red-500/10 text-red-300'
                                : 'border-hairline bg-veil text-ink-secondary'
                    )}>
                        {ticket.priority === 'urgent' ? 'Critical' : ticket.priority === 'high' ? 'High' : ticket.priority === 'medium' ? 'Medium' : 'Low'} priority
                    </span>
                    <span className="ml-auto font-mono text-[0.7rem] text-ink-muted">
                        opened {new Date(ticket.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                </div>

                <h1 className="text-[1.2rem] font-extrabold tracking-tight text-foreground sm:text-[1.35rem]">{ticket.subject}</h1>
                <p className="text-[0.86rem] leading-relaxed whitespace-pre-wrap text-ink-secondary">{ticket.description}</p>

                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-hairline pt-3 text-[0.78rem]">
                    {participants.map((p) => (
                        <span key={`${p.kind}-${p.id}`} className="inline-flex items-center gap-2">
                            <AvatarBadge url={p.avatarUrl} name={p.name} size="size-7" text="text-[0.66rem]" />
                            <span className="font-bold text-foreground">{p.name}</span>
                            {p.kind === 'owner' ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-hairline bg-veil px-2 py-0.5 text-[0.66rem] font-bold text-ink-secondary">
                                    <UserRound className="size-3" aria-hidden="true" />
                                    Requester
                                </span>
                            ) : (
                                <>
                                    <RoleBadge role={p.role} size="xs" />
                                    <PresenceDot online={!!ticket.presence?.[p.id]?.online} lastSeenAt={ticket.presence?.[p.id]?.lastSeenAt} />
                                </>
                            )}
                        </span>
                    ))}
                    {!ticket.assignee && (
                        <span className="inline-flex items-center gap-1.5 text-ink-muted">
                            <Clock className="size-3.5" aria-hidden="true" />
                            Waiting for a specialist to pick this up
                        </span>
                    )}
                    {isAdmin && ticket.owner?.email && (
                        <a href={`mailto:${ticket.owner.email}`} className="inline-flex items-center gap-1.5 text-ink-secondary transition hover:text-foreground">
                            <Mail className="size-3.5" aria-hidden="true" />
                            {ticket.owner.email}
                        </a>
                    )}
                    {ticket.serverContactCode && (
                        <span className="inline-flex items-center gap-1.5 font-mono text-[0.72rem] text-ink-muted">
                            Server contact ID {ticket.serverContactCode}
                        </span>
                    )}
                </div>

                {isStaff && !isAdmin && ticket.assigneeId && ticket.assigneeId !== user?.id && (
                    <p className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-veil px-3 py-2 text-[0.8rem] text-ink-secondary">
                        <Eye className="size-4 shrink-0" aria-hidden="true" />
                        <span>
                            This ticket belongs to <span className="font-bold text-foreground">{ticket.assignee?.name ?? 'another specialist'}</span> — you
                            can read it and help in person, but only they (or an admin) can reply here.
                        </span>
                    </p>
                )}

                {ticket.pendingEscalation && (
                    <p className="flex items-start gap-2 rounded-lg border border-violet-500/25 bg-violet-500/10 px-3 py-2 text-[0.8rem] text-violet-200">
                        <Bell className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                        <span>
                            <span className="font-bold">Admin called in.</span> {ticket.pendingEscalation.reason}
                            <span className="ml-1 text-violet-300/70">
                                · {new Date(ticket.pendingEscalation.createdAt).toLocaleString()}
                            </span>
                        </span>
                    </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                    {/*
                      The ticket status belongs to the support team: the owner
                      can reply (which reopens a resolved ticket for rework) and
                      can delete a ticket nobody has touched yet, but they can
                      never close, resolve or reopen one themselves.
                    */}
                    {ticket.myRole === 'owner' && ticket.status === 'resolved' && !ticket.rating && (
                        <p className="text-[0.76rem] text-ink-muted">
                            Marked resolved? Reply below and the ticket goes back to the team automatically.
                        </p>
                    )}
                    {ticket.myRole === 'owner' && ticket.status === 'open' && (
                        <button
                            type="button"
                            onClick={() => setConfirmDelete(true)}
                            className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3.5 py-1.5 text-[0.78rem] font-bold text-ink-secondary transition hover:border-red-500/40 hover:text-red-300"
                        >
                            <Trash2 className="size-3.5" aria-hidden="true" />
                            Delete
                        </button>
                    )}
                    <StaffTicketActions ticket={ticket} onChanged={refetch} isStaff={isStaff} isAdmin={isAdmin} />
                    <PriorityControl ticket={ticket} onChanged={refetch} isStaff={isStaff} />
                    {actionError && <span className="text-[0.76rem] text-red-300">{actionError}</span>}
                </div>
            </header>

            {canRate && (
                <RatingForm
                    ticket={ticket}
                    ratee={eligibility.data.ratee}
                    onDone={() => { eligibility.refetch(); refetch(); }}
                />
            )}

            {ticket.rating && (
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 text-[0.84rem] text-emerald-100">
                    <p className="font-bold">You rated this ticket</p>
                    <p className="mt-1">{'★'.repeat(ticket.rating.stars)}{'☆'.repeat(5 - ticket.rating.stars)} · {ticket.rating.resolved === 'yes' ? 'Problem solved' : ticket.rating.resolved === 'partial' ? 'Partly solved' : 'Not solved'}</p>
                    {ticket.rating.comment && <p className="mt-1 text-emerald-200/80">“{ticket.rating.comment}”</p>}
                </div>
            )}

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="flex min-w-0 flex-col gap-4">
                    <TicketChat ticket={ticket} me={user} allowedToPost={ticket.myRole !== 'support' || !ticket.assigneeId || ticket.assigneeId === user?.id || ticket.myRole === 'admin'} />
                </div>
                <aside className="flex min-w-0 flex-col gap-4">
                    {isStaff && <ServerCard ticketId={ticket.id} />}
                    <TicketFacts ticket={ticket} isStaff={isStaff} />
                </aside>
            </div>

            <Modal
                open={confirmDelete}
                onClose={() => setConfirmDelete(false)}
                title="Delete this ticket?"
                description="The ticket is archived for audit purposes and can be restored by an administrator. Tickets that already received a reply cannot be deleted."
            >
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="rounded-full border border-hairline px-4 py-2 text-[0.82rem] font-bold text-ink-secondary transition hover:text-foreground"
                    >
                        Keep it
                    </button>
                    <button
                        type="button"
                        disabled={remove.isPending}
                        onClick={async () => {
                            setActionError(null);
                            try { await remove.mutateAsync(); navigate('/dashboard/support'); }
                            catch (e) { setActionError(e?.message ?? 'Could not delete the ticket.'); setConfirmDelete(false); }
                        }}
                        className="inline-flex items-center gap-2 rounded-full bg-red-500/90 px-4 py-2 text-[0.82rem] font-bold text-white transition hover:bg-red-500 disabled:opacity-60"
                    >
                        {remove.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
                        Delete ticket
                    </button>
                </div>
            </Modal>
        </div>
    );
}

function TicketFacts({ ticket, isStaff }) {
    const [tab, setTab] = useState('details');
    return (
        <section className="rounded-xl border border-hairline bg-card" aria-label="Ticket details">
            <header className="flex items-center gap-1 border-b border-hairline p-1.5">
                <TabButton active={tab === 'details'} onClick={() => setTab('details')}>Details</TabButton>
                {isStaff && <TabButton active={tab === 'history'} onClick={() => setTab('history')}>Event log</TabButton>}
            </header>
            <div className="p-4 text-[0.82rem] text-ink-secondary">
                {tab === 'details' ? (
                    <dl className="flex flex-col gap-2">
                        <Row label="Ticket" value={ticketNo(ticket.ticketNo)} mono />
                        <Row label="Category" value={categoryLabel(ticket.category)} />
                        <Row label="Priority" value={ticket.priority} />
                        <Row label="Status" value={ticket.status} />
                        <Row label="Opened" value={new Date(ticket.createdAt).toLocaleString()} />
                        {ticket.resolvedAt && <Row label="Resolved" value={new Date(ticket.resolvedAt).toLocaleString()} />}
                        {ticket.closedAt && <Row label="Closed" value={new Date(ticket.closedAt).toLocaleString()} />}
                        {ticket.serverContactCode && <Row label="Server contact ID" value={ticket.serverContactCode} mono />}
                    </dl>
                ) : (
                    <TicketTimeline ticketId={ticket.id} />
                )}
            </div>
        </section>
    );
}

function TabButton({ active, onClick, children }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={cn(
                'rounded-lg px-3 py-1.5 text-[0.78rem] font-bold transition',
                active ? 'bg-white/[0.08] text-foreground' : 'text-ink-secondary hover:text-foreground'
            )}
        >
            {children}
        </button>
    );
}

function Row({ label, value, mono }) {
    return (
        <div className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-ink-muted">{label}</dt>
            <dd className={cn('min-w-0 truncate text-right font-semibold text-foreground capitalize', mono && 'font-mono normal-case')}>{value}</dd>
        </div>
    );
}

function TicketTimeline({ ticketId }) {
    const { data, isLoading, error } = useTimeline(ticketId);
    const events = data?.events ?? [];

    if (error) return <p className="text-[0.8rem] text-red-300">{error.message ?? 'Could not load the event log'}</p>;
    if (isLoading) return <p className="flex items-center gap-2 text-[0.8rem]"><Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Loading…</p>;
    if (events.length === 0) return <p className="text-[0.8rem] text-ink-muted">No events recorded yet.</p>

    return (
        <ol className="flex flex-col gap-2.5">
            {events.map((e, i) => (
                <li key={i} className="flex flex-col gap-0.5 border-l border-hairline pl-3">
                    <span className="text-[0.76rem] font-bold text-foreground">
                        {e.action.replace(/_/g, ' ')}
                        {e.actor?.name ? ` · ${e.actor.name}` : ''}
                    </span>
                    <span className="font-mono text-[0.68rem] text-ink-muted">{new Date(e.at).toLocaleString()}</span>
                    {(e.fromStatus || e.toStatus) && (
                        <span className="text-[0.74rem] text-ink-secondary">
                            {e.fromStatus ? `${e.fromStatus} → ${e.toStatus}` : e.toStatus}
                        </span>
                    )}
                    {e.reason && <span className="text-[0.74rem] text-ink-secondary">{e.reason}</span>}
                </li>
            ))}
        </ol>
    );
}
