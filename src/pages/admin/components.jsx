import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { EllipsisVertical, Search } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/field.jsx';

/* ---------- formatting helpers (admin-wide, single source) ---------- */

export function timeAgo(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}

export function fmtBytes(n) {
  const v0 = Number(n) || 0;
  if (v0 <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = v0;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/* ---------- page header: title / description / primary action ---------- */

export function PageHeader({ title, description, actions }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[1.35rem] font-extrabold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[0.87rem] text-ink-secondary">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ---------- metrics: label / value / context (no invented deltas) ---------- */

export function Stat({ label, value, context, to, tone }) {
  const body = (
    <>
      <p className="truncate text-[0.78rem] font-semibold text-ink-secondary">{label}</p>
      <p className="mt-1.5 truncate text-[1.55rem] leading-none font-extrabold tabular-nums">{value}</p>
      {context && <p className="mt-1.5 truncate text-[0.74rem] text-ink-muted">{context}</p>}
    </>
  );
  const cls = cn(
    'min-w-0 rounded-xl border bg-card p-4 transition sm:p-5',
    tone === 'danger' && value !== '0' && value !== 0 ? 'border-red-500/30' : 'border-hairline',
    tone === 'warn' && value !== '0' && value !== 0 ? 'border-amber-500/25' : null,
    to && 'hover:border-hairline-hover',
  );
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function StatGrid({ children }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

/* ---------- section panel ---------- */

export function Section({ title, description, action, children, className }) {
  return (
    <section className={cn('rounded-xl border border-hairline bg-card', className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            {title && <h2 className="truncate text-[0.95rem] font-bold">{title}</h2>}
            {description && <p className="mt-0.5 truncate text-[0.78rem] text-ink-secondary">{description}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

/* ---------- status badge: dot + label (never color alone) ---------- */

const TONES = {
  emerald: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
  zinc: 'border-hairline bg-veil text-ink-secondary',
  amber: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
  red: 'border-red-500/25 bg-red-500/10 text-red-300',
  blue: 'border-blue-500/25 bg-blue-500/10 text-blue-300',
  violet: 'border-violet-500/25 bg-violet-500/10 text-violet-300',
};
const DOTS = { emerald: 'bg-emerald-500', zinc: 'bg-zinc-500', amber: 'bg-amber-500', red: 'bg-red-500', blue: 'bg-blue-500', violet: 'bg-violet-500' };

export function StatusBadge({ tone = 'zinc', dot = true, children, className }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[0.7rem] font-bold whitespace-nowrap', TONES[tone], className)}>
      {dot && <span className={cn('size-1.5 rounded-full', DOTS[tone])} />}
      {children}
    </span>
  );
}

export function userTone(status) {
  return status === 'suspended' ? 'amber' : status === 'deleted' ? 'zinc' : 'emerald';
}

export function serverTone(status) {
  if (status === 'online') return 'emerald';
  if (status === 'error') return 'red';
  if (status === 'suspended') return 'amber';
  if (status === 'restarting' || status === 'provisioning') return 'blue';
  return 'zinc';
}

/* ---------- audit target link (user/server drill-down) ---------- */

export function formatTargetLink(targetType, targetId) {
  if (!targetType || !targetId) return null;
  const short = `${String(targetId).slice(0, 8)}…`;
  if (targetType === 'user') return { to: `/admin/users/${targetId}`, label: short };
  if (targetType === 'server') return { to: `/admin/servers/${targetId}`, label: short };
  return null;
}

/* ---------- search input ---------- */

export function SearchInput({ value, onChange, placeholder, ariaLabel }) {
  return (
    <div className="relative min-w-0 flex-1 sm:max-w-xs">
      <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className="input-field pl-9"
      />
    </div>
  );
}

/* ---------- pagination ---------- */

export function Pager({ page, pages, total, unit = 'entries', onPage }) {
  const max = Math.max(1, pages ?? 1);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className="rounded-full border border-hairline px-5 py-2 text-sm font-bold text-ink-secondary transition hover:text-foreground disabled:opacity-40"
      >
        Prev
      </button>
      <span className="font-mono text-[0.78rem] text-ink-muted tabular-nums">
        Page {page} / {max}
        {typeof total === 'number' ? ` · ${total.toLocaleString()} ${unit}` : ''}
      </span>
      <button
        type="button"
        disabled={page >= max}
        onClick={() => onPage(page + 1)}
        className="rounded-full border border-hairline px-5 py-2 text-sm font-bold text-ink-secondary transition hover:text-foreground disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}

/* ---------- states: loading / empty / error ---------- */

export function TableSkeleton({ rows = 6, className }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={cn('h-12 rounded-xl', className)} />
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      {Icon && (
        <span className="mb-1 flex size-11 items-center justify-center rounded-xl border border-hairline bg-veil">
          <Icon className="size-5 text-ink-muted" />
        </span>
      )}
      <p className="text-[0.92rem] font-bold">{title}</p>
      {hint && <p className="max-w-sm text-[0.82rem] text-ink-secondary">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-red-500/25 bg-red-500/[0.05] px-4 py-10 text-center">
      <p className="text-[0.92rem] font-bold text-red-300">Unable to load</p>
      <p className="max-w-md text-[0.82rem] text-ink-secondary">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full border border-hairline px-5 py-2 text-[0.83rem] font-bold text-ink-secondary transition hover:text-foreground"
        >
          Retry
        </button>
      )}
    </div>
  );
}

/* ---------- kebab menu: accessible dropdown actions ---------- */

export function Menu({ label, items, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    const onDown = (e) => {
      if (!panelRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open ]);

  return (
    <span className="relative inline-flex shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted transition hover:bg-white/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <EllipsisVertical size={16} />
      </button>
      {open && (
        <span
          ref={panelRef}
          role="menu"
          aria-label={label}
          className={cn(
            'absolute top-full z-40 mt-1 w-48 overflow-hidden rounded-xl border border-hairline bg-card py-1 shadow-2xl',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((it) =>
            it.to ? (
              <Link
                key={it.key}
                to={it.to}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-[0.83rem] font-semibold text-ink-secondary transition hover:bg-veil hover:text-foreground"
              >
                {it.Icon && <it.Icon size={15} className="shrink-0" />}
                {it.label}
              </Link>
            ) : (
              <button
                key={it.key}
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect?.();
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 px-4 py-2 text-left text-[0.83rem] font-semibold transition hover:bg-veil hover:text-foreground disabled:opacity-40',
                  it.danger && 'text-red-300 hover:!text-red-200',
                )}
              >
                {it.Icon && <it.Icon size={15} className="shrink-0" />}
                {it.label}
              </button>
            ),
          )}
        </span>
      )}
    </span>
  );
}
