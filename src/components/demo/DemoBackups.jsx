import { useEffect, useRef, useState } from 'react';
import {
    Clock,
    Database,
    Download,
    History,
    Loader2,
    Plus,
    Sparkles,
    Trash2,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { ConfirmModal } from '@/components/ui/confirm-modal.jsx';
import { useToast } from '@/hooks/useToast.jsx';
import { DEMO_BACKUPS, DEMO_BACKUP_SLOTS, fmtBytes, fmtDate, timeAgo } from '@/data/demoData.js';

/* Chip + button classes copied from ServerBackups.jsx. */
const STATUS_CHIP = {
    ready: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
    pending: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
    creating: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
    failed: 'border-red-500/25 bg-red-500/10 text-red-300',
};

const rowBtn =
    'inline-flex items-center gap-1.5 rounded-full border border-hairline bg-veil px-3.5 py-1.5 text-[0.78rem] font-semibold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40';

const typeChip =
    'inline-flex shrink-0 items-center gap-1 rounded-full border border-hairline bg-veil px-2 py-0.5 text-[0.68rem] font-semibold text-ink-secondary';

const statusChip =
    'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[0.7rem] font-semibold';

const primaryBtn =
    'inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2.5 text-[0.82rem] font-bold text-black transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40';

function StatusChip({ status }) {
    const failed = status === 'failed';
    const pending = status === 'creating' || status === 'pending';

    return (
        <span className={cn(statusChip, STATUS_CHIP[status] ?? 'border-hairline bg-veil text-ink-secondary')}>
            {pending ? (
                <Loader2 size={11} className="animate-spin" />
            ) : (
                <span className={cn('size-1.5 rounded-full', failed ? 'bg-red-500' : status === 'ready' ? 'bg-emerald-500' : 'bg-zinc-500')} />
            )}
            {status === 'ready' ? 'Ready' : status === 'failed' ? 'Failed' : 'Creating…'}
        </span>
    );
}

function TypeChip({ type }) {
    return type === 'auto' ? (
        <span className={typeChip}>
            <Sparkles size={11} className="text-violet-300" />
            Automatic
        </span>
    ) : (
        <span className={typeChip}>
            <Clock size={11} />
            Manual
        </span>
    );
}

/** Slot usage ring (ServerBackups.jsx `SlotsRing`). */
function SlotsRing({ used, total }) {
    const p = Math.min(100, (used / total) * 100);
    const r = 34;
    const c = 2 * Math.PI * r;
    const locked = used >= total;

    return (
        <div className="relative size-[86px] shrink-0">
            <svg viewBox="0 0 80 80" className="-rotate-90 size-full" aria-hidden="true">
                <circle cx="40" cy="40" r={r} className="text-white/[0.08]" strokeWidth="7" fill="none" stroke="currentColor" />
                <circle
                    cx="40"
                    cy="40"
                    r={r}
                    className={cn('transition-[stroke-dashoffset] duration-700', locked ? 'text-amber-400/70' : 'text-white')}
                    strokeWidth="7"
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={c}
                    strokeDashoffset={c - (c * p) / 100}
                />
            </svg>
            <span className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-mono text-[1.15rem] leading-none font-extrabold tabular-nums">
                    {used}
                    <span className="text-[0.8rem] font-bold text-ink-muted">/{total}</span>
                </span>
                <span className="mt-0.5 text-[0.6rem] font-bold tracking-[0.12em] text-ink-muted uppercase">
                    Snapshots
                </span>
            </span>
        </div>
    );
}

export default function DemoBackups({ now, reduced }) {
    const toast = useToast();
    const [backups, setBackups] = useState(DEMO_BACKUPS);
    const [creating, setCreating] = useState(false);
    const [restoreTarget, setRestoreTarget] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [expanded, setExpanded] = useState(null);

    const timerRef = useRef(null);
    useEffect(() => () => timerRef.current && clearTimeout(timerRef.current), []);

    const ready = backups.filter((b) => b.status === 'ready');
    const used = backups.filter((b) => b.status !== 'failed').length;
    const totalSize = ready.reduce((sum, b) => sum + (b.sizeBytes || 0), 0);
    const full = used >= DEMO_BACKUP_SLOTS;

    const create = () => {
        if (full || creating) return;

        const id = `bk_demo_${used + 1}`;
        const entry = {
            id,
            name: `manual-${new Date().toISOString().slice(0, 16).replace(/[:T-]/g, '')}.tar.gz`,
            status: 'creating',
            type: 'manual',
            sizeBytes: 0,
            createdAt: new Date().toISOString(),
        };

        setBackups((b) => [entry, ...b]);
        setCreating(true);

        const finish = () => {
            setCreating(false);
            setBackups((b) =>
                b.map((x) => (x.id === id ? { ...x, status: 'ready', sizeBytes: 42.4 * 1024 * 1024 } : x))
            );
            toast.success('Demo backup created');
        };

        // A short delay is the honest way to show a pending state.
        if (reduced) finish();
        else timerRef.current = setTimeout(finish, 1100);
    };

    const restore = (backup) => {
        setRestoreTarget(null);
        toast.success(`${backup.name} restored in the demo`);
    };

    const remove = (backup) => {
        setDeleteTarget(null);
        setBackups((b) => b.filter((x) => x.id !== backup.id));
        toast.success(`${backup.name} deleted from the demo`);
    };

    return (
        <div className="flex flex-col gap-5">
            {/* ---- hero ---- */}
            <section className="relative overflow-hidden rounded-2xl border border-hairline bg-card">
                <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0"
                    style={{ backgroundImage: 'radial-gradient(520px circle at 12% 0%, rgba(255,255,255,0.06), transparent 60%)' }}
                />
                <div className="relative flex flex-wrap items-center gap-5 p-5 sm:p-6">
                    <div className="min-w-0 flex-1">
                        <h3 className="text-[1.35rem] font-extrabold tracking-tight">Backups</h3>
                        <p className="mt-1 max-w-lg text-[0.85rem] leading-relaxed text-ink-secondary">
                            Snapshots of the files and environment of your server. Restore rolls the project back to
                            the moment the snapshot was taken.
                        </p>
                        <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[0.7rem] font-semibold text-amber-300">
                            Simulated — nothing is uploaded or deleted
                        </span>
                    </div>

                    <SlotsRing used={used} total={DEMO_BACKUP_SLOTS} />

                    <button type="button" onClick={create} disabled={full || creating} className={primaryBtn}>
                        {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                        {creating ? 'Creating…' : full ? 'Slots full' : 'Create backup'}
                    </button>
                </div>

                {/* stats strip */}
                <div className="relative grid grid-cols-2 gap-2 border-t border-hairline p-3 sm:grid-cols-4 sm:p-4">
                    {[
                        ['Snapshots', String(ready.length), `${DEMO_BACKUP_SLOTS} available`],
                        ['Total size', fmtBytes(totalSize), 'compressed archives'],
                        ['Latest', ready[0] ? timeAgo(ready[0].createdAt, now) : '—', 'most recent ready'],
                        ['Auto-backup', 'Daily', 'keeps the last 7'],
                    ].map(([label, value, sub]) => (
                        <div key={label} className="flex-1 rounded-xl border border-hairline bg-veil/30 px-4 py-3">
                            <p className="text-[0.68rem] font-bold tracking-[0.12em] text-ink-muted uppercase">
                                {label}
                            </p>
                            <p className="mt-1 font-mono text-[1.05rem] font-extrabold tabular-nums">{value}</p>
                            <p className="mt-0.5 text-[0.72rem] text-ink-secondary">{sub}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* ---- restore hint ---- */}
            <p className="flex items-start gap-2 rounded-xl border border-hairline bg-white/[0.02] px-4 py-3 text-[0.78rem] leading-relaxed text-ink-secondary">
                <History size={14} className="mt-0.5 shrink-0 text-amber-300" aria-hidden="true" />
                <span>
                    Restoring a snapshot replaces the server&apos;s current files. In this demo it only moves the
                    list below — no container is touched.
                </span>
            </p>

            {/* ---- snapshot list ---- */}
            <div className="flex flex-col gap-3">
                {backups.map((backup) => {
                    const failed = backup.status === 'failed';
                    const busy = backup.status === 'creating';
                    const open = expanded === backup.id;

                    return (
                        <article
                            key={backup.id}
                            className={cn(
                                'relative flex flex-col gap-3 rounded-2xl border bg-card p-4 transition duration-150 hover:border-hairline-hover sm:flex-row sm:flex-wrap sm:items-center sm:px-5',
                                failed ? 'border-red-500/25' : 'border-hairline'
                            )}
                        >
                            <span
                                aria-hidden="true"
                                className={cn(
                                    'absolute top-5 bottom-5 left-0 w-px rounded-full',
                                    failed ? 'bg-red-500/30' : busy ? 'bg-amber-500/30' : 'bg-white/10'
                                )}
                            />

                            <span
                                className={cn(
                                    'ml-1 flex size-10 shrink-0 items-center justify-center rounded-xl border',
                                    failed
                                        ? 'border-red-500/25 bg-red-500/10 text-red-300'
                                        : busy
                                          ? 'border-amber-500/25 bg-amber-500/10 text-amber-300'
                                          : 'border-hairline bg-veil text-ink-secondary'
                                )}
                            >
                                {busy ? <Loader2 size={18} className="animate-spin" /> : <Database size={18} />}
                            </span>

                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setExpanded(open ? null : backup.id)}
                                        aria-expanded={open}
                                        className="truncate font-mono text-[0.88rem] font-bold transition hover:text-foreground"
                                    >
                                        {backup.name}
                                    </button>
                                    <TypeChip type={backup.type} />
                                    <StatusChip status={backup.status} />
                                </div>
                                <p className="mt-1 truncate font-mono text-[0.72rem] text-ink-muted">
                                    {failed ? '0 B' : fmtBytes(backup.sizeBytes)} · {timeAgo(backup.createdAt, now)}
                                    {failed && backup.error && (
                                        <span className="text-red-300"> · {backup.error}</span>
                                    )}
                                </p>

                                {open && (
                                    <dl className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-hairline bg-white/[0.02] p-3 text-[0.78rem] sm:grid-cols-3">
                                        <div>
                                            <dt className="text-ink-muted">Created</dt>
                                            <dd className="mt-0.5 font-semibold">{fmtDate(backup.createdAt)}</dd>
                                        </div>
                                        <div>
                                            <dt className="text-ink-muted">Archive size</dt>
                                            <dd className="mt-0.5 font-mono font-semibold">
                                                {failed ? '—' : fmtBytes(backup.sizeBytes)}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-ink-muted">Contents</dt>
                                            <dd className="mt-0.5 font-semibold">
                                                {failed ? 'partial' : 'files + environment'}
                                            </dd>
                                        </div>
                                    </dl>
                                )}
                            </div>

                            <div className="flex shrink-0 items-center gap-2 max-sm:self-end sm:ml-auto">
                                <button
                                    type="button"
                                    onClick={() =>
                                        toast.info('Downloads are disabled in the demo — snapshots are local fixtures.')
                                    }
                                    title="Downloads are disabled in the demo"
                                    className={rowBtn}
                                >
                                    <Download size={14} />
                                    <span className="hidden sm:inline">Download</span>
                                </button>
                                <button
                                    type="button"
                                    disabled={backup.status !== 'ready'}
                                    onClick={() => setRestoreTarget(backup)}
                                    className={rowBtn}
                                >
                                    <History size={14} />
                                    Restore
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setDeleteTarget(backup)}
                                    aria-label={`Delete ${backup.name}`}
                                    className="inline-flex size-8 items-center justify-center rounded-full border border-hairline text-ink-muted transition hover:border-red-500/50 hover:text-red-400"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        </article>
                    );
                })}
            </div>

            {/* ---- confirmations ---- */}
            <ConfirmModal
                open={!!restoreTarget}
                onClose={() => setRestoreTarget(null)}
                title="Restore backup"
                description="The server's current files will be replaced with this snapshot. Files created after the snapshot are lost."
                confirmLabel="Restore"
                onConfirm={() => restore(restoreTarget)}
            >
                <p className="text-[0.85rem] text-ink-secondary">
                    Snapshot: <span className="font-mono font-bold text-foreground">{restoreTarget?.name}</span>{' '}
                    ({restoreTarget && fmtDate(restoreTarget.createdAt)})
                </p>
                <p className="text-[0.8rem] text-ink-muted">
                    Demo only — the container is not contacted.
                </p>
            </ConfirmModal>

            <ConfirmModal
                open={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                title="Delete backup"
                description="This snapshot will be permanently removed. The server itself is not affected."
                confirmLabel="Delete backup"
                onConfirm={() => remove(deleteTarget)}
            >
                <p className="text-[0.85rem] text-ink-secondary">
                    Snapshot: <span className="font-mono font-bold text-foreground">{deleteTarget?.name}</span>
                </p>
                <p className="text-[0.8rem] text-ink-muted">
                    Removed from this browser tab only.
                </p>
            </ConfirmModal>
        </div>
    );
}