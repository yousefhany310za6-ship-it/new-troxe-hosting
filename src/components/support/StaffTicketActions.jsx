import { useState } from 'react';
import { BellRing, HandHelping, LogOut, Pencil, UserPlus } from 'lucide-react';

import { Modal } from '@/components/ui/modal.jsx';
import { useAuth } from '@/context/AuthContext.jsx';
import { useClaimTicket, useReleaseTicket, useRetitleTicket, useEscalateTicket } from '@/hooks/useSupportQueries.js';

/**
 * Staff-only ticket actions: claim (atomic), release back to the queue,
 * retitle, and Call Admin. Nothing here reaches an admin endpoint — the
 * backend refuses these routes for plain users with 403.
 */
export function StaffTicketActions({ ticket, onChanged, isStaff, isAdmin }) {
    const claim = useClaimTicket(ticket.id);
    const release = useReleaseTicket(ticket.id);
    const retitle = useRetitleTicket(ticket.id);
    const escalate = useEscalateTicket(ticket.id);
    const { user: me } = useAuth();

    const [escalateOpen, setEscalateOpen] = useState(false);
    const [reason, setReason] = useState('');
    const [retitleOpen, setRetitleOpen] = useState(false);
    const [subject, setSubject] = useState(ticket.subject);
    const [note, setNote] = useState(null);
    const [error, setError] = useState(null);

    if (!isStaff) return null;

    // "mine" means I hold it right now (admins may act on anything)
    const mine = !!ticket.assigneeId && ticket.assigneeId === me?.id;

    const run = async (fn, okNote) => {
        setError(null);
        try {
            await fn();
            setNote(okNote);
            onChanged?.();
            window.setTimeout(() => setNote(null), 4000);
        } catch (e) {
            setError(e?.message ?? 'Action failed.');
        }
    };

    return (
        <>
            <div className="flex flex-wrap items-center gap-2">
                {!ticket.assigneeId && ticket.status === 'open' && (
                    <button
                        type="button"
                        disabled={claim.isPending}
                        onClick={() => run(() => claim.mutateAsync(), 'Ticket assigned to you')}
                        className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-[0.78rem] font-bold text-black transition hover:bg-white/90 disabled:opacity-60"
                    >
                        <HandHelping className="size-3.5" aria-hidden="true" />
                        Take ticket
                    </button>
                )}
                {(mine || isAdmin) && ticket.assigneeId && ticket.status !== 'closed' && (
                    <button
                        type="button"
                        disabled={release.isPending}
                        onClick={() => run(() => release.mutateAsync(), 'Returned to the queue')}
                        className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3.5 py-1.5 text-[0.78rem] font-bold text-ink-secondary transition hover:text-foreground"
                    >
                        <LogOut className="size-3.5" aria-hidden="true" />
                        Leave ticket
                    </button>
                )}
                <button
                    type="button"
                    onClick={() => { setSubject(ticket.subject); setRetitleOpen(true); }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3.5 py-1.5 text-[0.78rem] font-bold text-ink-secondary transition hover:text-foreground"
                >
                    <Pencil className="size-3.5" aria-hidden="true" />
                    Rename
                </button>
                {ticket.status === 'in_progress' && !ticket.pendingEscalation && (
                    <button
                        type="button"
                        onClick={() => { setReason(''); setEscalateOpen(true); }}
                        className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-3.5 py-1.5 text-[0.78rem] font-bold text-violet-200 transition hover:bg-violet-500/20"
                    >
                        <BellRing className="size-3.5" aria-hidden="true" />
                        Call admin
                    </button>
                )}
                {ticket.pendingEscalation && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/25 bg-violet-500/10 px-3 py-1.5 text-[0.74rem] font-bold text-violet-200">
                        <BellRing className="size-3.5" aria-hidden="true" />
                        Admin already called in
                    </span>
                )}
                {isAdmin && !ticket.assigneeId && (
                    <span className="inline-flex items-center gap-1.5 text-[0.76rem] text-ink-muted">
                        <UserPlus className="size-3.5" aria-hidden="true" />
                        Assign this ticket from the admin console
                    </span>
                )}
            </div>
            {note && <span className="text-[0.76rem] text-emerald-300">{note}</span>}
            {error && <span className="text-[0.76rem] text-red-300">{error}</span>}

            <Modal
                open={escalateOpen}
                onClose={() => setEscalateOpen(false)}
                title="Call an admin"
                description="Your reason is saved immediately and pushed to every active administrator, whether or not one is connected right now. The ticket moves to waiting for admin."
            >
                <div className="flex flex-col gap-3">
                    <label htmlFor="esc-reason" className="text-[0.78rem] font-bold text-ink-secondary">Why do you need an admin?</label>
                    <textarea
                        id="esc-reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={4}
                        maxLength={500}
                        placeholder="e.g. the account needs a manual plan change, or the server filesystem is corrupted."
                        className="input-field resize-y"
                    />
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => setEscalateOpen(false)}
                            className="rounded-full border border-hairline px-4 py-2 text-[0.82rem] font-bold text-ink-secondary transition hover:text-foreground"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            disabled={reason.trim().length < 3 || escalate.isPending}
                            onClick={async () => {
                                setError(null);
                                try {
                                    const res = await escalate.mutateAsync(reason.trim());
                                    setEscalateOpen(false);
                                    setNote(res?.deduped ? 'An admin request was already open — no duplicate was sent.' : 'Admin notified.');
                                    window.setTimeout(() => setNote(null), 4000);
                                    onChanged?.();
                                } catch (e) {
                                    setError(e?.message ?? 'Could not escalate.');
                                }
                            }}
                            className="inline-flex items-center gap-2 rounded-full bg-violet-500/90 px-4 py-2 text-[0.82rem] font-bold text-white transition hover:bg-violet-500 disabled:opacity-60"
                        >
                            <BellRing className="size-4" aria-hidden="true" />
                            Notify admins
                        </button>
                    </div>
                </div>
            </Modal>

            <Modal open={retitleOpen} onClose={() => setRetitleOpen(false)} title="Rename ticket" description="The requester sees the new subject immediately.">
                <div className="flex flex-col gap-3">
                    <label htmlFor="re-subject" className="text-[0.78rem] font-bold text-ink-secondary">Subject</label>
                    <input
                        id="re-subject"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        maxLength={140}
                        className="input-field"
                    />
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => setRetitleOpen(false)}
                            className="rounded-full border border-hairline px-4 py-2 text-[0.82rem] font-bold text-ink-secondary transition hover:text-foreground"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            disabled={subject.trim().length < 4 || retitle.isPending}
                            onClick={async () => {
                                setError(null);
                                try {
                                    await retitle.mutateAsync(subject.trim());
                                    setRetitleOpen(false);
                                    setNote('Subject updated');
                                    window.setTimeout(() => setNote(null), 4000);
                                    onChanged?.();
                                } catch (e) {
                                    setError(e?.message ?? 'Could not rename the ticket.');
                                }
                            }}
                            className="rounded-full bg-white px-4 py-2 text-[0.82rem] font-bold text-black transition hover:bg-white/90 disabled:opacity-60"
                        >
                            Save
                        </button>
                    </div>
                </div>
            </Modal>
        </>
    );
}
