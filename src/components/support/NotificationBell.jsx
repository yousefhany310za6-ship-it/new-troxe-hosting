import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Check, Loader2, LogIn, Ticket as TicketIcon } from 'lucide-react';

import { useNavigate } from 'react-router-dom';
import { useNotifications, useReadNotification, useMarkSeen, useAcceptCallForTicket } from '@/hooks/useSupportQueries.js';
import { useSupportSocket } from '@/hooks/useSupportSocket.js';
import { timeAgo } from '@/pages/admin/components.jsx';

/**
 * Ticket notification bell.
 *
 * Rules this implements:
 * - the badge is the SERVER's unread count (plus anything genuinely new that
 *   arrived over the socket since the last fetch) — never a local number;
 * - opening the panel marks as read exactly the notifications that already
 *   existed at that moment (`asOf`), so a notification arriving while the
 *   panel is open stays unread and keeps the badge honest;
 * - a failed "seen" call surfaces an error and can be retried — no fake
 *   success, and the badge is not optimistically cleared;
 * - the same notification arriving twice (reconnect, replayed push) is
 *   de-duplicated by id, so it can never be counted twice;
 * - read state lives in the database, so a second device sees the same badge.
 */
/** Extract the ticket id from a canonical notification link. */
function ticketIdFromLink(link) {
    const m = String(link ?? '').match(/\/dashboard\/support\/([0-9a-fA-F-]{36})/);
    return m ? m[1] : null;
}

export function NotificationBell() {
    const [open, setOpen] = useState(false);
    const [live, setLive] = useState([]);
    const [seenPending, setSeenPending] = useState(false);
    const [seenError, setSeenError] = useState(null);
    const ref = useRef(null);
    const { data, isFetching } = useNotifications(1);
    const readOne = useReadNotification();
    const markSeen = useMarkSeen();

    const navigate = useNavigate();
    const acceptCall = useAcceptCallForTicket();
    const { connected } = useSupportSocket({
        listenOnly: true,
        onEvent: (type, payload) => {
            if (type !== 'notification' && type !== 'admin:notification') return;
            setLive((prev) => {
                // id-based de-duplication: a replayed push must not stack up
                if (prev.some((n) => n.id === payload.id)) return prev;
                const entry = {
                    id: payload.id ?? `live:${payload.ts}:${Math.random().toString(36).slice(2, 8)}`,
                    type: payload.type,
                    title: payload.title,
                    body: payload.body,
                    link: payload.link ?? null,
                    createdAt: new Date(payload.ts).toISOString(),
                    live: true,
                };
                return [entry, ...prev].slice(0, 30);
            });
        },
    });

    useEffect(() => {
        if (!open) return undefined;
        const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDoc);
        document.addEventListener('keydown', onEsc);
        return () => {
            document.removeEventListener('mousedown', onDoc);
            document.removeEventListener('keydown', onEsc);
        };
    }, [open]);

    const stored = data?.items ?? [];
    const storedUnread = data?.unread ?? 0;
    // items shown: live pushes that are not yet in the stored page + stored
    const liveOnly = live.filter((n) => !stored.some((s) => s.id === n.id));
    const unread = storedUnread + liveOnly.length;
    const items = [...liveOnly, ...stored];

    const openPanel = async () => {
        const next = !open;
        setOpen(next);
        if (next) {
            setSeenError(null);
            setSeenPending(true);
            try {
                // everything that existed at THIS instant is what the user is
                // looking at right now
                await markSeen.mutateAsync(Date.now());
                setLive([]);
            } catch (e) {
                setSeenError(e?.message ?? 'Could not mark the notifications as read.');
            } finally {
                setSeenPending(false);
            }
        }
    };

    return (
        <div className="relative" ref={ref}>
            <button
                type="button"
                onClick={openPanel}
                aria-expanded={open}
                aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
                className="relative rounded-full border border-hairline p-2 text-ink-secondary transition hover:border-hairline-hover hover:text-foreground"
            >
                <Bell className="size-[18px]" aria-hidden="true" />
                {unread > 0 && (
                    <span className="absolute -top-1 -right-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-white px-1 text-[0.62rem] font-extrabold text-black tabular-nums">
                        {unread > 9 ? '9+' : unread}
                    </span>
                )}
                {connected && <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-emerald-400" aria-hidden="true" />}
            </button>

            {open && (
                <div className="absolute right-0 z-50 mt-2 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-hairline bg-card shadow-2xl" role="dialog" aria-label="Notifications">
                    <header className="flex items-center gap-2 border-b border-hairline px-3.5 py-2.5">
                        <p className="text-[0.85rem] font-bold text-foreground">Notifications</p>
                        {(isFetching || seenPending) && <Loader2 className="size-3.5 animate-spin text-ink-muted" aria-hidden="true" />}
                        <span className="ml-auto font-mono text-[0.7rem] text-ink-muted tabular-nums">{unread} unread</span>
                    </header>

                    {seenError && (
                        <p className="flex flex-wrap items-center gap-2 border-b border-hairline px-3.5 py-2 text-[0.76rem] text-amber-300" role="alert">
                            {seenError}
                            <button
                                type="button"
                                className="underline decoration-dotted"
                                onClick={async () => {
                                    setSeenError(null);
                                    setSeenPending(true);
                                    try { await markSeen.mutateAsync(Date.now()); setLive([]); }
                                    catch (e) { setSeenError(e?.message ?? 'Retry failed.'); }
                                    finally { setSeenPending(false); }
                                }}
                            >
                                Retry
                            </button>
                        </p>
                    )}

                    <ul className="max-h-[60vh] overflow-y-auto">
                        {items.length === 0 && (
                            <li className="px-3.5 py-8 text-center text-[0.82rem] text-ink-secondary">Nothing new.</li>
                        )}
                        {items.map((n) => (
                            <li key={n.id} className="border-b border-hairline last:border-0">
                                <div className="relative">
                                <Link
                                    to={n.link ?? '/dashboard/support'}
                                    onClick={() => { setOpen(false); if (!n.live && !n.readAt) readOne.mutate(n.id); }}
                                    className="block px-3.5 py-2.5 transition hover:bg-white/[0.04]"
                                >
                                    <p className="flex items-center gap-1.5 text-[0.84rem] font-bold text-foreground">
                                        <TicketIcon className="size-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
                                        {n.title}
                                    </p>
                                    <p className="mt-0.5 line-clamp-2 text-[0.78rem] text-ink-secondary">{n.body}</p>
                                    <p className="mt-1 font-mono text-[0.66rem] text-ink-muted">
                                        {timeAgo(n.createdAt)}{!n.readAt && !n.live ? ' · unread' : ''}
                                    </p>
                                </Link>
                                {n.type === 'ticket_escalated' && ticketIdFromLink(n.link) && (
                                    <div className="px-3.5 pb-2.5">
                                        <button
                                            type="button"
                                            disabled={acceptCall.isPending}
                                            onClick={async () => {
                                                setOpen(false);
                                                try {
                                                    await acceptCall.mutateAsync(ticketIdFromLink(n.link));
                                                    navigate(n.link ?? '/dashboard/support');
                                                } catch (e) {
                                                    // the call may already be handled: still open the ticket
                                                    navigate(n.link ?? '/dashboard/support', { state: { escalationError: e?.message ?? null } });
                                                }
                                            }}
                                            className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-[0.74rem] font-bold text-black transition hover:bg-white/90 disabled:opacity-60"
                                        >
                                            <LogIn className="size-3.5" aria-hidden="true" />
                                            {acceptCall.isPending ? 'Joining…' : 'Join ticket'}
                                        </button>
                                    </div>
                                )}
                                </div>
                            </li>
                        ))}
                    </ul>
                    <footer className="border-t border-hairline px-3.5 py-2">
                        <Link to="/dashboard/support" onClick={() => setOpen(false)} className="text-[0.76rem] font-bold text-ink-secondary transition hover:text-foreground">
                            View all tickets
                        </Link>
                    </footer>
                </div>
            )}
        </div>
    );
}
