import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Ban, Eye, SearchX, Undo2, Users as UsersIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/useToast.jsx';
import { useAdminSuspendUser, useAdminUnsuspendUser, useAdminUsers } from '@/hooks/useAdminQueries.jsx';
import { ConfirmModal } from '@/components/ui/confirm-modal.jsx';
import { Select } from '@/components/ui/select.jsx';
import { AvatarBadge } from '@/components/AvatarBadge.jsx';
import { Flag } from '@/components/ui/flag.jsx';
import {
  EmptyState,
  ErrorState,
  Menu,
  PageHeader,
  Pager,
  SearchInput,
  Stat,
  StatGrid,
  StatusBadge,
  TableSkeleton,
  timeAgo,
  userTone,
} from './components.jsx';

export default function AdminUsers() {
    const toast = useToast();
    const [params, setParams] = useSearchParams();
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [q, setQ] = useState('');
    const [role, setRole] = useState('');
    const [status, setStatus] = useState(() => params.get('status') ?? '');
    const [suspendTarget, setSuspendTarget] = useState(null);
    const [suspendReason, setSuspendReason] = useState('');

    const { data, isLoading, error, refetch } = useAdminUsers({
        page,
        limit: 20,
        search: q || undefined,
        role: role || undefined,
        status: status || undefined,
    });
    const suspendUser = useAdminSuspendUser();
    const unsuspendUser = useAdminUnsuspendUser();

    // keep the URL in sync so sidebar sub-links (?status=suspended) work
    useEffect(() => {
        setParams((prev) => {
            const next = new URLSearchParams(prev);
            if (status) next.set('status', status);
            else next.delete('status');
            return next;
        }, { replace: true });
    }, [status, setParams]);

    // external navigation (sidebar) may change the query while mounted
    useEffect(() => {
        const s = params.get('status') ?? '';
        if (s !== status) {
            setStatus(s);
            setPage(1);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params]);

    const submitSearch = (e) => {
        e.preventDefault();
        setPage(1);
        setQ(search.trim());
    };

    const doSuspend = async () => {
        try {
            await suspendUser.mutateAsync({ id: suspendTarget.id, reason: suspendReason.trim() || undefined });
            toast.success('User suspended — sessions revoked.');
            setSuspendTarget(null);
            setSuspendReason('');
            refetch();
        } catch (e) {
            toast.error(e.message);
        }
    };

    const doUnsuspend = async (u) => {
        try {
            await unsuspendUser.mutateAsync(u.id);
            toast.success('User unsuspended.');
            refetch();
        } catch (e) {
            toast.error(e.message);
        }
    };

    const counts = data?.counts ?? {};
    const suspendedOnly = status === 'suspended';

    return (
        <div className="flex flex-col gap-5">
            <PageHeader title="Users" description="Manage customer accounts, access, security and activity." />

            <StatGrid>
                <Stat label="Total" value={(data?.pagination.total ?? '—').toLocaleString?.() ?? data?.pagination.total ?? '—'} context={`${counts.active ?? 0} active`} />
                <Stat label="Active" value={counts.active ?? '—'} context="Can sign in" to="/admin/users" />
                <Stat
                    label="Suspended"
                    value={counts.suspended ?? '—'}
                    context="Blocked by administration"
                    tone="warn"
                    to="/admin/users?status=suspended"
                />
                <Stat label="Unverified" value={counts.unverified ?? '—'} context="Email not confirmed" />
            </StatGrid>

            <form onSubmit={submitSearch} className="flex flex-wrap items-center gap-2" role="search">
                <SearchInput value={search} onChange={(v) => { setSearch(v); }} placeholder="Search name or email…" />
                <Select
                    ariaLabel="Filter by status"
                    value={status}
                    onChange={(v) => { setStatus(v); setPage(1); }}
                    options={[
                        { value: '', label: 'All statuses' },
                        { value: 'active', label: 'active' },
                        { value: 'suspended', label: 'suspended' },
                        { value: 'deleted', label: 'deleted' },
                    ]}
                    className="w-40"
                />
                <Select
                    ariaLabel="Filter by role"
                    value={role}
                    onChange={(v) => { setRole(v); setPage(1); }}
                    options={[
                        { value: '', label: 'All roles' },
                        { value: 'user', label: 'user' },
                        { value: 'admin', label: 'admin' },
                    ]}
                    className="w-36"
                />
                <button type="submit" className="rounded-full bg-white px-5 py-2 text-sm font-bold text-black transition hover:bg-gray-200">
                    Search
                </button>
            </form>

            {isLoading && <TableSkeleton rows={8} />}
            {error && <ErrorState message={error.message} onRetry={refetch} />}

            {data && (
                <>
                    <div className="overflow-hidden rounded-xl border border-hairline bg-card">
                        <div className="hidden grid-cols-[minmax(0,1.5fr)_minmax(0,1.4fr)_150px_70px_90px_110px_110px_48px] items-center gap-3 border-b border-hairline px-5 py-2.5 font-mono text-[0.68rem] tracking-wider text-ink-muted uppercase lg:grid">
                            <span>User</span><span>Email</span><span>Status</span><span>Servers</span><span>Plan</span><span>Last login</span><span>Created</span><span className="sr-only">Actions</span>
                        </div>
                        <div className="flex flex-col divide-y divide-hairline">
                            {data.data.map((u) => (
                                <div key={u.id} className="flex items-center gap-3 px-4 py-3 transition hover:bg-white/[0.02] sm:px-5 lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.4fr)_150px_70px_90px_110px_110px_48px] lg:gap-3">
                                    <Link to={`/admin/users/${u.id}`} className="flex min-w-0 flex-1 items-center gap-2.5 lg:flex-none">
                                        <AvatarBadge url={u.avatarUrl} name={u.name} size="size-8" text="text-xs" />
                                        <span className="min-w-0">
                                            <span className="block truncate text-[0.87rem] font-bold">{u.name}</span>
                                            <span className="mt-0.5 block truncate font-mono text-[0.7rem] text-ink-muted lg:hidden">
                                                {u.email}
                                            </span>
                                            <span className="mt-0.5 block truncate font-mono text-[0.7rem] text-ink-muted lg:hidden">
                                                {u.serverCount} servers · {u.planId} · {u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'never'}
                                            </span>
                                        </span>
                                    </Link>
                                    <span className="hidden truncate font-mono text-[0.78rem] text-ink-secondary lg:block" title={u.email}>
                                        {u.email}
                                    </span>
                                    <span className="hidden flex-wrap items-center gap-1.5 lg:flex">
                                        <StatusBadge tone={userTone(u.status)}>
                                            {u.status ?? 'active'}
                                        </StatusBadge>
                                        {u.role === 'admin' && (
                                            <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[0.68rem] font-bold text-red-300">admin</span>
                                        )}
                                    </span>
                                    <span className="hidden font-mono text-[0.78rem] text-ink-secondary tabular-nums lg:block">{u.serverCount}</span>
                                    <span className="hidden truncate font-mono text-[0.78rem] text-ink-secondary lg:block">{u.planId}</span>
                                    <span className="hidden font-mono text-[0.74rem] text-ink-muted lg:block">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'never'}</span>
                                    <span className="hidden font-mono text-[0.74rem] text-ink-muted lg:block">
                                        {new Date(u.createdAt).toLocaleDateString()}
                                    </span>
                                    <span className="flex shrink-0 items-center gap-1.5">
                                        <span className="lg:hidden">
                                            <StatusBadge tone={userTone(u.status)}>
                                                {u.status ?? 'active'}
                                            </StatusBadge>
                                        </span>
                                        <Menu
                                            label={`Actions for ${u.name}`}
                                            items={[
                                                { key: 'view', label: 'View details', to: `/admin/users/${u.id}` },
                                                u.status === 'suspended'
                                                    ? { key: 'unsuspend', label: 'Unsuspend', onSelect: () => doUnsuspend(u) }
                                                    : u.status !== 'deleted'
                                                      ? { key: 'suspend', label: 'Suspend', danger: true, onSelect: () => setSuspendTarget(u) }
                                                      : null,
                                            ].filter(Boolean)}
                                        />
                                    </span>
                                </div>
                            ))}
                            {data.data.length === 0 && (
                                <EmptyState
                                    icon={suspendedOnly ? Ban : UsersIcon}
                                    title={suspendedOnly ? 'No suspended users' : 'No users found'}
                                    hint={suspendedOnly ? 'There are currently no suspended accounts.' : 'Try a different search or filter.'}
                                />
                            )}
                        </div>
                    </div>
                    <Pager page={data.pagination.page} pages={data.pagination.pages} total={data.pagination.total} unit="accounts" onPage={setPage} />
                </>
            )}

            <ConfirmModal
                open={!!suspendTarget}
                onClose={() => { setSuspendTarget(null); setSuspendReason(''); }}
                title="Suspend user"
                description="Login, sessions and all APIs stop working immediately. Running servers are stopped (data kept)."
                confirmLabel="Suspend user"
                danger
                onConfirm={doSuspend}
            >
                <label className="flex flex-col gap-1.5 text-left text-[0.85rem] font-semibold">
                    Reason (audit log)
                    <input
                        value={suspendReason}
                        onChange={(e) => setSuspendReason(e.target.value)}
                        placeholder="e.g. abuse report #123"
                        maxLength={300}
                        className="w-full rounded-md border border-hairline bg-black/40 px-3.5 py-2.5 font-normal text-[0.88rem] text-foreground placeholder-ink-muted focus:border-primary focus:outline-none"
                    />
                </label>
                <p className="mt-2 text-[0.82rem] text-ink-secondary">
                    <span className="font-mono font-bold text-ink">{suspendTarget?.email}</span> will be signed out everywhere.
                </p>
            </ConfirmModal>
        </div>
    );
}
