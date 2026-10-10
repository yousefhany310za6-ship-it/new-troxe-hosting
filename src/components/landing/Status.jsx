import { Activity, CircleSlash, HelpCircle, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useServiceHealth } from '@/hooks/useSiteQueries.js';

/**
 * Real service status: the page reads the platform's own readiness probe
 * (database + container daemon). If the probe cannot be reached the section
 * says so — there is no hardcoded green light anywhere.
 */
export default function Status() {
    const { data, isLoading, isError } = useServiceHealth();

    const checks = Array.isArray(data?.checks) ? data.checks : [];
    const state = isError || !data ? 'unknown' : data.status === 'ok' ? 'ok' : 'degraded';

    const label = state === 'ok' ? 'All systems operational' : state === 'degraded' ? 'Partly degraded' : 'Status unavailable';
    const hint =
        state === 'ok'
            ? 'The control plane reports the database and the container engine healthy.'
            : state === 'degraded'
              ? 'One or more components report a problem. Creating servers may be affected; running servers keep running.'
              : 'The status endpoint could not be reached just now.';

    return (
        <section id="status" className="border-t border-hairline bg-[color:var(--surface-1)] py-14">
            <div className="container-page">
                <div className="flex flex-wrap items-center gap-x-8 gap-y-5 rounded-2xl border border-hairline bg-[color:var(--surface-2)] px-6 py-6">
                    <div className="flex min-w-0 items-center gap-3">
                        <span
                            className={cn(
                                'flex size-10 shrink-0 items-center justify-center rounded-xl border',
                                state === 'ok' && 'border-[color:var(--lime)]/30 bg-[color:var(--lime)]/10 text-[color:var(--lime)]',
                                state === 'degraded' && 'border-amber-500/25 bg-amber-500/10 text-amber-300',
                                state === 'unknown' && 'border-hairline bg-veil text-ink-muted'
                            )}
                        >
                            {isLoading ? (
                                <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                            ) : state === 'ok' ? (
                                <Activity className="size-5" aria-hidden="true" />
                            ) : state === 'degraded' ? (
                                <CircleSlash className="size-5" aria-hidden="true" />
                            ) : (
                                <HelpCircle className="size-5" aria-hidden="true" />
                            )}
                        </span>
                        <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-2 text-[1rem] font-bold text-foreground">
                                {label}
                                <span
                                    className={cn(
                                        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.68rem] font-bold',
                                        state === 'ok' && 'border-[color:var(--lime)]/30 bg-[color:var(--lime)]/10 text-[color:var(--lime)]',
                                        state === 'degraded' && 'border-amber-500/25 bg-amber-500/10 text-amber-300',
                                        state === 'unknown' && 'border-hairline bg-veil text-ink-secondary'
                                    )}
                                >
                                    <span
                                        className={cn(
                                            'size-1.5 rounded-full',
                                            state === 'ok' && 'status-dot bg-[color:var(--lime)]',
                                            state === 'degraded' && 'bg-amber-400',
                                            state === 'unknown' && 'bg-zinc-500'
                                        )}
                                        aria-hidden="true"
                                    />
                                    {state === 'ok' ? 'live' : state === 'degraded' ? 'issues' : 'unknown'}
                                </span>
                            </p>
                            <p className="mt-1 text-[0.84rem] leading-[1.6] text-ink-secondary">{hint}</p>
                        </div>
                    </div>

                    {checks.length > 0 && (
                        <ul className="ml-auto flex flex-wrap items-center gap-2">
                            {checks.map((c) => (
                                <li
                                    key={c.name}
                                    className={cn(
                                        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.72rem] font-bold capitalize',
                                        c.ok
                                            ? 'border-[color:var(--lime)]/25 bg-[color:var(--lime)]/10 text-[color:var(--lime)]'
                                            : 'border-red-500/25 bg-red-500/10 text-red-300'
                                    )}
                                >
                                    <span className={cn('size-1.5 rounded-full', c.ok ? 'bg-[color:var(--lime)]' : 'bg-red-400')} aria-hidden="true" />
                                    {c.name}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </section>
    );
}
