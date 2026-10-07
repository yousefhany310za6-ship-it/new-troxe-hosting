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
import { Modal } from '@/components/ui/modal.jsx';
import { Field } from '@/components/ui/field.jsx';
import {
    EmptyState,
    ErrorState,
    Menu,
    PageHeader,
    StatusBadge,
    TableSkeleton,
    timeAgo,
} from './components.jsx';

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
        <div className="flex flex-col gap-5">
            <PageHeader
                title="Nodes"
                description="Docker daemons hosting client sandboxes. New servers land on the least-loaded eligible node."
                actions={
                    <button
                        type="button"
                        onClick={() => { setForm(blank); setShowNew(true); }}
                        className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:bg-gray-200"
                    >
                        + New node
                    </button>
                }
            />

            {isLoading && <TableSkeleton rows={3} />}
            {error && <ErrorState message={error.message} onRetry={refetch} />}

            {!isLoading && !error && (
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
                    {(nodes ?? []).length === 0 && (
                        <EmptyState
                            title="No nodes yet"
                            hint="Register a Docker host to place sandboxes on. Run scripts/node-setup.sh on the new host first."
                            action={
                                <button
                                    type="button"
                                    onClick={() => { setForm(blank); setShowNew(true); }}
                                    className="rounded-full bg-white px-5 py-2 text-[0.83rem] font-bold text-black transition hover:bg-gray-200"
                                >
                                    Register node
                                </button>
                            }
                        />
                    )}
                </div>
            )}

            <Modal
                open={showNew}
                onClose={() => setShowNew(false)}
                title="Register node"
                description="Run scripts/node-setup.sh on the new host first — it prints these values."
                size="lg"
                footer={
                    <>
                        <button type="button" onClick={() => setShowNew(false)} className="rounded-full border border-hairline px-6 py-2.5 text-sm font-bold text-ink-secondary transition hover:text-foreground">
                            Cancel
                        </button>
                        <button type="submit" form="node-form" className="rounded-full bg-white px-6 py-2.5 text-sm font-bold text-black transition hover:bg-gray-200">
                            Register
                        </button>
                    </>
                }
            >
                <form id="node-form" onSubmit={submitNew} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Display name" htmlFor="node-name">
                        <input id="node-name" value={form.name} onChange={set('name')} placeholder="hetzner-2" className="input-field" />
                    </Field>
                    <Field label="Node id (optional)" htmlFor="node-id">
                        <input id="node-id" value={form.id} onChange={set('id')} placeholder="auto" className="input-field font-mono" />
                    </Field>
                    <Field label="Subnet base (required)" htmlFor="node-subnet">
                        <input id="node-subnet" value={form.subnetBase} onChange={set('subnetBase')} placeholder="10.201.0.0/16" className="input-field font-mono" />
                    </Field>
                    <Field label="Daemon host" htmlFor="node-host">
                        <input id="node-host" value={form.host} onChange={set('host')} placeholder="203.0.113.9" className="input-field font-mono" />
                    </Field>
                    <Field label="Port" htmlFor="node-port" className="sm:col-span-1">
                        <input id="node-port" value={form.port} onChange={set('port')} placeholder="2376" className="input-field font-mono" />
                    </Field>
                    {[['ca', 'CA certificate (ca.pem)'], ['cert', 'Client certificate (client-cert.pem)'], ['key', 'Client key (client-key.pem)']].map(([k, label]) => (
                        <Field key={k} label={label} htmlFor={`node-${k}`} className="sm:col-span-2">
                            <textarea id={`node-${k}`} value={form[k]} onChange={set(k)} rows={3} placeholder="-----BEGIN ..." className="input-field font-mono text-[0.75rem]" />
                        </Field>
                    ))}
                </form>
            </Modal>

            {editTls && (
                <TlsRotateModal
                    nodeId={editTls}
                    onClose={() => { setEditTls(null); refetch(); }}
                />
            )}
        </div>
    );
}

const actionBtn =
    'inline-flex items-center gap-1.5 rounded-md border border-hairline bg-veil px-3 py-1.5 text-[0.8rem] font-semibold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40';

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
        <section className="rounded-xl border border-hairline bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2.5">
                <StatusBadge tone={node.enabled ? 'emerald' : 'zinc'}>
                    {node.enabled ? 'Enabled' : 'Disabled'}
                </StatusBadge>
                <span className="font-mono text-[0.95rem] font-bold">{node.id}</span>
                <span className="truncate text-[0.85rem] text-ink-secondary">{node.name}</span>
                {isLocal && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[0.68rem] font-bold text-ink-secondary">LOCAL</span>}
                {node.drained && <StatusBadge tone="amber">Drained</StatusBadge>}
                <span className="ml-auto">
                    <Menu
                        label={`Node actions for ${node.id}`}
                        items={[
                            { key: 'check', label: checking ? 'Checking…' : 'Run health check', disabled: checking, onSelect: () => onCheck(check) },
                            ...(!isLocal ? [
                                { key: 'drain', label: node.drained ? 'Undrain' : 'Drain', onSelect: () => toggle('drained', !node.drained, 'Drain') },
                                { key: 'toggle', label: node.enabled ? 'Disable' : 'Enable', onSelect: () => toggle('enabled', !node.enabled, 'Node') },
                                { key: 'tls', label: 'Rotate TLS', onSelect: onRotate },
                                { key: 'remove', label: 'Remove', danger: true, onSelect: () => setRemoveOpen(true) },
                            ] : []),
                        ]}
                    />
                </span>
            </div>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 font-mono text-[0.75rem] text-ink-muted sm:grid-cols-2">
                <div className="flex gap-2"><dt className="w-20 shrink-0">host</dt><dd className="truncate text-ink-secondary">{node.dockerHost ? `${node.dockerHost}:${node.dockerPort}` : 'unix socket'}</dd></div>
                <div className="flex gap-2"><dt className="w-20 shrink-0">supernet</dt><dd className="truncate text-ink-secondary">{node.subnetBase ?? '— (legacy)'}</dd></div>
                <div className="flex gap-2"><dt className="w-20 shrink-0">servers</dt><dd className="text-ink-secondary tabular-nums">{node.serverCount ?? '—'}</dd></div>
                <div className="flex gap-2"><dt className="w-20 shrink-0">last seen</dt><dd className="text-ink-secondary">{node.lastSeenAt ? timeAgo(node.lastSeenAt) : 'never'}</dd></div>
                {fw && (
                    <div className="flex gap-2 sm:col-span-2">
                        <dt className="w-20 shrink-0">firewall</dt>
                        <dd className={cn(
                            fw.ok === false && 'font-bold text-red-400',
                            fw.ok === true && 'text-emerald-400',
                            fw.ok === null && fw.mode !== 'none' && 'text-amber-400',
                        )}>
                            {fw.mode === 'none'
                                ? 'off (HARDEN_NETWORK=0)'
                                : fw.ok === true
                                    ? `ok · ${fw.found}/${fw.expected} rules`
                                    : fw.ok === false
                                        ? `DRIFT · ${fw.missing.length}/${fw.expected} missing`
                                        : 'unreadable (≠ drift)'}
                        </dd>
                    </div>
                )}
            </dl>
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
        </section>
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
        <Modal
            open
            onClose={onClose}
            title={`Rotate TLS — ${nodeId}`}
            description="All three blocks rotate together; the pool drops the old client immediately."
            size="lg"
            footer={
                <>
                    <button type="button" onClick={onClose} className="rounded-full border border-hairline px-6 py-2.5 text-sm font-bold text-ink-secondary transition hover:text-foreground">
                        Cancel
                    </button>
                    <button type="submit" form="tls-form" className="rounded-full bg-white px-6 py-2.5 text-sm font-bold text-black transition hover:bg-gray-200">
                        Rotate
                    </button>
                </>
            }
        >
            <form id="tls-form" onSubmit={save} className="flex flex-col gap-3">
                {[['CA certificate', ca, setCa], ['Client certificate', cert, setCert], ['Client key', key, setKey]].map(([label, v, fn]) => (
                    <Field key={label} label={label}>
                        <textarea value={v} onChange={(e) => fn(e.target.value)} rows={3} placeholder="-----BEGIN ..." className="input-field font-mono text-[0.75rem]" />
                    </Field>
                ))}
            </form>
        </Modal>
    );
}
