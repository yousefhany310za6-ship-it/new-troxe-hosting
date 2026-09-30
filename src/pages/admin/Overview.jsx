import { Link } from 'react-router-dom';
import { Activity, Database, Server, Users } from 'lucide-react';

import { useAdminStats } from '@/hooks/useAdminQueries.jsx';

function Card({ label, value, hint, Icon }) {
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

const fmtBytes = (b) => {
    if (!b) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, v = b;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(1)} ${u[i]}`;
};

export default function AdminOverview() {
    const { data: stats, isLoading, error } = useAdminStats();

    if (isLoading) return <div className="flex h-64 items-center justify-center text-ink-muted">Loading…</div>;
    if (error) return <div className="text-red-400">Failed to load: {error.message}</div>;

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-[1.6rem] font-extrabold tracking-tight">Platform overview</h1>
                <p className="mt-1 text-[0.92rem] text-ink-secondary">Users, servers, backups and database health.</p>
            </div>

            <div className="grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-md:grid-cols-1">
                <Card label="Users" value={stats.users.total} hint="registered accounts" Icon={Users} />
                <Card label="Servers" value={stats.servers.total} hint={`${stats.servers.online} online · ${stats.servers.error} error`} Icon={Server} />
                <Card label="Backups" value={stats.backups.total} hint={`${fmtBytes(stats.backups.storageBytes)} stored`} Icon={Database} />
                <Card label="Postgres" value={fmtBytes(stats.postgres.sizeBytes)} hint={`${stats.postgres.activeConnections} active conns`} Icon={Activity} />
            </div>

            <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
                {[
                    ['Manage users', 'Roles, plans, lockouts, deletion.', '/admin/users'],
                    ['Manage servers', 'Every sandbox on the platform.', '/admin/servers'],
                    ['Audit trail', 'Who did what, and when.', '/admin/audit'],
                ].map(([label, hint, to]) => (
                    <Link key={to} to={to} className="rounded-xl border border-hairline bg-card p-6 transition hover:border-hairline-hover">
                        <p className="text-[1.02rem] font-bold">{label}</p>
                        <p className="mt-1 text-[0.85rem] text-ink-secondary">{hint}</p>
                    </Link>
                ))}
            </div>
        </div>
    );
}