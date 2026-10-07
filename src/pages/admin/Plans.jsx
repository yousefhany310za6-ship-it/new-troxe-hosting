import { useState } from 'react';

import { useToast } from '@/hooks/useToast.jsx';
import { useAdminCreatePlan, useAdminPlanDelete, useAdminPlans, useAdminPlanUpdate } from '@/hooks/useAdminQueries.jsx';
import { ConfirmModal } from '@/components/ui/confirm-modal.jsx';
import { Modal } from '@/components/ui/modal.jsx';
import { Field } from '@/components/ui/field.jsx';
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from './components.jsx';

const blank = { id: '', name: '', priceCents: 0, cpuMilli: 250, ramMb: 256, storageGb: 1, maxServers: 1, maxBackupSlots: 0 };

const NUMS = ['priceCents', 'cpuMilli', 'ramMb', 'storageGb', 'maxServers', 'maxBackupSlots'];
const FIELDS = [
    ['priceCents', 'Price (cents/mo)', 'Charged amount, integer cents.'],
    ['cpuMilli', 'CPU (milli)', '1000 = 1 vCPU.'],
    ['ramMb', 'RAM (MB)', 'Per-server memory cap.'],
    ['storageGb', 'Storage (GB)', 'Per-server disk quota.'],
    ['maxServers', 'Max servers', 'Servers this plan may own.'],
    ['maxBackupSlots', 'Backup slots', 'Snapshots per server (0 = locked).'],
];

export default function AdminPlans() {
    const toast = useToast();
    const { data: plans, isLoading, error, refetch } = useAdminPlans();
    const createPlan = useAdminCreatePlan();
    const [editing, setEditing] = useState(null); // plan object or 'new'
    const [form, setForm] = useState(blank);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [errors, setErrors] = useState({});
    const updatePlan = useAdminPlanUpdate(editing?.id);
    const deletePlan = useAdminPlanDelete(editing?.id);

    const openNew = () => { setForm(blank); setErrors({}); setEditing('new'); };
    const openEdit = (p) => { setForm({ ...blank, ...p }); setErrors({}); setEditing(p); };

    const validate = () => {
        const errs = {};
        if (editing === 'new' && !/^[a-z0-9-]{2,32}$/.test(form.id)) errs.id = 'Lowercase letters, digits, dashes (2–32).';
        if (!String(form.name).trim()) errs.name = 'Name is required.';
        for (const k of NUMS) {
            if (!/^\d+$/.test(String(form[k] ?? '')) || Number(form[k]) < 0) errs[k] = 'Must be a number ≥ 0.';
        }
        setErrors(errs);
        return Object.keys(errs).length === 0;
    };

    const save = async (e) => {
        e.preventDefault();
        if (!validate()) return;
        try {
            const payload = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, NUMS.includes(k) ? Number(v) : typeof v === 'string' ? v.trim() : v]));
            if (editing === 'new') {
                await createPlan.mutateAsync(payload);
                toast.success('Plan created.');
            } else {
                const { id: _id, ...rest } = payload;
                await updatePlan.mutateAsync(rest);
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
        <div className="flex flex-col gap-5">
            <PageHeader
                title="Plans"
                description="Quotas are resolved server-side from these records — editing applies to enforcement immediately."
                actions={
                    <button type="button" onClick={openNew} className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:bg-gray-200">
                        New plan
                    </button>
                }
            />

            {isLoading && <TableSkeleton rows={3} />}
            {error && <ErrorState message={error.message} onRetry={refetch} />}

            {!isLoading && !error && (
                <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {(plans ?? []).map((p) => (
                            <button
                                key={p.id}
                                type="button"
                                onClick={() => openEdit(p)}
                                aria-label={`Edit plan ${p.id}`}
                                className="rounded-xl border border-hairline bg-card p-5 text-left transition hover:border-hairline-hover focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                            >
                                <div className="flex items-center gap-2">
                                    <p className="font-mono text-[1rem] font-bold">{p.id}</p>
                                    {p.custom && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[0.68rem] font-bold text-ink-secondary">custom</span>}
                                    {p.id === 'free' && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[0.68rem] font-bold text-ink-secondary">default</span>}
                                </div>
                                <p className="mt-0.5 text-[0.83rem] text-ink-secondary">{p.name}</p>
                                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[0.74rem] text-ink-muted">
                                    <div className="flex justify-between gap-2"><dt>price</dt><dd className="text-ink-secondary tabular-nums">${(p.priceCents / 100).toFixed(2)}/mo</dd></div>
                                    <div className="flex justify-between gap-2"><dt>servers</dt><dd className="text-ink-secondary tabular-nums">{p.maxServers}</dd></div>
                                    <div className="flex justify-between gap-2"><dt>cpu</dt><dd className="text-ink-secondary tabular-nums">{p.cpuMilli / 1000} vCPU</dd></div>
                                    <div className="flex justify-between gap-2"><dt>ram</dt><dd className="text-ink-secondary tabular-nums">{p.ramMb} MB</dd></div>
                                    <div className="flex justify-between gap-2"><dt>disk</dt><dd className="text-ink-secondary tabular-nums">{p.storageGb} GB</dd></div>
                                    <div className="flex justify-between gap-2"><dt>backups</dt><dd className="text-ink-secondary tabular-nums">{p.maxBackupSlots}</dd></div>
                                </dl>
                            </button>
                        ))}
                    </div>
                    {(plans ?? []).length === 0 && (
                        <EmptyState title="No plans" hint="Create the first pricing plan." />
                    )}
                </>
            )}

            <Modal
                open={!!editing}
                onClose={() => setEditing(null)}
                title={editing === 'new' ? 'New plan' : `Edit ${editing?.id}`}
                size="lg"
                footer={
                    <>
                        {editing !== 'new' && (
                            <button type="button" onClick={askRemove} className="mr-auto rounded-full border border-red-500/40 px-5 py-2.5 text-sm font-bold text-red-400 transition hover:bg-red-500 hover:text-white">
                                Delete
                            </button>
                        )}
                        <button type="button" onClick={() => setEditing(null)} className="rounded-full border border-hairline px-6 py-2.5 text-sm font-bold text-ink-secondary transition hover:text-foreground">
                            Cancel
                        </button>
                        <button type="submit" form="plan-form" className="rounded-full bg-white px-6 py-2.5 text-sm font-bold text-black transition hover:bg-gray-200">
                            {editing === 'new' ? 'Create' : 'Save'}
                        </button>
                    </>
                }
            >
                <form id="plan-form" onSubmit={save} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="ID" hint={editing === 'new' ? 'Immutable after creation.' : undefined} error={errors.id}>
                        <input value={form.id} onChange={set('id')} disabled={editing !== 'new'} placeholder="pro" aria-invalid={!!errors.id} className="input-field font-mono" />
                    </Field>
                    <Field label="Name" error={errors.name}>
                        <input value={form.name} onChange={set('name')} placeholder="Pro" aria-invalid={!!errors.name} className="input-field" />
                    </Field>
                    {FIELDS.map(([k, label, hint]) => (
                        <Field key={k} label={label} hint={hint} error={errors[k]}>
                            <input
                                type="number"
                                min="0"
                                value={form[k]}
                                onChange={set(k)}
                                aria-invalid={!!errors[k]}
                                className="input-field font-mono"
                            />
                        </Field>
                    ))}
                </form>
            </Modal>

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
