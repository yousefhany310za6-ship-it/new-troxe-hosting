import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, Loader2, Server, Ticket as TicketIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { apiGet } from '@/lib/api.js';
import { ApiError } from '@/lib/api.js';
import { useCreateTicket } from '@/hooks/useSupportQueries.js';

const CATEGORIES = [
    { value: 'server_issue', label: 'Server issue' },
    { value: 'server_crash', label: 'Server crash' },
    { value: 'performance', label: 'Performance' },
    { value: 'billing', label: 'Billing' },
    { value: 'account', label: 'Account' },
    { value: 'technical', label: 'Technical' },
    { value: 'other', label: 'Other' },
];

const PRIORITIES = [
    { value: 'low', label: 'Low — general question' },
    { value: 'medium', label: 'Medium — degraded but usable' },
    { value: 'high', label: 'High — service down' },
];

/**
 * Ticket composer. The linked server is resolved from the owner's own list
 * (its contact code is what gets sent), so a guessed code can never attach
 * somebody else's server — the backend re-checks ownership anyway.
 */
export function CreateTicketForm({ onDone, onCancel }) {
    const navigate = useNavigate();
    const create = useCreateTicket();
    const [servers, setServers] = useState(null);
    const [serversError, setServersError] = useState(null);
    const [form, setForm] = useState({
        subject: '',
        category: 'technical',
        description: '',
        priority: 'medium',
        serverId: '',
        manualCode: '',
    });
    const [touched, setTouched] = useState(false);

    useEffect(() => {
        let alive = true;
        apiGet('/servers')
            .then((rows) => { if (alive) setServers(rows ?? []); })
            .catch((e) => { if (alive) setServersError(e?.message ?? 'Could not load your servers'); });
        return () => { alive = false; };
    }, []);

    const serverOptions = useMemo(
        () => (servers ?? []).filter((s) => s.status !== 'deleting'),
        [servers]
    );

    const subjectError = form.subject.trim().length < 4 ? 'Use at least 4 characters.' : null;
    const descriptionError = form.description.trim().length < 10 ? 'Describe the problem in at least 10 characters.' : null;
    const codeError = form.manualCode && !/^\d{8}$/.test(form.manualCode.trim()) ? 'A contact ID is exactly 8 digits.' : null;
    const valid = !subjectError && !descriptionError && !codeError;

    const submit = async (e) => {
        e.preventDefault();
        setTouched(true);
        if (!valid) return;
        const picked = serverOptions.find((s) => s.id === form.serverId);
        const body = {
            subject: form.subject.trim(),
            category: form.category,
            description: form.description.trim(),
            priority: form.priority,
        };
        if (picked?.contactCode) body.serverContactCode = picked.contactCode;
        else if (form.manualCode.trim()) body.serverContactCode = form.manualCode.trim();
        try {
            const created = await create.mutateAsync(body);
            onDone?.();
            navigate(`/dashboard/support/${created.id}`);
        } catch {
            /* the mutation surfaces the error below */
        }
    };

    const serverError = create.error instanceof ApiError ? create.error : null;

    return (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1.5">
                <label htmlFor="t-subject" className="text-[0.78rem] font-bold text-ink-secondary">Subject</label>
                <input
                    id="t-subject"
                    value={form.subject}
                    onChange={(e) => setForm({ ...form, subject: e.target.value })}
                    maxLength={140}
                    placeholder="e.g. Node server crashes on restart"
                    className="input-field"
                    aria-invalid={touched && !!subjectError}
                    aria-describedby={touched && subjectError ? 't-subject-err' : undefined}
                />
                {touched && subjectError && <p id="t-subject-err" className="text-[0.74rem] text-red-300">{subjectError}</p>}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                    <label htmlFor="t-category" className="text-[0.78rem] font-bold text-ink-secondary">Category</label>
                    <select
                        id="t-category"
                        value={form.category}
                        onChange={(e) => setForm({ ...form, category: e.target.value })}
                        className="input-field"
                    >
                        {CATEGORIES.map((c) => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                    </select>
                </div>
                <div className="flex flex-col gap-1.5">
                    <label htmlFor="t-priority" className="text-[0.78rem] font-bold text-ink-secondary">Priority</label>
                    <select
                        id="t-priority"
                        value={form.priority}
                        onChange={(e) => setForm({ ...form, priority: e.target.value })}
                        className="input-field"
                    >
                        {PRIORITIES.map((p) => (
                            <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                    </select>
                    <p className="text-[0.7rem] text-ink-muted">Critical priority is set by the support team, not by the requester.</p>
                </div>
            </div>

            <div className="flex flex-col gap-1.5">
                <label htmlFor="t-description" className="text-[0.78rem] font-bold text-ink-secondary">What happened?</label>
                <textarea
                    id="t-description"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    rows={5}
                    maxLength={5000}
                    placeholder="Steps to reproduce, what you expected, and any error text you saw."
                    className="input-field resize-y"
                    aria-invalid={touched && !!descriptionError}
                />
                {touched && descriptionError
                    ? <p className="text-[0.74rem] text-red-300">{descriptionError}</p>
                    : <p className="text-[0.7rem] text-ink-muted">{form.description.length}/5000 · please do not paste passwords or API keys</p>}
            </div>

            <fieldset className="rounded-xl border border-hairline bg-veil/60 p-3.5">
                <legend className="px-1 text-[0.78rem] font-bold text-ink-secondary">Related server (optional)</legend>
                {serversError ? (
                    <p className="flex items-center gap-2 text-[0.78rem] text-amber-300">
                        <AlertTriangle className="size-4" aria-hidden="true" />
                        {serversError} — you can still open the ticket.
                    </p>
                ) : servers === null ? (
                    <p className="flex items-center gap-2 text-[0.78rem] text-ink-muted">
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading your servers…
                    </p>
                ) : serverOptions.length === 0 ? (
                    <p className="text-[0.78rem] text-ink-muted">You have no servers yet.</p>
                ) : (
                    <div className="flex flex-col gap-1.5">
                        {serverOptions.map((s) => (
                            <label
                                key={s.id}
                                className={cn(
                                    'flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-[0.82rem] transition',
                                    form.serverId === s.id ? 'border-white/25 bg-white/[0.06]' : 'border-hairline hover:border-hairline-hover'
                                )}
                            >
                                <input
                                    type="radio"
                                    name="t-server"
                                    value={s.id}
                                    checked={form.serverId === s.id}
                                    onChange={() => setForm({ ...form, serverId: s.id, manualCode: '' })}
                                    className="size-3.5 accent-white"
                                />
                                <Server className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                                <span className="min-w-0 flex-1 truncate font-semibold text-foreground">{s.name}</span>
                                <span className="font-mono text-[0.72rem] text-ink-muted">{s.contactCode ?? '—'}</span>
                            </label>
                        ))}
                    </div>
                )}
                <div className="mt-3 flex flex-col gap-1.5">
                    <label htmlFor="t-code" className="text-[0.74rem] font-semibold text-ink-secondary">
                        Or enter a server contact ID (8 digits)
                    </label>
                    <input
                        id="t-code"
                        value={form.manualCode}
                        onChange={(e) => setForm({ ...form, manualCode: e.target.value, serverId: '' })}
                        inputMode="numeric"
                        maxLength={8}
                        placeholder="58310472"
                        className="input-field font-mono tracking-[0.2em]"
                        aria-invalid={touched && !!codeError}
                    />
                    {touched && codeError && <p className="text-[0.74rem] text-red-300">{codeError}</p>}
                </div>
            </fieldset>

            {serverError && (
                <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-[0.8rem] text-red-200" role="alert">
                    {serverError.message ?? 'Could not create the ticket.'}
                </p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2">
                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="rounded-full border border-hairline px-4 py-2 text-[0.82rem] font-bold text-ink-secondary transition hover:text-foreground"
                    >
                        Cancel
                    </button>
                )}
                <button
                    type="submit"
                    disabled={create.isPending}
                    className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[0.82rem] font-bold text-black transition hover:bg-white/90 disabled:opacity-60"
                >
                    {create.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <TicketIcon className="size-4" aria-hidden="true" />}
                    {create.isPending ? 'Sending…' : 'Open ticket'}
                    {create.isSuccess && <Check className="size-4" aria-hidden="true" />}
                </button>
            </div>
        </form>
    );
}
