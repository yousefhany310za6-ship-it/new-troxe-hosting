import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  BadgeCheck,
  Ban,
  Database,
  KeyRound,
  Server as ServerIcon,
  ShieldCheck,
  Trash2,
  Undo2,
  UserCheck,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { apiPost } from '@/lib/api.js';
import { useToast } from '@/hooks/useToast.jsx';
import {
  useAdminAudit,
  useAdminDeleteUser,
  useAdminPlans,
  useAdminResetLogins,
  useAdminRestoreUser,
  useAdminServers,
  useAdminSetPassword,
  useAdminSuspendUser,
  useAdminUnsuspendUser,
  useAdminUpdatePlan,
  useAdminUpdateRole,
  useAdminUser,
} from '@/hooks/useAdminQueries.jsx';
import { ConfirmModal } from '@/components/ui/confirm-modal.jsx';
import { Flag } from '@/components/ui/flag.jsx';
import { Select } from '@/components/ui/select.jsx';
import { AvatarBadge } from '@/components/AvatarBadge.jsx';
import {
  EmptyState,
  ErrorState,
  StatusBadge,
  TableSkeleton,
  fmtBytes,
  timeAgo,
  userTone,
} from './components.jsx';

const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'servers', label: 'Servers' },
    { id: 'security', label: 'Security' },
    { id: 'logins', label: 'Login history' },
    { id: 'activity', label: 'Activity' },
];

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="shrink-0 text-[0.82rem] text-ink-muted">{label}</span>
      <span className="min-w-0 text-right text-[0.85rem] font-semibold">{children}</span>
    </div>
  );
}

export default function AdminUserDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const toast = useToast();
    const [tab, setTab] = useState('overview');
    const { data: user, isLoading, error, refetch } = useAdminUser(id);
    const { data: plans } = useAdminPlans();
    const { data: servers } = useAdminServers({ ownerId: id, limit: 100 });
    const updateRole = useAdminUpdateRole(id);
    const updatePlan = useAdminUpdatePlan(id);
    const resetLogins = useAdminResetLogins(id);
    const deleteUser = useAdminDeleteUser(id);
    const setPassword = useAdminSetPassword(id);
    const suspendUser = useAdminSuspendUser();
    const unsuspendUser = useAdminUnsuspendUser();
    const restoreUser = useAdminRestoreUser();
    const [roleTarget, setRoleTarget] = useState(null);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [suspendOpen, setSuspendOpen] = useState(false);
    const [pwOpen, setPwOpen] = useState(false);
    const [pw1, setPw1] = useState('');
    const [pw2, setPw2] = useState('');
    const [suspendReason, setSuspendReason] = useState('');
    const [impBusy, setImpBusy] = useState(false);

    if (isLoading) {
        return (
            <div className="flex flex-col gap-5">
                <PageSkeleton />
            </div>
        );
    }
    if (error || !user) return <ErrorState message={error?.message ?? 'User not found.'} onRetry={refetch} />;

    const changeRole = async () => {
        await updateRole.mutateAsync(roleTarget);
        toast.success(`Role changed to ${roleTarget}.`);
    };

    const changePlan = async (planId) => {
        try { await updatePlan.mutateAsync(planId); toast.success(`Plan changed to ${planId}.`); }
        catch (e) { toast.error(e.message); }
    };

    const reset = async () => {
        try { await resetLogins.mutateAsync(); toast.success('Failed logins reset, lock cleared.'); }
        catch (e) { toast.error(e.message); }
    };

    const remove = async () => {
        await deleteUser.mutateAsync();
        toast.success('User soft-deleted — data retained, sessions revoked.');
        navigate('/admin/users');
    };

    const doSuspend = async () => {
        try {
            await suspendUser.mutateAsync({ id, reason: suspendReason.trim() || undefined });
            toast.success('User suspended — all sessions revoked, servers stopped.');
            setSuspendOpen(false);
            setSuspendReason('');
        } catch (e) { toast.error(e.message); }
    };

    const doUnsuspend = async () => {
        try { await unsuspendUser.mutateAsync(id); toast.success('User unsuspended.'); }
        catch (e) { toast.error(e.message); }
    };

    const doRestore = async () => {
        try { await restoreUser.mutateAsync(id); toast.success('User restored.'); }
        catch (e) { toast.error(e.message); }
    };

    const doSetPassword = async () => {
        if (pw1 !== pw2) { toast.error('Passwords do not match.'); return; }
        try {
            const out = await setPassword.mutateAsync(pw1);
            toast.success(`Password changed — ${out.sessionsRevoked ?? 0} session(s) revoked.`);
            setPwOpen(false);
            setPw1('');
            setPw2('');
        } catch (e) { toast.error(e.message); }
    };

    const impersonate = async () => {
        setImpBusy(true);
        try {
            const res = await apiPost(`/admin/users/${user.id}/impersonate`);
            localStorage.setItem('impersonation_token', res.token);
            toast.success(`Now viewing as ${user.email} (5 minutes).`);
            window.location.href = '/dashboard';
        } catch (e) {
            toast.error(e.message);
            setImpBusy(false);
        }
    };

    const suspended = user.status === 'suspended';
    const deleted = user.status === 'deleted';
    const logins = user.recentLogins ?? [];

    return (
        <div className="flex flex-col gap-5">
            <Link to="/admin/users" className="w-fit text-[0.85rem] font-semibold text-ink-secondary hover:text-foreground">← All users</Link>

            {/* ---- header ---- */}
            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-hairline bg-card p-5">
                <AvatarBadge url={user.avatarUrl} name={user.name} size="size-14" text="text-xl" />
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h1 className="truncate font-mono text-[1.3rem] font-extrabold">{user.name}</h1>
                        <StatusBadge tone={userTone(user.status)}>{user.status ?? 'active'}</StatusBadge>
                        {user.role === 'admin' && (
                            <span className="rounded-full bg-red-500/15 px-2.5 py-0.5 text-[0.7rem] font-bold text-red-300">admin</span>
                        )}
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[0.85rem] text-ink-secondary">
                        <span className="truncate">{user.email}</span>
                        {user.emailVerified ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[0.68rem] font-bold text-emerald-400">
                                <BadgeCheck size={12} /> Verified
                            </span>
                        ) : (
                            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[0.68rem] font-bold text-amber-400">Unverified</span>
                        )}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {suspended ? (
                        <button type="button" onClick={doUnsuspend} disabled={unsuspendUser.isPending} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 px-4 py-2 text-[0.8rem] font-bold text-emerald-300 transition hover:bg-emerald-500/10 disabled:opacity-50">
                            <Undo2 size={14} /> Unsuspend
                        </button>
                    ) : !deleted ? (
                        <button type="button" onClick={() => setSuspendOpen(true)} className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 px-4 py-2 text-[0.8rem] font-bold text-amber-300 transition hover:bg-amber-500/10">
                            <Ban size={14} /> Suspend
                        </button>
                    ) : (
                        <button type="button" onClick={doRestore} disabled={restoreUser.isPending} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 px-4 py-2 text-[0.8rem] font-bold text-emerald-300 transition hover:bg-emerald-500/10 disabled:opacity-50">
                            <Undo2 size={14} /> Restore
                        </button>
                    )}
                    {!deleted && (
                        <button type="button" onClick={() => setPwOpen(true)} className="rounded-full border border-hairline px-4 py-2 text-[0.8rem] font-bold text-ink-secondary transition hover:text-foreground">
                            Change password
                        </button>
                    )}
                    {!deleted && (
                        <button type="button" onClick={() => setDeleteOpen(true)} className="rounded-full border border-red-500/40 px-4 py-2 text-[0.8rem] font-bold text-red-400 transition hover:bg-red-500 hover:text-white">
                            Delete
                        </button>
                    )}
                </div>
            </div>

            {suspended && (
                <p className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 text-[0.83rem] text-amber-200">
                    Suspended — login, sessions and APIs are blocked. Running servers were stopped; data is preserved.
                </p>
            )}
            {deleted && (
                <p className="rounded-xl border border-hairline bg-veil px-4 py-3 text-[0.83rem] text-ink-secondary">
                    Soft-deleted{user.deletedAt ? ` on ${new Date(user.deletedAt).toLocaleString()}` : ''} — data retained for audit. Restore re-activates the account.
                </p>
            )}

            {/* ---- tabs ---- */}
            <div className="flex gap-1 overflow-x-auto border-b border-hairline" role="tablist" aria-label="User details">
                {TABS.map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={tab === t.id}
                        onClick={() => setTab(t.id)}
                        className={cn(
                            'shrink-0 border-b-2 px-4 py-2.5 text-[0.85rem] font-semibold transition focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                            tab === t.id ? 'border-white text-foreground' : 'border-transparent text-ink-secondary hover:text-foreground',
                        )}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {tab === 'overview' && (
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                    <section className="rounded-xl border border-hairline bg-card p-5">
                        <h2 className="mb-1 text-[0.95rem] font-bold">Account</h2>
                        <div className="divide-y divide-hairline">
                            <Row label="Email">{user.email}</Row>
                            <Row label="Verification">{user.emailVerified ? 'Verified' : 'Unverified'}</Row>
                            <Row label="Role">{user.role}</Row>
                            <Row label="Plan">{user.planId}</Row>
                            <Row label="Created">{new Date(user.createdAt).toLocaleString()}</Row>
                            <Row label="Last login">{logins[0] ? new Date(logins[0].createdAt).toLocaleString() : '—'}</Row>
                        </div>
                    </section>
                    <section className="rounded-xl border border-hairline bg-card p-5">
                        <h2 className="mb-1 text-[0.95rem] font-bold">Usage</h2>
                        <div className="divide-y divide-hairline">
                            <Row label="Servers">{user.serverCount ?? 0}</Row>
                            <Row label="Backups">{`${user.backupCount ?? 0} · ${fmtBytes(user.backupBytes ?? 0)}`}</Row>
                            <Row label="Files on disk">{user.volumeBytes == null ? 'unknown' : fmtBytes(user.volumeBytes)}</Row>
                            <Row label="Active sessions">{user.activeSessions ?? 0}</Row>
                            <Row label="Failed logins">{user.failedLogins ?? 0}</Row>
                            <Row label="Country">
                                {user.country ? (
                                    <span className="inline-flex items-center gap-2">
                                        <Flag code={user.country.countryCode} name={user.country.location} />
                                        {user.country.location}
                                    </span>
                                ) : 'Unknown'}
                            </Row>
                        </div>
                    </section>
                </div>
            )}

            {tab === 'servers' && (
                <section className="rounded-xl border border-hairline bg-card">
                    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-5 py-3">
                        <h2 className="text-[0.95rem] font-bold">Servers ({servers?.pagination.total ?? '—'})</h2>
                        <Link to={`/admin/servers/new?owner=${user.id}`} className="rounded-full bg-white px-4 py-1.5 text-[0.78rem] font-bold text-black transition hover:bg-gray-200">
                            + New server for this user
                        </Link>
                    </header>
                    <div className="flex flex-col divide-y divide-hairline px-5">
                        {(servers?.data ?? []).map((s) => (
                            <Link key={s.id} to={`/admin/servers/${s.id}`} className="group flex items-center gap-3 py-3">
                                <ServerIcon size={16} className="shrink-0 text-ink-muted" />
                                <span className="min-w-0 flex-1 truncate font-mono text-[0.87rem] font-semibold">{s.name}</span>
                                <span className="hidden rounded-full border border-hairline bg-veil px-2 py-0.5 text-[0.7rem] text-ink-secondary sm:inline">{s.runtime}</span>
                                <StatusBadge tone={s.status === 'online' ? 'emerald' : s.status === 'error' ? 'red' : s.status === 'suspended' ? 'amber' : 'zinc'}>
                                    {s.status}
                                </StatusBadge>
                            </Link>
                        ))}
                        {(servers?.data ?? []).length === 0 && <p className="py-6 text-center text-[0.85rem] text-ink-muted">No servers.</p>}
                    </div>
                </section>
            )}

            {tab === 'security' && (
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                    <section className="rounded-xl border border-hairline bg-card p-5">
                        <h2 className="text-[0.95rem] font-bold">Access control</h2>
                        <div className="mt-3 flex flex-col gap-2.5">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="w-24 shrink-0 text-[0.82rem] text-ink-muted">Role</span>
                                <Select
                                    ariaLabel="Role"
                                    value={user.role}
                                    onChange={(v) => { if (v !== user.role) setRoleTarget(v); }}
                                    disabled={updateRole.isPending}
                                    options={[{ value: 'user', label: 'user' }, { value: 'admin', label: 'admin' }]}
                                    className="flex-1"
                                />
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="w-24 shrink-0 text-[0.82rem] text-ink-muted">Plan</span>
                                <Select
                                    ariaLabel="Plan"
                                    value={user.planId}
                                    onChange={changePlan}
                                    disabled={updatePlan.isPending || !plans}
                                    loading={!plans}
                                    options={(plans ?? []).map((p) => ({ value: p.id, label: p.id }))}
                                    className="flex-1"
                                />
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="w-24 shrink-0 text-[0.82rem] text-ink-muted">Lockout</span>
                                <button type="button" onClick={reset} disabled={resetLogins.isPending} className="rounded-full border border-hairline px-4 py-1.5 text-[0.8rem] font-bold text-ink-secondary transition hover:text-foreground disabled:opacity-50">
                                    Reset lockout
                                </button>
                                <span className="font-mono text-[0.74rem] text-ink-muted">
                                    {user.failedLogins ?? 0} failed · {user.lockedUntil ? `locked until ${new Date(user.lockedUntil).toLocaleString()}` : 'not locked'}
                                </span>
                            </div>
                        </div>
                    </section>
                    <section className="rounded-xl border border-hairline bg-card p-5">
                        <h2 className="text-[0.95rem] font-bold">Credentials</h2>
                        <div className="mt-1 divide-y divide-hairline">
                            <Row label="Password changed">{user.passwordChangedAt ? new Date(user.passwordChangedAt).toLocaleString() : '—'}</Row>
                            <Row label="OAuth">
                                <span className="text-ink-secondary">Managed by the user in Settings</span>
                            </Row>
                        </div>
                        {!deleted && (
                            <div className="mt-3 flex flex-wrap gap-2">
                                <button type="button" onClick={() => setPwOpen(true)} className="rounded-full border border-hairline px-4 py-1.5 text-[0.8rem] font-bold text-ink-secondary transition hover:text-foreground">
                                    Change password
                                </button>
                                {user.role !== 'admin' && (
                                    <button type="button" onClick={impersonate} disabled={impBusy} className="rounded-full border border-hairline px-4 py-1.5 text-[0.8rem] font-bold text-ink-secondary transition hover:text-foreground disabled:opacity-50">
                                        Impersonate (5 min)
                                    </button>
                                )}
                            </div>
                        )}
                    </section>
                </div>
            )}

            {tab === 'logins' && (
                <section className="overflow-hidden rounded-xl border border-hairline bg-card">
                    <div className="hidden grid-cols-[90px_1fr_150px_1fr] gap-3 border-b border-hairline px-5 py-2.5 font-mono text-[0.68rem] tracking-wider text-ink-muted uppercase lg:grid">
                        <span>Status</span><span>Location</span><span>IP</span><span>Date</span>
                    </div>
                    <div className="flex flex-col divide-y divide-hairline px-5">
                        {logins.map((l) => (
                            <div key={l.id} className="grid grid-cols-1 gap-1 py-3 lg:grid-cols-[90px_1fr_150px_1fr] lg:items-center lg:gap-3">
                                <span>
                                    <span className={cn('rounded-full px-2 py-0.5 text-[0.68rem] font-bold', l.status === 'success' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400')}>
                                        {l.status}
                                    </span>
                                </span>
                                <span className="flex min-w-0 items-center gap-2 text-[0.83rem]">
                                    <Flag code={l.countryCode} name={l.location ?? 'Unknown'} className="w-5 shrink-0" />
                                    <span className="truncate font-semibold">{l.location ?? 'Unknown'}</span>
                                </span>
                                <span className="font-mono text-[0.78rem] text-ink-secondary">{l.ip}</span>
                                <span className="font-mono text-[0.74rem] text-ink-muted">{new Date(l.createdAt).toLocaleString()}</span>
                            </div>
                        ))}
                        {logins.length === 0 && <EmptyState title="No login history" hint="Sign-ins will appear here." />}
                    </div>
                </section>
            )}

            {tab === 'activity' && <UserActivity userId={id} />}

            <ConfirmModal
                open={!!roleTarget}
                onClose={() => setRoleTarget(null)}
                title="Change role"
                description={roleTarget === 'admin' ? 'Admins can manage every user and server on the platform.' : 'The user loses admin access immediately.'}
                confirmLabel="Change role"
                danger={roleTarget !== 'admin'}
                onConfirm={changeRole}
            >
                <p className="text-[0.85rem] text-ink-secondary">
                    Change <span className="font-mono font-bold text-ink">{user.email}</span> from{' '}
                    <span className="font-mono font-bold text-ink">{user.role}</span> to{' '}
                    <span className="font-mono font-bold text-ink">{roleTarget}</span>?
                </p>
            </ConfirmModal>

            <ConfirmModal
                open={deleteOpen}
                onClose={() => setDeleteOpen(false)}
                title="Delete user"
                description="Soft-delete: the account is closed and every session revoked, servers are stopped — but all data is retained for audit and can be restored."
                confirmLabel="Delete user"
                confirmPhrase={user.email}
                phraseHint={<>Type <span className="font-mono font-bold text-ink">{user.email}</span> to confirm</>}
                onConfirm={remove}
            >
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-[0.82rem] text-red-300">
                    <p className="font-bold">This will close (not erase):</p>
                    <ul className="mt-1.5 list-disc space-y-1 pl-5">
                        <li>User account <span className="font-mono">{user.email}</span></li>
                        <li>{user.serverCount ?? 0} server{(user.serverCount ?? 0) === 1 ? '' : 's'} (stopped, data kept)</li>
                        <li>{fmtBytes(user.volumeBytes ?? 0)} of server files kept on disk</li>
                        <li>{user.backupCount ?? 0} backup{(user.backupCount ?? 0) === 1 ? '' : 's'} ({fmtBytes(user.backupBytes ?? 0)}) kept</li>
                    </ul>
                </div>
            </ConfirmModal>

            <ConfirmModal
                open={suspendOpen}
                onClose={() => { setSuspendOpen(false); setSuspendReason(''); }}
                title="Suspend user"
                description="Login, OAuth, sessions and all APIs stop working immediately. Running servers are stopped (data kept)."
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
                    <span className="font-mono font-bold text-ink">{user.email}</span> will be signed out everywhere.
                </p>
            </ConfirmModal>

            <ConfirmModal
                open={pwOpen}
                onClose={() => { setPwOpen(false); setPw1(''); setPw2(''); }}
                title="Change password"
                description="No current password needed. The new password signs out every session on all devices."
                confirmLabel="Change password"
                onConfirm={doSetPassword}
            >
                <div className="flex flex-col gap-2.5">
                    <label className="flex flex-col gap-1.5 text-left text-[0.85rem] font-semibold">
                        New password
                        <input
                            type="password"
                            value={pw1}
                            onChange={(e) => setPw1(e.target.value)}
                            placeholder="min 8 chars, letters + digits"
                            autoComplete="new-password"
                            className="w-full rounded-md border border-hairline bg-black/40 px-3.5 py-2.5 font-mono font-normal text-[0.88rem] text-foreground placeholder-ink-muted focus:border-primary focus:outline-none"
                        />
                    </label>
                    <label className="flex flex-col gap-1.5 text-left text-[0.85rem] font-semibold">
                        Confirm new password
                        <input
                            type="password"
                            value={pw2}
                            onChange={(e) => setPw2(e.target.value)}
                            autoComplete="new-password"
                            onKeyDown={(e) => { if (e.key === 'Enter') doSetPassword(); }}
                            className="w-full rounded-md border border-hairline bg-black/40 px-3.5 py-2.5 font-mono font-normal text-[0.88rem] text-foreground placeholder-ink-muted focus:border-primary focus:outline-none"
                        />
                    </label>
                    <p className="text-[0.78rem] text-ink-secondary">For <span className="font-mono text-ink">{user.email}</span>. Never logged or emailed.</p>
                </div>
            </ConfirmModal>
        </div>
    );
}

function PageSkeleton() {
    return (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
            <div className="h-4 w-28 animate-pulse rounded bg-white/[0.06]" />
            <div className="h-24 animate-pulse rounded-xl bg-white/[0.04]" />
            <div className="h-64 animate-pulse rounded-xl bg-white/[0.04]" />
        </div>
    );
}

function UserActivity({ userId }) {
    const { data, isLoading, error } = useAdminAudit({ actorId: userId, page: 1, limit: 15 });
    if (isLoading) return <TableSkeletonRows />;
    if (error || !data) return <ErrorState message={error?.message ?? 'Could not load activity.'} />;
    const items = data.data ?? [];
    if (items.length === 0) {
        return (
            <div className="rounded-xl border border-hairline bg-card px-4 py-10">
                <EmptyState icon={Activity} title="No recorded activity" hint="Actions performed by this account will appear here." />
            </div>
        );
    }
    return (
        <div className="overflow-hidden rounded-xl border border-hairline bg-card">
            <div className="hidden grid-cols-[220px_1fr_170px] gap-3 border-b border-hairline px-5 py-2.5 font-mono text-[0.68rem] tracking-wider text-ink-muted uppercase lg:grid">
                <span>Action</span><span>Target</span><span>Date</span>
            </div>
            <div className="flex flex-col divide-y divide-hairline px-5">
                {items.map((a) => (
                    <div key={a.id} className="grid grid-cols-1 gap-1 py-3 lg:grid-cols-[220px_1fr_170px] lg:items-center lg:gap-3">
                        <span className={cn(
                            'w-fit rounded-full px-2 py-0.5 font-mono text-[0.7rem] font-bold',
                            String(a.action).startsWith('admin.') ? 'bg-red-500/15 text-red-400' : 'bg-white/10 text-ink-secondary',
                        )}>
                            {a.action}
                        </span>
                        <span className="truncate font-mono text-[0.78rem] text-ink-secondary">
                            {a.targetType ? `${a.targetType} · ${String(a.targetId ?? '').slice(0, 8)}…` : '—'}
                        </span>
                        <span className="font-mono text-[0.74rem] text-ink-muted" title={new Date(a.createdAt).toLocaleString()}>
                            {timeAgo(a.createdAt)}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function TableSkeletonRows() {
    return (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
            {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-11 animate-pulse rounded-xl bg-white/[0.04]" />
            ))}
        </div>
    );
}
