import { useMemo } from 'react';
import { Cpu, HardDrive, MemoryStick, Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * The resource step of the create form (and the resize card in settings).
 *
 * Everything it shows comes from the API's `create-limits` / `resource-limits`
 * payload, which already accounts for the owner's plan AND for what their
 * other servers already consume — the sliders can never offer a number the
 * backend would refuse.
 */

export const RESOURCE_META = {
    cpuMilli: {
        key: 'cpuMilli',
        label: 'CPU',
        hint: 'vCPU share (1000 = 1 full core)',
        unit: 'milli-vCPU',
        Icon: Cpu,
        format: (v) => `${Number((v / 1000).toFixed(2))} vCPU`,
        short: (v) => `${Number((v / 1000).toFixed(2))}`,
        tone: 'from-sky-500/70',
    },
    ramMb: {
        key: 'ramMb',
        label: 'Memory',
        hint: 'Hard limit — the container is killed above it',
        unit: 'MB',
        Icon: MemoryStick,
        format: (v) => (v >= 1024 && v % 1024 === 0 ? `${v / 1024} GB` : `${v} MB`),
        short: (v) => `${v}`,
        tone: 'from-violet-500/70',
    },
    storageGb: {
        key: 'storageGb',
        label: 'Storage',
        hint: 'Disk quota for /data — the volume is not pre-allocated',
        unit: 'GB',
        Icon: HardDrive,
        format: (v) => `${v} GB`,
        short: (v) => `${v}`,
        tone: 'from-emerald-500/70',
    },
};

export const RESOURCE_ORDER = ['cpuMilli', 'ramMb', 'storageGb'];

/** Minimum sensible sizes used by the "Small" preset. */
const TINY = { cpuMilli: 100, ramMb: 128, storageGb: 1 };

const snap = (value, step, min, max) => {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(Math.round(value / step) * step, max));
};

export function formatResource(key, value) {
    return RESOURCE_META[key]?.format?.(value) ?? String(value);
}

/**
 * @param limits  `resources` object from the limits endpoint
 * @param value   { cpuMilli, ramMb, storageGb }
 * @param onChange(next)
 */
export default function ResourcePicker({ limits, value, onChange, disabled = false, className }) {
    const presets = useMemo(() => {
        if (!limits) return [];
        const max = (k) => limits[k]?.max ?? 0;
        const small = {
            cpuMilli: Math.min(TINY.cpuMilli, max('cpuMilli')),
            ramMb: Math.min(TINY.ramMb, max('ramMb')),
            storageGb: Math.min(TINY.storageGb, max('storageGb')),
        };
        const full = {
            cpuMilli: max('cpuMilli'),
            ramMb: max('ramMb'),
            storageGb: max('storageGb'),
        };
        const half = {
            cpuMilli: snap((full.cpuMilli + limits.cpuMilli.min) / 2, limits.cpuMilli.step, limits.cpuMilli.min, full.cpuMilli),
            ramMb: snap((full.ramMb + limits.ramMb.min) / 2, limits.ramMb.step, limits.ramMb.min, full.ramMb),
            storageGb: snap((full.storageGb + limits.storageGb.min) / 2, limits.storageGb.step, limits.storageGb.min, full.storageGb),
        };
        return [
            { id: 'small', label: 'Small', hint: 'cheapest that still boots', next: small },
            { id: 'balanced', label: 'Balanced', hint: 'half of what you have left', next: half },
            { id: 'max', label: 'Maximum', hint: 'everything still free', next: full },
        ];
    }, [limits]);

    if (!limits) {
        return (
            <div className={cn('console-card p-5 sm:p-6', className)}>
                <div className="h-5 w-40 animate-pulse rounded bg-veil" />
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="h-32 animate-pulse rounded-xl bg-veil" />
                    ))}
                </div>
            </div>
        );
    }

    const apply = (patch) => onChange?.({ ...value, ...patch });
    const activePreset = presets.find((p) => RESOURCE_ORDER.every((k) => p.next[k] === value?.[k]));

    return (
        <div className={cn('flex flex-col gap-5', className)}>
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-tiny font-bold tracking-wider text-ink-muted uppercase">Presets</span>
                {presets.map((p) => (
                    <button
                        key={p.id}
                        type="button"
                        title={p.hint}
                        disabled={disabled}
                        onClick={() => apply(p.next)}
                        className={cn(
                            'rounded-full border px-3 py-1 text-tiny font-bold transition disabled:cursor-not-allowed disabled:opacity-40',
                            activePreset?.id === p.id
                                ? 'border-white bg-white text-black'
                                : 'border-hairline bg-veil text-ink-secondary hover:border-hairline-hover hover:text-foreground',
                        )}
                    >
                        {p.id === 'balanced' && <Sparkles className="mr-1 inline size-3" aria-hidden="true" />}
                        {p.label}
                    </button>
                ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
                {RESOURCE_ORDER.map((key) => (
                    <ResourceCard
                        key={key}
                        limit={limits[key]}
                        value={value?.[key]}
                        onChange={(v) => apply({ [key]: v })}
                        disabled={disabled}
                    />
                ))}
            </div>
        </div>
    );
}

function ResourceCard({ limit, value, onChange, disabled }) {
    const meta = RESOURCE_META[limit.key];
    const { Icon } = meta;
    const max = Math.max(limit.min, limit.max);
    const current = Math.max(limit.min, Math.min(value ?? limit.min, max));
    const usedPct = limit.poolMax > 0 ? Math.min(100, Math.round((limit.used / limit.poolMax) * 100)) : 0;
    const afterPct = limit.poolMax > 0 ? Math.min(100, Math.round(((limit.used + current) / limit.poolMax) * 100)) : 0;
    const left = Math.max(0, limit.available);

    return (
        <div className={cn('console-card flex flex-col gap-3 p-4', limit.exhausted && 'border-red-500/30')}>
            <div className="flex items-center gap-2">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-hairline bg-veil">
                    <Icon className="size-4 text-ink-secondary" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                    <p className="text-small font-bold">{meta.label}</p>
                    <p className="truncate font-mono text-micro text-ink-muted">{meta.hint}</p>
                </div>
            </div>

            <div className="flex items-baseline gap-1.5">
                <input
                    type="number"
                    inputMode="numeric"
                    min={limit.min}
                    max={max}
                    step={limit.step}
                    value={current}
                    disabled={disabled || limit.exhausted}
                    aria-label={`${meta.label} in ${meta.unit}`}
                    onChange={(e) => onChange(snap(Number(e.target.value), limit.step, limit.min, max))}
                    className="input-field w-24 py-1.5 text-center font-mono text-small tabular-nums"
                />
                <span className="text-tiny text-ink-secondary">{meta.label === 'CPU' ? 'vCPU × 1000' : meta.unit}</span>
            </div>

            <input
                type="range"
                min={limit.min}
                max={max}
                step={limit.step}
                value={current}
                disabled={disabled || limit.exhausted}
                aria-label={`${meta.label} slider`}
                onChange={(e) => onChange(Number(e.target.value))}
                className="w-full accent-white disabled:cursor-not-allowed disabled:opacity-40"
            />

            <div className="flex flex-col gap-1">
                <div className="meter" role="presentation">
                    <div
                        className={cn('meter-fill', limit.exhausted ? 'bg-red-500/70' : 'bg-white/35')}
                        style={{ width: `${Math.max(afterPct, usedPct)}%` }}
                    />
                </div>
                <p className="font-mono text-micro text-ink-muted tabular-nums">
                    {meta.short(current)} of {meta.short(limit.poolMax)} {meta.unit}
                </p>
                <p className={cn('text-micro', limit.exhausted ? 'text-red-300' : 'text-ink-muted')}>
                    {limit.exhausted
                        ? `Nothing left — all ${meta.format(limit.poolMax)} are in use by your other servers.`
                        : `${meta.format(left)} left of your ${meta.format(limit.poolMax)} plan pool · up to ${meta.format(limit.perServerMax)} per server`}
                </p>
            </div>
        </div>
    );
}

/** Compact read-only view of an allocation (server cards, summaries). */
export function ResourceSummary({ cpuMilli, ramMb, storageGb, className }) {
    const items = [
        { key: 'cpuMilli', value: cpuMilli },
        { key: 'ramMb', value: ramMb },
        { key: 'storageGb', value: storageGb },
    ].filter((i) => typeof i.value === 'number');
    return (
        <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-micro text-ink-secondary tabular-nums', className)}>
            {items.map(({ key, value }) => {
                const { Icon } = RESOURCE_META[key];
                return (
                    <li key={key} className="flex items-center gap-1.5">
                        <Icon className="size-3 text-ink-muted" aria-hidden="true" />
                        {RESOURCE_META[key].format(value)}
                    </li>
                );
            })}
        </ul>
    );
}

/** Small inline gauge used in the wizard summary sidebar. */
export function ResourceGauge({ label, current, total, format, tone = 'bg-white/60' }) {
    const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-tiny font-semibold text-ink-secondary">{label}</span>
                <span className="font-mono text-tiny tabular-nums">
                    {format(current)}
                    <span className="text-ink-muted"> / {format(total)}</span>
                </span>
            </div>
            <div className="meter">
                <div className={cn('meter-fill', tone)} style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
}