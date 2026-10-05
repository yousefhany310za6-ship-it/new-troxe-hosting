import { Link } from 'react-router-dom';
import { Activity, ArrowRight, Clock, Globe, MonitorSmartphone, Server, ShieldCheck } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Flag } from '@/components/ui/flag.jsx';
import { useAuth } from '@/context/AuthContext.jsx';
import { useServers, useAuthSessions } from '@/hooks/useQueries.jsx';

const STAT_ICONS = {
    server: Server,
    activity: Activity,
    globe: Globe,
    clock: Clock,
    shield: ShieldCheck,
};

function StatCard({ label, value, hint, icon }) {
    const Icon = STAT_ICONS[icon] ?? Server;

    return (
        <div className="rounded-xl border border-hairline bg-card p-6">
            <div className="flex items-center justify-between">
                <p className="text-[0.85rem] text-ink-muted">{label}</p>
                <Icon className="size-[18px] text-ink-muted" />
            </div>
            <p className="mt-2 font-mono text-[1.7rem] font-bold text-foreground">{value}</p>
            <p className="mt-1 font-mono text-[0.75rem] text-ink-secondary">{hint}</p>
        </div>
    );
}

export const STATUS_STYLE = {
    online: 'bg-emerald-500',
    offline: 'bg-zinc-600',
    restarting: 'bg-amber-500',
    error: 'bg-red-500',
    provisioning: 'bg-blue-500',
};

export const RUNTIME_ICONS = {
    'Node.js': (props) => <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>,
    Bun: (props) => <svg {...props} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>,
    Python: (props) => <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5"/></svg>,
    PHP: (props) => <svg {...props} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>,
};

export default function Overview() {
    const { user } = useAuth();
    const { data: servers, isLoading: serversLoading, error: serversError } = useServers();
    const { data: sessions, isLoading: sessionsLoading, error: sessionsError } = useAuthSessions();

    if (serversLoading || sessionsLoading) {
        return <div className="flex items-center justify-center h-64 text-ink-muted">Loading…</div>;
    }
    if (serversError || sessionsError) {
        return <div className="text-red-400">Failed to load: {serversError?.message ?? sessionsError?.message}</div>;
    }

    const online = servers.filter(s => s.status === 'online').length;
    const restarting = servers.filter(s => s.status === 'restarting').length;
    const currentSession = sessions?.current;

    const stats = [
        { label: 'Total servers', value: servers.length, hint: `${online} online`, icon: 'server' },
        { label: 'Online now', value: online, hint: restarting > 0 ? `${restarting} restarting` : 'All healthy', icon: 'activity' },
        { label: 'Plan', value: user?.planId ?? 'free', hint: `${user?.role ?? 'user'} account`, icon: 'shield' },
        {
            label: 'Last sign-in',
            value: currentSession ? new Date(currentSession.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—',
            hint: currentSession ? currentSession.location : 'No history',
            icon: 'globe',
        },
    ];

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-[1.6rem] font-extrabold tracking-tight">Overview</h1>
                <p className="mt-1 text-[0.92rem] text-ink-secondary">
                    Servers, sessions and sign-ins — at a glance.
                </p>
            </div>

            {user && user.emailVerified === false && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-5 py-3.5">
                    <p className="text-[0.9rem] text-amber-200">
                        Your email <span className="font-bold">{user.email}</span> is not verified yet — some features may ask for it.
                    </p>
                    <Link to="/verify-email" className="rounded-full bg-white px-5 py-2 text-[0.83rem] font-bold text-black transition hover:bg-gray-200">
                        Verify now
                    </Link>
                </div>
            )}

            <div className="grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-md:grid-cols-1">
                {stats.map((stat) => (
                    <StatCard key={stat.label} {...stat} />
                ))}
            </div>

            <div className="grid grid-cols-5 gap-4 max-lg:grid-cols-1">
                {/* Servers summary */}
                <div className="col-span-3 rounded-xl border border-hairline bg-card p-6">
                    <div className="mb-4 flex items-center justify-between">
                        <h2 className="text-[1.05rem] font-bold">Servers</h2>
                        <Link
                            to="/dashboard/servers"
                            className="inline-flex items-center gap-1 text-[0.85rem] font-semibold text-ink-secondary transition hover:gap-2 hover:text-foreground"
                        >
                            Manage all <ArrowRight className="size-4" />
                        </Link>
                    </div>
                    <div className="flex flex-col">
                        {servers.slice(0, 5).map((server) => (
                            <Link
                                key={server.id}
                                to={`/dashboard/servers/${server.id}`}
                                className="flex items-center gap-3 border-t border-hairline py-3.5 first:border-t-0 first:pt-0 last:pb-0"
                            >
                                <span className={cn('size-2.5 shrink-0 rounded-full', STATUS_STYLE[server.status])} />
                                <span className="font-mono text-[0.9rem] font-semibold">{server.name}</span>
                                <span className="rounded-full border border-hairline bg-veil px-2 py-0.5 text-[0.72rem] font-semibold text-ink-secondary">
                                    {server.runtimeLabel ?? server.runtime}
                                </span>
                                <span className="ml-auto font-mono text-[0.8rem] text-ink-muted capitalize">{server.status}</span>
                            </Link>
                        ))}
                        {servers.length === 0 && (
                            <p className="border-t border-hairline py-3.5 text-center text-ink-muted">No servers yet</p>
                        )}
                    </div>
                </div>

                {/* Current session */}
                <div className="col-span-2 rounded-xl border border-hairline bg-card p-6">
                    <h2 className="mb-4 flex items-center gap-2 text-[1.05rem] font-bold">
                        <MonitorSmartphone className="size-[18px] text-ink-muted" /> Current session
                    </h2>
                    {currentSession ? (
                        <>
                            <div className="flex items-center gap-3">
                                <Flag code={currentSession.countryCode} name={currentSession.location} />
                                <div>
                                    <p className="text-[0.92rem] font-bold">{currentSession.location}</p>
                                    <p className="font-mono text-[0.78rem] text-ink-secondary">{currentSession.ip}</p>
                                </div>
                                <span className="ml-auto rounded-full bg-emerald-500/15 px-2.5 py-1 text-[0.7rem] font-bold text-emerald-400">
                                    This device
                                </span>
                            </div>
                            <div className="mt-4 flex flex-col gap-2 border-t border-hairline pt-4 text-[0.85rem]">
                                <div className="flex justify-between gap-2">
                                    <span className="text-ink-muted">Device</span>
                                    <span className="text-right font-semibold">{currentSession.device}</span>
                                </div>
                                <div className="flex justify-between gap-2">
                                    <span className="text-ink-muted">Signed in</span>
                                    <span className="text-right font-mono text-[0.78rem]">{new Date(currentSession.createdAt).toLocaleString()}</span>
                                </div>
                            </div>
                        </>
                    ) : (
                        <p className="text-ink-muted">No active session</p>
                    )}
                </div>
            </div>

            {/* Login history */}
            <div className="overflow-hidden rounded-xl border border-hairline bg-card">
                <div className="border-b border-hairline px-6 py-4">
                    <h2 className="text-[1.05rem] font-bold">Login history</h2>
                    <p className="mt-0.5 text-[0.83rem] text-ink-secondary">
                        Every sign-in attempt with IP, full date and country.
                    </p>
                </div>
                <div className="hidden grid-cols-[90px_1fr_150px_1fr_220px] gap-4 border-b border-hairline px-6 py-3 font-mono text-[0.7rem] tracking-wider text-ink-muted uppercase lg:grid">
                    <span>Status</span>
                    <span>Location</span>
                    <span>IP</span>
                    <span>Device</span>
                    <span>Date</span>
                </div>
                <div className="flex flex-col divide-y divide-hairline">
                    {(sessions?.history ?? []).map((entry) => (
                        <div
                            key={entry.id}
                            className="grid grid-cols-1 gap-2 px-6 py-4 lg:grid-cols-[90px_1fr_150px_1fr_220px] lg:items-center lg:gap-4"
                        >
                            <span>
                                <span className={cn(
                                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.7rem] font-bold',
                                    entry.status === 'success'
                                        ? 'bg-emerald-500/15 text-emerald-400'
                                        : 'bg-red-500/15 text-red-400'
                                )}>
                                    <span className={cn(
                                        'size-1.5 rounded-full',
                                        entry.status === 'success' ? 'bg-emerald-400' : 'bg-red-400'
                                    )} />
                                    {entry.status === 'success' ? 'Success' : 'Failed'}
                                </span>
                            </span>
                            <span className="flex items-center gap-2.5">
                                <Flag code={entry.countryCode} name={entry.location} />
                                <span className="text-[0.88rem] font-semibold">{entry.location}</span>
                                {entry.id === currentSession?.id && (
                                    <span className="rounded-full border border-hairline bg-veil px-2 py-0.5 text-[0.68rem] font-bold text-ink-secondary">
                                        Current
                                    </span>
                                )}
                            </span>
                            <span className="font-mono text-[0.8rem] text-ink-secondary">{entry.ip}</span>
                            <span className="text-[0.83rem] text-ink-secondary">{entry.device}</span>
                            <span className="font-mono text-[0.78rem] text-ink-muted">{new Date(entry.createdAt).toLocaleString()}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}