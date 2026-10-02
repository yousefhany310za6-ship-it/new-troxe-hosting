import { useEffect, useState } from 'react';
import {
    Activity as ActivityIcon,
    Database,
    KeyRound,
    LogIn,
    LogOut,
    Plus,
    Power,
    RotateCcw,
    Settings as SettingsIcon,
    Square,
    Trash2,
    User as UserIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useActivity } from '@/hooks/useQueries.jsx';

// human labels for known audit actions; unknown actions fall back to raw text
const LABELS = {
    'auth.signup': ['Account created', UserIcon],
    'auth.login': ['Signed in', LogIn],
    'auth.login.fail': ['Failed sign-in', LogIn],
    'auth.logout': ['Signed out', LogOut],
    'auth.logout-all': ['Signed out everywhere', LogOut],
    'server.create': ['Server created', Plus],
    'server.update': ['Server updated', SettingsIcon],
    'server.delete': ['Server deleted', Trash2],
    'server.start': ['Server started', Power],
    'server.stop': ['Server stopped', Square],
    'server.restart': ['Server restarted', RotateCcw],
    'server.reinstall': ['Server reinstalled', RotateCcw],
    'server.backup.create': ['Backup created', Database],
    'server.backup.restore': ['Backup restored', Database],
    'server.backup.delete': ['Backup deleted', Trash2],
    'server.exec.open': ['Console opened', ActivityIcon],
    'user.email.change': ['Email changed', UserIcon],
    'user.password.change': ['Password changed', KeyRound],
    'admin.server.create': ['Server created (admin)', Plus],
};

function dayLabel(iso) {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    if (d.toDateString() === new Date(now - 864e5).toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

export default function Activity() {
    const [page, setPage] = useState(1);
    const [items, setItems] = useState([]);
    const [hasMore, setHasMore] = useState(true);
    const { data, isLoading, error, isFetching } = useActivity(page);

    useEffect(() => {
        if (!data) return;
        setItems((prev) => {
            const known = new Set(prev.map((x) => x.id));
            const fresh = (data.data ?? []).filter((e) => !known.has(e.id));
            return page === 1 ? (data.data ?? []) : [...prev, ...fresh];
        });
        setHasMore(data.hasMore);
    }, [data, page]);

    const groups = [];
    for (const e of items) {
        const day = dayLabel(e.createdAt);
        if (groups.length === 0 || groups[groups.length - 1].day !== day) groups.push({ day, items: [] });
        groups[groups.length - 1].items.push(e);
    }

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-[1.6rem] font-extrabold tracking-tight">Activity</h1>
                <p className="mt-1 text-[0.92rem] text-ink-secondary">
                    Everything done by this account — sign-ins, servers, backups, settings.
                </p>
            </div>

            {isLoading && items.length === 0 && <p className="text-ink-muted">Loading…</p>}
            {error && <p className="text-red-400">Failed to load: {error.message}</p>}
            {!isLoading && !error && items.length === 0 && (
                <div className="rounded-xl border border-dashed border-hairline bg-card p-10 text-center">
                    <ActivityIcon className="mx-auto mb-3 size-8 text-ink-muted" />
                    <p className="text-[0.92rem] font-semibold">No activity yet</p>
                    <p className="mt-1 text-[0.85rem] text-ink-secondary">Actions you take will show up here.</p>
                </div>
            )}

            {groups.map((g) => (
                <div key={g.day}>
                    <p className="mb-2 font-mono text-[0.72rem] uppercase tracking-wider text-ink-muted">{g.day}</p>
                    <div className="overflow-hidden rounded-xl border border-hairline bg-card">
                        <div className="flex flex-col divide-y divide-hairline/60">
                            {g.items.map((e) => {
                                const [label, Icon] = LABELS[e.action] ?? [e.action, ActivityIcon];
                                const danger = /delete|fail/.test(e.action);
                                return (
                                    <div key={e.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                                        <span className={cn(
                                            'flex size-8 shrink-0 items-center justify-center rounded-lg',
                                            danger ? 'bg-red-500/15 text-red-400' : 'bg-veil text-ink-secondary',
                                        )}>
                                            <Icon className="size-4" />
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-[0.88rem] font-semibold">{label}</p>
                                            {e.targetId && (
                                                <p className="truncate font-mono text-[0.72rem] text-ink-muted">
                                                    {e.targetType} · {e.targetId.slice(0, 8)}
                                                </p>
                                            )}
                                        </div>
                                        <span className="shrink-0 font-mono text-[0.72rem] text-ink-muted">
                                            {new Date(e.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            ))}

            {hasMore && items.length > 0 && (
                <button
                    type="button"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={isFetching}
                    className="mx-auto rounded-full border border-hairline px-6 py-2.5 text-sm font-bold text-ink-secondary transition hover:text-foreground disabled:opacity-50"
                >
                    {isFetching ? 'Loading…' : 'Load more'}
                </button>
            )}
        </div>
    );
}
