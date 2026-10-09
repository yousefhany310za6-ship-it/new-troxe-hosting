import { AlertOctagon, AlertTriangle, ArrowUpRight, Check, CheckCircle2, Info, X } from 'lucide-react';

import { cn } from '@/lib/utils';

export const KIND_META = {
    info: { label: 'Information', Icon: Info, text: 'text-sky-300', chip: 'border-sky-500/30 bg-sky-500/10', bar: 'bg-sky-400' },
    success: { label: 'Success', Icon: CheckCircle2, text: 'text-emerald-300', chip: 'border-emerald-500/30 bg-emerald-500/10', bar: 'bg-emerald-400' },
    warning: { label: 'Warning', Icon: AlertTriangle, text: 'text-amber-300', chip: 'border-amber-500/30 bg-amber-500/10', bar: 'bg-amber-400' },
    critical: { label: 'Critical', Icon: AlertOctagon, text: 'text-red-300', chip: 'border-red-500/35 bg-red-500/10', bar: 'bg-red-400' },
};

export function formatEventWindow(start, end) {
    if (!start && !end) return null;
    const fmt = (v) => {
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) return null;
        return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };
    const a = start ? fmt(start) : null;
    const b = end ? fmt(end) : null;
    if (a && b) return `${a} → ${b}`;
    if (a) return `Starts ${a}`;
    return `Until ${b}`;
}

/**
 * Shared announcement banner (user dashboard + admin live preview).
 * Body is ALWAYS plain text — never HTML. Kind is conveyed by icon + text
 * label, never color alone.
 */
export function AnnouncementBanner({
    announcement,
    interaction = null,
    onAck,
    onDismiss,
    ackBusy = false,
    dismissBusy = false,
    preview = false,
}) {
    const meta = KIND_TILE_FALLBACK(announcement?.kind);
    const { Icon } = meta;
    const acked = !!interaction?.ackedAt;
    const needsAck = (announcement?.policy === 'until_ack' || announcement?.requireAck) && !acked;
    const canHide = !announcement?.requireAck || acked;
    // until_ack banners have no dismiss path at all — only explicit ack hides
    // them. every_visit dismiss is view-local (parent hides for this mount).
    const showDismissBtn = canHide && announcement?.policy !== 'until_ack';
    const windowText = formatEventWindow(announcement?.eventStart, announcement?.eventEnd);

    return (
        <article
            role={announcement?.kind === 'critical' ? 'alert' : 'status'}
            aria-label={`${meta.label}: ${announcement?.title ?? ''}`}
            className={cn(
                'relative overflow-hidden rounded-2xl border bg-card',
                announcement?.kind === 'critical' ? 'border-red-500/35' : 'border-hairline',
            )}
        >
            <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-1', meta.bar)} />
            <div className="flex items-start gap-3.5 p-4 sm:p-5">
                <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl border', meta.chip, meta.text)}>
                    <Icon size={20} />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className={cn('rounded-full border px-2 py-0.5 text-[0.66rem] font-bold tracking-wide uppercase', meta.chip, meta.text)}>
                            {meta.label}
                        </span>
                        {announcement?.policy === 'until_ack' && !acked && (
                            <span className="rounded-full border border-hairline bg-veil px-2 py-0.5 text-[0.66rem] font-bold text-ink-secondary">
                                Acknowledgement required
                            </span>
                        )}
                        {acked && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[0.66rem] font-bold text-emerald-300">
                                <Check size={11} /> Acknowledged
                            </span>
                        )}
                    </div>
                    <h3 className="mt-1.5 text-[1rem] leading-snug font-extrabold tracking-tight text-foreground">
                        {announcement?.title}
                    </h3>
                    {/* plain text only — whitespace preserved, no HTML parsing */}
                    <p className="mt-1 text-[0.86rem] leading-relaxed whitespace-pre-wrap text-ink-secondary">
                        {announcement?.body}
                    </p>
                    {windowText && (
                        <p className="mt-2 font-mono text-[0.72rem] text-ink-muted">
                            {announcement?.kind === 'critical' || announcement?.kind === 'warning' ? 'Maintenance window: ' : 'Event: '}{windowText}
                        </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        {announcement?.actionLabel && announcement?.actionUrl && (
                            <a
                                href={announcement.actionUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-[0.78rem] font-bold text-black transition hover:bg-gray-200"
                            >
                                {announcement.actionLabel}
                                <ArrowUpRight size={14} />
                            </a>
                        )}
                        {!preview && needsAck && (
                            <button
                                type="button"
                                onClick={onAck}
                                disabled={ackBusy}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-veil px-4 py-2 text-[0.78rem] font-bold text-foreground transition hover:border-hairline-hover disabled:opacity-60"
                            >
                                {ackBusy ? 'Saving…' : 'Got it, acknowledge'}
                            </button>
                        )}
                        {!preview && showDismissBtn && onDismiss && (
                            <button
                                type="button"
                                onClick={onDismiss}
                                disabled={dismissBusy}
                                aria-label="Dismiss announcement"
                                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[0.78rem] font-semibold text-ink-muted transition hover:bg-veil hover:text-foreground disabled:opacity-60"
                            >
                                <X size={14} />
                                Dismiss
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </article>
    );
}

function KIND_TILE_FALLBACK(kind) {
    return KIND_META[kind] ?? KIND_META.info;
}
