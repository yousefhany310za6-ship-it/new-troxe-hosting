import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  Check,
  ChevronRight,
  Clock,
  Crown,
  Database,
  History,
  Loader2,
  Lock,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Select } from '@/components/ui/select.jsx';

const fmtBytes = (bytes) => {
  const v0 = Number(bytes) || 0;
  if (v0 <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let v = v0;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
};

const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');

function timeAgo(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}

const STATUS_CHIP = {
  ready: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
  pending: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
  creating: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
  failed: 'border-red-500/25 bg-red-500/10 text-red-300',
  error: 'border-red-500/25 bg-red-500/10 text-red-300',
};

function StatusChip({ status }) {
  const s = String(status ?? '').toLowerCase();
  const busy = s === 'pending' || s === 'creating';
  const failed = s === 'failed' || s === 'error';
  const label = s === 'ready' ? 'Ready' : busy ? 'Creating…' : failed ? 'Failed' : s || 'Unknown';
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[0.7rem] font-semibold',
        STATUS_CHIP[s] ?? 'border-hairline bg-veil text-ink-secondary',
      )}
    >
      {busy ? (
        <Loader2 size={11} className="animate-spin" />
      ) : (
        <span className={cn('size-1.5 rounded-full', s === 'ready' ? 'bg-emerald-500' : failed ? 'bg-red-500' : 'bg-zinc-500')} />
      )}
      {label}
    </span>
  );
}

function TypeChip({ type }) {
  const auto = type === 'auto';
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-hairline bg-veil px-2 py-0.5 text-[0.68rem] font-semibold text-ink-secondary">
      {auto ? <Sparkles size={11} className="text-violet-300" /> : <Clock size={11} />}
      {auto ? 'Automatic' : 'Manual'}
    </span>
  );
}

function SlotsBar({ used, slots }) {
  const pct = slots > 0 ? Math.min(100, (used / slots) * 100) : 0;
  return (
    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/[0.07]">
      <div className="h-full rounded-full bg-white/80 transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * Backups tab: automatic-backup settings, manual snapshots and the snapshot
 * list. When the owner's plan has no backup slots the creation controls are
 * replaced by a prominent locked panel with an upgrade path.
 */
export default function ServerBackups({
  server,
  backups,
  quota,
  creating,
  onCreateBackup,
  onToggleAuto,
  onRetain,
  onRestore,
  onDelete,
}) {
  const list = backups ?? [];
  const slots = quota?.slots;
  const locked = quota != null && (slots ?? 0) <= 0;
  const used = quota?.used ?? list.length;
  const full = slots != null && slots > 0 && used >= slots;
  const totalBytes = list.reduce((a, b) => a + (Number(b.sizeBytes) || 0), 0);

  return (
    <div className="flex flex-col gap-5">
      {/* ---- header: usage + create ---- */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-[1.05rem] font-bold">Snapshots</h2>
          <p className="mt-0.5 text-[0.8rem] text-ink-secondary">
            {quota == null ? (
              'Full copies of your server files — restore any of them in one click.'
            ) : locked ? (
              <>Backups are not included in the <span className="font-semibold capitalize text-ink">{quota.planName ?? 'current'} plan</span>.</>
            ) : (
              <>
                <span className="font-semibold text-ink tabular-nums">
                  {used} of {slots}
                </span>{' '}
                slots used · {fmtBytes(totalBytes)} stored
              </>
            )}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {slots != null && slots > 0 && (
            <div className="hidden items-center gap-2 sm:flex">
              <SlotsBar used={used} slots={slots} />
              <span className="font-mono text-[0.72rem] text-ink-muted tabular-nums">
                {used}/{slots}
              </span>
            </div>
          )}
          {!locked && (
            <button
              type="button"
              onClick={onCreateBackup}
              disabled={creating || full}
              title={full ? 'All backup slots are used — delete one to make room' : 'Take a snapshot now'}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-[0.8rem] font-bold text-black transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="size-4" /> {creating ? 'Creating…' : full ? 'Slots full' : 'Create backup'}
            </button>
          )}
        </div>
      </div>

      {/* ---- locked hero ---- */}
      {locked && (
        <section className="relative overflow-hidden rounded-2xl border border-amber-500/25 bg-card p-6 text-center sm:p-10">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{ backgroundImage: 'radial-gradient(500px circle at 50% 0%, rgba(245,158,11,0.12), transparent 65%)' }}
          />
          <div className="relative flex flex-col items-center">
            <span className="flex size-16 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-300">
              <Lock className="size-7" />
            </span>
            <h3 className="mt-4 text-[1.15rem] font-extrabold">Backups are locked</h3>
            <p className="mt-1.5 max-w-md text-[0.85rem] leading-relaxed text-ink-secondary">
              The <span className="font-semibold capitalize text-ink">{quota.planName ?? 'current'} plan</span> doesn&apos;t include
              backup slots. Upgrade to protect {server.name} with manual snapshots and daily automatic backups.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[0.76rem]">
              {[
                ['Starter', '2 slots'],
                ['Pro', '3 slots'],
                ['Super', '10 slots'],
              ].map(([plan, what]) => (
                <span key={plan} className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-veil px-3 py-1 font-semibold text-ink-secondary">
                  <Check size={12} className="text-emerald-400" /> {plan} · {what}
                </span>
              ))}
            </div>
            <Link
              to="/pricing"
              className="group mt-5 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[0.85rem] font-bold text-black transition hover:bg-gray-200"
            >
              <Crown className="size-4" /> Upgrade plan
              <ChevronRight size={15} className="transition group-hover:translate-x-0.5" />
            </Link>
          </div>
        </section>
      )}

      {/* ---- automatic backups ---- */}
      {!locked && (
        <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-hairline bg-card p-5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-hairline bg-veil text-ink-secondary">
            <Database className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[0.92rem] font-bold">Automatic backups</p>
            <p className="mt-0.5 text-[0.8rem] text-ink-secondary">
              {server.autoBackup ? `Daily snapshot, keeping the newest ${server.autoBackupRetain ?? 7}.` : 'Off — only manual snapshots.'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!!server.autoBackup}
            aria-label="Toggle automatic backups"
            onClick={() => onToggleAuto(!server.autoBackup)}
            className={cn(
              'relative h-7 w-12 shrink-0 rounded-full border transition',
              server.autoBackup ? 'border-emerald-500/40 bg-emerald-500/30' : 'border-hairline bg-white/[0.07]',
            )}
          >
            <span
              className={cn(
                'absolute top-1/2 size-5 -translate-y-1/2 rounded-full bg-white shadow transition-all',
                server.autoBackup ? 'left-[22px]' : 'left-[3px]',
              )}
            />
          </button>
          {server.autoBackup && (
            <span className="flex items-center gap-2 text-[0.85rem] font-semibold">
              Keep
              <Select
                ariaLabel="Backup retention"
                value={String(server.autoBackupRetain ?? 7)}
                onChange={(v) => onRetain(Number(v))}
                options={[1, 3, 7, 14, 30].map((n) => ({ value: String(n), label: `${n} snapshot${n === 1 ? '' : 's'}` }))}
                buttonClassName="px-2.5 py-1.5 font-mono text-[0.82rem]"
              />
            </span>
          )}
        </section>
      )}

      {/* ---- snapshot list ---- */}
      {list.length === 0 ? (
        !locked && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-hairline bg-card px-4 py-14 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl border border-hairline bg-veil">
              <Archive className="size-6 text-ink-muted" />
            </span>
            <div>
              <p className="text-[0.95rem] font-bold">No snapshots yet</p>
              <p className="mt-1 max-w-xs text-[0.82rem] text-ink-secondary">
                Take your first snapshot — if anything breaks you can roll the whole server back in one click.
              </p>
            </div>
            <button
              type="button"
              onClick={onCreateBackup}
              disabled={creating}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-[0.8rem] font-bold text-black transition hover:bg-gray-200 disabled:opacity-40"
            >
              <Plus className="size-4" /> Create first backup
            </button>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-2.5">
          <p className="px-1 text-[0.72rem] font-semibold tracking-[0.12em] text-ink-muted uppercase">
            {list.length} snapshot{list.length === 1 ? '' : 's'}
          </p>
          {list.map((backup) => {
            const failed = backup.status === 'failed' || backup.status === 'error';
            const busy = backup.status === 'pending' || backup.status === 'creating';
            return (
              <div
                key={backup.id}
                className={cn(
                  'flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:flex-wrap sm:items-center sm:px-5',
                  failed ? 'border-red-500/25' : 'border-hairline',
                )}
              >
                <span
                  className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-xl border',
                    failed
                      ? 'border-red-500/25 bg-red-500/10 text-red-300'
                      : busy
                        ? 'border-amber-500/25 bg-amber-500/10 text-amber-300'
                        : 'border-hairline bg-veil text-ink-secondary',
                  )}
                >
                  {busy ? <Loader2 size={18} className="animate-spin" /> : <Database size={18} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-mono text-[0.88rem] font-bold">{backup.name}</p>
                    <TypeChip type={backup.type} />
                    <StatusChip status={backup.status} />
                  </div>
                  <p className="mt-1 truncate font-mono text-[0.72rem] text-ink-muted" title={fmtDateTime(backup.createdAt)}>
                    {fmtBytes(backup.sizeBytes)} · {timeAgo(backup.createdAt)}
                    {failed && backup.error ? <span className="text-red-300"> · {String(backup.error).slice(0, 160)}</span> : null}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2 max-sm:self-end sm:ml-auto">
                  <button
                    type="button"
                    onClick={() => onRestore(backup)}
                    disabled={backup.status !== 'ready'}
                    title="Restore this snapshot"
                    className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-veil px-3.5 py-1.5 text-[0.78rem] font-semibold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <History size={14} /> Restore
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${backup.name}`}
                    title="Delete snapshot"
                    onClick={() => onDelete(backup)}
                    className="inline-flex size-8 items-center justify-center rounded-full border border-hairline text-ink-muted transition hover:border-red-500/50 hover:text-red-400"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ---- restore hint ---- */}
      {list.some((b) => b.status === 'ready') && (
        <p className="flex items-start gap-2 rounded-xl border border-hairline bg-white/[0.02] px-4 py-3 text-[0.78rem] leading-relaxed text-ink-secondary">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-300" />
          Restoring replaces the server&apos;s current files with the snapshot. Files created after it are lost — take a
          fresh backup first if they matter.
          <button type="button" onClick={() => onCreateBackup()} disabled={creating || locked || full} className="ml-auto inline-flex shrink-0 items-center gap-1 font-semibold text-ink transition hover:text-foreground disabled:opacity-40">
            <RotateCcw size={12} /> Back up now
          </button>
        </p>
      )}
    </div>
  );
}
