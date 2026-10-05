import { useState } from 'react';
import {
  useAdminCampaign,
  useAdminCampaignCancel,
  useAdminCampaignCreate,
  useAdminCampaignPreview,
  useAdminCampaignRecipients,
  useAdminCampaignSend,
  useAdminCampaignUpdate,
  useAdminCampaigns,
  useAdminEmailSettings,
  useAdminEmailStatus,
} from '@/hooks/useAdminQueries.jsx';
import { cn } from '@/lib/utils';
import { ConfirmModal } from '@/components/ui/confirm-modal.jsx';
import { Select } from '@/components/ui/select.jsx';

const inputClass =
  'w-full rounded-xl border border-hairline bg-white/10 px-4 py-2.5 text-[0.9rem] text-foreground placeholder-ink-muted transition focus:border-primary focus:outline-none';
const btnPrimary = 'rounded-full bg-white px-5 py-2 text-[0.83rem] font-bold text-black transition hover:bg-gray-200 disabled:opacity-60';
const btnGhost =
  'rounded-full border border-hairline px-5 py-2 text-[0.83rem] font-bold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:opacity-60';

function Card({ title, children }) {
  return (
    <section className="rounded-xl border border-hairline bg-card p-5">
      <h2 className="mb-3 text-[1.05rem] font-bold">{title}</h2>
      {children}
    </section>
  );
}

function StatusDot({ ok, warn }) {
  return <span className={cn('inline-block size-2.5 rounded-full', ok ? 'bg-emerald-400' : warn ? 'bg-amber-400' : 'bg-red-400')} />;
}

function StatusSection({ status, saveSettings }) {
  if (!status) return null;
  return (
    <Card title="Email provider">
      <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <div className="flex items-center gap-2 text-[0.9rem]">
          <StatusDot ok={status.resendConnected} />
          {status.resendConnected ? 'Resend connected' : 'Resend not configured'}
        </div>
        <div className="text-[0.9rem] text-ink-secondary">
          Sender: <span className="text-foreground">{status.senderName} &lt;{status.senderEmail || '—'}&gt;</span>
        </div>
        <div className="flex items-center gap-2 text-[0.9rem]">
          <StatusDot ok={status.domainStatus === 'verified'} warn={status.domainStatus === 'pending' || status.domainStatus === 'unknown'} />
          Domain: {status.domainStatus}
        </div>
        <label className="flex items-center justify-between gap-3 text-[0.9rem]">
          <span>
            New-login notifications
            <span className="block text-[0.78rem] text-ink-muted">Security emails on sign-in from a new IP. Verification &amp; reset mail are unaffected.</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={status.newLoginEmails}
            onClick={() => saveSettings.mutateAsync({ newLoginEmails: !status.newLoginEmails })}
            disabled={saveSettings.isPending}
            className={cn('relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-60', status.newLoginEmails ? 'bg-white' : 'bg-white/15')}
          >
            <span className={cn('absolute top-0.5 size-5 rounded-full transition-all', status.newLoginEmails ? 'left-[22px] bg-black' : 'left-0.5 bg-white')} />
          </button>
        </label>
      </div>
      {!status.emailEnabled && (
        <p className="mt-3 text-[0.85rem] text-amber-400">
          Email is disabled (no RESEND_API_KEY / RESEND_FROM_EMAIL). Verification codes, reset links and campaigns will fail until it is configured.
        </p>
      )}
    </Card>
  );
}

const EMPTY_FILTERS = { audience: 'all', planId: '', role: '', search: '', ids: '' };

function CampaignDetail({ id, onBack }) {
  const { data: camp, isLoading } = useAdminCampaign(id);
  const update = useAdminCampaignUpdate(id);
  const preview = useAdminCampaignPreview(id);
  const send = useAdminCampaignSend(id);
  const cancel = useAdminCampaignCancel(id);
  const [form, setForm] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [rStatus, setRStatus] = useState('');
  const [page, setPage] = useState(0);
  const { data: recipients } = useAdminCampaignRecipients(id, { status: rStatus || undefined, limit: 50, offset: page * 50 });
  const [msg, setMsg] = useState({ text: '', ok: true });
  const [sendOpen, setSendOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  if (isLoading || !camp) return <p className="text-ink-muted">Loading campaign…</p>;
  const editable = camp.status === 'draft';
  const f = form ?? { name: camp.name, subject: camp.subject, html: camp.html, text: camp.text || '' };
  const set = (k) => (e) => setForm({ ...f, [k]: e.target.value });
  const counts = camp.counts || {};

  const doPreview = async () => {
    try {
      const out = await preview.mutateAsync(cleanFilters(filters));
      setMsg({ text: `Recipients: ${out.count} user(s)`, ok: true });
    } catch (e) {
      setMsg({ text: e.message, ok: false });
    }
  };
  const doSend = async () => {
    const out = await send.mutateAsync(cleanFilters(filters));
    setMsg({ text: `Sending started — ${out.recipients} recipient(s) snapshotted.`, ok: true });
  };
  const doCancel = async () => {
    await cancel.mutateAsync();
    setMsg({ text: 'Campaign cancelled.', ok: true });
  };

  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={onBack} className="self-start text-[0.85rem] font-bold text-ink-secondary hover:text-foreground">
        ← All campaigns
      </button>
      {msg.text && <p className={cn('text-sm', msg.ok ? 'text-emerald-400' : 'text-red-400')}>{msg.text}</p>}
      <Card title={`${camp.name} — ${camp.status}`}>
        <div className="mb-3 flex flex-wrap gap-4 text-[0.85rem] text-ink-secondary">
          {['total', 'pending', 'sending', 'sent', 'failed', 'skipped'].map((k) => (
            <span key={k}>
              {k}: <span className="font-bold text-foreground">{counts[k] ?? 0}</span>
            </span>
          ))}
        </div>
        {editable ? (
          <div className="flex flex-col gap-3">
            <input value={f.name} onChange={set('name')} placeholder="Campaign name" className={inputClass} />
            <input value={f.subject} onChange={set('subject')} placeholder="Subject — {{user.name}} and {{user.email}} allowed" className={inputClass} />
            <textarea value={f.html} onChange={set('html')} placeholder="HTML body" rows={8} className={cn(inputClass, 'font-mono')} />
            <textarea value={f.text} onChange={set('text')} placeholder="Plain-text fallback (optional)" rows={4} className={cn(inputClass, 'font-mono')} />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => update.mutateAsync({ name: f.name, subject: f.subject, html: f.html, text: f.text || null })} disabled={update.isPending} className={btnPrimary}>
                Save draft
              </button>
            </div>
          </div>
        ) : (
          <div className="text-[0.88rem] text-ink-secondary">
            <p className="mb-1">
              <span className="font-bold text-foreground">Subject:</span> {camp.subject}
            </p>
            <p>Locked (status {camp.status}). Only drafts can be edited.</p>
          </div>
        )}
      </Card>

      <Card title="Audience">
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <label className="flex flex-col gap-1 text-[0.82rem] font-semibold">
            Audience
            <Select
              ariaLabel="Audience"
              value={filters.audience}
              onChange={(v) => setFilters({ ...filters, audience: v })}
              disabled={!editable && camp.status !== 'draft'}
              options={[
                { value: 'all', label: 'All opted-in users' },
                { value: 'verified', label: 'Verified emails only' },
                { value: 'unverified', label: 'Unverified emails only' },
              ]}
              className="w-full"
            />
          </label>
          <label className="flex flex-col gap-1 text-[0.82rem] font-semibold">
            Role
            <Select
              ariaLabel="Role"
              value={filters.role}
              onChange={(v) => setFilters({ ...filters, role: v })}
              options={[
                { value: '', label: 'Any role' },
                { value: 'user', label: 'user' },
                { value: 'admin', label: 'admin' },
              ]}
              className="w-full"
            />
          </label>
          <label className="flex flex-col gap-1 text-[0.82rem] font-semibold">
            Plan ID
            <input value={filters.planId} onChange={(e) => setFilters({ ...filters, planId: e.target.value })} placeholder="e.g. pro (empty = any)" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-[0.82rem] font-semibold">
            Search email / name
            <input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="needle" className={inputClass} />
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-[0.82rem] font-semibold max-md:col-span-1">
            Manual user IDs (one UUID per line, optional)
            <textarea value={filters.ids} onChange={(e) => setFilters({ ...filters, ids: e.target.value })} rows={3} className={cn(inputClass, 'font-mono')} />
          </label>
        </div>
        <p className="mt-2 text-[0.8rem] text-ink-muted">Only users with marketing emails enabled are ever included. Unsubscribed users are skipped automatically, even mid-campaign.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={doPreview} disabled={preview.isPending} className={btnGhost}>
            Preview recipient count
          </button>
          {editable && (
            <button type="button" onClick={() => setSendOpen(true)} disabled={send.isPending} className={btnPrimary}>
              Snapshot &amp; send
            </button>
          )}
          {(camp.status === 'draft' || camp.status === 'sending') && (
            <button
              type="button"
              onClick={() => setCancelOpen(true)}
              disabled={cancel.isPending}
              className={btnGhost}
            >
              Cancel
            </button>
          )}
        </div>
      </Card>

      <Card title="Recipients">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {['', 'pending', 'sending', 'sent', 'failed', 'skipped'].map((s) => (
            <button
              key={s || 'all'}
              type="button"
              onClick={() => {
                setRStatus(s);
                setPage(0);
              }}
              className={cn('rounded-full border px-3 py-1 text-[0.78rem] font-bold', rStatus === s ? 'border-white text-foreground' : 'border-hairline text-ink-muted')}
            >
              {s || 'all'}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[0.82rem]">
            <thead>
              <tr className="text-ink-muted">
                <th className="py-2 pr-3">User</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Delivery</th>
                <th className="py-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {(recipients || []).map((r) => (
                <tr key={r.id} className="border-t border-hairline">
                  <td className="py-2 pr-3">
                    {r.name} <span className="text-ink-muted">{r.email}</span>
                  </td>
                  <td className="py-2 pr-3">{r.status}</td>
                  <td className="py-2 pr-3">{r.delivery || '—'}</td>
                  <td className="py-2 text-ink-muted">{r.failureReason || r.resendId || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className={btnGhost}>
            Prev
          </button>
          <button type="button" onClick={() => setPage((p) => p + 1)} disabled={(recipients || []).length < 50} className={btnGhost}>
            Next
          </button>
        </div>
      </Card>

      <ConfirmModal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        title="Send campaign"
        description="This snapshots the filtered recipients and starts delivery. Only marketing-opted-in users are included; unsubscribed users are skipped automatically."
        confirmLabel="Snapshot & send"
        danger={false}
        onConfirm={doSend}
      >
        <p className="text-[0.85rem] text-ink-secondary">
          Campaign: <span className="font-bold text-ink">{camp.name}</span>
        </p>
      </ConfirmModal>

      <ConfirmModal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel campaign"
        description="Pending recipients will be skipped. Emails already sent cannot be recalled."
        confirmLabel="Cancel campaign"
        onConfirm={doCancel}
      />
    </div>
  );
}

function cleanFilters(filters) {
  const ids = (filters.ids || '')
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s));
  return {
    audience: filters.audience && filters.audience !== 'all' ? filters.audience : undefined,
    planId: filters.planId.trim() || undefined,
    role: filters.role || undefined,
    search: filters.search.trim() || undefined,
    ids: ids.length ? ids : undefined,
  };
}

export default function Email() {
  const { data: status } = useAdminEmailStatus();
  const saveSettings = useAdminEmailSettings();
  const { data: campaigns } = useAdminCampaigns();
  const create = useAdminCampaignCreate();
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ name: '', subject: '', html: '', text: '' });
  const [msg, setMsg] = useState({ text: '', ok: true });

  if (selected) return <CampaignDetail id={selected} onBack={() => setSelected(null)} />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[1.6rem] font-extrabold tracking-tight">Email</h1>
        <p className="mt-1 text-[0.92rem] text-ink-secondary">Provider status, security-mail toggle, and marketing campaigns.</p>
      </div>
      {msg.text && <p className={cn('text-sm', msg.ok ? 'text-emerald-400' : 'text-red-400')}>{msg.text}</p>}

      <StatusSection status={status} saveSettings={saveSettings} />

      <Card title="Campaigns">
        {(campaigns || []).length === 0 && <p className="text-[0.88rem] text-ink-muted">No campaigns yet.</p>}
        <div className="flex flex-col gap-2">
          {(campaigns || []).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelected(c.id)}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-hairline px-4 py-3 text-left transition hover:border-hairline-hover"
            >
              <span>
                <span className="block text-[0.92rem] font-bold">{c.name}</span>
                <span className="block text-[0.8rem] text-ink-muted">{c.subject}</span>
              </span>
              <span className="text-[0.8rem] font-bold text-ink-secondary">
                {c.status} · {c.counts?.total ?? 0} recipients ({c.counts?.sent ?? 0} sent, {c.counts?.failed ?? 0} failed)
              </span>
            </button>
          ))}
        </div>
      </Card>

      <Card title="New campaign">
        <div className="flex flex-col gap-3">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Campaign name (internal)" className={inputClass} />
          <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Subject — {{user.name}} and {{user.email}} allowed" className={inputClass} />
          <textarea value={form.html} onChange={(e) => setForm({ ...form, html: e.target.value })} placeholder="HTML body" rows={8} className={cn(inputClass, 'font-mono')} />
          <textarea value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder="Plain-text fallback (optional)" rows={4} className={cn(inputClass, 'font-mono')} />
          <div>
            <button
              type="button"
              disabled={create.isPending}
              onClick={async () => {
                try {
                  const out = await create.mutateAsync({ name: form.name, subject: form.subject, html: form.html, text: form.text || undefined });
                  setForm({ name: '', subject: '', html: '', text: '' });
                  setSelected(out.id);
                } catch (e) {
                  setMsg({ text: e.message, ok: false });
                }
              }}
              className={btnPrimary}
            >
              Create draft
            </button>
          </div>
          <p className="text-[0.8rem] text-ink-muted">Only {'{{user.name}}, {{user.email}}, {{app.name}}'} are substituted — everything else is stripped. Scripts, iframes and javascript: URLs are removed before sending.</p>
        </div>
      </Card>
    </div>
  );
}
