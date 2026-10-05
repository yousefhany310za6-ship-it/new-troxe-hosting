import { useState } from 'react';

import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/useToast.jsx';
import { useAdminCreatePlan, useAdminPlanDelete, useAdminPlans, useAdminPlanUpdate } from '@/hooks/useAdminQueries.jsx';
import { ConfirmModal } from '@/components/ui/confirm-modal.jsx';

const inputClass =
    'w-full rounded-xl border border-hairline bg-white/10 px-4 py-2 text-[0.85rem] text-foreground placeholder-ink-muted transition focus:border-primary focus:outline-none';

const blank = { id: '', name: '', priceCents: 0, cpuMilli: 250, ramMb: 256, storageGb: 1, maxServers: 1, maxBackupSlots: 0 };

export default function AdminPlans() {
    const toast = useToast();
    const { data: plans, isLoading, error } = useAdminPlans();
    const createPlan = useAdminCreatePlan();
    const [editing, setEditing] = useState(null); // plan object or 'new'
    const [form, setForm] = useState(blank);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const updatePlan = useAdminPlanUpdate(editing?.id);
    const deletePlan = useAdminPlanDelete(editing?.id);

    const openNew = () => { setForm(blank); setEditing('new'); };
    const openEdit = (p) => { setForm({ ...blank, ...p }); setEditing(p); };

    const save = async (e) => {
        e.preventDefault();
        try {
            if (editing === 'new') {
                await createPlan.mutateAsync({
                    ...form,
                    priceCents: Number(form.priceCents), cpuMilli: Number(form.cpuMilli),
                    ramMb: Number(form.ramMb), storageGb: Number(form.storageGb),
                    maxServers: Number(form.maxServers), maxBackupSlots: Number(form.maxBackupSlots),
                });
                toast.success('Plan created.');
            } else {
                const { id: _id, ...rest } = form;
                const nums = ['priceCents', 'cpuMilli', 'ramMb', 'storageGb', 'maxServers', 'maxBackupSlots'];
                const payload = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, nums.includes(k) ? Number(v) : v]));
                await updatePlan.mutateAsync(payload);
                toast.success('Plan updated.');
            }
            setEditing(null);
        } catch (err) { toast.error(err.message); }
    };

    const remove = async () => {
        await deletePlan.mutateAsync();
        toast.success('Plan deleted.');
        setEditing(null);
    };

    const askRemove = () => {
        if (editing?.id === 'free') { toast.error('The free plan cannot be deleted.'); return; }
        setDeleteOpen(true);
    };

    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-[1.6rem] font-extrabold tracking-tight">Plans</h1>
                    <p className="mt-1 text-[0.92rem] text-ink-secondary">Quotas are resolved server-side from these records.</p>
                </div>
                <button type="button" onClick={openNew} className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:bg-gray-200">
                    New plan
                </button>
            </div>

            {isLoading && <p className="text-ink-muted">Loading…</p>}
            {error && <p className="text-red-400">Failed to load: {error.message}</p>}

            <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
                {(plans ?? []).map((p) => (
                    <button key={p.id} type="button" onClick={() => openEdit(p)} className="rounded-xl border border-hairline bg-card p-6 text-left transition hover:border-hairline-hover">
                        <div className="flex items-center gap-2">
                            <p className="font-mono text-[1.05rem] font-bold">{p.id}</p>
                            {p.custom && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[0.68rem] font-bold text-ink-secondary">custom</span>}
                        </div>
                        <p className="mt-0.5 text-[0.85rem] text-ink-secondary">{p.name}</p>
                        <div className="mt-3 grid grid-cols-2 gap-1 font-mono text-[0.75rem] text-ink-muted">
                            <span>${(p.priceCents / 100).toFixed(2)}/mo</span>
                            <span>{p.maxServers} servers</span>
                            <span>{p.cpuMilli / 1000} vCPU</span>
                            <span>{p.ramMb} MB</span>
                            <span>{p.storageGb} GB</span>
                            <span>{p.maxBackupSlots} backups</span>
                        </div>
                    </button>
                ))}
            </div>

            {editing && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setEditing(null)}>
                    <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-xl border border-hairline bg-card p-6">
                        <h2 className="text-[1.1rem] font-bold">{editing === 'new' ? 'New plan' : `Edit ${editing.id}`}</h2>
                        <div className="mt-4 grid grid-cols-2 gap-3 max-md:grid-cols-1">
                            <label className="flex flex-col gap-1 text-[0.8rem] font-semibold">ID
                                <input value={form.id} onChange={set('id')} disabled={editing !== 'new'} placeholder="pro" className={cn(inputClass, 'font-mono')} />
                            </label>
                            <label className="flex flex-col gap-1 text-[0.8rem] font-semibold">Name
                                <input value={form.name} onChange={set('name')} placeholder="Pro" className={inputClass} />
                            </label>
                            {[
                                ['priceCents', 'Price (cents/mo)'], ['cpuMilli', 'CPU (milli)'], ['ramMb', 'RAM (MB)'],
                                ['storageGb', 'Storage (GB)'], ['maxServers', 'Max servers'], ['maxBackupSlots', 'Backup slots'],
                            ].map(([k, label]) => (
                                <label key={k} className="flex flex-col gap-1 text-[0.8rem] font-semibold">{label}
                                    <input type="number" min="0" value={form[k]} onChange={set(k)} className={cn(inputClass, 'font-mono')} />
                                </label>
                            ))}
                        </div>
                        <div className="mt-5 flex items-center gap-2">
                            <button type="submit" className="rounded-full bg-white px-6 py-2.5 text-sm font-bold text-black transition hover:bg-gray-200">
                                {editing === 'new' ? 'Create' : 'Save'}
                            </button>
                            <button type="button" onClick={() => setEditing(null)} className="rounded-full border border-hairline px-6 py-2.5 text-sm font-bold text-ink-secondary transition hover:text-foreground">
                                Cancel
                            </button>
                            {editing !== 'new' && (
                                <button type="button" onClick={askRemove} className="ml-auto rounded-full border border-red-500/40 px-5 py-2 text-[0.83rem] font-bold text-red-400 transition hover:bg-red-500 hover:text-white">
                                    Delete
                                </button>
                            )}
                        </div>
                    </form>
                </div>
            )}
            <ConfirmModal
                open={deleteOpen}
                onClose={() => setDeleteOpen(false)}
                title="Delete plan"
                description="Plans with users on them cannot be deleted — the API will refuse while any account references it."
                confirmLabel="Delete plan"
                onConfirm={remove}
            >
                <p className="text-[0.85rem] text-ink-secondary">
                    Plan: <span className="font-mono font-bold text-ink">{editing?.id}</span>
                </p>
            </ConfirmModal>
        </div>
    );
}