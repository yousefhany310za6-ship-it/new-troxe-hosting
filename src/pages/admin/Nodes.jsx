import { useState } from 'react';

import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/useToast.jsx';
import {
    useAdminCheckNode,
    useAdminCreateNode,
    useAdminDeleteNode,
    useAdminNodes,
    useAdminUpdateNode,
} from '@/hooks/useAdminQueries.jsx';
import { ConfirmModal } from '@/components/ui/confirm-modal.jsx';

const inputClass =
    'w-full rounded-xl border border-hairline bg-white/10 px-4 py-2 text-[0.85rem] text-foreground placeholder-ink-muted transition focus:border-primary focus:outline-none';
const actionBtn =
    'inline-flex items-center gap-1.5 rounded-md border border-hairline bg-veil px-3 py-1.5 text-[0.8rem] font-semibold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40';

const blank = { id: '', name: '', host: '', port: '2376', subnetBase: '', ca: '', cert: '', key: '' };

export default function AdminNodes() {
    const toast = useToast();
    const { data: nodes, isLoading, error, refetch } = useAdminNodes();
    const createNode = useAdminCreateNode();
    const [showNew, setShowNew] = useState(false);
    const [form, setForm] = useState(blank);
    const [checking, setChecking] = useState({});
    // last firewall report per node (`ok: null` = unreadable, NOT the same as drift)
    const [fw, setFw] = useState({});
    const [editTls, setEditTls] = useState(null); // node id being rotated

    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

    const submitNew = async (e) => {
        e.preventDefault();
        try {
            const payload = {
                name: form.name.trim(),
                host: form.host.trim(),
                port: Number(form.port) || 2376,
                subnetBase: form.subnetBase.trim(),
                ca: form.ca,
                cert: form.cert,
                key: form.key,
            };
            if (form.id.trim()) payload.id = form.id.trim();
            await createNode.mutateAsync(payload);
            toast.success('Node registered. Run a health check next.');
            setShowNew(false);
            setForm(blank);
            refetch();
        } catch (err) { toast.error(err.message); }
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-[1.6rem] font-extrabold tracking-tight">Nodes</h1>
                    <p className="mt-1 text-[0.92rem] text-ink-secondary">
                        Docker daemons hosting client sandboxes. New servers land on the least-loaded eligible node.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => { setForm(blank); setShowNew(true); }}
                    className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:bg-gray-200"
                >
                    + New node
                </button>
            </div>

            {isLoading && <p className="text-ink-muted">Loading…</p>}
            {error && <p className="text-red-400">Failed to load: {error.message}</p>}

            <div className="flex flex-col gap-3">
                {(nodes ?? []).map((n) => (
                    <NodeCard
                        key={n.id}
                        node={n}
                        checking={!!checking[n.id]}
                        fw={fw[n.id]}
                        onCheck={async (check) => {
                            setChecking((c) => ({ ...c, [n.id]: true }));
                            try {
                                const res = await check.mutateAsync();
                                setFw((c) => ({ ...c, [n.id]: res.firewall ?? null }));
                                const f = res.firewall;
                                let suffix = '';
                                if (f) {
                                    if (f.mode === 'none') suffix = ' · firewall off (HARDEN_NETWORK=0)';
                                    else if (f.ok === true) suffix = ` · firewall ok (${f.found}/${f.expected} rules)`;
                                    else if (f.ok === false) suffix = ` · FIREWALL DRIFT — ${f.missing.length}/${f.expected} rule(s) missing`;
                                    else suffix = ' · firewall unreadable (that is not the same as drift)';
                                }
                                toast[f?.ok === false ? 'error' : res.ok ? 'success' : 'error'](
                                    res.ok ? `${n.id} reachable (docker ${res.version ?? '?'})${suffix}` : `Unreachable: ${res.error}${suffix}`,
                                );
                                refetch();
                            } catch (e) { toast.error(e.message); }
                            finally { setChecking((c) => ({ ...c, [n.id]: false })); }
                        }}
                        onRotate={() => setEditTls(n.id)}
                    />
                ))}
                {(nodes ?? []).length === 0 && !isLoading && (
                    <p className="text-center text-ink-muted">No nodes yet.</p>
                )}
            </div>

            {showNew && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowNew(false)}>
                    <form onSubmit={submitNew} onClick={(e) => e.stopPropagation()} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-hairline bg-card p-6">
                        <h2 className="text-[1.1rem] font-bold">Register node</h2>
                        <p className="mt-1 text-[0.8rem] text-ink-secondary">
                            Run <span className="font-mono">scripts/node-setup.sh</span> on the new host first — it prints these values.
                        </p>
                        <div className="mt-4 flex flex-col gap-3">
                            <label className="flex flex-col gap-1 text-[0.8rem] font-semibold">Display name
                                <input value={form.name} onChange={set('name')} placeholder="hetzner-2" className={inputClass} />
                            </label>
                            <div className="grid grid-cols-2 gap-3">
                                <label className="flex flex-col gap-1 text-[0.8rem] font-semibold">Node id (optional)
                                    <input value={form.id} onChange={set('id')} placeholder="auto" className={cn(inputClass, 'font-mono')} />
                                </label>
                                <label className="flex flex-col gap-1 text-[0.8rem] font-semibold">Subnet base (required)
                                    <input value={form.subnetBase} onChange={set('subnetBase')} placeholder="10.201.0.0/16" className={cn(inputClass, 'font-mono')} />
                                </label>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <label className="flex flex-col gap-1 text-[0.8rem] font-semibold">Daemon host
                                    <input value={form.host} onChange={set('host')} placeholder="203.0.113.9" className={cn(inputClass, 'font-mono')} />
                                </label>
                                <label className="flex flex-col gap-1 text-[0.8rem] font-semibold">Port
                                    <input value={form.port} onChange={set('port')} placeholder="2376" className={cn(inputClass, 'font-mono')} />
                                </label>
                            </div>
                            {[['ca', 'CA certificate (ca.pem)'], ['cert', 'Client certificate (client-cert.pem)'], ['key', 'Client key (client-key.pem)']].map(([k, label]) => (
                                <label key={k} className="flex flex-col gap-1 text-[0.8rem] font-semibold">{label}
                                    <textarea value={form[k]} onChange={set(k)} rows={3} placeholder="-----BEGIN ..." className={cn(inputClass, 'font-mono text-[0.75rem]')} />
                                </label>
                            ))}
                        </div>
                        <div className="mt-5 flex items-center gap-2">
                            <button type="submit" className="rounded-full bg-white px-6 py-2.5 text-sm font-bold text-black transition hover:bg-gray-200">
                                Register
                            </button>
                            <button type="button" onClick={() => setShowNew(false)} className="rounded-full border border-hairline px-6 py-2.5 text-sm font-bold text-ink-secondary transition hover:text-foreground">
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {editTls && (
                <TlsRotateModal
                    nodeId={editTls}
                    onClose={() => { setEditTls(null); refetch(); }}
                />
            )}
        </div>
    );
}

function NodeCard({ node, checking, fw, onCheck, onRotate }) {
    const toast = useToast();
    const check = useAdminCheckNode(node.id);
    const update = useAdminUpdateNode(node.id);
    const del = useAdminDeleteNode(node.id);
    const isLocal = node.id === 'local';
    const [removeOpen, setRemoveOpen] = useState(false);

    const toggle = async (field, value, label) => {
        try {
            await update.mutateAsync({ [field]: value });
            toast.success(`${label} ${value ? 'on' : 'off'}.`);
        } catch (e) { toast.error(e.message); }
    };

    const remove = async () => {
        await del.mutateAsync();
        toast.success('Node removed.');
    };

    return (
        <div className="rounded-xl border border-hairline bg-card p-5">
            <div className="flex flex-wrap items-center gap-3">
                <span className={cn('size-2.5 shrink-0 rounded-full', node.enabled ? 'bg-emerald-500' : 'bg-zinc-600')} />
                <span className="font-mono text-[0.95rem] font-bold">{node.id}</span>
                <span className="text-[0.85rem] text-ink-secondary">{node.name}</span>
                {isLocal && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[0.68rem] font-bold text-ink-secondary">LOCAL</span>}
                {node.drained && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[0.68rem] font-bold text-amber-400">DRAINED</span>}
                <div className="ml-auto flex items-center gap-2">
                    <button type="button" onClick={() => onCheck(check)} disabled={checking} className={actionBtn}>
                        {checking ? 'Checking…' : 'Check'}
                    </button>
                    {!isLocal && (
                        <>
                            <button type="button" onClick={() => toggle('drained', !node.drained, 'Drain')} className={actionBtn}>
                                {node.drained ? 'Undrain' : 'Drain'}
                            </button>
                            <button type="button" onClick={() => toggle('enabled', !node.enabled, 'Node')} className={actionBtn}>
                                {node.enabled ? 'Disable' : 'Enable'}
                            </button>
                            <button type="button" onClick={onRotate} className={actionBtn}>Rotate TLS</button>
                            <button
                                type="button"
                                onClick={() => setRemoveOpen(true)}
                                className={cn(actionBtn, 'hover:!border-red-500/50 hover:!text-red-400')}
                            >
                                Remove
                            </button>
                        </>
                    )}
                </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[0.75rem] text-ink-muted max-md:grid-cols-1">
                <span>host: {node.dockerHost ? `${node.dockerHost}:${node.dockerPort}` : 'unix socket'}</span>
                <span>supernet: {node.subnetBase ?? '— (legacy)'}</span>
                <span>servers: {node.serverCount ?? '—'}</span>
                <span>last seen: {node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString() : 'never'}</span>
                {fw && (
                    <span
                        className={cn(
                            fw.ok === false && 'font-bold text-red-400',
                            fw.ok === true && 'text-emerald-400',
                            fw.ok === null && fw.mode !== 'none' && 'text-amber-400',
                        )}
                    >
                        firewall:{' '}
                        {fw.mode === 'none'
                            ? 'off (HARDEN_NETWORK=0)'
                            : fw.ok === true
                                ? `ok · ${fw.found}/${fw.expected} rules`
                                : fw.ok === false
                                    ? `DRIFT · ${fw.missing.length}/${fw.expected} missing`
                                    : 'unreadable (≠ drift)'}
                    </span>
                )}
            </div>
            <ConfirmModal
                open={removeOpen}
                onClose={() => setRemoveOpen(false)}
                title="Remove node"
                description="The node is deregistered from the fleet. Servers already running on it are NOT migrated."
                confirmLabel="Remove node"
                onConfirm={remove}
            >
                <p className="text-[0.85rem] text-ink-secondary">
                    Node: <span className="font-mono font-bold text-ink">{node.id}</span>
                    {node.serverCount ? ` — ${node.serverCount} server${node.serverCount === 1 ? '' : 's'} on it` : ''}
                </p>
            </ConfirmModal>
        </div>
    );
}

function TlsRotateModal({ nodeId, onClose }) {
    const toast = useToast();
    const update = useAdminUpdateNode(nodeId);
    const [ca, setCa] = useState('');
    const [cert, setCert] = useState('');
    const [key, setKey] = useState('');

    const save = async (e) => {
        e.preventDefault();
        if (!ca.trim() || !cert.trim() || !key.trim()) { toast.error('All three blocks are required (atomic rotation).'); return; }
        try {
            await update.mutateAsync({ ca, cert, key });
            toast.success('TLS rotated.');
            onClose();
        } catch (err) { toast.error(err.message); }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
            <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-hairline bg-card p-6">
                <h2 className="text-[1.1rem] font-bold">Rotate TLS — {nodeId}</h2>
                <p className="mt-1 text-[0.8rem] text-ink-secondary">All three blocks rotate together; the pool drops the old client immediately.</p>
                <div className="mt-4 flex flex-col gap-3">
                    {[['CA certificate', ca, setCa], ['Client certificate', cert, setCert], ['Client key', key, setKey]].map(([label, v, fn]) => (
                        <label key={label} className="flex flex-col gap-1 text-[0.8rem] font-semibold">{label}
                            <textarea value={v} onChange={(e) => fn(e.target.value)} rows={3} placeholder="-----BEGIN ..." className={cn(inputClass, 'font-mono text-[0.75rem]')} />
                        </label>
                    ))}
                </div>
                <div className="mt-5 flex items-center gap-2">
                    <button type="submit" className="rounded-full bg-white px-6 py-2.5 text-sm font-bold text-black transition hover:bg-gray-200">
                        Rotate
                    </button>
                    <button type="button" onClick={onClose} className="rounded-full border border-hairline px-6 py-2.5 text-sm font-bold text-ink-secondary transition hover:text-foreground">
                        Cancel
                    </button>
                </div>
            </form>
        </div>
    );
}
