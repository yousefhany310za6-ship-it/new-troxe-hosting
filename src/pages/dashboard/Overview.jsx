import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  Clock,
  Cpu,
  Crown,
  Database,
  Globe,
  History,
  LogIn,
  MailWarning,
  MonitorSmartphone,
  Plus,
  Power,
  RotateCcw,
  Server,
  Settings as SettingsIcon,
  ShieldCheck,
  Square,
  Trash2,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Flag } from '@/components/ui/flag.jsx';
import { AvatarBadge } from '@/components/AvatarBadge.jsx';
import { useAuth } from '@/context/AuthContext.jsx';
import { useActivity, useAuthSessions, useServers } from '@/hooks/useQueries.jsx';

export const STATUS_STYLE = {
    online: 'bg-emerald-500',
    offline: 'bg-zinc-600',
    restarting: 'bg-amber-500',
    error: 'bg-red-500',
    provisioning: 'bg-blue-500',
    suspended: 'bg-red-500',
};

const STATUS_PILL = {
    online: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
    offline: 'border-hairline bg-veil text-ink-secondary',
    restarting: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
    error: 'border-red-500/25 bg-red-500/10 text-red-300',
    provisioning: 'border-blue-500/25 bg-blue-500/10 text-blue-300',
};

export const RUNTIME_ICONS = {
    'Node.js': (props) => <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>,
    Bun: (props) => <svg {...props} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>,
    Python: (props) => <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5"/></svg>,
    PHP: (props) => <svg {...props} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>,
};

const ACT_ICONS = {
    'server.create': Plus,
    'server.update': SettingsIcon,
    'server.delete': Trash2,
    'server.start': Power,
    'server.stop': Square,
    'server.restart': RotateCcw,
    'server.reinstall': RotateCcw,
    'server.backup.create': Database,
    'server.backup.restore': History,
    'server.backup.delete': Trash2,
    'auth.login': LogIn,
};

const ACT_LABELS = {
    'server.create': 'created a server',
    'server.update': 'updated a server',
    'server.delete': 'deleted a server',
    'server.start': 'started a server',
    'server.stop': 'stopped a server',
    'server.restart': 'restarted a server',
    'server.reinstall': 'reinstalled a server',
    'server.backup.create': 'created a backup',
    'server.backup.restore': 'restored a backup',
    'server.backup.delete': 'deleted a backup',
    'auth.login': 'signed in',
};

function timeAgo(iso) {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '';
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    return new Date(t).toLocaleDateString();
}

function greeting() {
    const h = new Date().getHours();
    if (h < 5) return 'Good night';
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
}

function Tile({ to, icon: Icon, label, value, sub, accent }) {
    const body = (
        <>
            <span aria-hidden="true" className="absolute inset-x-4 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accent}66, transparent)` }} />
            <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[0.8rem] font-semibold text-ink-secondary">{label}</p>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-hairline" style={{ backgroundColor: `${accent}14`, color: accent }}>
                    <Icon className="size-4" />
                </span>
            </div>
            <p className="mt-2 truncate text-[1.5rem] leading-none font-extrabold tabular-nums">{value}</p>
            <p className="mt-1.5 flex items-center gap-1 truncate text-[0.74rem] text-ink-muted">
                {sub}
                {to && <ArrowRight size={12} className="shrink-0 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />}
            </p>
        </>
    );
    const cls = 'group relative flex flex-col overflow-hidden rounded-2xl border border-hairline bg-card p-4 transition duration-200 hover:-translate-y-0.5 hover:border-hairline-hover hover:shadow-[0_16px_40px_-16px_rgba(255,255,255,0.15)] sm:p-5';
    return to ? (
        <Link to={to} className={cn(cls, 'hover:bg-white/[0.03]')}>
            {body}
        </Link>
    ) : (
        <div className={cls}>{body}</div>
    );
}

function Panel({ title, icon: Icon, action, children, className }) {
    return (
        <section className={cn('flex flex-col overflow-hidden rounded-2xl border border-hairline bg-card', className)}>
            <header className="flex items-center gap-2.5 border-b border-hairline bg-white/[0.015] px-5 py-3.5">
                {Icon && (
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-hairline bg-veil">
                        <Icon className="size-3.5 text-ink-secondary" />
                    </span>
                )}
                <h2 className="flex-1 text-[0.92rem] font-bold tracking-tight">{title}</h2>
                {action}
            </header>
            <div className="flex-1 p-3 sm:p-4">{children}</div>
        </section>
    );
}

export default function Overview() {
    const { user } = useAuth();
    const { data: servers, isLoading: serversLoading, error: serversError } = useServers();
    const { data: sessions, isLoading: sessionsLoading, error: sessionsError } = useAuthSessions();
    const { data: activity } = useActivity(1);

    if (serversLoading || sessionsLoading) {
        return (
            <div className="flex flex-col gap-4">
                <div className="h-9 w-56 animate-pulse rounded-lg bg-white/[0.06]" />
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                    {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="h-32 animate-pulse rounded-2xl bg-white/[0.04]" />
                    ))}
                </div>
            </div>
        );
    }
    if (serversError || sessionsError) {
        return <div className="text-red-400">Failed to load: {serversError?.message ?? sessionsError?.message}</div>;
    }

    const list = servers ?? [];
    const online = list.filter((s) => s.status === 'online').length;
    const attention = list.filter((s) => s.status === 'error' || s.status === 'restarting' || s.status === 'provisioning');
    const currentSession = sessions?.current;
    const history = sessions?.history ?? [];
    const failedLogins = history.filter((e) => e.status !== 'success').length;
    const recentActivity = (activity?.data ?? []).slice(0, 6);
    const planId = user?.planId ?? 'free';
    const firstName = (user?.name || 'there').split(' ')[0];
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const allHealthy = list.length > 0 && online === list.length && attention.length === 0;

    return (
        <div className="flex flex-col gap-5">
            {/* ---- welcome hero ---- */}
            <section className="relative overflow-hidden rounded-3xl border border-hairline bg-card">
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0"
                    style={{
                        backgroundImage:
                            'radial-gradient(560px circle at 100% 0%, rgba(255,255,255,0.09), transparent 62%), radial-gradient(420px circle at 0% 100%, rgba(255,255,255,0.045), transparent 60%), linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
                        backgroundSize: 'auto, auto, 28px 28px, 28px 28px',
                    }}
                />
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" aria-hidden="true" />
                <div className="relative p-5 sm:p-7">
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-4">
                        <span className="relative shrink-0">
                            <AvatarBadge url={user?.avatarUrl} name={user?.name} size="size-16" text="text-2xl" className="ring-2 ring-white/15" />
                            {list.length > 0 && (
                                <span
                                    title={allHealthy ? 'All systems operational' : 'Something needs attention'}
                                    className={cn(
                                        'absolute -right-0.5 -bottom-0.5 size-4 rounded-full border-[3px] border-card',
                                        allHealthy ? 'bg-emerald-400' : 'bg-amber-400',
                                    )}
                                />
                            )}
                        </span>
                        <div className="min-w-0 flex-1 basis-56">
                            <div className="flex flex-wrap items-center gap-2">
                                <p className="font-mono text-[0.68rem] tracking-[0.16em] text-ink-muted uppercase">{today}</p>
                                <span className="rounded-full border border-hairline bg-veil px-2 py-0.5 text-[0.66rem] font-bold text-ink-secondary capitalize">
                                    {planId} plan
                                </span>
                                {user?.emailVerified === false && (
                                    <Link to="/verify-email" className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[0.66rem] font-bold text-amber-200 transition hover:bg-amber-500/20">
                                        Verify email
                                    </Link>
                                )}
                            </div>
                            <h1 className="mt-1.5 text-[1.6rem] leading-tight font-extrabold tracking-tight break-words sm:text-[2rem]">
                                {greeting()}, {firstName}
                            </h1>
                            <p className="mt-1 flex items-center gap-2 text-[0.88rem] text-ink-secondary">
                                {list.length > 0 && (
                                    <span className={cn('size-1.5 shrink-0 rounded-full', allHealthy ? 'animate-pulse bg-emerald-400' : 'bg-amber-400')} />
                                )}
                                {list.length === 0
                                    ? 'Create your first server to get started.'
                                    : online === list.length
                                      ? `All ${list.length} server${list.length === 1 ? '' : 's'} running smoothly.`
                                      : `${online} of ${list.length} servers online.`}
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Link
                                to="/dashboard/servers/new"
                                className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-[0.83rem] font-bold text-black shadow-[0_10px_36px_-12px_rgba(255,255,255,0.5)] transition hover:bg-gray-200"
                            >
                                <Plus className="size-4" /> New server
                            </Link>
                            {planId === 'free' && (
                                <Link
                                    to="/pricing"
                                    className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-[0.83rem] font-bold text-amber-200 transition hover:bg-amber-500/20"
                                >
                                    <Crown className="size-4" /> Upgrade
                                </Link>
                            )}
                        </div>
                    </div>
                </div>
            </section>

            {user && user.emailVerified === false && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/40 bg-gradient-to-r from-amber-500/10 to-transparent px-5 py-3.5">
                    <p className="flex min-w-0 flex-1 items-center gap-2.5 text-[0.88rem] text-amber-200 basis-48">
                        <MailWarning size={16} className="shrink-0" />
                        <span className="min-w-0">
                            Your email <span className="font-bold">{user.email}</span> is not verified yet — some features may ask for it.
                        </span>
                    </p>
                    <Link to="/verify-email" className="shrink-0 rounded-xl bg-white px-5 py-2 text-[0.83rem] font-bold text-black transition hover:bg-gray-200">
                        Verify now
                    </Link>
                </div>
            )}

            {/* ---- attention ---- */}
            {attention.length > 0 && (
                <section className="flex flex-col gap-2">
                    {attention.map((s) => (
                        <Link
                            key={s.id}
                            to={`/dashboard/servers/${s.id}`}
                            className={cn(
                                'group flex items-center gap-3 rounded-2xl border px-4 py-3 transition',
                                s.status === 'error'
                                    ? 'border-red-500/30 bg-red-500/[0.06] hover:border-red-500/50'
                                    : 'border-amber-500/25 bg-amber-500/[0.05] hover:border-amber-500/45',
                            )}
                        >
                            <AlertTriangle size={17} className={s.status === 'error' ? 'shrink-0 text-red-300' : 'shrink-0 text-amber-300'} />
                            <p className="min-w-0 flex-1 truncate text-[0.86rem]">
                                <span className="font-mono font-bold">{s.name}</span>
                                <span className="text-ink-secondary">
                                    {' '}
                                    — {s.status === 'error' ? (s.lastError || 'failed — check the console') : `${s.status}…`}
                                </span>
                            </p>
                            <span className="inline-flex shrink-0 items-center gap-1 text-[0.78rem] font-semibold text-ink-secondary transition group-hover:text-foreground">
                                View <ChevronRight size={14} />
                            </span>
                        </Link>
                    ))}
                </section>
            )}

            {/* ---- stat tiles ---- */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
                <Tile
                    to="/dashboard/servers"
                    icon={Server}
                    accent="#38bdf8"
                    label="Servers"
                    value={list.length}
                    sub={list.length ? `${online} online` : 'None yet — create one'}
                />
                <Tile
                    to="/dashboard/activity"
                    icon={Activity}
                    accent="#4ade80"
                    label="Recent actions"
                    value={activity?.data?.length ?? '—'}
                    sub={failedLogins > 0 ? `${failedLogins} failed sign-in${failedLogins === 1 ? '' : 's'}` : 'All quiet'}
                />
                <Tile
                    to="/pricing"
                    icon={Crown}
                    accent="#fbbf24"
                    label="Plan"
                    value={<span className="capitalize">{planId}</span>}
                    sub={`${user?.role ?? 'user'} account`}
                />
                <Tile
                    icon={Clock}
                    accent="#a78bfa"
                    label="Last sign-in"
                    value={
                        currentSession
                            ? new Date(currentSession.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                            : '—'
                    }
                    sub={currentSession ? currentSession.location : 'No history'}
                />
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                {/* ---- servers ---- */}
                <Panel
                    title="Servers"
                    icon={Server}
                    className="lg:col-span-2"
                    action={
                        <Link to="/dashboard/servers" className="inline-flex items-center gap-1 text-[0.76rem] font-semibold text-ink-secondary transition hover:text-foreground">
                            Manage all <ArrowRight size={13} />
                        </Link>
                    }
                >
                    {list.length === 0 ? (
                        <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                            <span className="relative flex size-14 items-center justify-center rounded-2xl border border-hairline bg-veil">
                                <Server className="size-6 text-ink-muted" />
                                <span className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-white text-black">
                                    <Plus size={13} strokeWidth={3} />
                                </span>
                            </span>
                            <div>
                                <p className="text-[0.95rem] font-bold">No servers yet</p>
                                <p className="mx-auto mt-1 max-w-xs text-[0.8rem] text-ink-muted">Deploy your first app, bot or site in minutes.</p>
                            </div>
                            <div className="flex flex-wrap items-center justify-center gap-1.5" aria-hidden="true">
                                {['Node.js', 'Python', 'Bun', 'PHP'].map((r) => (
                                    <span key={r} className="rounded-full border border-hairline bg-white/[0.03] px-2.5 py-1 font-mono text-[0.66rem] text-ink-secondary">
                                        {r}
                                    </span>
                                ))}
                            </div>
                            <Link
                                to="/dashboard/servers/new"
                                className="inline-flex items-center gap-1.5 rounded-xl bg-white px-5 py-2.5 text-[0.83rem] font-bold text-black shadow-[0_10px_36px_-12px_rgba(255,255,255,0.5)] transition hover:bg-gray-200"
                            >
                                <Plus size={15} /> Create server
                            </Link>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-1">
                            {list.slice(0, 6).map((server) => (
                                <Link
                                    key={server.id}
                                    to={`/dashboard/servers/${server.id}`}
                                    className="group flex items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 transition hover:border-hairline hover:bg-white/[0.04]"
                                >
                                    <span className={cn('size-2.5 shrink-0 rounded-full', STATUS_STYLE[server.status])} />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate font-mono text-[0.9rem] font-semibold">{server.name}</span>
                                        <span className="mt-0.5 block truncate text-[0.7rem] text-ink-muted">
                                            {server.runtimeLabel ?? server.runtime}
                                            {server.region ? ` · ${server.region}` : ''}
                                        </span>
                                    </span>
                                    <span className={cn('hidden rounded-full border px-2 py-0.5 text-[0.68rem] font-semibold capitalize sm:inline-block', STATUS_PILL[server.status] ?? STATUS_PILL.offline)}>
                                        {server.status}
                                    </span>
                                    <ChevronRight size={15} className="shrink-0 text-ink-muted transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                                </Link>
                            ))}
                        </div>
                    )}
                </Panel>

                <div className="flex flex-col gap-5">
                    {/* ---- current session ---- */}
                    <Panel title="This session" icon={MonitorSmartphone}>
                        {currentSession ? (
                            <div className="flex flex-col gap-3 p-1">
                                <div className="flex items-center gap-3">
                                    <Flag code={currentSession.countryCode} name={currentSession.location} />
                                    <div className="min-w-0">
                                        <p className="truncate text-[0.9rem] font-bold">{currentSession.location}</p>
                                        <p className="truncate font-mono text-[0.74rem] text-ink-secondary">{currentSession.ip}</p>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between gap-2 border-t border-hairline pt-3 text-[0.8rem]">
                                    <span className="truncate text-ink-muted">{currentSession.device}</span>
                                    <span className="shrink-0 font-mono text-[0.72rem] text-ink-secondary">{timeAgo(currentSession.createdAt)}</span>
                                </div>
                            </div>
                        ) : (
                            <p className="p-1 text-[0.85rem] text-ink-muted">No active session</p>
                        )}
                    </Panel>

                    {/* ---- recent activity ---- */}
                    <Panel
                        title="Recent activity"
                        icon={History}
                        action={
                            <Link to="/dashboard/activity" className="inline-flex items-center gap-1 text-[0.76rem] font-semibold text-ink-secondary transition hover:text-foreground">
                                View all <ArrowRight size={13} />
                            </Link>
                        }
                    >
                        {(recentActivity ?? []).length === 0 ? (
                            <p className="p-1 text-[0.85rem] text-ink-muted">Nothing yet — your actions will appear here.</p>
                        ) : (
                            <div className="flex flex-col">
                                {recentActivity.map((e) => {
                                    const Icon = ACT_ICONS[e.action] ?? Activity;
                                    return (
                                        <div key={e.id} className="flex items-center gap-2.5 border-t border-hairline py-2.5 first:border-t-0 first:pt-1 last:pb-1">
                                            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-hairline bg-veil text-ink-secondary">
                                                <Icon size={14} />
                                            </span>
                                            <div className="min-w-0 flex-1 leading-tight">
                                                <p className="truncate text-[0.82rem]">
                                                    <span className="font-semibold">{ACT_LABELS[e.action] ?? e.action}</span>
                                                </p>
                                                <p className="mt-0.5 font-mono text-[0.68rem] text-ink-muted">{timeAgo(e.createdAt)}</p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </Panel>
                </div>
            </div>

            {/* ---- resource totals ---- */}
            {list.length > 0 && (
                <Panel title="Fleet totals" icon={Cpu}>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {[
                            ['vCPU', `${(list.reduce((a, s) => a + (s.cpuMilli ?? 0), 0) / 1000).toFixed(1)}`],
                            ['RAM', `${list.reduce((a, s) => a + (s.ramMb ?? 0), 0).toLocaleString()} MB`],
                            ['Storage', `${list.reduce((a, s) => a + (s.storageGb ?? 0), 0)} GB`],
                            ['Runtimes', `${new Set(list.map((s) => s.runtimeLabel ?? s.runtime)).size}`],
                        ].map(([label, value]) => (
                            <div key={label} className="rounded-xl border border-hairline bg-white/[0.02] px-4 py-3">
                                <p className="text-[0.7rem] font-semibold tracking-[0.1em] text-ink-muted uppercase">{label}</p>
                                <p className="mt-1 truncate text-[1.1rem] font-bold tabular-nums">{value}</p>
                            </div>
                        ))}
                    </div>
                </Panel>
            )}

            {/* ---- login history ---- */}
            <Panel
                title="Login history"
                icon={Globe}
                action={<span className="text-[0.72rem] text-ink-muted">Every sign-in attempt</span>}
            >
                <div className="hidden grid-cols-[100px_1fr_150px_1fr_190px] gap-4 border-b border-hairline px-3 pb-2.5 font-mono text-[0.68rem] tracking-wider text-ink-muted uppercase lg:grid">
                    <span>Status</span>
                    <span>Location</span>
                    <span>IP</span>
                    <span>Device</span>
                    <span>Date</span>
                </div>
                <div className="flex flex-col divide-y divide-hairline">
                    {(history ?? []).slice(0, 8).map((entry) => (
                        <div key={entry.id} className="grid grid-cols-1 gap-1.5 px-3 py-3 lg:grid-cols-[100px_1fr_150px_1fr_190px] lg:items-center lg:gap-4">
                            <span>
                                <span className={cn(
                                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.7rem] font-bold',
                                    entry.status === 'success' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400',
                                )}>
                                    <span className={cn('size-1.5 rounded-full', entry.status === 'success' ? 'bg-emerald-400' : 'bg-red-400')} />
                                    {entry.status === 'success' ? 'Success' : 'Failed'}
                                </span>
                            </span>
                            <span className="flex min-w-0 items-center gap-2.5">
                                <Flag code={entry.countryCode} name={entry.location} />
                                <span className="truncate text-[0.86rem] font-semibold">{entry.location}</span>
                                {entry.id === currentSession?.id && (
                                    <span className="shrink-0 rounded-full border border-hairline bg-veil px-2 py-0.5 text-[0.66rem] font-bold text-ink-secondary">
                                        Current
                                    </span>
                                )}
                            </span>
                            <span className="truncate font-mono text-[0.78rem] text-ink-secondary">{entry.ip}</span>
                            <span className="truncate text-[0.8rem] text-ink-secondary">{entry.device}</span>
                            <span className="truncate font-mono text-[0.74rem] text-ink-muted">{new Date(entry.createdAt).toLocaleString()}</span>
                        </div>
                    ))}
                    {(history ?? []).length === 0 && (
                        <p className="px-3 py-6 text-center text-[0.85rem] text-ink-muted">No sign-in history yet.</p>
                    )}
                </div>
                {(history ?? []).length > 8 && (
                    <p className="px-3 pt-2 text-center font-mono text-[0.72rem] text-ink-muted">
                        Showing the latest 8 — full history lives on the Activity page.
                    </p>
                )}
            </Panel>

            {/* ---- security hint ---- */}
            <div className="flex items-start gap-3 rounded-2xl border border-hairline bg-white/[0.02] px-5 py-4">
                <ShieldCheck size={17} className="mt-0.5 shrink-0 text-emerald-300" />
                <p className="text-[0.82rem] leading-relaxed text-ink-secondary">
                    {failedLogins > 0 ? (
                        <>
                            <span className="font-bold text-ink">{failedLogins} failed sign-in{failedLogins === 1 ? '' : 's'}</span> on
                            record.{' '}
                        </>
                    ) : (
                        'No failed sign-ins on record. '
                    )}
                    If you don&apos;t recognize a location above, change your password from Settings and sign out all sessions.
                </p>
            </div>
        </div>
    );
}
