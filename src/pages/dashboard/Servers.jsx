import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronRight,
  Cpu,
  MemoryStick,
  Play,
  Plus,
  RotateCcw,
  Search,
  Server as ServerIcon,
  Square,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/useToast.jsx';
import { useServers, useServerLifecycle, useServerStats } from '@/hooks/useQueries.jsx';
import { STATUS_STYLE } from './Overview.jsx';
import { IconBun, IconNode, IconPhp, IconPython } from '../../components/icons.jsx';

export const RUNTIME_ICONS = {
    'Node.js': IconNode,
    Bun: IconBun,
    Python: IconPython,
    PHP: IconPhp,
};

const STATUS_PILL = {
    online: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
    offline: 'border-hairline bg-veil text-ink-secondary',
    restarting: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
    error: 'border-red-500/25 bg-red-500/10 text-red-300',
    provisioning: 'border-blue-500/25 bg-blue-500/10 text-blue-300',
};

const FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'online', label: 'Online' },
    { id: 'offline', label: 'Offline' },
    { id: 'attention', label: 'Needs attention' },
];

const actionBtn =
    'inline-flex items-center gap-1.5 rounded-full border border-hairline bg-veil px-3 py-1.5 text-[0.74rem] font-semibold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35';

function Meter({ label, pct, color }) {
    return (
        <div className="flex items-center gap-2">
            <span className="w-8 font-mono text-[0.66rem] tracking-wider text-ink-muted uppercase">{label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                <div className="h-full rounded-full transition-[width]" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
            </div>
            <span className="w-10 text-right font-mono text-[0.68rem] text-ink-secondary tabular-nums">{Math.round(Math.min(100, pct))}%</span>
        </div>
    );
}

function ServerCard({ server }) {
    const navigate = useNavigate();
    const { success, error: toastError } = useToast();
    const { data: stats } = useServerStats(server.status === 'online' ? server.id : null);
    const { mutate: lifecycle, isPending } = useServerLifecycle(server.id);
    const RuntimeIcon = RUNTIME_ICONS[server.runtime];
    const online = server.status === 'online';
    const failed = server.status === 'error';

    const cpuPct = stats?.cpuPercent ? Math.min(100, stats.cpuPercent) : 0;
    const memPct = stats?.memBytes && stats?.memLimitBytes ? Math.min(100, (stats.memBytes / stats.memLimitBytes) * 100) : 0;

    const run = (action, label) =>
        lifecycle(action, {
            onSuccess: () => success(`Server ${label}`),
            onError: (e) => toastError(e.message),
        });

    const open = () => navigate(`/dashboard/servers/${server.id}`);

    return (
        <article
            onClick={open}
            onKeyDown={(e) => {
                if (e.key === 'Enter') open();
            }}
            tabIndex={0}
            className={cn(
                'group relative cursor-pointer overflow-hidden rounded-2xl border bg-card p-5 transition',
                failed ? 'border-red-500/30 hover:border-red-500/55' : 'border-hairline hover:border-hairline-hover',
            )}
        >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {RuntimeIcon ? (
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-hairline bg-veil text-ink-secondary">
                        <RuntimeIcon className="size-5" />
                    </span>
                ) : (
                    <span className={cn('size-2.5 shrink-0 rounded-full', STATUS_STYLE[server.status])} />
                )}
                <h2 className="min-w-0 flex-1 truncate font-mono text-[1rem] font-bold sm:flex-none">{server.name}</h2>
                <span className="rounded-full border border-hairline bg-veil px-2.5 py-0.5 text-[0.7rem] font-semibold text-ink-secondary">
                    {server.runtimeLabel ?? server.runtime}
                </span>
                <span className={cn('rounded-full border px-2.5 py-0.5 text-[0.7rem] font-semibold capitalize', STATUS_PILL[server.status] ?? STATUS_PILL.offline)}>
                    {server.status}
                </span>
                <div className="ml-auto flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <button type="button" aria-label={`Start ${server.name}`} disabled={server.status !== 'offline' || isPending} onClick={() => run('start', 'started')} className={actionBtn}>
                        <Play className="size-3.5" /> <span className="hidden sm:inline">Start</span>
                    </button>
                    <button type="button" aria-label={`Restart ${server.name}`} disabled={!online || isPending} onClick={() => run('restart', 'restarted')} className={actionBtn}>
                        <RotateCcw className="size-3.5" /> <span className="hidden sm:inline">Restart</span>
                    </button>
                    <button type="button" aria-label={`Stop ${server.name}`} disabled={!online || isPending} onClick={() => run('stop', 'stopped')} className={cn(actionBtn, 'hover:!border-red-500/50 hover:!text-red-300')}>
                        <Square className="size-3.5" /> <span className="hidden sm:inline">Stop</span>
                    </button>
                    <ChevronRight size={16} className="ml-1 shrink-0 text-ink-muted transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                </div>
            </div>

            {failed && server.lastError && (
                <p className="relative mt-3 flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/[0.06] px-3.5 py-2.5 text-[0.78rem] text-red-300">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span className="min-w-0 break-words font-mono">{server.lastError}</span>
                </p>
            )}

            <div className="mt-4">
                {online ? (
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-4">
                        <Meter label="CPU" pct={cpuPct} color="#38bdf8" />
                        <Meter label="RAM" pct={memPct} color="#a78bfa" />
                    </div>
                ) : !failed ? (
                    <p className="font-mono text-[0.72rem] text-ink-muted">
                        {server.status === 'offline' ? 'Stopped — start it to see live usage.' : `${server.status}…`}
                    </p>
                ) : null}
            </div>
        </article>
    );
}

export default function Servers() {
    const { data: servers, isLoading, error } = useServers();
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState('all');

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return (servers ?? [])
            .filter((s) => {
                if (filter === 'online' && s.status !== 'online') return false;
                if (filter === 'offline' && s.status !== 'offline') return false;
                if (filter === 'attention' && !(s.status === 'error' || s.status === 'restarting' || s.status === 'provisioning')) return false;
                return !q || s.name.toLowerCase().includes(q) || (s.runtimeLabel ?? s.runtime ?? '').toLowerCase().includes(q);
            })
            .sort((a, b) => {
                const rank = (s) => (s.status === 'error' ? 0 : s.status === 'restarting' || s.status === 'provisioning' ? 1 : s.status === 'online' ? 2 : 3);
                return rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { numeric: true });
            });
    }, [servers, query, filter]);

    if (isLoading) {
        return (
            <div className="flex flex-col gap-4">
                <div className="h-9 w-48 animate-pulse rounded-lg bg-white/[0.06]" />
                {[0, 1].map((i) => (
                    <div key={i} className="h-44 animate-pulse rounded-2xl bg-white/[0.04]" />
                ))}
            </div>
        );
    }
    if (error) {
        return <div className="text-red-400">Failed to load: {error.message}</div>;
    }

    const onlineCount = servers.filter((s) => s.status === 'online').length;

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-[1.6rem] font-extrabold tracking-tight">Servers</h1>
                    <p className="mt-1 text-[0.9rem] text-ink-secondary tabular-nums">
                        {onlineCount} of {servers.length} online
                    </p>
                </div>
                <Link
                    to="/dashboard/servers/new"
                    className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:bg-gray-200"
                >
                    <Plus className="size-4" /> New server
                </Link>
            </div>

            {servers.length > 0 && (
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
                    <div className="relative min-w-0 flex-1">
                        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
                        <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search servers…"
                            aria-label="Search servers"
                            className="input-field pl-9"
                        />
                    </div>
                    <div className="flex shrink-0 items-center gap-1 rounded-full border border-hairline p-1" role="tablist" aria-label="Filter servers">
                        {FILTERS.map((f) => (
                            <button
                                key={f.id}
                                type="button"
                                role="tab"
                                aria-selected={filter === f.id}
                                onClick={() => setFilter(f.id)}
                                className={cn(
                                    'rounded-full px-3.5 py-1.5 text-[0.78rem] font-semibold transition',
                                    filter === f.id ? 'bg-white text-black' : 'text-ink-secondary hover:text-foreground',
                                )}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex flex-col gap-3.5">
                {filtered.map((server) => (
                    <ServerCard key={server.id} server={server} />
                ))}
                {servers.length === 0 && (
                    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-hairline bg-card px-4 py-14 text-center">
                        <span className="flex size-12 items-center justify-center rounded-2xl border border-hairline bg-veil">
                            <ServerIcon className="size-6 text-ink-muted" />
                        </span>
                        <div>
                            <p className="text-[0.95rem] font-bold">No servers yet</p>
                            <p className="mt-1 max-w-xs text-[0.84rem] text-ink-secondary">
                                Deploy your first app, bot or site — pick a runtime and go live in minutes.
                            </p>
                        </div>
                        <Link
                            to="/dashboard/servers/new"
                            className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-[0.8rem] font-bold text-black transition hover:bg-gray-200"
                        >
                            <Plus className="size-4" /> Create server
                        </Link>
                    </div>
                )}
                {servers.length > 0 && filtered.length === 0 && (
                    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-hairline bg-card px-4 py-12 text-center">
                        <Search size={26} className="text-ink-muted" />
                        <p className="text-[0.92rem] font-semibold">No servers match</p>
                        <button type="button" onClick={() => { setQuery(''); setFilter('all'); }} className="mt-1 rounded-full border border-hairline bg-veil px-4 py-1.5 text-[0.8rem] font-semibold text-ink-secondary transition hover:text-foreground">
                            Clear search & filters
                        </button>
                    </div>
                )}
            </div>

            {servers.length > 0 && (
                <p className="flex items-center gap-4 font-mono text-[0.7rem] text-ink-muted">
                    <span className="inline-flex items-center gap-1.5"><Cpu size={12} /> CPU</span>
                    <span className="inline-flex items-center gap-1.5"><MemoryStick size={12} /> RAM</span>
                    <span className="ml-auto hidden sm:inline">Usage refreshes every few seconds</span>
                </p>
            )}
        </div>
    );
}
