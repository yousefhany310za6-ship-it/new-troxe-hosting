import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, Send, WifiOff } from 'lucide-react';

import { cn } from '@/lib/utils';
import { AvatarBadge } from '@/components/AvatarBadge.jsx';
import { MessageTicks, MessagePending, RoleBadge, PresenceDot } from '@/components/support/Badges.jsx';
import { useTicketMessages, useSendMessage, useMarkRead } from '@/hooks/useSupportQueries.js';
import { useSupportSocket } from '@/hooks/useSupportSocket.js';

const DAY = 86_400_000;

function dayLabel(iso) {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    if (d.toDateString() === new Date(now - DAY).toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

/** stable per-attempt idempotency key: a retry of the same text reuses it */
function newKey() {
    try {
        return crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    } catch {
        return `${Date.now()}${Math.random().toString(36).slice(2, 12)}`;
    }
}

/**
 * Ticket chat. Delivery of history is always REST; the socket only adds what
 * is new. A failed send stays visible as pending and can be retried with the
 * SAME idempotency key, so a retry can never become a duplicate message.
 */
export function TicketChat({ ticket, me }) {
    const [page, setPage] = useState(1);
    const [text, setText] = useState('');
    const [pending, setPending] = useState(null); // { key, body }
    const [sendError, setSendError] = useState(null);
    const [typing, setTyping] = useState(null);
    const [presence, setPresence] = useState(null);
    const [live, setLive] = useState([]);
    const [socketDown, setSocketDown] = useState(false);
    const bottomRef = useRef(null);
    const listRef = useRef(null);
    const lastReadRef = useRef(null);

    const historyQuery = useTicketMessages(ticket.id, page);
    const send = useSendMessage(ticket.id);
    const markRead = useMarkRead(ticket.id);

    const typingTimer = useRef(null);

    const onEvent = useCallback((type, payload) => {
        if (payload?.ticketId && payload.ticketId !== ticket.id) return;
        if (type === 'ticket:message') {
            const m = payload.message;
            setLive((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
            setTyping(null);
        } else if (type === 'ticket:typing') {
            setTyping({ userId: payload.userId, typing: payload.typing, at: payload.at });
            window.clearTimeout(typingTimer.current);
            if (payload.typing !== false) {
                typingTimer.current = window.setTimeout(() => setTyping(null), 4000);
            }
        } else if (type === 'ticket:read') {
            // read state lives in the database: re-read it instead of guessing
            historyQuery.refetch?.();
        } else if (type === 'ticket:refresh') {
            historyQuery.refetch?.();
        } else if (type === 'presence') {
            setPresence((prev) => ({ ...(prev ?? {}), [payload.userId]: payload.online }));
        } else if (type === 'ticket:subscribed') {
            setPresence(payload.presence ?? null);
        } else if (type === 'error') {
            setSocketDown(true);
        }
    }, [ticket.id, historyQuery]);

    const { connected, emit } = useSupportSocket({ ticketId: ticket.id, onEvent });

    const history = useMemo(() => {
        const items = [...(historyQuery.data?.items ?? [])];
        const seen = new Set(items.map((m) => m.id));
        return [...items, ...live.filter((m) => !seen.has(m.id))].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
    }, [historyQuery.data, live]);

    // optimistic echo of my own pending message (until the server confirms)
    const rows = useMemo(() => {
        if (!pending) return history;
        return [...history, {
            id: `pending:${pending.key}`,
            author: { id: me?.id, name: me?.name, avatarUrl: me?.avatarUrl },
            authorRole: 'user',
            body: pending.body,
            createdAt: new Date().toISOString(),
            pending: true,
        }];
    }, [history, pending, me]);

    // follow the tail as new messages arrive
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ block: 'end' });
    }, [rows.length]);

    // read receipt: everything the counterpart wrote before I opened the chat
    useEffect(() => {
        if (!rows.length || !connected) return;
        const mine = rows.filter((m) => m.author?.id !== me?.id);
        const last = mine[mine.length - 1];
        if (!last || lastReadRef.current === last.id) return;
        lastReadRef.current = last.id;
        markRead.mutate(last.id);
        emit('ticket:read', { ticketId: ticket.id, upToId: last.id });
    }, [rows, connected, me?.id, ticket.id, emit, markRead]);

    const canWrite = ticket.status !== 'closed' && !ticket.deletedAt;

    const doSend = async (body, key) => {
        const trimmed = body.trim();
        if (!trimmed) return;
        setSendError(null);
        setPending({ key, body: trimmed });
        try {
            const msg = await send.mutateAsync({ body: trimmed, clientMsgId: key });
            setLive((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, m]));
            setText('');
            setPending(null);
        } catch (e) {
            setSendError(e?.message ?? 'Message could not be sent.');
        }
    };

    const submit = (e) => {
        e.preventDefault();
        if (!canWrite || send.isPending || pending) return;
        void doSend(text, newKey());
    };

    const notifyTyping = () => {
        emit('ticket:typing', { ticketId: ticket.id, typing: true });
    };

    const statusLine = () => {
        if (!canWrite) return 'This ticket is closed. Reopen it (or ask an admin to) to keep talking.';
        if (ticket.status === 'waiting_user') return 'Support is waiting for your reply.';
        if (ticket.status === 'in_progress') return 'A specialist is working on this ticket.';
        if (ticket.status === 'waiting_admin') return 'An administrator has been called in — they will join here.';
        if (ticket.status === 'resolved') return 'Marked resolved. Reply to reopen the conversation if it is not fixed.';
        return 'Ticket open — the team has been notified.';
    };

    return (
        <div className="flex flex-col gap-3">
            {/* live connection state is stated honestly, never faked */}
            <div className="flex flex-wrap items-center gap-2 text-[0.74rem]">
                {connected ? (
                    <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-300">
                        <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                        Live
                    </span>
                ) : (
                    <span className="inline-flex items-center gap-1.5 font-semibold text-amber-300">
                        <WifiOff className="size-3.5" aria-hidden="true" />
                        Reconnecting — messages still save, they will appear when the connection returns
                    </span>
                )}
                {socketDown && (
                    <button type="button" onClick={() => setSocketDown(false)} className="underline decoration-dotted text-ink-muted">
                        dismiss
                    </button>
                )}
                <span className="ml-auto text-ink-muted">{statusLine()}</span>
            </div>

            <div
                ref={listRef}
                className="flex max-h-[52vh] min-h-[280px] flex-col gap-3 overflow-y-auto rounded-xl border border-hairline bg-card p-3.5 sm:p-4"
                aria-live="polite"
                aria-label="Ticket conversation"
            >
                {historyQuery.isError && (
                    <p className="flex items-center gap-2 text-[0.8rem] text-red-200" role="alert">
                        <AlertTriangle className="size-4" aria-hidden="true" />
                        Could not load the conversation. <button type="button" className="underline" onClick={() => historyQuery.refetch()}>Retry</button>
                    </p>
                )}
                {historyQuery.isLoading && (
                    <p className="flex items-center gap-2 text-[0.82rem] text-ink-secondary"><Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading conversation…</p>
                )}
                {historyQuery.data?.hasMore && (
                    <button
                        type="button"
                        onClick={() => setPage((p) => p + 1)}
                        className="mx-auto inline-flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-[0.74rem] font-bold text-ink-secondary transition hover:text-foreground"
                    >
                        <RefreshCw className="size-3.5" aria-hidden="true" />
                        Load older messages
                    </button>
                )}

                {rows.length === 0 && !historyQuery.isLoading && (
                    <p className="py-8 text-center text-[0.85rem] text-ink-secondary">
                        No messages yet. Write the first one below.
                    </p>
                )}

                {rows.map((m, i) => {
                    const mine = m.author?.id === me?.id && !m.pending;
                    const showDay = i === 0 || dayLabel(rows[i - 1].createdAt) !== dayLabel(m.createdAt);
                    return (
                        <div key={m.id}>
                            {showDay && (
                                <p className="my-1 text-center font-mono text-[0.68rem] tracking-[0.16em] text-ink-muted uppercase">
                                    {dayLabel(m.createdAt)}
                                </p>
                            )}
                            <MessageBubble
                                message={m}
                                mine={mine}
                                ticket={ticket}
                                presence={presence}
                                typing={typing}
                            />
                        </div>
                    );
                })}

                {typing?.typing && (
                    <p className="flex items-center gap-2 px-1 text-[0.74rem] text-ink-muted">
                        <span className="flex gap-1" aria-hidden="true">
                            <span className="size-1.5 animate-bounce rounded-full bg-ink-muted" />
                            <span className="size-1.5 animate-bounce rounded-full bg-ink-muted [animation-delay:120ms]" />
                            <span className="size-1.5 animate-bounce rounded-full bg-ink-muted [animation-delay:240ms]" />
                        </span>
                        Someone is typing…
                    </p>
                )}
                <div ref={bottomRef} />
            </div>

            <form onSubmit={submit} className="flex flex-col gap-2">
                <div className="flex items-end gap-2">
                    <textarea
                        value={text}
                        onChange={(e) => { setText(e.target.value); if (e.target.value.trim()) notifyTyping(); }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(e); }
                        }}
                        rows={2}
                        maxLength={4000}
                        disabled={!canWrite}
                        placeholder={canWrite ? 'Write a message… (Enter to send, Shift+Enter for a new line)' : 'This ticket is closed.'}
                        aria-label="Message"
                        className="input-field resize-y"
                    />
                    <button
                        type="submit"
                        disabled={!canWrite || !text.trim() || send.isPending || !!pending}
                        className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-white px-4 text-[0.84rem] font-bold text-black transition hover:bg-white/90 disabled:opacity-50"
                    >
                        {send.isPending || pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
                        Send
                    </button>
                </div>
                {sendError && pending && (
                    <p className="flex flex-wrap items-center gap-2 text-[0.76rem] text-amber-300" role="alert">
                        <AlertTriangle className="size-3.5" aria-hidden="true" />
                        {sendError}
                        <button
                            type="button"
                            className="underline decoration-dotted"
                            onClick={() => { void doSend(pending.body, pending.key); }}
                        >
                            Retry
                        </button>
                        <button type="button" className="underline decoration-dotted text-ink-muted" onClick={() => { setPending(null); setSendError(null); }}>
                            Discard
                        </button>
                    </p>
                )}
                <p className="text-[0.7rem] text-ink-muted">
                    Messages are stored with the ticket and survive refreshes and dropped connections.
                </p>
            </form>
        </div>
    );
}

function MessageBubble({ message, mine, ticket, presence, typing }) {
    const isStaff = message.authorRole === 'support' || message.authorRole === 'admin';
    const online = presence?.[message.author?.id]?.online;
    const label = message.authorRole === 'admin' ? 'Admin' : message.authorRole === 'support' ? 'Support' : (message.author?.name ?? 'You');
    return (
        <div className={cn('flex items-start gap-2.5', mine && 'flex-row-reverse')}>
            <AvatarBadge url={message.author?.avatarUrl} name={message.author?.name} size="size-8" text="text-[0.7rem]" />
            <div className={cn('flex min-w-0 max-w-[85%] flex-col gap-1', mine && 'items-end')}>
                <p className={cn('flex flex-wrap items-center gap-1.5 text-[0.74rem]', mine && 'flex-row-reverse')}>
                    <span className="font-bold text-foreground">{label}</span>
                    {isStaff && <RoleBadge role={message.authorRole} size="xs" />}
                    {!mine && isStaff && <PresenceDot online={!!online} />}
                    <span className="font-mono text-[0.66rem] text-ink-muted">
                        {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                </p>
                <div
                    className={cn(
                        'rounded-2xl border px-3.5 py-2.5 text-[0.86rem] leading-relaxed whitespace-pre-wrap break-words',
                        mine ? 'border-white/15 bg-white/[0.09] text-foreground' : 'border-hairline bg-veil text-foreground',
                        message.pending && 'opacity-70'
                    )}
                >
                    {message.body}
                </div>
                <div className="flex items-center gap-2">
                    {message.pending ? <MessagePending /> : <MessageTicks deliveredAt={message.deliveredAt} readAt={message.readAt} mine={mine} />}
                </div>
            </div>
        </div>
    );
}
