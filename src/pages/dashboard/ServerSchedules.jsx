import { useEffect, useState } from 'react';
import { CalendarClock, History, Loader2, Plus, Power, Trash2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { ConfirmModal } from '@/components/ui/confirm-modal.jsx';
import {
  useCreateSchedule,
  useDeleteSchedule,
  usePreviewCron,
  useSchedules,
  useUpdateSchedule,
} from '@/hooks/useQueries.jsx';

const ACTIONS = [
  { value: 'backup', label: 'Take a backup', hint: 'A snapshot like a manual one. Respects your backup slots.' },
  { value: 'start', label: 'Start the server', hint: 'Only if it is stopped — otherwise skipped.' },
  { value: 'stop', label: 'Stop the server', hint: 'Only if it is running — otherwise skipped.' },
  { value: 'restart', label: 'Restart the server', hint: 'Only if it is running — otherwise skipped.' },
];

const PRESETS = [
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Daily at midnight', cron: '0 0 * * *' },
  { label: 'Daily at 04:00', cron: '0 4 * * *' },
  { label: 'Weekly (Monday)', cron: '0 0 * * 1' },
  { label: 'Monthly (1st)', cron: '0 0 1 * *' },
  { label: 'Every 5 minutes', cron: '*/5 * * * *' },
];

const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');

function StatusLine({ s }) {
  if (!s.lastRunAt) return <span className="text-ink-muted">Never ran yet</span>;
  const tone = s.lastStatus === 'ok' ? 'text-emerald-300' : s.lastStatus === 'skipped' ? 'text-ink-secondary' : 'text-red-300';
  return (
    <span className={tone}>
      {s.lastStatus === 'ok' ? 'Ran fine' : s.lastStatus === 'skipped' ? 'Skipped' : 'Failed'} · {fmtDateTime(s.lastRunAt)}
      {s.lastStatus === 'failed' && s.lastError ? ` — ${s.lastError}` : ''}
      {s.lastStatus === 'skipped' && s.lastError ? ` (${s.lastError})` : ''}
    </span>
  );
}

/**
 * Schedules tab. Creating, editing and deleting need `schedule.manage`;
 * anyone with `server.view` reads the list. Times are evaluated in UTC by the
 * platform and shown here in local time.
 */
export default function ServerSchedules({ server, canManage }) {
  const { data, isLoading, error, refetch } = useSchedules(server.id);
  const create = useCreateSchedule(server.id);
  const update = useUpdateSchedule(server.id);
  const remove = useDeleteSchedule(server.id);
  const preview = usePreviewCron(server.id);

  const [form, setForm] = useState(null); // { id?, name, cron, action, enabled }
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [formError, setFormError] = useState(null);
  const [runs, setRuns] = useState(null);

  const rows = data ?? [];
  const busy = create.isPending || update.isPending;

  useEffect(() => {
    if (!form) return setRuns(null);
    const t = setTimeout(async () => {
      try {
        const res = await preview.mutateAsync(form.cron);
        setRuns(res?.runs ?? []);
        setFormError(null);
      } catch (err) {
        setRuns(null);
        setFormError(err.message);
      }
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.cron]);

  const openNew = () => {
    setFormError(null);
    setRuns(null);
    setForm({ id: null, name: '', cron: '0 4 * * *', action: 'backup', enabled: true });
  };

  const openEdit = (s) => {
    setFormError(null);
    setRuns(null);
    setForm({ id: s.id, name: s.name, cron: s.cron, action: s.action, enabled: s.enabled });
  };

  const save = async () => {
    setFormError(null);
    if (!form.name.trim()) return setFormError('Give the schedule a name.');
    if (!form.cron.trim()) return setFormError('Enter a cron expression.');
    try {
      if (form.id) {
        await update.mutateAsync({ scheduleId: form.id, name: form.name.trim(), cron: form.cron.trim(), action: form.action, enabled: form.enabled });
      } else {
        await create.mutateAsync({ name: form.name.trim(), cron: form.cron.trim(), action: form.action, enabled: form.enabled });
      }
      setForm(null);
    } catch (err) {
      setFormError(err.message);
    }
  };

  const toggle = async (s) => {
    try {
      await update.mutateAsync({ scheduleId: s.id, enabled: !s.enabled });
    } catch (err) {
      setFormError(err.message);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-2xl border border-hairline bg-card p-5 sm:p-6">
        <header className="flex flex-wrap items-center gap-2">
          <CalendarClock className="size-4 text-ink-muted" aria-hidden="true" />
          <h2 className="flex-1 text-[0.95rem] font-semibold">Scheduled tasks</h2>
          {canManage && (
            <button
              type="button"
              onClick={openNew}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-[0.8rem] font-bold text-black transition hover:bg-white/90"
            >
              <Plus className="size-4" aria-hidden="true" /> New schedule
            </button>
          )}
        </header>
        <p className="mt-1.5 max-w-2xl text-[0.82rem] leading-relaxed text-ink-secondary">
          Backups and power actions on a cron timetable, evaluated in UTC. A missed run fires once when the platform
          is back — never a pile of catch-ups. Runs are recorded as the platform, not as you.
        </p>

        {formError && !form && (
          <p className="mt-3 text-[0.8rem] text-red-300" role="alert">{formError}</p>
        )}

        {isLoading ? (
          <div className="mt-4 flex flex-col gap-2" aria-busy="true">
            {[0, 1].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-white/[0.04]" />)}
          </div>
        ) : error ? (
          <p className="mt-4 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3 text-[0.84rem] text-red-200" role="alert">
            Could not load schedules: {error.message}
          </p>
        ) : rows.length === 0 && !form ? (
          <div className="mt-4 rounded-xl border border-dashed border-hairline px-4 py-10 text-center">
            <CalendarClock className="mx-auto size-7 text-ink-muted" aria-hidden="true" />
            <p className="mt-3 text-[0.92rem] font-bold">No schedules yet</p>
            <p className="mx-auto mt-1 max-w-sm text-[0.82rem] text-ink-secondary">
              {canManage ? 'Automate a nightly backup or a weekly restart — it takes a minute to set up.' : 'The owner has not set up any scheduled tasks.'}
            </p>
          </div>
        ) : (
          <ul className="mt-4 flex flex-col gap-2.5">
            {rows.map((s) => (
              <li
                key={s.id}
                className={cn(
                  'flex flex-col gap-3 rounded-xl border bg-veil/40 p-4 sm:flex-row sm:flex-wrap sm:items-center',
                  s.enabled ? 'border-hairline' : 'border-hairline opacity-60'
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-[0.9rem] font-bold">{s.name}</p>
                    <span className="rounded-full border border-hairline bg-veil px-2 py-0.5 text-[0.68rem] font-bold text-ink-secondary">
                      {ACTIONS.find((a) => a.value === s.action)?.label ?? s.action}
                    </span>
                    {!s.enabled && (
                      <span className="rounded-full border border-hairline bg-veil px-2 py-0.5 text-[0.68rem] font-bold text-ink-muted">
                        Paused
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-[0.72rem] text-ink-muted" dir="ltr">
                    {s.cron} (UTC){s.nextRunAt && s.enabled ? <> · next {fmtDateTime(s.nextRunAt)}</> : null}
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-[0.76rem]">
                    <History size={12} className="shrink-0 text-ink-muted" aria-hidden="true" />
                    <StatusLine s={s} />
                  </p>
                </div>
                {canManage && (
                  <div className="flex shrink-0 items-center gap-2 max-sm:self-end">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!!s.enabled}
                      aria-label={s.enabled ? `Pause ${s.name}` : `Resume ${s.name}`}
                      onClick={() => toggle(s)}
                      className={cn(
                        'relative h-6 w-11 shrink-0 rounded-full border transition',
                        s.enabled ? 'border-emerald-500/40 bg-emerald-500/30' : 'border-hairline bg-white/[0.07]'
                      )}
                    >
                      <span className={cn('absolute top-1/2 size-4 -translate-y-1/2 rounded-full bg-white shadow transition-all', s.enabled ? 'left-[22px]' : 'left-[3px]')} />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(s)}
                      className="rounded-full border border-hairline px-3.5 py-1.5 text-[0.76rem] font-bold text-ink-secondary transition hover:text-foreground"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(s)}
                      aria-label={`Delete ${s.name}`}
                      className="inline-flex size-8 items-center justify-center rounded-full border border-hairline text-ink-muted transition hover:border-red-500/50 hover:text-red-400"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {form && (
          <div className="mt-4 rounded-xl border border-hairline bg-veil/40 p-4">
            <h3 className="text-[0.88rem] font-bold">{form.id ? 'Edit schedule' : 'New schedule'}</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-[0.8rem] font-semibold text-ink-secondary">Name</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  maxLength={64}
                  placeholder="Nightly backup"
                  className="w-full rounded-xl border border-hairline bg-white/10 px-4 py-2.5 text-[0.86rem] text-foreground placeholder-ink-muted focus:border-primary focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[0.8rem] font-semibold text-ink-secondary">Action</span>
                <select
                  value={form.action}
                  onChange={(e) => setForm({ ...form, action: e.target.value })}
                  className="w-full rounded-xl border border-hairline bg-white/10 px-4 py-2.5 text-[0.86rem] text-foreground focus:border-primary focus:outline-none"
                >
                  {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </label>
            </div>
            <p className="mt-1.5 text-[0.76rem] text-ink-muted">
              {ACTIONS.find((a) => a.value === form.action)?.hint}
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.cron}
                  type="button"
                  onClick={() => setForm({ ...form, cron: p.cron })}
                  aria-pressed={form.cron === p.cron}
                  className={cn(
                    'rounded-full border px-3 py-1 text-[0.74rem] font-bold transition',
                    form.cron === p.cron ? 'border-white/40 bg-white/10 text-foreground' : 'border-hairline text-ink-secondary hover:text-foreground'
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <label className="mt-3 block">
              <span className="mb-1.5 block text-[0.8rem] font-semibold text-ink-secondary">
                Cron expression <span className="font-normal text-ink-muted">(minute hour day month weekday, UTC)</span>
              </span>
              <input
                value={form.cron}
                onChange={(e) => setForm({ ...form, cron: e.target.value })}
                dir="ltr"
                maxLength={64}
                placeholder="0 4 * * *"
                className="w-full rounded-xl border border-hairline bg-white/10 px-4 py-2.5 font-mono text-[0.86rem] text-foreground placeholder-ink-muted focus:border-primary focus:outline-none"
              />
            </label>

            <div className="mt-2 min-h-[2rem] text-[0.78rem]">
              {preview.isPending ? (
                <span className="inline-flex items-center gap-1.5 text-ink-muted">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Checking…
                </span>
              ) : runs ? (
                <p className="text-ink-secondary">
                  Next runs: {runs.map((r) => new Date(r).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })).join(' · ') || 'none in the next year'}
                </p>
              ) : formError ? (
                <p className="text-red-300" role="alert">{formError}</p>
              ) : null}
            </div>

            <label className="mt-1 flex cursor-pointer items-center gap-2 text-[0.84rem] font-semibold">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                className="size-4 accent-white"
              />
              Enabled
            </label>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => { setForm(null); setFormError(null); }}
                className="rounded-full border border-hairline px-4 py-2 text-[0.82rem] font-bold text-ink-secondary transition hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={save}
                className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[0.82rem] font-bold text-black transition hover:bg-white/90 disabled:opacity-50"
              >
                {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {form.id ? 'Save schedule' : 'Create schedule'}
              </button>
            </div>
          </div>
        )}

        <button type="button" onClick={() => refetch()} className="mt-3 text-[0.78rem] font-bold text-ink-secondary underline decoration-dotted hover:text-foreground">
          Refresh list
        </button>
      </section>

      <div className="flex items-start gap-2 rounded-xl border border-hairline bg-white/[0.02] px-4 py-3 text-[0.78rem] leading-relaxed text-ink-secondary">
        <Power size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        Power actions respect the live state: start fires only when the server is stopped, stop and restart only when it
        is running. Anything else is recorded as skipped, never forced.
      </div>

      <ConfirmModal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete schedule?"
        description={`"${confirmDelete?.name}" will stop running. Past runs stay in the activity trail.`}
        confirmLabel="Delete schedule"
        onConfirm={async () => {
          try {
            await remove.mutateAsync(confirmDelete.id);
            setConfirmDelete(null);
          } catch (err) {
            setFormError(err.message);
            setConfirmDelete(null);
          }
        }}
      />
    </div>
  );
}
