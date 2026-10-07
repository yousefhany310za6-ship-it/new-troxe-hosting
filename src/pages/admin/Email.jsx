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
import { apiPost } from '@/lib/api.js';
import { ConfirmModal } from '@/components/ui/confirm-modal.jsx';
import { Modal } from '@/components/ui/modal.jsx';
import { Field } from '@/components/ui/field.jsx';
import { Select } from '@/components/ui/select.jsx';
import {
  EmptyState,
  ErrorState,
  Menu,
  PageHeader,
  Section,
  StatusBadge,
  TableSkeleton,
} from './components.jsx';

const btnPrimary = 'rounded-full bg-white px-5 py-2 text-[0.83rem] font-bold text-black transition hover:bg-gray-200 disabled:opacity-60';
const btnGhost =
  'rounded-full border border-hairline px-5 py-2 text-[0.83rem] font-bold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:opacity-60';

function StatusDot({ ok, warn }) {
  return <span className={cn('inline-block size-2.5 rounded-full', ok ? 'bg-emerald-400' : warn ? 'bg-amber-400' : 'bg-red-400')} />;
}

function campaignTone(status) {
  if (status === 'sent') return 'emerald';
  if (status === 'sending') return 'blue';
  if (status === 'cancelled' || status === 'failed') return 'red';
  return 'zinc';
}

function StatusSection({ status, saveSettings }) {
  if (!status) return null;
  return (
    <Section title="Email provider">
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        <div className="flex items-center gap-2 text-[0.88rem]">
          <StatusDot ok={status.resendConnected} />
          {status.resendConnected ? 'Resend connected' : 'Resend not configured'}
        </div>
        <div className="text-[0.88rem] text-ink-secondary">
          Sender: <span className="text-foreground">{status.senderName} &lt;{status.senderEmail || '—'}&gt;</span>
        </div>
        <div className="flex items-center gap-2 text-[0.88rem]">
          <StatusDot ok={status.domainStatus === 'verified'} warn={status.domainStatus === 'pending' || status.domainStatus === 'unknown'} />
          Domain: {status.domainStatus}
        </div>
        <div className="flex items-center justify-between gap-3 text-[0.88rem]">
          <span>
            New-login notifications
            <span className="block text-[0.76rem] text-ink-muted">Security emails on sign-in from a new IP. Verification &amp; reset mail are unaffected.</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={status.newLoginEmails}
            aria-label="Toggle new-login notifications"
            onClick={() => saveSettings.mutateAsync({ newLoginEmails: !status.newLoginEmails })}
            disabled={saveSettings.isPending}
            className={cn('relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-60', status.newLoginEmails ? 'bg-white' : 'bg-white/15')}
          >
            <span className={cn('absolute top-0.5 size-5 rounded-full transition-all', status.newLoginEmails ? 'left-[22px] bg-black' : 'left-0.5 bg-white')} />
          </button>
        </div>
      </div>
      {!status.emailEnabled && (
        <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-[0.83rem] text-amber-300">
          Email is disabled (no RESEND_API_KEY / RESEND_FROM_EMAIL). Verification codes, reset links and campaigns will fail until it is configured.
        </p>
      )}
    </Section>
  );
}

const EMPTY_FILTERS = { audience: 'all', planId: '', role: '', search: '', ids: '' };

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

function AudienceForm({ filters, setFilters, disabled }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Audience">
        <Select
          ariaLabel="Audience"
          value={filters.audience}
          onChange={(v) => setFilters({ ...filters, audience: v })}
          disabled={disabled}
          options={[
            { value: 'all', label: 'All opted-in users' },
            { value: 'verified', label: 'Verified emails only' },
            { value: 'unverified', label: 'Unverified emails only' },
          ]}
          className="w-full"
        />
      </Field>
      <Field label="Role">
        <Select
          ariaLabel="Role"
          value={filters.role}
          onChange={(v) => setFilters({ ...filters, role: v })}
          disabled={disabled}
          options={[
            { value: '', label: 'Any role' },
            { value: 'user', label: 'user' },
            { value: 'admin', label: 'admin' },
          ]}
          className="w-full"
        />
      </Field>
      <Field label="Plan ID" hint="Empty = any plan.">
        <input value={filters.planId} onChange={(e) => setFilters({ ...filters, planId: e.target.value })} disabled={disabled} placeholder="e.g. pro" className="input-field" />
      </Field>
      <Field label="Search email / name">
        <input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} disabled={disabled} placeholder="needle" className="input-field" />
      </Field>
      <Field label="Manual user IDs" hint="One UUID per line, optional. Only marketing-opted-in users are ever included." className="sm:col-span-2">
        <textarea value={filters.ids} onChange={(e) => setFilters({ ...filters, ids: e.target.value })} disabled={disabled} rows={3} className="input-field font-mono" />
      </Field>
    </div>
  );
}

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

  if (isLoading || !camp) return <TableSkeleton rows={4} />;
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
    <div className="flex flex-col gap-5">
      <button type="button" onClick={onBack} className="self-start text-[0.85rem] font-bold text-ink-secondary hover:text-foreground">
        ← All campaigns
      </button>
      {msg.text && <p className={cn('text-sm', msg.ok ? 'text-emerald-400' : 'text-red-400')} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}

      <Section
        title={camp.name}
        description={`Status: ${camp.status} · ${counts.total ?? 0} recipients (${counts.sent ?? 0} sent, ${counts.failed ?? 0} failed)`}
        action={<StatusBadge tone={campaignTone(camp.status)}>{camp.status}</StatusBadge>}
      >
        {editable ? (
          <div className="flex flex-col gap-3">
            <Field label="Campaign name (internal)">
              <input value={f.name} onChange={set('name')} className="input-field" />
            </Field>
            <Field label="Subject" hint="{{user.name}} and {{user.email}} allowed.">
              <input value={f.subject} onChange={set('subject')} className="input-field" />
            </Field>
            <Field label="HTML body">
              <textarea value={f.html} onChange={set('html')} rows={8} className="input-field font-mono" />
            </Field>
            <Field label="Plain-text fallback (optional)">
              <textarea value={f.text} onChange={set('text')} rows={4} className="input-field font-mono" />
            </Field>
            <div>
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
      </Section>

      <Section
        title="Audience"
        description="Only users with marketing emails enabled are ever included. Unsubscribed users are skipped automatically, even mid-campaign."
        action={
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={doPreview} disabled={preview.isPending} className={btnGhost}>
              Preview recipient count
            </button>
            {editable && (
              <button type="button" onClick={() => setSendOpen(true)} disabled={send.isPending} className={btnPrimary}>
                Snapshot &amp; send
              </button>
            )}
            {(camp.status === 'draft' || camp.status === 'sending') && (
              <button type="button" onClick={() => setCancelOpen(true)} disabled={cancel.isPending} className={btnGhost}>
                Cancel
              </button>
            )}
          </div>
        }
      >
        <AudienceForm filters={filters} setFilters={setFilters} disabled={camp.status !== 'draft'} />
      </Section>

      <Section title="Recipients">
        <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Recipient status">
          {['', 'pending', 'sending', 'sent', 'failed', 'skipped'].map((s) => (
            <button
              key={s || 'all'}
              type="button"
              role="tab"
              aria-selected={rStatus === s}
              onClick={() => { setRStatus(s); setPage(0); }}
              className={cn('rounded-full border px-3 py-1 text-[0.78rem] font-bold transition focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none', rStatus === s ? 'border-white text-foreground' : 'border-hairline text-ink-muted hover:text-foreground')}
            >
              {s || 'all'}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[0.82rem]">
            <thead>
              <tr className="text-ink-muted">
                <th scope="col" className="py-2 pr-3 font-medium">User</th>
                <th scope="col" className="py-2 pr-3 font-medium">Status</th>
                <th scope="col" className="py-2 pr-3 font-medium">Delivery</th>
                <th scope="col" className="py-2 font-medium">Detail</th>
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
          {(recipients || []).length === 0 && <p className="py-6 text-center text-[0.83rem] text-ink-muted">No recipients in this view.</p>}
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className={btnGhost}>
            Prev
          </button>
          <button type="button" onClick={() => setPage((p) => p + 1)} disabled={(recipients || []).length < 50} className={btnGhost}>
            Next
          </button>
        </div>
      </Section>

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

const WIZARD_STEPS = ['Details', 'Audience', 'Content', 'Preview', 'Review'];

function CreateWizard({ onDone, onCancel }) {
  const create = useAdminCampaignCreate();
  const [step, setStep] = useState(0);
  const [details, setDetails] = useState({ name: '', subject: '' });
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [content, setContent] = useState({ html: '', text: '' });
  const [created, setCreated] = useState(null);
  const [count, setCount] = useState(null);
  const [error, setError] = useState('');

  const canNext =
    step === 0
      ? details.name.trim() && details.subject.trim()
      : step === 2
        ? content.html.trim()
        : true;

  const goPreview = async () => {
    setError('');
    try {
      const out = await create.mutateAsync({
        name: details.name.trim(),
        subject: details.subject.trim(),
        html: content.html,
        text: content.text.trim() || undefined,
      });
      setCreated(out);
      const c = await previewCount(out.id);
      setCount(c);
      setStep(4);
    } catch (e) {
      setError(e.message);
    }
  };

  const previewCount = async (id) => {
    // recipient preview runs against the saved draft
    const out = await apiPost(`/admin/email/campaigns/${id}/recipients/preview`, cleanFilters(filters));
    return out.count;
  };

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-wrap items-center gap-1.5" aria-label="Creation progress">
        {WIZARD_STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => { if (created || i < step) setStep(i); }}
              disabled={!created && i >= step}
              aria-current={i === step ? 'step' : undefined}
              className={cn(
                'rounded-full px-3 py-1 text-[0.76rem] font-bold transition',
                i === step ? 'bg-white text-black' : i < step || created ? 'border border-hairline text-ink-secondary hover:text-foreground' : 'text-ink-muted opacity-50',
              )}
            >
              {i + 1}. {label}
            </button>
            {i < WIZARD_STEPS.length - 1 && <span aria-hidden="true" className="text-ink-muted">→</span>}
          </li>
        ))}
      </ol>

      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}

      {step === 0 && (
        <div className="flex flex-col gap-3">
          <Field label="Campaign name" hint="Internal only — recipients never see it.">
            <input value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} placeholder="October product update" className="input-field" />
          </Field>
          <Field label="Subject" hint="{{user.name}} and {{user.email}} are substituted per recipient.">
            <input value={details.subject} onChange={(e) => setDetails({ ...details, subject: e.target.value })} placeholder="What's new at Troxe" className="input-field" />
          </Field>
        </div>
      )}

      {step === 1 && <AudienceForm filters={filters} setFilters={setFilters} />}

      {step === 2 && (
        <div className="flex flex-col gap-3">
          <Field label="HTML body" hint="Scripts, iframes and javascript: URLs are stripped before sending.">
            <textarea value={content.html} onChange={(e) => setContent({ ...content, html: e.target.value })} rows={10} className="input-field font-mono" />
          </Field>
          <Field label="Plain-text fallback (optional)">
            <textarea value={content.text} onChange={(e) => setContent({ ...content, text: e.target.value })} rows={4} className="input-field font-mono" />
          </Field>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-card p-5">
          <p className="text-[0.85rem] text-ink-secondary">
            Saving the draft, then counting recipients for the chosen audience…
          </p>
          <div>
            <button type="button" onClick={goPreview} disabled={create.isPending} className={btnPrimary}>
              {create.isPending ? 'Working…' : 'Save draft & count recipients'}
            </button>
          </div>
        </div>
      )}

      {step === 4 && created && (
        <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-card p-5">
          <p className="text-[0.95rem] font-bold">{details.name}</p>
          <p className="text-[0.83rem] text-ink-secondary">{details.subject}</p>
          <p className="rounded-lg border border-hairline bg-white/[0.02] px-3 py-2 font-mono text-[0.82rem]">
            {count ?? 0} recipient{(count ?? 0) === 1 ? '' : 's'} will receive this campaign.
          </p>
          <p className="text-[0.8rem] text-ink-muted">Only {'{{user.name}}, {{user.email}}, {{app.name}}'} are substituted — everything else is stripped.</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => (step === 0 ? onCancel() : setStep((s) => s - 1))}
          className="rounded-full border border-hairline px-5 py-2 text-[0.83rem] font-bold text-ink-secondary transition hover:text-foreground"
        >
          {step === 0 ? 'Cancel' : 'Back'}
        </button>
        {step < 3 && (
          <button type="button" onClick={() => setStep((s) => s + 1)} disabled={!canNext} className={btnPrimary}>
            Continue
          </button>
        )}
        {step === 4 && created && (
          <button type="button" onClick={() => onDone(created.id)} className={btnPrimary}>
            Open campaign
          </button>
        )}
      </div>
    </div>
  );
}

export default function Email() {
  const { data: status } = useAdminEmailStatus();
  const saveSettings = useAdminEmailSettings();
  const { data: campaigns, isLoading, error, refetch } = useAdminCampaigns();
  const [tab, setTab] = useState('campaigns');
  const [selected, setSelected] = useState(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  if (selected) return <CampaignDetail id={selected} onBack={() => { setSelected(null); refetch(); }} />;

  const list = campaigns ?? [];
  const counts = {
    draft: list.filter((c) => c.status === 'draft').length,
    sending: list.filter((c) => c.status === 'sending').length,
    sent: list.filter((c) => c.status === 'sent').length,
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Email"
        description="Provider health, marketing campaigns and delivery."
        actions={
          tab === 'campaigns' ? (
            <button type="button" onClick={() => setWizardOpen(true)} className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:bg-gray-200">
              New campaign
            </button>
          ) : undefined
        }
      />

      <div className="flex gap-1 border-b border-hairline" role="tablist" aria-label="Email sections">
        {[
          ['campaigns', 'Campaigns'],
          ['settings', 'Settings'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              'px-4 py-2.5 text-[0.85rem] font-semibold transition focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
              tab === id ? 'border-b-2 border-white text-foreground' : 'border-b-2 border-transparent text-ink-secondary hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'settings' && <StatusSection status={status} saveSettings={saveSettings} />}

      {tab === 'campaigns' && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-[0.78rem]">
            <StatusBadge tone="zinc">{counts.draft} drafts</StatusBadge>
            <StatusBadge tone="blue">{counts.sending} sending</StatusBadge>
            <StatusBadge tone="emerald">{counts.sent} sent</StatusBadge>
          </div>

          {isLoading && <TableSkeleton rows={4} />}
          {error && <ErrorState message={error.message} onRetry={refetch} />}

          {!isLoading && !error && list.length === 0 && (
            <EmptyState
              title="No campaigns yet"
              hint="Draft your first announcement — recipients, content and delivery are reviewed before anything sends."
              action={
                <button type="button" onClick={() => setWizardOpen(true)} className={btnPrimary}>
                  New campaign
                </button>
              }
            />
          )}

          {!isLoading && !error && list.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-hairline bg-card">
              <div className="hidden grid-cols-[minmax(0,1.4fr)_90px_minmax(0,1fr)_150px] items-center gap-3 border-b border-hairline px-5 py-2.5 font-mono text-[0.68rem] tracking-wider text-ink-muted uppercase lg:grid">
                <span>Campaign</span><span>Status</span><span>Recipients</span><span>Created</span>
              </div>
              <div className="flex flex-col divide-y divide-hairline">
                {list.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelected(c.id)}
                    className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3 text-left transition hover:bg-white/[0.02] sm:px-5 lg:grid-cols-[minmax(0,1.4fr)_90px_minmax(0,1fr)_150px]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[0.9rem] font-bold">{c.name}</span>
                      <span className="mt-0.5 block truncate text-[0.76rem] text-ink-muted">{c.subject}</span>
                    </span>
                    <span>
                      <StatusBadge tone={campaignTone(c.status)}>{c.status}</StatusBadge>
                    </span>
                    <span className="font-mono text-[0.76rem] text-ink-secondary tabular-nums">
                      {c.counts?.sent ?? 0}/{c.counts?.total ?? 0} sent
                      {(c.counts?.failed ?? 0) > 0 && <span className="text-red-300"> · {c.counts.failed} failed</span>}
                    </span>
                    <span className="font-mono text-[0.72rem] text-ink-muted">
                      {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <Modal open={wizardOpen} onClose={() => setWizardOpen(false)} title="New campaign" description="Five short steps — nothing sends until you confirm in the campaign view." size="lg">
        <CreateWizard
          onCancel={() => setWizardOpen(false)}
          onDone={(id) => {
            setWizardOpen(false);
            refetch();
            setSelected(id);
          }}
        />
      </Modal>
    </div>
  );
}
