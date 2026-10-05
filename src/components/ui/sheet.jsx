import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Prompt/action sheet: bottom-sheet on mobile, centered dialog on desktop.
 * Replaces browser prompt()/confirm() dialogs with an in-app form.
 */
export function Sheet({ title, subtitle, onClose, onSubmit, submitLabel = 'Save', danger = false, children }) {
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prev;
        };
    }, [onClose]);

    const submit = async (e) => {
        e?.preventDefault?.();
        if (busy) return;
        setBusy(true);
        try {
            await onSubmit();
        } finally {
            setBusy(false);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[92] flex items-end justify-center sm:items-center">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => !busy && onClose()} />
            <form
                onSubmit={submit}
                className={cn(
                    'relative z-10 w-full max-w-md border border-hairline bg-card shadow-2xl',
                    'rounded-t-2xl sm:rounded-2xl',
                    'max-h-[92dvh] overflow-y-auto overscroll-contain',
                )}
            >
                <div className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
                    <div className="min-w-0">
                        <h3 className={cn('text-[1rem] font-bold', danger && 'text-red-400')}>{title}</h3>
                        {subtitle && <p className="mt-0.5 truncate font-mono text-[0.75rem] text-ink-muted">{subtitle}</p>}
                    </div>
                    <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="rounded-full p-1.5 text-ink-muted transition hover:bg-veil hover:text-ink disabled:opacity-40">
                        <X size={16} />
                    </button>
                </div>
                <div className="px-5 py-4">{children}</div>
                <div className="flex justify-end gap-2 border-t border-hairline px-5 py-4">
                    <button type="button" onClick={onClose} disabled={busy} className="btn-ghost-modal">Cancel</button>
                    <button type="submit" disabled={busy} className={cn('btn-primary-modal', danger && 'btn-danger-modal')}>
                        {busy && <Loader2 size={15} className="animate-spin" />}
                        {submitLabel}
                    </button>
                </div>
            </form>
        </div>,
        document.body,
    );
}