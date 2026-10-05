import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils.js';

/**
 * Shared modal dialog.
 * - portal to <body>, overlay click + Escape close (unless busy)
 * - mobile: bottom-sheet; sm+: centered dialog
 * - danger variant accents destructive actions
 */
export function Modal({ open, onClose, title, description, children, footer, size = 'md', danger = false, busy = false, closeOnOverlay = true }) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // focus the first focusable element for keyboard users
    const t = setTimeout(() => {
      const el = panelRef.current?.querySelector('input,button:not([disabled]),textarea,select');
      el?.focus();
    }, 30);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      clearTimeout(t);
    };
  }, [open, busy, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => { if (!busy && closeOnOverlay) onClose?.(); }}
      />
      <div
        ref={panelRef}
        className={cn(
          'relative z-10 w-full border border-hairline bg-card shadow-2xl',
          'rounded-t-2xl sm:rounded-2xl',
          'max-h-[92dvh] overflow-y-auto overscroll-contain',
          size === 'sm' && 'sm:max-w-sm',
          size === 'md' && 'sm:max-w-md',
          size === 'lg' && 'sm:max-w-lg',
          size === 'xl' && 'sm:max-w-2xl',
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
          <div className="min-w-0">
            <h2 className={cn('text-[1.02rem] font-bold leading-6', danger && 'text-red-400')}>{title}</h2>
            {description && <p className="mt-1 text-[0.83rem] leading-5 text-ink-secondary">{description}</p>}
          </div>
          <button
            type="button"
            onClick={() => { if (!busy) onClose?.(); }}
            disabled={busy}
            aria-label="Close"
            className="rounded-full p-1.5 text-ink-muted transition-colors hover:bg-veil hover:text-ink disabled:opacity-40"
          >
            <X size={17} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex flex-col-reverse gap-2 border-t border-hairline px-5 py-4 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
