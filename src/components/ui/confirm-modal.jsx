import { useEffect, useMemo, useState } from 'react';
import { Loader2, TriangleAlert } from 'lucide-react';
import { Modal } from './modal.jsx';
import { cn } from '@/lib/utils.js';

/**
 * Destructive-action confirmation dialog.
 *
 * Modes:
 *  - plain confirm (confirmPhrase omitted)
 *  - typed confirmation: the action stays disabled until the input matches
 *    `confirmPhrase` exactly (case-sensitive, trimmed).
 *
 * Handles loading + inline API error rendering; the caller's onConfirm may be
 * async — thrown errors (ApiError) are displayed and the modal stays open.
 */
export function ConfirmModal({
  open,
  onClose,
  title,
  description,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmPhrase,
  phraseHint,
  confirmDisabled = false,
  onConfirm,
  danger = true,
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) { setTyped(''); setBusy(false); setError(null); }
  }, [open]);

  const phraseOk = useMemo(
    () => (confirmPhrase ? typed.trim() === confirmPhrase : true) && !confirmDisabled,
    [typed, confirmPhrase, confirmDisabled],
  );

  const run = async () => {
    if (!phraseOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose?.();
    } catch (e) {
      setError(e?.message || 'Request failed');
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      danger={danger}
      busy={busy}
      size="md"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost-modal">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={run}
            disabled={!phraseOk || busy}
            className={cn('btn-primary-modal', danger && 'btn-danger-modal')}
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        {children}
        {confirmPhrase && (
          <label className="block">
            <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-secondary">
              {phraseHint ?? <>Type <span className="font-mono font-bold text-ink">{confirmPhrase}</span> to confirm</>}
            </span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={confirmPhrase}
              autoComplete="off"
              spellCheck={false}
              className="input-field font-mono"
            />
          </label>
        )}
        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-[0.82rem] text-red-400">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </p>
        )}
      </div>
    </Modal>
  );
}

/** Shared modal button styles (used via @apply in index.css or inline). */
export const modalBtnBase = 'inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-[0.85rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';
