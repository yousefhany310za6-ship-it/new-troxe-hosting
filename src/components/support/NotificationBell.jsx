import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Check, Loader2 } from 'lucide-react';

import { useNotifications, useReadAllNotifications, useReadNotification } from '@/hooks/useSupportQueries.js';
import { useSupportSocket } from '@/hooks/useSupportSocket.js';
import { timeAgo } from '@/pages/admin/components.jsx';

/**
 * Ticket notification bell. The count is always derived from the stored
 * notifications (what the user actually has), and live socket events only add
 * to it — never replace it, so a dropped connection can never make the badge
 * lie about unread items.
 */
export function NotificationBell() {
    const [open, setOpen] = useState(false);
    const [live, setLive] = useState([]);
    const ref = useRef(null);
    const { data, isFetching } = useNotifications(1);
    const readAll = useReadAllNotifications();
    const readOne = useReadNotification();

    const { connected } = useSupportSocket({
        listenOnly: true,
        onEvent: (type, payload) => {
            if (type === 'notification' || type === 'admin:notification') {
                setLive((prev) => [{ id: `live:${payload.ts}:${Math.random().toString(36).slice(2, 8)}`, ...payload, createdAt: new Date(payload.ts).toISOString() }, ...prev].slice(0, 20));
            }
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
    const unread = (data?.unread ?? 0) + live.length;
    const items = [...live.map((n) => ({ ...n, live: true })), ...stored.filter((n) => !n.readAt)];

    return (
        <div className="relative" ref={ref}>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
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
                <div className="absolute right-0 z-50 mt-2 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-hairline bg-card shadow-2xl" role="dialog" aria-label="Notifications">
                    <header className="flex items-center gap-2 border-b border-hairline px-3.5 py-2.5">
                        <p className="text-[0.85rem] font-bold text-foreground">Notifications</p>
                        {isFetching && <Loader2 className="size-3.5 animate-spin text-ink-muted" aria-hidden="true" />}
                        <button
                            type="button"
                            disabled={readAll.isPending || unread === 0}
                            onClick={() => { readAll.mutate(); setLive([]); }}
                            className="ml-auto inline-flex items-center gap-1 text-[0.72rem] font-bold text-ink-secondary transition hover:text-foreground disabled:opacity-40"
                        >
                            <Check className="size-3.5" aria-hidden="true" />
                            Mark all read
                        </button>
                    </header>
                    <ul className="max-h-[60vh] overflow-y-auto">
                        {items.length === 0 && (
                            <li className="px-3.5 py-8 text-center text-[0.82rem] text-ink-secondary">Nothing new.</li>
                        )}
                        {items.map((n) => (
                            <li key={n.id} className="border-b border-hairline last:border-0">
                                <Link
                                    to={n.link ?? '/dashboard/support'}
                                    onClick={() => { setOpen(false); if (!n.live) readOne.mutate(n.id); }}
                                    className="block px-3.5 py-2.5 transition hover:bg-white/[0.04]"
                                >
                                    <p className="text-[0.84rem] font-bold text-foreground">{n.title}</p>
                                    <p className="mt-0.5 line-clamp-2 text-[0.78rem] text-ink-secondary">{n.body}</p>
                                    <p className="mt-1 font-mono text-[0.66rem] text-ink-muted">{timeAgo(n.createdAt)}</p>
                                </Link>
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
