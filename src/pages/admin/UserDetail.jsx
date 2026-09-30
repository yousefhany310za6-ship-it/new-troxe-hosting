import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/useToast.jsx';
import {
    useAdminDeleteUser,
    useAdminPlans,
    useAdminResetLogins,
    useAdminServers,
    useAdminUpdatePlan,
    useAdminUpdateRole,
    useAdminUser,
} from '@/hooks/useAdminQueries.jsx';

const inputClass =
    'rounded-xl border border-hairline bg-white/10 px-4 py-2 text-[0.85rem] text-foreground transition focus:border-primary focus:outline-none';

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
    const [msg, setMsg] = useState({ text: '', ok: true });

    if (isLoading) return <div className="flex h-64 items-center justify-center text-ink-muted">Loading…</div>;
    if (error) return <div className="text-red-400">Failed to load: {error.message}</div>;

    const fail = (e) => { setMsg({ text: e.message, ok: false }); toast.error(e.message); };
    const ok = (t) => { setMsg({ text: t, ok: true }); toast.success(t); };

    const changeRole = async (role) => {
        if (!window.confirm(`Change ${user.email} role to "${role}"?`)) return;
        try { await updateRole.mutateAsync(role); ok(`Role changed to ${role}.`); }
        catch (e) { fail(e); }
    };

    const changePlan = async (planId) => {
        try { await updatePlan.mutateAsync(planId); ok(`Plan changed to ${planId}.`); }
        catch (e) { fail(e); }
    };

    const reset = async () => {
        try { await resetLogins.mutateAsync(); ok('Failed logins reset, lock cleared.'); }
        catch (e) { fail(e); }
    };

    const remove = async () => {
        if (!window.confirm(`DELETE ${user.email} and ALL their servers? This cannot be undone.`)) return;
        if (window.prompt('Type DELETE to confirm:') !== 'DELETE') {
            setMsg({ text: 'Confirmation failed. Deletion cancelled.', ok: false });
            return;
        }
        try { await deleteUser.mutateAsync(); toast.success('User deleted.'); navigate('/admin/users'); }
        catch (e) { fail(e); }
    };

    return (
        <div className="flex flex-col gap-6">
            <Link to="/admin/users" className="w-fit text-[0.85rem] font-semibold text-ink-secondary hover:text-foreground">← All users</Link>
            <div>
                <h1 className="font-mono text-[1.4rem] font-extrabold">{user.name}</h1>
                <p className="mt-1 font-mono text-[0.9rem] text-ink-secondary">{user.email}</p>
            </div>

            {msg.text && <p className={cn('text-sm', msg.ok ? 'text-emerald-400' : 'text-red-400')}>{msg.text}</p>}

            <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
                {[
                    ['Role', user.role],
                    ['Plan', user.planId],
                    ['Servers', user.serverCount],
                    ['Active sessions', user.activeSessions],
                    ['Failed logins', user.failedLogins],
                    ['Locked until', user.lockedUntil ? new Date(user.lockedUntil).toLocaleString() : '—'],
                    ['Joined', new Date(user.createdAt).toLocaleString()],
                    ['Password changed', user.passwordChangedAt ? new Date(user.passwordChangedAt).toLocaleString() : '—'],
                ].map(([label, value]) => (
                    <div key={label} className="rounded-xl border border-hairline bg-card p-5">
                        <p className="text-[0.8rem] text-ink-muted">{label}</p>
                        <p className="mt-1 font-mono text-[0.95rem] font-bold">{String(value)}</p>
                    </div>
                ))}
            </div>

            <div className="rounded-xl border border-hairline bg-card p-6">
                <h2 className="text-[1.05rem] font-bold">Actions</h2>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                    <select value={user.role} onChange={(e) => changeRole(e.target.value)} className={inputClass} disabled={updateRole.isPending}>
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                    </select>
                    <select value={user.planId} onChange={(e) => changePlan(e.target.value)} className={inputClass} disabled={updatePlan.isPending}>
                        {(plans ?? []).map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
                    </select>
                    <button type="button" onClick={reset} disabled={resetLogins.isPending} className="rounded-full border border-hairline px-5 py-2 text-[0.83rem] font-bold text-ink-secondary transition hover:text-foreground">
                        Reset lockout
                    </button>
                    <button type="button" onClick={remove} disabled={deleteUser.isPending} className="rounded-full border border-red-500/40 px-5 py-2 text-[0.83rem] font-bold text-red-400 transition hover:bg-red-500 hover:text-white">
                        Delete user
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
                            <span className="ml-auto">{new Date(l.createdAt).toLocaleString()}</span>
                        </div>
                    ))}
                    {(user.recentLogins ?? []).length === 0 && <p className="py-3 text-[0.85rem] text-ink-muted">No login history.</p>}
                </div>
            </div>
        </div>
    );
}