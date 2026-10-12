import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  Check,
  ChevronRight,
  Clock,
  Crown,
  Database,
  Download,
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

/**
 * Ring showing slots used. Monochrome track, white fill — the ring is the
 * whole "protection at a glance" story: how full the shelf is, not a chart.
 */
function SlotsRing({ used, slots, locked = false }) {
  const total = slots > 0 ? slots : 1;
  const pct = Math.max(0, Math.min(1, used / total));
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-[86px] shrink-0" role="img" aria-label={`${used} of ${slots} backup slots used`}>
      <svg viewBox="0 0 80 80" className="size-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="currentColor" strokeWidth="7" className="text-white/[0.08]" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className={cn('transition-[stroke-dashoffset] duration-700', locked ? 'text-amber-400/70' : 'text-white')}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-[1.15rem] leading-none font-extrabold tabular-nums">
          {used}
          <span className="text-[0.8rem] font-bold text-ink-muted">/{slots}</span>
        </span>
        <span className="mt-0.5 text-[0.6rem] font-bold tracking-[0.12em] text-ink-muted uppercase">slots</span>
      </div>
    </div>
  );
}

/** A labelled number in the hero strip. */
function Stat({ label, value, sub }) {
  return (
    <div className="flex-1 rounded-xl border border-hairline bg-veil/30 px-4 py-3">
      <p className="text-[0.68rem] font-bold tracking-[0.12em] text-ink-muted uppercase">{label}</p>
      <p className="mt-1 font-mono text-[1.05rem] font-extrabold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-[0.72rem] text-ink-secondary">{sub}</p>}
    </div>
  );
}

/**
 * Backups tab: protection status at a glance, automatic-snapshot settings and
 * the snapshot timeline. When the owner's plan has no backup slots the
 * creation controls are replaced by a prominent locked panel with an upgrade
 * path.
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
  onDownload,
  downloadingId,
}) {
  const list = backups ?? [];
  const slots = quota?.slots;
  const locked = quota != null && (slots ?? 0) <= 0;
  const used = quota?.used ?? list.length;
  const full = slots != null && slots > 0 && used >= slots;
  const totalBytes = list.reduce((a, b) => a + (Number(b.sizeBytes) || 0), 0);

  const ready = list.filter((b) => b.status === 'ready');
  const autos = ready.filter((b) => b.type === 'auto');
  const manuals = ready.filter((b) => b.type !== 'auto');
  const newest = ready.reduce((a, b) => (!a || new Date(b.createdAt) > new Date(a.createdAt) ? b : a), null);
  const oldest = ready.reduce((a, b) => (!a || new Date(b.createdAt) < new Date(a.createdAt) ? b : a), null);

  return (
    <div className="flex flex-col gap-5">
      {/* ============================ protection hero ============================ */}
      <section className="relative overflow-hidden rounded-2xl border border-hairline bg-card">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: 'radial-gradient(520px circle at 12% 0%, rgba(255,255,255,0.06), transparent 60%)' }}
        />
        <div className="relative flex flex-wrap items-center gap-5 p-5 sm:p-6">
          {quota != null && !locked && <SlotsRing used={used} slots={slots} />}
          {locked && (
            <span className="flex size-[86px] shrink-0 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-300">
              <Lock className="size-8" />
            </span>
          )}
          <div className="min-w-0 flex-1 basis-56">
            <h2 className="text-[1.35rem] font-extrabold tracking-tight">
              {locked ? 'Backups are locked' : ready.length === 0 ? 'Not protected yet' : 'Protected'}
            </h2>
            <p className="mt-1 max-w-lg text-[0.85rem] leading-relaxed text-ink-secondary">
              {quota == null ? (
                'Full copies of your server files — restore any of them in one click.'
              ) : locked ? (
                <>
                  The <span className="font-semibold capitalize text-ink">{quota.planName ?? 'current'} plan</span> doesn&apos;t include
                  backup slots. Upgrade to protect {server.name} with manual snapshots and daily automatic backups.
                </>
              ) : ready.length === 0 ? (
                <>You have {slots} slots and none used. Take a snapshot — if anything breaks you can roll the whole server back in one click.</>
              ) : (
                <>
                  <span className="font-semibold text-ink tabular-nums">{ready.length}</span> snapshot{ready.length === 1 ? '' : 's'} ready
                  ({manuals.length} manual · {autos.length} automatic) ·{' '}
                  <span className="font-semibold text-ink tabular-nums">{fmtBytes(totalBytes)}</span> stored.
                  {oldest && newest && oldest.id !== newest.id && <> Oldest {timeAgo(oldest.createdAt)}, newest {timeAgo(newest.createdAt)}.</>}
                  {oldest && newest && oldest.id === newest.id && <> Taken {timeAgo(newest.createdAt)}.</>}
                </>
              )}
            </p>
          </div>
          {!locked && (
            <div className="flex shrink-0 items-center gap-3">
              {slots != null && slots > 0 && (
                <span className="hidden font-mono text-[0.72rem] text-ink-muted tabular-nums sm:inline">
                  {used}/{slots} slots
                </span>
              )}
              <button
                type="button"
                onClick={onCreateBackup}
                disabled={creating || full}
                title={full ? 'All backup slots are used — delete one to make room' : 'Take a snapshot now'}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2.5 text-[0.82rem] font-bold text-black transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                {creating ? 'Creating…' : full ? 'Slots full' : 'Create backup'}
              </button>
            </div>
          )}
        </div>

        {/* stats strip */}
        {quota != null && !locked && (
          <div className="relative grid grid-cols-2 gap-2 border-t border-hairline p-3 sm:grid-cols-4 sm:p-4">
            <Stat label="Stored" value={fmtBytes(totalBytes)} sub={ready.length === 0 ? 'nothing yet' : `${ready.length} snapshot${ready.length === 1 ? '' : 's'}`} />
            <Stat label="Manual" value={String(manuals.length)} sub="taken by you" />
            <Stat label="Automatic" value={String(autos.length)} sub={server.autoBackup ? `keeping ${server.autoBackupRetain ?? 7}` : 'off'} />
            <Stat label="Last snapshot" value={newest ? timeAgo(newest.createdAt) : '—'} sub={newest ? fmtDateTime(newest.createdAt) : 'never'} />
          </div>
        )}
      </section>

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
            <h3 className="mt-4 text-[1.15rem] font-extrabold">Protect {server.name}</h3>
            <p className="mt-1.5 max-w-md text-[0.85rem] leading-relaxed text-ink-secondary">
              Manual snapshots and daily automatic backups are available from the Starter plan up.
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
          <div className="min-w-0 flex-1 basis-64">
            <p className="flex items-center gap-2 text-[0.92rem] font-bold">
              Automatic snapshots
              {server.autoBackup && (
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[0.68rem] font-bold text-emerald-300">ON</span>
              )}
            </p>
            <p className="mt-0.5 text-[0.8rem] leading-relaxed text-ink-secondary">
              {server.autoBackup
                ? `The platform checks for a due snapshot all day long and takes one at most once every 24 hours, keeping the newest ${server.autoBackupRetain ?? 7}. Suspended servers are skipped.`
                : 'Off — only manual snapshots. Turn this on for daily protection without thinking about it.'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
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
          </div>
        </section>
      )}

      {/* ============================ snapshot timeline ============================ */}
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
              className="inline-flex items-center gap-1 rounded-full bg-white px-4 py-2 text-[0.8rem] font-bold text-black transition hover:bg-gray-200 disabled:opacity-40"
            >
              <Plus className="size-4" /> Create first backup
            </button>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-2.5">
          <p className="flex items-center gap-2 px-1 text-[0.72rem] font-bold tracking-[0.14em] text-ink-muted uppercase">
            <History size={13} />
            {list.length} snapshot{list.length === 1 ? '' : 's'} · newest first
          </p>
          {list.map((backup) => {
            const failed = backup.status === 'failed' || backup.status === 'error';
            const busy = backup.status === 'pending' || backup.status === 'creating';
            return (
              <div
                key={backup.id}
                className={cn(
                  'relative flex flex-col gap-3 rounded-2xl border bg-card p-4 transition duration-150 hover:border-hairline-hover sm:flex-row sm:flex-wrap sm:items-center sm:px-5',
                  failed ? 'border-red-500/25' : 'border-hairline',
                )}
              >
                {/* timeline rail */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute top-5 bottom-5 left-0 w-px rounded-full',
                    failed ? 'bg-red-500/30' : busy ? 'bg-amber-500/30' : 'bg-white/10',
                  )}
                />
                <span
                  className={cn(
                    'ml-1 flex size-10 shrink-0 items-center justify-center rounded-xl border',
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
                    onClick={() => onDownload(backup)}
                    disabled={backup.status !== 'ready' || !!downloadingId}
                    title={backup.status === 'ready' ? 'Download this snapshot' : 'Available once the snapshot is ready'}
                    className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-veil px-3.5 py-1.5 text-[0.78rem] font-semibold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {downloadingId === backup.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download
                  </button>
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
