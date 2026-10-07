import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Database, HardDrive, Server, Users } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useAdminAudit, useAdminServers, useAdminStats } from '@/hooks/useAdminQueries.jsx';
import { EmptyState, ErrorState, PageHeader, Stat, StatGrid, TableSkeleton, timeAgo } from './components.jsx';

function fmtBytes(n) {
  const v0 = Number(n) || 0;
  if (v0 <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = v0;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${u[i]}`;
}

export default function AdminOverview() {
    const { data: stats, isLoading, error, refetch } = useAdminStats();
    const { data: errors } = useAdminServers({ limit: 5, status: 'error' });
    const { data: audit } = useAdminAudit({ page: 1, limit: 8 });

    if (isLoading) {
        return (
            <div className="flex flex-col gap-5">
                <PageHeader title="Overview" description="Platform health at a glance." />
                <TableSkeleton rows={4} />
            </div>
        );
    }
    if (error || !stats) return <ErrorState message={error?.message ?? 'Could not load platform stats.'} onRetry={refetch} />;

    const errorList = errors?.data ?? [];
    const recentAdmin = (audit?.data ?? []).filter((a) => String(a.action).startsWith('admin.')).slice(0, 6);

    return (
        <div className="flex flex-col gap-5">
            <PageHeader
                title="Overview"
                description="Platform health at a glance — users, servers, storage and recent admin actions."
            />

            <StatGrid>
                <Stat
                    label="Users"
                    value={(stats.users.total ?? 0).toLocaleString()}
                    context={(stats.users.suspended ?? 0) > 0 ? `${stats.users.suspended} suspended` : 'No suspended accounts'}
                    tone={(stats.users.suspended ?? 0) > 0 ? 'warn' : undefined}
                    to="/admin/users"
                />
                <Stat
                    label="Servers"
                    value={(stats.servers.total ?? 0).toLocaleString()}
                    context={`${stats.servers.online ?? 0} running · ${stats.servers.error ?? 0} error · ${stats.servers.suspended ?? 0} suspended`}
                    tone={(stats.servers.error ?? 0) > 0 || (stats.servers.suspended ?? 0) > 0 ? 'warn' : undefined}
                    to="/admin/servers"
                />
                <Stat
                    label="Backup storage"
                    value={fmtBytes(stats.backups.storageBytes)}
                    context={`${(stats.backups.total ?? 0).toLocaleString()} snapshots stored`}
                />
                <Stat
                    label="Database"
                    value={fmtBytes(stats.postgres.sizeBytes)}
                    context={`${stats.postgres.activeConnections ?? 0} active connections · ${(Number(stats.postgres.cacheHitRatio) * 100 || 0).toFixed(1)}% cache hit`}
                />
            </StatGrid>

            {errorList.length > 0 && (
                <section aria-label="Servers needing attention" className="flex flex-col gap-2 rounded-xl border border-red-500/25 bg-red-500/[0.04] p-4">
                    <p className="flex items-center gap-2 text-[0.85rem] font-bold text-red-300">
                        <AlertTriangle size={15} /> {errorList.length} server{errorList.length === 1 ? '' : 's'} in error
                    </p>
                    {errorList.map((s) => (
                        <Link
                            key={s.id}
                            to={`/admin/servers/${s.id}`}
                            className="group flex min-w-0 items-center gap-2 text-[0.83rem]"
                        >
                            <span className="truncate font-mono font-bold">{s.name}</span>
                            <span className="truncate text-ink-secondary">{s.lastError || 'failed — check the console'}</span>
                            <ArrowRight size={13} className="ml-auto shrink-0 text-ink-muted transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                        </Link>
                    ))}
                </section>
            )}

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <section className="rounded-xl border border-hairline bg-card">
                    <header className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-3 sm:px-5">
                        <h2 className="text-[0.95rem] font-bold">Recent admin activity</h2>
                        <Link to="/admin/audit" className="inline-flex items-center gap-1 text-[0.76rem] font-semibold text-ink-secondary transition hover:text-foreground">
                            View all <ArrowRight size={13} />
                        </Link>
                    </header>
                    <div className="flex flex-col divide-y divide-hairline px-4 sm:px-5">
                        {recentAdmin.length === 0 && (
                            <p className="py-6 text-center text-[0.83rem] text-ink-muted">No admin actions recorded yet.</p>
                        )}
                        {recentAdmin.map((a) => (
                            <div key={a.id} className="flex min-w-0 items-baseline gap-2 py-2.5">
                                <span className="shrink-0 rounded-full bg-red-500/15 px-2 py-0.5 font-mono text-[0.68rem] font-bold text-red-300">
                                    {a.action.replace(/^admin\./, '')}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[0.82rem] text-ink-secondary" title={a.actorEmail || a.actorId}>
                                    {a.actorEmail || 'unknown admin'}
                                </span>
                                <span className="shrink-0 font-mono text-[0.7rem] text-ink-muted">{timeAgo(a.createdAt)}</span>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="rounded-xl border border-hairline bg-card">
                    <header className="border-b border-hairline px-4 py-3 sm:px-5">
                        <h2 className="text-[0.95rem] font-bold">Storage</h2>
                    </header>
                    <div className="flex flex-col gap-3 p-4 sm:p-5">
                        {[
                            ['Database size', fmtBytes(stats.postgres.sizeBytes), HardDrive],
                            ['Backup storage', fmtBytes(stats.backups.storageBytes), Database],
                            ['Servers online', `${stats.servers.online ?? 0} / ${stats.servers.total ?? 0}`, Server],
                            ['Registered users', (stats.users.total ?? 0).toLocaleString(), Users],
                        ].map(([label, value, Icon]) => (
                            <div key={label} className="flex items-center gap-3">
                                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-hairline bg-veil text-ink-secondary">
                                    <Icon size={15} />
                                </span>
                                <span className="flex-1 text-[0.85rem] text-ink-secondary">{label}</span>
                                <span className={cn('text-[0.9rem] font-bold tabular-nums')}>{value}</span>
                            </div>
                        ))}
                    </div>
                </section>
            </div>
        </div>
    );
}
