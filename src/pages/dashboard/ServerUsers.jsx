import { useState } from 'react';
import { Loader2, ShieldCheck, Trash2, UserPlus } from 'lucide-react';

import { cn } from '@/lib/utils';
import { AvatarBadge } from '@/components/AvatarBadge.jsx';
import { ConfirmModal } from '@/components/ui/confirm-modal.jsx';
import {
  useAddSubuser,
  useRemoveSubuser,
  useSubusers,
  useUpdateSubuser,
} from '@/hooks/useQueries.jsx';

/** Must stay in sync with PERMISSION_LABELS in server-access-policy.ts. */
const PERMISSIONS = [
  { key: 'server.view', title: 'View server', text: 'Details, metrics, logs, activity and the package list.' },
  { key: 'console.access', title: 'Console', text: 'Open the live console.' },
  { key: 'files.read', title: 'Read files', text: 'Browse, preview and download files.' },
  { key: 'files.write', title: 'Manage files', text: 'Create, edit, upload, rename, move, archive and delete.' },
  { key: 'backup.read', title: 'View backups', text: 'See snapshots and quota.' },
  { key: 'backup.write', title: 'Manage backups', text: 'Create, restore, download and delete snapshots.' },
  { key: 'packages.write', title: 'Manage packages', text: 'Install and remove packages.' },
  { key: 'control.power', title: 'Power controls', text: 'Start, stop, restart and reprovision.' },
  { key: 'settings.update', title: 'Edit settings', text: 'Name, main file, startup, variables, auto-backup, ports.' },
  { key: 'schedule.manage', title: 'Manage schedules', text: 'Create, edit, enable and delete scheduled tasks.' },
];

/**
 * The platform only shares with an account that already exists (a grant is a
 * row between two real users, not an email invitation). The backend answers
 * 404 for unknown emails — deliberately neutral, so this endpoint cannot be
 * used to probe which addresses have accounts. The UI's job is to explain
 * that honestly instead of showing a raw error code.
 */
const SHARE_ERRORS = {
  USER_NOT_FOUND: 'No active Troxe account uses that email. They need to sign up first — then share with them here.',
  ALREADY_OWNER: 'That account already owns this server.',
  ADMIN_NO_GRANT: 'Administrators already have access to every server — no grant needed.',
  ALREADY_SHARED: 'That account already has access to this server.',
  QUOTA_SUBUSERS: 'This server is shared with 20 people already — the maximum.',
  PERMISSION_DENIED: 'Only the owner can manage who has access.',
};

const friendly = (err) => SHARE_ERRORS[err?.code] ?? err?.message ?? 'Something went wrong.';

function PermissionGrid({ value, onChange, disabled }) {
  const toggle = (key) => {
    onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
  };
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {PERMISSIONS.map((p) => {
        const on = value.includes(p.key);
        return (
          <button
            key={p.key}
            type="button"
            disabled={disabled}
            onClick={() => toggle(p.key)}
            aria-pressed={on}
            className={cn(
              'rounded-xl border p-3 text-left transition',
              on ? 'border-white/40 bg-white/[0.07]' : 'border-hairline bg-veil/40 hover:border-hairline-hover'
            )}
          >
            <span className="flex items-center gap-2 text-[0.84rem] font-bold">
              <span className={cn('flex size-4 items-center justify-center rounded border text-[0.65rem]', on ? 'border-white bg-white text-black' : 'border-hairline text-transparent')}>
                ✓
              </span>
              {p.title}
            </span>
            <span className="mt-1 block text-[0.74rem] leading-relaxed text-ink-secondary">{p.text}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Owner-only sharing management. Subusers never see this tab (the grant
 * endpoint tells the UI), and the server re-checks ownership on every call.
 */
export default function ServerUsers({ server }) {
  const { data, isLoading, error, refetch } = useSubusers(server.id);
  const add = useAddSubuser(server.id);
  const update = useUpdateSubuser(server.id);
  const remove = useRemoveSubuser(server.id);

  const [email, setEmail] = useState('');
  const [perms, setPerms] = useState(['server.view']);
  const [formError, setFormError] = useState(null);
  const [editing, setEditing] = useState(null); // userId being edited
  const [editPerms, setEditPerms] = useState([]);
  const [confirmRemove, setConfirmRemove] = useState(null);

  const rows = data ?? [];

  const submitAdd = async (e) => {
    e.preventDefault();
    setFormError(null);
    if (!email.trim()) return setFormError('Enter the email of their Troxe account.');
    if (!perms.length) return setFormError('Grant at least one permission.');
    try {
      await add.mutateAsync({ email: email.trim(), permissions: perms });
      setEmail('');
      setPerms(['server.view']);
    } catch (err) {
      setFormError(friendly(err));
    }
  };

  const submitEdit = async (userId) => {
    setFormError(null);
    try {
      await update.mutateAsync({ userId, permissions: editPerms });
      setEditing(null);
    } catch (err) {
      setFormError(friendly(err));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-2xl border border-hairline bg-card p-5 sm:p-6">
        <header className="flex items-center gap-2.5">
          <UserPlus className="size-4 text-ink-muted" aria-hidden="true" />
          <h2 className="text-[0.95rem] font-semibold">Share this server</h2>
        </header>
        <p className="mt-1.5 max-w-2xl text-[0.82rem] leading-relaxed text-ink-secondary">
          They sign in with their own account and only get what you tick below. The really destructive actions —
          deleting the server, reinstalling it, changing its runtime and managing this list — always stay yours.
          Sharing works with accounts that already exist on Troxe — so they need to sign up first.
        </p>
        <form onSubmit={submitAdd} className="mt-4 flex flex-col gap-3">
          <label className="block max-w-md">
            <span className="mb-1.5 block text-[0.82rem] font-semibold text-ink-secondary">Their account email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="friend@example.com"
              dir="ltr"
              maxLength={255}
              className="w-full rounded-xl border border-hairline bg-white/10 px-4 py-2.5 text-[0.88rem] text-foreground placeholder-ink-muted transition focus:border-primary focus:ring-2 focus:ring-ring/40 focus:outline-none"
            />
          </label>
          <PermissionGrid value={perms} onChange={setPerms} disabled={add.isPending} />
          {formError && !editing && (
            <p className="text-[0.8rem] text-red-300" role="alert">{formError}</p>
          )}
          <div>
            <button
              type="submit"
              disabled={add.isPending}
              className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[0.84rem] font-bold text-black transition hover:bg-white/90 disabled:opacity-50"
            >
              {add.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <UserPlus className="size-4" aria-hidden="true" />}
              Share server
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-hairline bg-card p-5 sm:p-6" aria-label="People with access">
        <h2 className="flex items-center gap-2 text-[0.95rem] font-semibold">
          <ShieldCheck className="size-4 text-ink-muted" aria-hidden="true" />
          People with access
          <span className="font-mono text-[0.72rem] font-normal text-ink-muted tabular-nums">{rows.length}/20</span>
        </h2>

        {isLoading ? (
          <div className="mt-4 flex flex-col gap-2" aria-busy="true">
            {[0, 1].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-white/[0.04]" />)}
          </div>
        ) : error ? (
          <p className="mt-4 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3 text-[0.84rem] text-red-200" role="alert">
            Could not load the list: {error.message}
          </p>
        ) : rows.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-hairline px-4 py-8 text-center text-[0.84rem] text-ink-secondary">
            Only you can access this server right now.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2.5">
            {rows.map((r) => (
              <li key={r.userId} className="rounded-xl border border-hairline bg-veil/40 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <AvatarBadge url={r.avatarUrl} name={r.name ?? r.email} size="size-9" text="text-sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.9rem] font-bold">{r.name ?? 'Account'}</p>
                    <p className="truncate font-mono text-[0.72rem] text-ink-muted" dir="ltr">{r.email}</p>
                  </div>
                  {r.status !== 'active' && (
                    <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[0.7rem] font-bold text-amber-300">
                      {r.status}
                    </span>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { setEditing(editing === r.userId ? null : r.userId); setEditPerms(r.permissions ?? []); setFormError(null); }}
                      className="rounded-full border border-hairline px-3.5 py-1.5 text-[0.76rem] font-bold text-ink-secondary transition hover:text-foreground"
                    >
                      {editing === r.userId ? 'Cancel' : 'Edit'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(r)}
                      aria-label={`Remove ${r.email}`}
                      className="inline-flex size-8 items-center justify-center rounded-full border border-hairline text-ink-muted transition hover:border-red-500/50 hover:text-red-400"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <p className="mt-2.5 text-[0.76rem] text-ink-secondary">
                  {(r.permissions ?? []).length
                    ? (r.permissions ?? []).map((k) => PERMISSIONS.find((p) => p.key === k)?.title ?? k).join(' · ')
                    : 'No permissions'}
                </p>
                {editing === r.userId && (
                  <div className="mt-3 border-t border-hairline pt-3">
                    <PermissionGrid value={editPerms} onChange={setEditPerms} disabled={update.isPending} />
                    {formError && (
                      <p className="mt-2 text-[0.8rem] text-red-300" role="alert">{formError}</p>
                    )}
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        disabled={update.isPending || !editPerms.length}
                        onClick={() => submitEdit(r.userId)}
                        className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[0.82rem] font-bold text-black transition hover:bg-white/90 disabled:opacity-50"
                      >
                        {update.isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                        Save permissions
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <button type="button" onClick={() => refetch()} className="mt-3 text-[0.78rem] font-bold text-ink-secondary underline decoration-dotted hover:text-foreground">
          Refresh list
        </button>
      </section>

      <ConfirmModal
        open={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        title="Remove access?"
        description={`${confirmRemove?.email ?? 'This person'} will immediately lose access to this server — including any open console session on their next action.`}
        confirmLabel="Remove access"
        onConfirm={async () => {
          try {
            await remove.mutateAsync(confirmRemove.userId);
            setConfirmRemove(null);
          } catch (err) {
            setFormError(friendly(err));
            setConfirmRemove(null);
          }
        }}
      />
    </div>
  );
}
