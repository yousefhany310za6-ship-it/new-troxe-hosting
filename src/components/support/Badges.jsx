import { BadgeCheck, Check, CheckCheck, Clock, Headset } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Identity badge for a message author. The role comes from the server
 * (message.authorRole snapshot taken at send time, or the assignee's live
 * role from the ticket payload) — never from anything the client sends.
 */
export function RoleBadge({ role, size = 'sm', className }) {
    if (role !== 'support' && role !== 'admin') return null;
    const admin = role === 'admin';
    return (
        <span
            className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-bold whitespace-nowrap',
                size === 'xs' ? 'text-[0.62rem]' : 'text-[0.7rem]',
                admin ? 'border-amber-400/40 bg-amber-400/10 text-amber-200' : 'border-hairline bg-veil text-ink-secondary',
                className,
            )}
            title={admin ? 'Platform administrator' : 'Support team member'}
        >
            {admin ? (
                <>
                    <BadgeCheck className={cn('shrink-0 text-amber-300', size === 'xs' ? 'size-3' : 'size-3.5')} aria-hidden="true" />
                    Admin
                    <span className="sr-only">verified administrator</span>
                </>
            ) : (
                <>
                    <Headset className={cn('shrink-0', size === 'xs' ? 'size-3' : 'size-3.5')} aria-hidden="true" />
                    Support
                </>
            )}
        </span>
    );
}

/**
 * Online presence computed from live socket sessions on the server. The label
 * is always written out (never colour alone) for screen readers.
 */
export function PresenceDot({ online, lastSeenAt, className }) {
    const label = online
        ? 'Online now'
        : lastSeenAt
            ? `Offline · last seen ${new Date(lastSeenAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`
            : 'Offline';
    return (
        <span className={cn('inline-flex items-center gap-1.5 text-[0.72rem] font-semibold', className)} title={label}>
            <span className="relative flex size-2 shrink-0" aria-hidden="true">
                {online && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/60" />}
                <span className={cn('relative inline-flex size-2 rounded-full', online ? 'bg-emerald-400' : 'bg-zinc-600')} />
            </span>
            <span className={online ? 'text-emerald-300' : 'text-ink-muted'}>{online ? 'Online' : 'Offline'}</span>
            <span className="sr-only">{label}</span>
        </span>
    );
}

/**
 * Message receipt indicator. Sent = stored, Delivered = a counterpart socket
 * received it, Read = the counterpart read up to it. The backend decides all
 * three; the client only renders them.
 */
export function MessageTicks({ deliveredAt, readAt, mine }) {
    if (readAt) {
        return (
            <span className="inline-flex items-center gap-1 text-[0.68rem] font-semibold text-sky-300" title={`Read ${new Date(readAt).toLocaleString()}`}>
                <CheckCheck className="size-3.5" aria-hidden="true" />
                Read
            </span>
        );
    }
    if (deliveredAt) {
        return (
            <span className="inline-flex items-center gap-1 text-[0.68rem] font-semibold text-ink-secondary" title={`Delivered ${new Date(deliveredAt).toLocaleString()}`}>
                <CheckCheck className="size-3.5" aria-hidden="true" />
                Delivered
            </span>
        );
    }
    if (!mine) return null;
    return (
        <span className="inline-flex items-center gap-1 text-[0.68rem] font-semibold text-ink-muted" title="Saved on the server">
            <Check className="size-3.5" aria-hidden="true" />
            Sent
        </span>
    );
}

/** Pending/queued indicator for a message that failed to send. */
export function MessagePending({ onRetry }) {
    return (
        <span className="inline-flex items-center gap-1.5 text-[0.68rem] font-semibold text-amber-300">
            <Clock className="size-3.5" aria-hidden="true" />
            Not sent
            <button type="button" onClick={onRetry} className="ml-1 underline decoration-dotted hover:text-amber-200">
                Retry
            </button>
        </span>
    );
}

const TICKET_STATUS = {
    open: { label: 'Open', tone: 'blue' },
    in_progress: { label: 'In progress', tone: 'emerald' },
    waiting_user: { label: 'Waiting for you', tone: 'amber' },
    waiting_admin: { label: 'Waiting for admin', tone: 'violet' },
    resolved: { label: 'Resolved', tone: 'emerald' },
    closed: { label: 'Closed', tone: 'zinc' },
};

/** Ticket state pill: dot + text, so meaning never depends on colour alone. */
export function TicketStatusBadge({ status, className }) {
    const s = TICKET_STATUS[status] ?? { label: status ?? 'Unknown', tone: 'zinc' };
    return (
        <span
            className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[0.7rem] font-bold whitespace-nowrap',
                s.tone === 'emerald' && 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
                s.tone === 'amber' && 'border-amber-500/25 bg-amber-500/10 text-amber-300',
                s.tone === 'violet' && 'border-violet-500/25 bg-violet-500/10 text-violet-300',
                s.tone === 'blue' && 'border-blue-500/25 bg-blue-500/10 text-blue-300',
                s.tone === 'zinc' && 'border-hairline bg-veil text-ink-secondary',
                className,
            )}
        >
            <span
                className={cn(
                    'size-1.5 rounded-full',
                    s.tone === 'emerald' && 'bg-emerald-500',
                    s.tone === 'amber' && 'bg-amber-500',
                    s.tone === 'violet' && 'bg-violet-500',
                    s.tone === 'blue' && 'bg-blue-500',
                    s.tone === 'zinc' && 'bg-zinc-500',
                )}
                aria-hidden="true"
            />
            {s.label}
        </span>
    );
}

const CATEGORY_LABEL = {
    server_issue: 'Server issue',
    server_crash: 'Server crash',
    performance: 'Performance',
    billing: 'Billing',
    account: 'Account',
    technical: 'Technical',
    other: 'Other',
};

export const categoryLabel = (c) => CATEGORY_LABEL[c] ?? c ?? '—';

export const PRIORITY_TONE = { low: 'zinc', medium: 'zinc', high: 'amber', urgent: 'red' };

export const ticketNo = (n) => `#${String(n ?? 0).padStart(6, '0')}`;
