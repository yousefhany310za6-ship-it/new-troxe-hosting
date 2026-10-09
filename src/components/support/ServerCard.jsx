import { useState } from 'react';
import {
    AlertTriangle,
    Cpu,
    Database,
    HardDrive,
    Hash,
    Loader2,
    MemoryStick,
    RefreshCw,
    ScrollText,
    Server as ServerIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useServerCard } from '@/hooks/useSupportQueries.js';
import { StatusBadge } from '@/pages/admin/components.jsx';
import { serverTone } from '@/pages/admin/components.jsx';

const fmtPct = (n) => (n === null || n === undefined ? '—' : `${Number(n).toFixed(1)}%`);
const fmtBytes = (n) => {
    const v = Number(n) || 0;
    if (v <= 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let x = v;
    let i = 0;
    while (x >= 1024 && i < u.length - 1) { x /= 1024; i += 1; }
    return `${x.toFixed(x < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
};

/**
 * Read-only server panel inside a ticket. Nothing here can change the server:
 * no start/stop/restart, no file access, no environment values — and a
 * suspended server reports itself as suspended instead of exposing telemetry.
 */
export function ServerCard({ ticketId }) {
    const [showLogs, setShowLogs] = useState(false);
    const { data, isLoading, error, isFetching, refetch } = useServerCard(ticketId);

    if (isLoading) {
        return (
            <div className="flex items-center gap-2 rounded-xl border border-hairline bg-card p-5 text-[0.85rem] text-ink-secondary" aria-busy="true">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Loading linked server…
            </div>
        );
    }

    if (error) {
        const code = error?.code;
        return (
            <div className="rounded-xl border border-hairline bg-card p-5" role="note">
                <p className="text-[0.85rem] font-bold text-foreground">No server linked to this ticket</p>
                <p className="mt-1 text-[0.8rem] text-ink-secondary">
                    {code === 'TICKET_NO_SERVER'
                        ? 'The requester did not attach a server. Ask them for the 8-digit server contact ID shown on their server Overview page.'
                        : code === 'SERVER_NOT_FOUND'
                            ? 'The linked server no longer exists (it was deleted).'
                            : `Server details are unavailable${code ? ` (${code})` : ''}.`}
                </p>
            </div>
        );
    }

    const s = data?.server;
    const u = data?.usage;
    const unavailable = data?.unavailable ?? {};

    return (
        <section className="rounded-xl border border-hairline bg-card" aria-label="Linked server">
            <header className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-3 sm:px-5">
                <ServerIcon className="size-4 text-ink-secondary" aria-hidden="true" />
                <h2 className="text-[0.95rem] font-bold">Linked server</h2>
                <span className="ml-auto flex items-center gap-2">
                    {isFetching && <Loader2 className="size-3.5 animate-spin text-ink-muted" aria-hidden="true" />}
                    <button
                        type="button"
                        onClick={() => refetch()}
                        className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 text-[0.7rem] font-bold text-ink-secondary transition hover:text-foreground"
                    >
                        <RefreshCw className="size-3.5" aria-hidden="true" />
                        Refresh
                    </button>
                </span>
            </header>

            <div className="flex flex-col gap-4 p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[0.95rem] font-bold text-foreground">{s.name}</span>
                    <StatusBadge tone={serverTone(s.status)}>{s.status}</StatusBadge>
                    <span className="rounded-full border border-hairline bg-veil px-2.5 py-0.5 text-[0.72rem] font-bold text-ink-secondary">
                        {s.runtime}{s.runtimeVersion ? ` ${s.runtimeVersion}` : ''}
                    </span>
                    <span className="inline-flex items-center gap-1 font-mono text-[0.72rem] text-ink-muted" title="Server contact ID">
                        <Hash className="size-3.5" aria-hidden="true" />
                        {s.contactCode}
                    </span>
                    <span className="ml-auto text-[0.72rem] text-ink-muted">Region {s.region}</span>
                </div>

                <p className="text-[0.72rem] text-ink-muted">
                    Read-only view · updated by the platform at {data?.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString() : '—'}
                    {s.updatedAt ? ` · server row changed ${new Date(s.updatedAt).toLocaleString()}` : ''}
                </p>

                {s.status === 'suspended' && (
                    <p className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[0.78rem] text-amber-200">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                        This server is suspended: live metrics and logs are withheld until the suspension is lifted.
                    </p>
                )}

                {s.lastError && (
                    <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-[0.78rem] text-red-200">
                        <span className="font-bold">Last error:</span> {s.lastError}
                    </p>
                )}

                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    <Metric icon={<Cpu className="size-4" />} label="CPU" value={fmtPct(u?.cpuPercent)} hint={`limit ${(s.plan.cpuMilli / 1000).toFixed(2)} vCPU`} />
                    <Metric
                        icon={<MemoryStick className="size-4" />}
                        label="Memory"
                        value={u?.memBytes != null ? fmtBytes(u.memBytes) : '—'}
                        hint={`limit ${s.plan.ramMb} MB`}
                    />
                    <Metric
                        icon={<HardDrive className="size-4" />}
                        label="Storage"
                        value={u?.storageUsedBytes != null ? fmtBytes(u.storageUsedBytes) : '—'}
                        hint={`limit ${s.plan.storageGb} GB`}
                    />
                    <Metric icon={<Database className="size-4" />} label="Plan limits" value={`${s.plan.ramMb} MB · ${s.plan.storageGb} GB`} hint={`${(s.plan.cpuMilli / 1000).toFixed(2)} vCPU`} />
                </div>

                {unavailable.liveMetrics && (
                    <p className="text-[0.74rem] text-ink-muted">Live metrics unavailable: {unavailable.liveMetrics}.</p>
                )}

                <div className="flex flex-col gap-2">
                    <button
                        type="button"
                        onClick={() => setShowLogs((v) => !v)}
                        aria-expanded={showLogs}
                        className="inline-flex w-fit items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-[0.75rem] font-bold text-ink-secondary transition hover:text-foreground"
                    >
                        <ScrollText className="size-3.5" aria-hidden="true" />
                        {showLogs ? 'Hide recent logs' : 'Show recent logs'}
                    </button>
                    {showLogs && (
                        <div className="rounded-lg border border-hairline bg-black/60 p-3">
                            {!data?.logs ? (
                                <p className="text-[0.78rem] text-ink-muted">{unavailable.logs ?? 'No logs available for this run.'}</p>
                            ) : (
                                <>
                                    <pre className="max-h-64 overflow-auto font-mono text-[0.72rem] leading-relaxed whitespace-pre-wrap text-ink-secondary">
                                        {data.logs.lines.join('\n') || '(empty)'}
                                    </pre>
                                    {data.logs.truncated && (
                                        <p className="mt-1.5 text-[0.7rem] text-ink-muted">Showing the last 100 lines.</p>
                                    )}
                                </>
                            )}
                            <p className="mt-2 text-[0.7rem] text-ink-muted">
                                Credentials and tokens in log output are masked before you see them. Viewing server logs is recorded in the audit log.
                            </p>
                        </div>
                    )}
                </div>

                {Array.isArray(data?.events) && data.events.length > 0 && (
                    <div>
                        <h3 className="text-[0.8rem] font-bold text-ink-secondary">Recent platform events</h3>
                        <ul className="mt-2 flex flex-col gap-1.5">
                            {data.events.map((e, i) => (
                                <li key={i} className="flex flex-wrap items-baseline gap-2 text-[0.76rem]">
                                    <span className="font-mono text-ink-muted">{new Date(e.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                                    <span className="font-bold text-foreground">{e.type}</span>
                                    {e.detail && Object.keys(e.detail).length > 0 && (
                                        <span className="min-w-0 flex-1 basis-48 truncate text-ink-secondary">
                                            {Object.entries(e.detail).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </section>
    );
}

function Metric({ icon, label, value, hint }) {
    return (
        <div className="rounded-lg border border-hairline bg-veil/60 p-3">
            <p className="flex items-center gap-1.5 text-[0.72rem] font-semibold text-ink-secondary">
                <span className="text-ink-muted" aria-hidden="true">{icon}</span>
                {label}
            </p>
            <p className="mt-1 text-[1.05rem] leading-none font-extrabold tabular-nums text-foreground">{value}</p>
            {hint && <p className={cn('mt-1 truncate text-[0.68rem] text-ink-muted')}>{hint}</p>}
        </div>
    );
}
