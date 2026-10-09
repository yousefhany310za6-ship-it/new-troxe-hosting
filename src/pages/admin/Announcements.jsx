import { useMemo, useState } from 'react';
import { Archive, Eye, Megaphone, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { AnnouncementBanner, KIND_META } from '@/components/AnnouncementBanner.jsx';
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
    StatGrid,
    Stat,
    StatusBadge,
    TableSkeleton,
    fmtDateTime,
} from './components.jsx';
import {
    useAdminAnnouncementAction,
    useAdminAnnouncementCreate,
    useAdminAnnouncementDelete,
    useAdminAnnouncements,
    useAdminAnnouncementStats,
    useAdminAnnouncementUpdate,
    useAdminPlans,
} from '@/hooks/useAdminQueries.jsx';

const btnPrimary = 'rounded-full bg-white px-5 py-2 text-[0.83rem] font-bold text-black transition hover:bg-gray-200 disabled:opacity-60';
const btnGhost =
    'rounded-full border border-hairline px-5 py-2 text-[0.83rem] font-bold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:opacity-60';
const inputCls = 'input-field font-mono text-[0.83rem]';

const KINDS = [
    { value: 'info', label: 'Information — updates & news' },
    { value: 'success', label: 'Success — launches & wins' },
    { value: 'warning', label: 'Warning — maintenance & issues' },
    { value: 'critical', label: 'Critical — outages & incidents' },
];
const POLICIES = [
    { value: 'once', label: 'Once — until dismissed or acknowledged' },
    { value: 'every_visit', label: 'Every visit — each dashboard visit' },
    { value: 'interval', label: 'Interval — repeat after N hours' },
    { value: 'until_ack', label: 'Until acknowledged — stays up' },
];
const AUDIENCES = [
    { value: 'all', label: 'Everyone eligible' },
    { value: 'plans', label: 'Specific plans' },
    { value: 'users', label: 'Specific users' },
];
const FILTERS = [
    { id: '', label: 'All' },
    { id: 'active', label: 'Active' },
    { id: 'draft', label: 'Drafts' },
    { id: 'scheduled', label: 'Scheduled' },
    { id: 'paused', label: 'Paused' },
    { id: 'archived', label: 'Archived' },
];

function statusTone(s) {
    if (s === 'published') return 'emerald';
    if (s === 'scheduled') return 'blue';
    if (s === 'paused') return 'amber';
    if (s === 'archived') return 'zinc';
    return 'zinc';
}

const isoToLocal = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const blankForm = () => ({
    name: '',
    title: '',
    body: '',
    kind: 'info',
    policy: 'once',
    requireAck: false,
    intervalHours: '24',
    audienceType: 'all',
    plans: [],
    userIdsText: '',
    actionLabel: '',
    actionUrl: '',
    eventStart: '',
    eventEnd: '',
    publishAt: '',
    expiresAt: '',
});

function formFromRow(r) {
    const a = r?.audience ?? { type: 'all' };
    return {
        name: r?.name ?? '',
        title: r?.title ?? '',
        body: r?.body ?? '',
        kind: r?.kind ?? 'info',
        policy: r?.policy ?? 'once',
        requireAck: !!r?.requireAck,
        intervalHours: r?.intervalHours != null ? String(r.intervalHours) : '24',
        audienceType: a.type ?? 'all',
        plans: a.plans ?? [],
        userIdsText: (a.userIds ?? []).join('\n'),
        actionLabel: r?.actionLabel ?? '',
        actionUrl: r?.actionUrl ?? '',
        eventStart: isoToLocal(r?.eventStart),
        eventEnd: isoToLocal(r?.eventEnd),
        publishAt: isoToLocal(r?.publishAt),
        expiresAt: isoToLocal(r?.expiresAt),
    };
}

function parseUserIds(text) {
    return [...new Set(text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
}

function buildPayload(f) {
    const audience = f.audienceType === 'plans'
        ? { type: 'plans', plans: f.plans }
        : f.audienceType === 'users'
            ? { type: 'users', userIds: parseUserIds(f.userIdsText) }
            : { type: 'all' };
    const dt = (v) => (v ? new Date(v).toISOString() : undefined);
    const payload = {
        name: f.name.trim(),
        title: f.title.trim(),
        body: f.body,
        kind: f.kind,
        policy: f.policy,
        requireAck: !!f.requireAck,
        audience,
        actionLabel: f.actionLabel.trim() || undefined,
        actionUrl: f.actionUrl.trim() || undefined,
        eventStart: dt(f.eventStart),
        eventEnd: dt(f.eventEnd),
    };
    if (f.policy === 'interval') payload.intervalHours = Math.max(1, parseInt(f.intervalHours, 10) || 24);
    return { payload, publishAt: dt(f.publishAt), expiresAt: dt(f.expiresAt) };
}

function audienceSummary(a) {
    if (!a || a.type === 'all') return 'Everyone';
    if (a.type === 'plans') return `Plans: ${(a.plans ?? []).join(', ') || '—'}`;
    return `${(a.userIds ?? []).length} user(s)`;
}

function previewAnnouncement(f) {
    return {
        kind: f.kind,
        title: f.title || 'Announcement title',
        body: f.body || 'Announcement text appears here exactly as users will read it.',
        policy: f.policy,
        requireAck: f.requireAck,
        actionLabel: f.actionLabel || null,
        actionUrl: f.actionUrl || null,
        eventStart: f.eventStart ? new Date(f.eventStart).toISOString() : null,
        eventEnd: f.eventEnd ? new Date(f.eventEnd).toISOString() : null,
    };
}

export default function Announcements() {
    const [statusFilter, setStatusFilter] = useState('');
    const [page, setPage] = useState(1);
    const { data, isLoading, error, refetch } = useAdminAnnouncements({ status: statusFilter || undefined, page, limit: 20 });
    const { data: plansData } = useAdminPlans();
    const plans = useMemo(() => plansData ?? [], [plansData]);

    const [editing, setEditing] = useState(null); // null | {id} | {new:true}
    const [form, setForm] = useState(blankForm());
    const [formError, setFormError] = useState('');
    const [confirm, setConfirm] = useState(null); // {action, row} | {delete,row}
    const [scheduleFor, setScheduleFor] = useState(null);
    const [scheduleAt, setScheduleAt] = useState('');
    const [statsFor, setStatsFor] = useState(null);

    const createMut = useAdminAnnouncementCreate();
    const updateMut = useAdminAnnouncementUpdate(editing?.id);
    const actionMut = useAdminAnnouncementAction(editing?.id ?? confirm?.row?.id ?? scheduleFor?.id);
    const deleteMut = useAdminAnnouncementDelete(confirm?.row?.id);

    const rows = data?.items ?? [];
    const set = (k) => (e) => {
        const v = e?.target?.type === 'checkbox' ? e.target.checked : e?.target?.value ?? e;
        setForm((f) => ({ ...f, [k]: v }));
    };

    const openNew = () => {
        setEditing({ new: true });
        setForm(blankForm());
        setFormError('');
    };
    const openEdit = (row) => {
        setEditing({ id: row.id });
        setForm(formFromRow(row));
        setFormError('');
    };

    const validate = () => {
        if (!form.name.trim()) return 'Internal name is required.';
        if (!form.title.trim()) return 'Title is required.';
        if (!form.body.trim()) return 'Body text is required.';
        if (form.policy === 'interval' && !(parseInt(form.intervalHours, 10) > 0)) return 'Interval needs a positive hour count.';
        if (form.audienceType === 'plans' && form.plans.length === 0) return 'Pick at least one plan.';
        if (form.audienceType === 'users' && parseUserIds(form.userIdsText).length === 0) return 'Enter at least one user UUID.';
        if (form.actionUrl.trim() && !/^(?!javascript:|data:|vbscript:|file:)[^\s<>]+$/i.test(form.actionUrl.trim())) return 'Action URL must be a site path or http(s) URL.';
        if (form.eventStart && form.eventEnd && new Date(form.eventStart) >= new Date(form.eventEnd)) return 'Event start must be before event end.';
        return '';
    };

    const doSave = async () => {
        const err = validate();
        if (err) { setFormError(err); return; }
        setFormError('');
        const { payload, publishAt, expiresAt } = buildPayload(form);
        const full = {
            ...payload,
            publishAt: publishAt ?? null,
            expiresAt: expiresAt ?? null,
        };
        try {
            if (editing?.new) await createMut.mutateAsync(full);
            else await updateMut.mutateAsync(full);
            setEditing(null);
        } catch (e) {
            setFormError(e?.message || 'Save failed.');
        }
    };

    const runAction = async (action, body) => {
        try {
            await actionMut.mutateAsync({ action, body });
            setConfirm(null);
            setScheduleFor(null);
        } catch (e) {
            setConfirm((c) => (c ? { ...c, error: e?.message } : c));
        }
    };

    const items = (row) => {
        const list = [
            { key: 'edit', label: 'Edit', Icon: Pencil, onSelect: () => onMenu('edit', row) },
            { key: 'preview', label: 'Preview', Icon: Eye, onSelect: () => onMenu('preview', row) },
            { key: 'stats', label: 'View stats', Icon: Eye, onSelect: () => onMenu('stats', row) },
        ];
        if (row.status === 'draft' || row.status === 'scheduled' || row.status === 'paused') {
            list.push({ key: 'publish', label: row.status === 'paused' ? 'Resume (publish)' : 'Publish now', Icon: Play, onSelect: () => onMenu('publish', row) });
        }
        if (row.status === 'draft' || row.status === 'paused') list.push({ key: 'schedule', label: 'Schedule…', Icon: Pencil, onSelect: () => onMenu('schedule', row) });
        if (row.status === 'published' || row.status === 'scheduled') list.push({ key: 'pause', label: 'Pause', Icon: Pause, onSelect: () => onMenu('pause', row) });
        if (row.status !== 'archived') list.push({ key: 'archive', label: 'Archive', Icon: Archive, onSelect: () => onMenu('archive', row) });
        if (row.status !== 'published') list.push({ key: 'delete', label: 'Delete', Icon: Trash2, danger: true, onSelect: () => onMenu('delete', row) });
        return list;
    };

    const onMenu = (key, row) => {
        if (key === 'edit') openEdit(row);
        else if (key === 'preview') setEditing({ preview: row });
        else if (key === 'stats') setStatsFor(row);
        else if (key === 'schedule') { setScheduleFor(row); setScheduleAt(isoToLocal(row.publishAt) || ''); }
        else if (key === 'delete') setConfirm({ delete: true, row });
        else setConfirm({ action: key, row });
    };

    return (
        <div className="flex flex-col gap-5">
            <PageHeader
                title="Announcements"
                description="Banners and notices shown inside the user dashboard — drafts never leave this page."
                actions={
                    <button type="button" onClick={openNew} className={btnPrimary}>
                        <Plus size={15} className="mr-1 inline" /> New announcement
                    </button>
                }
            />

            <Section title="All announcements" description="Critical first is enforced on the user side; drafts are invisible to users.">
                <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Filter by status">
                    {FILTERS.map((f) => (
                        <button
                            key={f.id}
                            type="button"
                            role="tab"
                            aria-selected={statusFilter === f.id}
                            onClick={() => { setStatusFilter(f.id); setPage(1); }}
                            className={cn(
                                'rounded-full px-3.5 py-1.5 text-[0.78rem] font-semibold transition',
                                statusFilter === f.id ? 'bg-white text-black' : 'text-ink-secondary hover:text-foreground',
                            )}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>

                {isLoading && <TableSkeleton rows={5} />}
                {error && <ErrorState message={error.message} onRetry={() => refetch()} />}
                {!isLoading && !error && rows.length === 0 && (
                    <EmptyState icon={Megaphone} title="No announcements" hint="Create one to inform, warn, or alert your users." action={<button type="button" onClick={openNew} className={btnPrimary}>New announcement</button>} />
                )}
                {!isLoading && !error && rows.length > 0 && (
                    <div className="flex flex-col divide-y divide-hairline">
                        {rows.map((row) => {
                            const meta = KIND_META[row.kind] ?? KIND_META.info;
                            return (
                                <div key={row.id} className="flex flex-wrap items-center gap-3 px-1 py-3">
                                    <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl border', meta.chip, meta.text)}>
                                        <meta.Icon size={17} />
                                    </span>
                                    <div className="min-w-0 flex-1 basis-48">
                                        <p className="truncate text-[0.9rem] font-bold">
                                            {row.title} <span className="font-mono font-normal text-ink-muted">· {row.name}</span>
                                        </p>
                                        <p className="mt-0.5 truncate font-mono text-[0.7rem] text-ink-muted">
                                            v{row.contentVersion} · {row.policy}{row.requireAck ? ' · ack-required' : ''} · {audienceSummary(row.audience)}
                                            {row.publishAt ? ` · from ${fmtDateTime(row.publishAt)}` : ''}
                                            {row.expiresAt ? ` · until ${fmtDateTime(row.expiresAt)}` : ''}
                                        </p>
                                    </div>
                                    <StatusBadge tone={statusTone(row.status)}>{row.status}</StatusBadge>
                                    <button type="button" onClick={() => setStatsFor(row)} className="rounded-full border border-hairline px-3 py-1 font-mono text-[0.7rem] text-ink-secondary transition hover:text-foreground">
                                        stats
                                    </button>
                                    <Menu label={`Actions for ${row.name}`} items={items(row)} />
                                </div>
                            );
                        })}
                    </div>
                )}
            </Section>

            {/* ---------- editor ---------- */}
            {(editing?.new || editing?.id) && (
                <Modal
                    open
                    onClose={() => setEditing(null)}
                    title={editing?.new ? 'New announcement' : 'Edit announcement'}
                    description="Drafts are invisible to users. Publishing is a separate, audited action."
                    size="lg"
                    footer={
                        <>
                            <button type="button" onClick={() => setEditing(null)} className={btnGhost}>Cancel</button>
                            <button type="button" onClick={doSave} disabled={createMut.isPending || updateMut.isPending} className={btnPrimary}>
                                {editing?.new ? 'Save draft' : 'Save changes'}
                            </button>
                        </>
                    }
                >
                    {formError && <p className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-[0.83rem] text-red-300" role="alert">{formError}</p>}
                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                        <div className="flex flex-col gap-4">
                            <Field label="Internal name (admins only)">
                                <input value={form.name} onChange={set('name')} placeholder="july-maintenance" maxLength={100} className="input-field font-mono" />
                            </Field>
                            <Field label="Title (users see this)">
                                <input value={form.title} onChange={set('title')} placeholder="Scheduled maintenance" maxLength={140} className="input-field" />
                            </Field>
                            <Field label="Body text (plain text — no HTML)">
                                <textarea value={form.body} onChange={set('body')} placeholder="What users need to know…" rows={5} maxLength={4000} className="input-field resize-y" />
                            </Field>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <Field label="Kind">
                                    <Select ariaLabel="Kind" value={form.kind} onChange={set('kind')} options={KINDS} />
                                </Field>
                                <Field label="Display policy">
                                    <Select ariaLabel="Display policy" value={form.policy} onChange={set('policy')} options={POLICIES} />
                                </Field>
                            </div>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                {form.policy === 'interval' && (
                                    <Field label="Repeat every (hours)">
                                        <input value={form.intervalHours} onChange={set('intervalHours')} type="number" min={1} max={2160} className="input-field font-mono" />
                                    </Field>
                                )}
                                <label className="flex items-center gap-2.5 rounded-xl border border-hairline bg-veil/40 px-3.5 py-2.5 text-[0.83rem] font-semibold">
                                    <input type="checkbox" checked={form.requireAck} onChange={set('requireAck')} className="size-4 accent-white" />
                                    Mandatory — requires explicit acknowledgement
                                </label>
                            </div>
                            <Field label="Audience">
                                <Select ariaLabel="Audience" value={form.audienceType} onChange={set('audienceType')} options={AUDIENCES} />
                            </Field>
                            {form.audienceType === 'plans' && (
                                <div className="flex flex-wrap gap-2">
                                    {plans.map((p) => (
                                        <label key={p.id} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-[0.78rem] font-semibold text-ink-secondary transition hover:text-foreground">
                                            <input
                                                type="checkbox"
                                                checked={form.plans.includes(p.id)}
                                                onChange={() => setForm((f) => ({ ...f, plans: f.plans.includes(p.id) ? f.plans.filter((x) => x !== p.id) : [...f.plans, p.id] }))}
                                                className="size-3.5 accent-white"
                                            />
                                            {p.name ?? p.id}
                                        </label>
                                    ))}
                                </div>
                            )}
                            {form.audienceType === 'users' && (
                                <Field label="User UUIDs (one per line)">
                                    <textarea value={form.userIdsText} onChange={set('userIdsText')} placeholder="uuid…" rows={3} className="input-field font-mono text-[0.78rem]" />
                                </Field>
                            )}
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <Field label="Action label (optional)">
                                    <input value={form.actionLabel} onChange={set('actionLabel')} placeholder="Read the docs" maxLength={40} className="input-field" />
                                </Field>
                                <Field label="Action URL (optional)">
                                    <input value={form.actionUrl} onChange={set('actionUrl')} placeholder="/pricing or https://…" maxLength={500} className="input-field font-mono text-[0.8rem]" />
                                </Field>
                            </div>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <Field label="Event start (optional)">
                                    <input value={form.eventStart} onChange={set('eventStart')} type="datetime-local" className="input-field font-mono text-[0.8rem]" />
                                </Field>
                                <Field label="Event end (optional)">
                                    <input value={form.eventEnd} onChange={set('eventEnd')} type="datetime-local" className="input-field font-mono text-[0.8rem]" />
                                </Field>
                                <Field label="Publish at (optional)">
                                    <input value={form.publishAt} onChange={set('publishAt')} type="datetime-local" className="input-field font-mono text-[0.8rem]" />
                                </Field>
                                <Field label="Expires at (optional)">
                                    <input value={form.expiresAt} onChange={set('expiresAt')} type="datetime-local" className="input-field font-mono text-[0.8rem]" />
                                </Field>
                            </div>
                        </div>
                        <div className="flex flex-col gap-2">
                            <p className="font-mono text-[0.68rem] tracking-widest text-ink-muted uppercase">Live preview — exactly what users see</p>
                            <AnnouncementBanner announcement={previewAnnouncement(form)} preview />
                        </div>
                    </div>
                </Modal>
            )}

            {/* ---------- read-only preview ---------- */}
            {editing?.preview && (
                <Modal open onClose={() => setEditing(null)} title={editing.preview.title} description={`Internal name: ${editing.preview.name} · v${editing.preview.contentVersion}`}>
                    <AnnouncementBanner announcement={editing.preview} preview />
                </Modal>
            )}

            {/* ---------- schedule ---------- */}
            {scheduleFor && (
                <Modal
                    open
                    onClose={() => setScheduleFor(null)}
                    title="Schedule publishing"
                    description={`“${scheduleFor.title}” goes live automatically at the chosen time.`}
                    footer={
                        <>
                            <button type="button" onClick={() => setScheduleFor(null)} className={btnGhost}>Cancel</button>
                            <button type="button" disabled={!scheduleAt} onClick={() => runAction('schedule', { publishAt: new Date(scheduleAt).toISOString() })} className={btnPrimary}>
                                Schedule
                            </button>
                        </>
                    }
                >
                    <Field label="Publish at (must be in the future)">
                        <input value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} type="datetime-local" className="input-field font-mono" />
                    </Field>
                </Modal>
            )}

            {/* ---------- confirm ---------- */}
            {confirm && (
                <ConfirmModal
                    open
                    onClose={() => setConfirm(null)}
                    title={confirm.delete ? `Delete “${confirm.row.name}”?` : `${confirm.action} “${confirm.row.name}”?`}
                    description={
                        confirm.delete
                            ? 'The announcement and all its interaction history are permanently removed. Published banners must be paused or archived first.'
                            : confirm.action === 'publish'
                                ? 'Users matching the audience will start seeing this immediately.'
                                : confirm.action === 'archive'
                                    ? 'Archived banners stop showing and become read-only.'
                                    : 'Users stop seeing this until it is published again.'
                    }
                    confirmLabel={confirm.delete ? 'Delete' : confirm.action === 'publish' ? 'Publish' : confirm.action === 'archive' ? 'Archive' : confirm.action === 'pause' ? 'Pause' : 'Confirm'}
                    danger={confirm.delete || confirm.action === 'archive'}
                    onConfirm={() => (confirm.delete
                        ? deleteMut.mutateAsync().then(() => setConfirm(null)).catch((e) => { throw e; })
                        : runAction(confirm.action))}
                >
                    {confirm.error && <p className="text-[0.83rem] text-red-300" role="alert">{confirm.error}</p>}
                </ConfirmModal>
            )}

            {/* ---------- stats ---------- */}
            {statsFor && (
                <StatsModal row={statsFor} onClose={() => setStatsFor(null)} />
            )}
        </div>
    );
}

function StatsModal({ row, onClose }) {
    const { data, isLoading, error } = useAdminAnnouncementStats(row.id);
    return (
        <Modal open onClose={onClose} title={`Stats — ${row.name}`} description={`Content version v${row.contentVersion}. Counts are distinct users.`}>
            {isLoading && <p className="text-[0.85rem] text-ink-muted">Loading…</p>}
            {error && <p className="text-[0.85rem] text-red-400" role="alert">{error.message}</p>}
            {data && (
                <StatGrid>
                    <Stat label="Eligible audience" value={data.eligible} context="active accounts matching the audience" />
                    <Stat label="Shown" value={data.shown} context="distinct users, current version" />
                    <Stat label="Acknowledged" value={data.acked} context="explicit acks, current version" />
                    <Stat label="Dismissed" value={data.dismissed} context="dismissals, current version" />
                </StatGrid>
            )}
        </Modal>
    );
}
