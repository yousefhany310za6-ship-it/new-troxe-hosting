import { Power } from 'lucide-react';

import { cn } from '@/lib/utils';
import { DEMO_COLORS, fmtPct } from '@/data/demoData.js';

/* ============================================================
 * Shared visual building blocks for the demo dashboard.
 *
 * Every class string below is copied from the production page it
 * came from, so the demo renders identically to the real panel:
 *   · Bar / Sparkline / Panel / Tile / LimitRow / Pill / Row
 *     -> src/pages/dashboard/ServerOverview.jsx
 *   · Ring / SegmentedBar / LineChart / Trio / InfoRow
 *     -> src/pages/dashboard/ResourceMonitor.jsx
 *
 * They live here (rather than being imported) because the
 * production modules import the API layer at module scope, and the
 * landing page must never pull that in for anonymous visitors.
 * ============================================================ */

export const COLORS = DEMO_COLORS;

/* ---- status tones (ServerOverview.jsx `STATUS`) --------------- */
export const STATUS = {
    online: {
        label: 'Online',
        glow: '16,185,129',
        dot: 'bg-emerald-500',
        text: 'text-emerald-300',
        ring: 'border-emerald-500/30 bg-emerald-500/10',
    },
    offline: {
        label: 'Offline',
        glow: '113,113,122',
        dot: 'bg-zinc-500',
        text: 'text-ink-secondary',
        ring: 'border-hairline bg-veil',
    },
    restarting: {
        label: 'Restarting',
        glow: '245,158,11',
        dot: 'bg-amber-500',
        text: 'text-amber-300',
        ring: 'border-amber-500/30 bg-amber-500/10',
    },
};

export const statusOf = (s) => STATUS[s] ?? STATUS.offline;

/** Flat status dot colour used in table rows (`STATUS_STYLE`). */
export const dotFor = (s) =>
    ({
        online: 'bg-emerald-500',
        offline: 'bg-zinc-600',
        restarting: 'bg-amber-500',
        error: 'bg-red-500',
        provisioning: 'bg-blue-500',
        suspended: 'bg-red-500',
    })[s] ?? 'bg-zinc-600';

/* ---- Bar — the meter used by every resource row -------------- */
export function Bar({ pct, color }) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    return (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
            <div
                className="h-full rounded-full"
                style={{
                    width: `${p}%`,
                    background: `linear-gradient(90deg, ${color}99, ${color})`,
                    transition: 'width .6s ease',
                }}
            />
        </div>
    );
}

/* ---- Sparkline — 40-sample CPU / network history -------------- */
export function Sparkline({ values, color, max }) {
    const W = 100;
    const H = 32;
    const series = values?.length ? values : null;

    if (!series) {
        return <div className="h-8 w-full rounded-md bg-white/[0.03]" />;
    }

    const peak = max ?? Math.max(...series, 1);
    const step = W / Math.max(series.length - 1, 1);
    const pts = series.map((v, i) => [i * step, H - (Math.max(0, v) / peak) * H]);
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
    const gradId = `demo-sp-${color.slice(1)}`;

    return (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-8 w-full" aria-hidden="true">
            <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
            </defs>
            <path d={`${line} L${W} ${H} L0 ${H} Z`} fill={`url(#${gradId})`} />
            <path
                d={line}
                fill="none"
                stroke={color}
                strokeWidth="1.8"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
            />
        </svg>
    );
}

/* ---- Panel — titled card (ServerOverview.jsx) ----------------- */
export function Panel({ title, icon: Icon, right, className, children }) {
    return (
        // `min-w-0`: as a grid item the default `min-width: auto` refuses to
        // shrink below its content, which pushes narrow phones into a
        // horizontal scroll.
        <section
            className={cn(
                'flex min-w-0 flex-col rounded-2xl border border-hairline bg-card',
                className
            )}
        >
            <header className="flex items-center gap-2.5 border-b border-hairline px-5 py-3.5">
                {Icon && <Icon className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />}
                <h3 className="flex-1 text-[0.92rem] font-semibold">{title}</h3>
                {right}
            </header>
            <div className="flex-1 p-5">{children}</div>
        </section>
    );
}

/* ---- Tile — one metric card ---------------------------------- */
export function Tile({ icon: Icon, label, color, value, sub, children }) {
    return (
        <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-hairline bg-card p-4 sm:p-5">
            <div className="flex items-center gap-2.5">
                <span
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-hairline bg-veil"
                    style={{ color }}
                >
                    <Icon className="size-4" />
                </span>
                <span className="text-[0.8rem] font-semibold text-ink-secondary">{label}</span>
            </div>
            <div>
                <p className="truncate text-[1.45rem] leading-none font-bold tabular-nums">{value}</p>
                <p className="mt-1.5 truncate text-[0.74rem] text-ink-muted">{sub}</p>
            </div>
            {children}
        </div>
    );
}

/* ---- LimitRow — label / used / limit + meter ------------------ */
export function LimitRow({ icon: Icon, color, label, used, limit, pct }) {
    return (
        <div>
            <div className="mb-1.5 flex items-center justify-between gap-3 text-[0.82rem]">
                <span className="inline-flex items-center gap-2 text-ink-secondary">
                    <Icon className="size-3.5" style={{ color }} aria-hidden="true" />
                    {label}
                </span>
                <span className="font-semibold tabular-nums">
                    {used} <span className="font-normal text-ink-muted">/ {limit}</span>
                </span>
            </div>
            <Bar pct={pct} color={color} />
        </div>
    );
}

/* ---- Pill — on/off boolean chip ------------------------------- */
export function Pill({ on, children }) {
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[0.72rem] font-semibold',
                on
                    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                    : 'border-hairline bg-veil text-ink-secondary'
            )}
        >
            <span className={cn('size-1.5 rounded-full', on ? 'bg-emerald-500' : 'bg-zinc-500')} />
            {children}
        </span>
    );
}

/* ---- Row — configuration key/value ---------------------------- */
export function Row({ label, children }) {
    return (
        <div className="flex items-center justify-between gap-4 py-2.5">
            <span className="shrink-0 text-[0.82rem] text-ink-muted">{label}</span>
            <div className="flex min-w-0 items-center gap-1.5 text-[0.85rem] font-semibold">{children}</div>
        </div>
    );
}

/* ---- Ring — circular percentage gauge ------------------------- */
export function Ring({ pct, color, text }) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    const c = 2 * Math.PI * 22;
    return (
        <div className="relative size-14 shrink-0">
            <svg viewBox="0 0 56 56" className="-rotate-90 size-full" aria-hidden="true">
                <circle cx="28" cy="28" r="22" stroke="rgba(255,255,255,0.07)" strokeWidth="4" fill="none" />
                <circle
                    cx="28"
                    cy="28"
                    r="22"
                    stroke={color}
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={`${(c * p) / 100} ${c}`}
                    fill="none"
                    style={{ transition: 'stroke-dasharray .6s ease' }}
                />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[0.72rem] font-bold tabular-nums">
                {text}
            </span>
        </div>
    );
}

/* ---- SegmentedBar — memory with 25/50/75 tick marks ------------ */
export function SegmentedBar({ pct, color }) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    return (
        <div className="relative h-3 w-full overflow-hidden rounded-full bg-white/[0.07]">
            <div
                className="h-full rounded-full"
                style={{
                    width: `${p}%`,
                    background: `linear-gradient(90deg, ${color}99, ${color})`,
                    transition: 'width .6s ease',
                }}
            />
            {[25, 50, 75].map((t) => (
                <span key={t} className="absolute top-0 h-full w-px bg-black/70" style={{ left: `${t}%` }} />
            ))}
        </div>
    );
}

/* ---- LineChart — CPU history graph ---------------------------- */
export function LineChart({ series, color, height = 'h-32', max }) {
    const W = 300;
    const H = 100;
    const peak = max ?? Math.max(...(series ?? []), 1);

    const path = (values) => {
        if (!values?.length) return '';
        const step = W / Math.max(values.length - 1, 1);
        return values
            .map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(2)} ${(H - (Math.max(0, v) / peak) * H).toFixed(2)}`)
            .join(' ');
    };

    const line = path(series);

    return (
        <div className={cn('relative w-full overflow-hidden rounded-xl bg-white/[0.02]', height)}>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden="true">
                <defs>
                    <linearGradient id={`demo-lc-${color.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity="0.28" />
                        <stop offset="100%" stopColor={color} stopOpacity="0" />
                    </linearGradient>
                </defs>
                {[25, 50, 75].map((y) => (
                    <line
                        key={y}
                        x1="0"
                        y1={y}
                        x2={W}
                        y2={y}
                        stroke="rgba(255,255,255,0.06)"
                        strokeDasharray="3 4"
                        vectorEffect="non-scaling-stroke"
                    />
                ))}
                {line && <path d={`${line} L${W} ${H} L0 ${H} Z`} fill={`url(#demo-lc-${color.slice(1)})`} />}
                {line && (
                    <path
                        d={line}
                        fill="none"
                        stroke={color}
                        strokeWidth="2"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        vectorEffect="non-scaling-stroke"
                    />
                )}
            </svg>
            {!series?.length && (
                <span className="absolute inset-0 flex items-center justify-center text-[0.75rem] text-ink-muted">
                    Server is offline
                </span>
            )}
        </div>
    );
}

/* ---- Trio — three-column mini stat row ------------------------ */
export function Trio({ items }) {
    return (
        <dl className="grid grid-cols-3 gap-2 text-center">
            {items.map(({ label, value, color }) => (
                <div key={label} className="min-w-0">
                    <dt className="flex items-center justify-center gap-1.5 text-[0.68rem] font-semibold tracking-[0.12em] text-ink-muted uppercase">
                        {color && <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />}
                        {label}
                    </dt>
                    <dd className="mt-1 truncate text-[0.88rem] font-semibold tabular-nums">{value}</dd>
                </div>
            ))}
        </dl>
    );
}

/* ---- InfoRow — label on the left, value on the right --------- */
export function InfoRow({ label, value, mono }) {
    return (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-hairline bg-white/[0.02] px-4 py-3">
            <span className="text-[0.82rem] text-ink-muted">{label}</span>
            <span className={cn('min-w-0 truncate text-[0.86rem] font-semibold', mono && 'font-mono')}>{value}</span>
        </div>
    );
}

/* ---- Status hero — the big status block at the top of Overview */
export function StatusHero({ status, sub, chips }) {
    const st = statusOf(status);
    const online = status === 'online';

    return (
        <section
            className="relative overflow-hidden rounded-2xl border border-hairline bg-card p-5 sm:p-6"
            style={{ backgroundImage: `radial-gradient(700px circle at 0% 0%, rgba(${st.glow},0.14), transparent 60%)` }}
        >
            <div className="relative flex flex-wrap items-center gap-x-6 gap-y-4">
                <div className="flex min-w-0 items-center gap-4">
                    <span className={cn('relative flex size-14 shrink-0 items-center justify-center rounded-2xl border', st.ring, st.text)}>
                        <Power className="size-6" aria-hidden="true" />
                        {online && (
                            <span className="absolute -top-1 -right-1 size-3 animate-beat rounded-full border-2 border-black bg-emerald-500" />
                        )}
                    </span>
                    <div className="min-w-0">
                        <p className={cn('text-[1.5rem] leading-none font-extrabold', st.text)}>{st.label}</p>
                        <p className="mt-1.5 text-[0.85rem] text-ink-secondary tabular-nums">{sub}</p>
                    </div>
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                    {chips.map((c) => (
                        <span
                            key={c}
                            className="rounded-full border border-hairline bg-black/30 px-3 py-1 text-[0.76rem] font-semibold text-ink-secondary capitalize backdrop-blur"
                        >
                            {c}
                        </span>
                    ))}
                </div>
            </div>
        </section>
    );
}

/** Compact "Simulated" marker — the demo must never read as live data. */
export function SimulatedPill() {
    return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-0.5 text-[0.72rem] font-semibold text-amber-300">
            <span className="size-1.5 rounded-full bg-amber-500" />
            Simulated
        </span>
    );
}

export { fmtPct };