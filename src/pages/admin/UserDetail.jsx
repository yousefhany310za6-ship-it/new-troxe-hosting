import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BadgeCheck, Ban, KeyRound, Trash2, Undo2, UserCheck } from 'lucide-react';

import { cn } from '@/lib/utils';
import { apiPost } from '@/lib/api.js';
import { useToast } from '@/hooks/useToast.jsx';
import {
    useAdminDeleteUser,
    useAdminRestoreUser,
    useAdminSetPassword,
    useAdminSuspendUser,
    useAdminUnsuspendUser,
    useAdminPlans,
    useAdminResetLogins,
    useAdminServers,
    useAdminUpdatePlan,
    useAdminUpdateRole,
    useAdminUser,
} from '@/hooks/useAdminQueries.jsx';
import { ConfirmModal } from '@/components/ui/confirm-modal.jsx';
import { Flag } from '@/components/ui/flag.jsx';
import { Select } from '@/components/ui/select.jsx';
import { Skeleton } from '@/components/ui/field.jsx';
import { AvatarBadge } from '@/components/AvatarBadge.jsx';

const fmtBytes = (n) => {
    const v0 = Number(n) || 0;
    if (v0 <= 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = v0;
    let i = 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
};

function StatusPill({ status }) {
    const st = status ?? 'active';
    return (
        <span className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.7rem] font-bold',
            st === 'active' ? 'bg-emerald-500/15 text-emerald-400'
            : st === 'suspended' ? 'bg-amber-500/15 text-amber-300'
            : 'bg-zinc-500/20 text-zinc-400',
        )}>
            <span className={cn(
                'size-1.5 rounded-full',
                st === 'active' ? 'bg-emerald-400' : st === 'suspended' ? 'bg-amber-400' : 'bg-zinc-400',
            )} />
            {st}
        </span>
    );
}

export default function AdminUserDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const toast = useToast();
    const { data: user, isLoading, error } = useAdminUser(id);
    const { data: plans } = useAdminPlans();
    const { data: servers } = useAdminServers({ ownerId: id, limit: 100 });
    const updateRole = useAdminUpdateRole(id);
    const updatePlan = useAdminUpdatePlan(id);
    const resetLogins = useAdminResetLogins(id);
    const deleteUser = useAdminDeleteUser(id);
    const setPassword = useAdminSetPassword(id);
    const suspendUser = useAdminSuspendUser(id);
    const unsuspendUser = useAdminUnsuspendUser(id);
    const restoreUser = useAdminRestoreUser(id);
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
            <div className="flex flex-col gap-6">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-16 w-full rounded-xl" />
                <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
                    {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
                </div>
            </div>
        );
    }
    if (error) return <div className="text-red-400">Failed to load: {error.message}</div>;

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
            await suspendUser.mutateAsync(suspendReason.trim() || undefined);
            toast.success('User suspended — all sessions revoked, servers stopped.');
            setSuspendOpen(false);
            setSuspendReason('');
        } catch (e) { toast.error(e.message); }
    };

    const doUnsuspend = async () => {
        try { await unsuspendUser.mutateAsync(); toast.success('User unsuspended.'); }
        catch (e) { toast.error(e.message); }
    };

    const doRestore = async () => {
        try { await restoreUser.mutateAsync(); toast.success('User restored.'); }
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

    return (
        <div className="flex flex-col gap-6">
            <Link to="/admin/users" className="w-fit text-[0.85rem] font-semibold text-ink-secondary hover:text-foreground">← All users</Link>

            <div className="flex flex-wrap items-center gap-4">
                <AvatarBadge url={user.avatarUrl} name={user.name} />
                <div className="min-w-0">
                    <h1 className="truncate font-mono text-[1.4rem] font-extrabold">{user.name}</h1>
                    <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[0.9rem] text-ink-secondary">
                        <span className="truncate">{user.email}</span>
                        <StatusPill status={user.status} />
                        {user.emailVerified ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[0.7rem] font-bold text-emerald-400">
                                <BadgeCheck size={12} /> Verified
                            </span>
                        ) : (
                            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[0.7rem] font-bold text-amber-400">Unverified</span>
                        )}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1 lg:grid-cols-3">
                {[
                    ['Status', user.status ?? 'active'],
                    ['Role', user.role],
                    ['Plan', user.planId],
                    ['Servers', user.serverCount],
                    ['Backups', `${user.backupCount ?? 0} (${fmtBytes(user.backupBytes ?? 0)})`],
                    ['Files on disk', user.volumeBytes == null ? 'unknown' : fmtBytes(user.volumeBytes)],
                    ['Active sessions', user.activeSessions],
                    ['Failed logins', user.failedLogins],
                    ['Locked until', user.lockedUntil ? new Date(user.lockedUntil).toLocaleString() : '—'],
                    ['Last login', user.recentLogins?.[0] ? new Date(user.recentLogins[0].createdAt).toLocaleString() : '—'],
                    ['Joined', new Date(user.createdAt).toLocaleString()],
                    ['Password changed', user.passwordChangedAt ? new Date(user.passwordChangedAt).toLocaleString() : '—'],
                ].map(([label, value]) => (
                    <div key={label} className="rounded-xl border border-hairline bg-card p-5">
                        <p className="text-[0.8rem] text-ink-muted">{label}</p>
                        <p className="mt-1 font-mono text-[0.95rem] font-bold">{String(value)}</p>
                    </div>
                ))}
                <div className="rounded-xl border border-hairline bg-card p-5">
                    <p className="text-[0.8rem] text-ink-muted">Country</p>
                    <p className="mt-1 flex items-center gap-2 text-[0.95rem] font-bold">
                        {user.country ? (
                            <>
                                <Flag code={user.country.countryCode} name={user.country.location} />
                                {user.country.location}
                            </>
                        ) : (
                            <span className="flex items-center gap-2 text-ink-muted"><Flag name="Unknown" /> Unknown</span>
                        )}
                    </p>
                </div>
            </div>

            <div className="rounded-xl border border-hairline bg-card p-6">
                <h2 className="text-[1.05rem] font-bold">Actions</h2>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Select
                        ariaLabel="Role"
                        value={user.role}
                        onChange={(v) => { if (v !== user.role) setRoleTarget(v); }}
                        disabled={updateRole.isPending}
                        options={[
                            { value: 'user', label: 'user' },
                            { value: 'admin', label: 'admin' },
                        ]}
                    />
                    <Select
                        ariaLabel="Plan"
                        value={user.planId}
                        onChange={changePlan}
                        disabled={updatePlan.isPending || !plans}
                        loading={!plans}
                        searchable={(plans ?? []).length > 6}
                        options={(plans ?? []).map((p) => ({ value: p.id, label: p.id }))}
                    />
                    <button type="button" onClick={reset} disabled={resetLogins.isPending} className="rounded-full border border-hairline px-5 py-2 text-[0.83rem] font-bold text-ink-secondary transition hover:text-foreground disabled:opacity-50">
                        Reset lockout
                    </button>
                    {user.role !== 'admin' && (
                        <button
                            type="button"
                            onClick={impersonate}
                            disabled={impBusy}
                            className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-5 py-2 text-[0.83rem] font-bold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:opacity-50"
                        >
                            <UserCheck size={14} /> Impersonate (5 min)
                        </button>
                    )}
                    {user.status === 'suspended' ? (
                        <button type="button" onClick={doUnsuspend} disabled={unsuspendUser.isPending} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 px-5 py-2 text-[0.83rem] font-bold text-emerald-300 transition hover:bg-emerald-500/10 disabled:opacity-50">
                            <Undo2 size={14} /> Unsuspend
                        </button>
                    ) : user.status !== 'deleted' ? (
                        <button type="button" onClick={() => setSuspendOpen(true)} className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 px-5 py-2 text-[0.83rem] font-bold text-amber-300 transition hover:bg-amber-500/10">
                            <Ban size={14} /> Suspend
                        </button>
                    ) : (
                        <button type="button" onClick={doRestore} disabled={restoreUser.isPending} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 px-5 py-2 text-[0.83rem] font-bold text-emerald-300 transition hover:bg-emerald-500/10 disabled:opacity-50">
                            <Undo2 size={14} /> Restore account
                        </button>
                    )}
                    {user.status !== 'deleted' && (
                        <button type="button" onClick={() => setPwOpen(true)} className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-5 py-2 text-[0.83rem] font-bold text-ink-secondary transition hover:text-foreground">
                            <KeyRound size={14} /> Set password
                        </button>
                    )}
                    {user.status !== 'deleted' && (
                        <button type="button" onClick={() => setDeleteOpen(true)} className="rounded-full border border-red-500/40 px-5 py-2 text-[0.83rem] font-bold text-red-400 transition hover:bg-red-500 hover:text-white">
                            Delete user
                        </button>
                    )}
                </div>
            </div>

            <div className="rounded-xl border border-hairline bg-card p-6">
                <h2 className="text-[1.05rem] font-bold">Security</h2>
                <p className="mt-1 text-[0.82rem] text-ink-secondary">
                    {user.status === 'suspended' && 'Account is suspended — login, sessions and APIs are blocked.'}
                    {user.status === 'deleted' && 'Account is soft-deleted — data retained, login blocked.'}
                    {(!user.status || user.status === 'active') && 'Account is active.'}
                    {' '}Password changes sign out every session immediately.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => setPwOpen(true)} disabled={user.status === 'deleted'} className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-5 py-2 text-[0.83rem] font-bold text-ink-secondary transition hover:text-foreground disabled:opacity-50">
                        <KeyRound size={14} /> Change password
                    </button>
                    <button type="button" onClick={reset} disabled={resetLogins.isPending} className="rounded-full border border-hairline px-5 py-2 text-[0.83rem] font-bold text-ink-secondary transition hover:text-foreground disabled:opacity-50">
                        Reset lockout
                    </button>
                </div>
            </div>

            <div className="rounded-xl border border-hairline bg-card p-6">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-[1.05rem] font-bold">Servers ({servers?.pagination.total ?? '—'})</h2>
                    <Link
                        to={`/admin/servers/new?owner=${user.id}`}
                        className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-[0.83rem] font-bold text-black transition hover:bg-gray-200"
                    >
                        + New server for this user
                    </Link>
                </div>
                <div className="mt-3 flex flex-col divide-y divide-hairline">
                    {(servers?.data ?? []).map((s) => (
                        <div key={s.id} className="flex items-center gap-3 py-2.5">
                            <span className="font-mono text-[0.88rem] font-semibold">{s.name}</span>
                            <span className="rounded-full border border-hairline bg-veil px-2 py-0.5 text-[0.7rem] text-ink-secondary">{s.runtime}</span>
                            <span className="font-mono text-[0.75rem] capitalize text-ink-muted">{s.status}</span>
                        </div>
                    ))}
                    {(servers?.data ?? []).length === 0 && <p className="py-3 text-[0.85rem] text-ink-muted">No servers.</p>}
                </div>
            </div>

            <div className="rounded-xl border border-hairline bg-card p-6">
                <h2 className="text-[1.05rem] font-bold">Recent logins</h2>
                <div className="mt-3 flex flex-col divide-y divide-hairline">
                    {(user.recentLogins ?? []).map((l) => (
                        <div key={l.id} className="flex flex-wrap items-center gap-3 py-2.5 font-mono text-[0.78rem] text-ink-secondary">
                            <span className={cn('rounded-full px-2 py-0.5 text-[0.7rem] font-bold', l.status === 'success' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400')}>{l.status}</span>
                            <span>{l.ip}</span>
                            <span className="inline-flex items-center gap-1.5">
                                <Flag code={l.countryCode} name={l.location ?? 'Unknown'} className="w-4" />
                                {l.location ?? 'Unknown'}
                            </span>
                            <span className="ml-auto">{new Date(l.createdAt).toLocaleString()}</span>
                        </div>
                    ))}
                    {(user.recentLogins ?? []).length === 0 && <p className="py-3 text-[0.85rem] text-ink-muted">No login history.</p>}
                </div>
            </div>

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
