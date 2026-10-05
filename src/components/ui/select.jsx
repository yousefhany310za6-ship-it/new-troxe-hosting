import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils.js';

/**
 * Accessible custom select (listbox).
 *
 * - full keyboard support: ↑/↓ navigate, Enter/Space select, Esc close,
 *   Home/End jump, type-to-filter when `searchable`
 * - loading / disabled / empty states
 * - portal-positioned panel (never clipped by overflow), flips up when needed
 * - mobile: uses the same popover with larger touch targets
 *
 * options: [{ value, label, hint?, disabled? }]
 */
export function Select({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled = false,
  loading = false,
  searchable = false,
  emptyText = 'No options',
  className,
  buttonClassName,
  ariaLabel,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, up: false });
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);

  const selected = options.find((o) => o.value === value);
  const filtered = query
    ? options.filter((o) => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(query.toLowerCase()))
    : options;

  useLayoutEffect(() => {
    if (!open) return;
    const r = btnRef.current.getBoundingClientRect();
    const panelH = Math.min(320, 56 + filtered.length * 40);
    const up = r.bottom + panelH + 8 > window.innerHeight && r.top > panelH;
    setPos({
      top: up ? r.top - panelH - 6 : r.bottom + 6,
      left: r.left,
      width: Math.max(r.width, 200),
      up,
    });
  }, [open, filtered.length]);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (!panelRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(Math.max(0, filtered.findIndex((o) => o.value === value)));
      if (searchable) setTimeout(() => searchRef.current?.focus(), 20);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const commit = (opt) => {
    if (opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    btnRef.current?.focus();
  };

  const onKeyDown = (e) => {
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        btnRef.current?.focus();
        break;
      case 'ArrowDown':
        e.preventDefault();
        setActive((a) => Math.min(a + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
        break;
      case 'Home':
        e.preventDefault();
        setActive(0);
        break;
      case 'End':
        e.preventDefault();
        setActive(filtered.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (filtered[active]) commit(filtered[active]);
        break;
    }
  };

  useEffect(() => {
    if (active < 0) return;
    panelRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <div className={cn('relative inline-block', className)}>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled || loading}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={cn(
          'inline-flex w-full items-center justify-between gap-2 rounded-[10px] border border-hairline bg-background px-3 py-[9px] text-left text-[0.88rem] text-ink transition-colors',
          'hover:border-hairline-hover focus:outline-none focus:ring-2 focus:ring-white/10',
          'disabled:cursor-not-allowed disabled:opacity-50',
          buttonClassName,
        )}
      >
        <span className={cn('truncate', !selected && 'text-ink-muted')}>
          {loading ? 'Loading…' : selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={15} className={cn('shrink-0 text-ink-muted transition-transform', open && 'rotate-180')} />
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            aria-label={ariaLabel}
            className="fixed z-[95] overflow-hidden rounded-xl border border-hairline bg-card shadow-2xl"
            style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: 320 }}
          >
            {searchable && (
              <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
                <Search size={14} className="text-ink-muted" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                  onKeyDown={onKeyDown}
                  placeholder="Search…"
                  className="w-full bg-transparent text-[0.85rem] outline-none placeholder:text-ink-muted"
                />
              </div>
            )}
            <div className="max-h-[264px] overflow-y-auto p-1">
              {filtered.length === 0 && (
                <p className="px-3 py-2.5 text-[0.82rem] text-ink-muted">{emptyText}</p>
              )}
              {filtered.map((o, i) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  data-idx={i}
                  aria-selected={o.value === value}
                  disabled={o.disabled}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => commit(o)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[0.85rem] transition-colors',
                    i === active ? 'bg-veil text-ink' : 'text-ink-secondary',
                    o.disabled && 'cursor-not-allowed opacity-40',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{o.label}</span>
                    {o.hint && <span className="block truncate text-[0.72rem] text-ink-muted">{o.hint}</span>}
                  </span>
                  {o.value === value && <Check size={14} className="shrink-0" />}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
