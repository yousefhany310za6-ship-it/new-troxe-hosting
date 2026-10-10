import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, Loader2, RefreshCw, Server, Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '../ui/button.jsx';
import { usePublicPlans } from '@/hooks/useSiteQueries.js';

/** The plan the badge marks, if it is in the live list. One badge only. */
const HIGHLIGHTED_PLAN = 'pro';

const fmtRam = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`);
const fmtCpu = (milli) => `${(milli / 1000).toFixed(milli % 1000 === 0 ? 0 : 2)} vCPU`;
const fmtPrice = (cents) => (cents === 0 ? 'Free' : `$${(cents / 100).toFixed(2)}`);
const fmtStorage = (gb) => `${gb} GB`;

function PlanCard({ plan, popular }) {
    const navigate = useNavigate();
    const price = fmtPrice(plan.priceCents);

    return (
        <div
            className={cn(
                'relative flex h-full flex-col rounded-2xl border p-6 transition',
                popular
                    ? 'border-[color:var(--lime)]/40 bg-[color:var(--surface-2)]'
                    : 'border-hairline bg-[color:var(--surface-1)] hover:border-hairline-hover'
            )}
        >
            {popular && (
                <span className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full bg-[color:var(--lime)] px-3 py-1 text-[0.68rem] font-extrabold tracking-[0.08em] text-[color:var(--lime-ink)] uppercase">
                    <Sparkles className="size-3" aria-hidden="true" />
                    Popular
                </span>
            )}

            <h3 className="text-[1.15rem] font-extrabold text-foreground">{plan.name}</h3>

            <p className="mt-4 flex items-baseline gap-1.5">
                <span className="text-[2.4rem] leading-none font-extrabold tracking-[-0.03em] text-foreground">{price}</span>
                {plan.priceCents > 0 && <span className="text-[0.86rem] font-semibold text-ink-muted">/month</span>}
            </p>

            <p className="mt-2 text-[0.8rem] text-ink-muted">
                {plan.custom ? 'Custom resources, agreed with the team.' : 'Billed per server.'}
            </p>

            <ul className="mt-6 flex flex-col gap-2.5 border-t border-hairline pt-6 text-[0.88rem] text-ink-secondary">
                {[
                    `${fmtCpu(plan.cpuMilli)} CPU`,
                    `${fmtRam(plan.ramMb)} RAM`,
                    `${fmtStorage(plan.storageGb)} storage`,
                    `${plan.maxServers === 1 ? '1 server' : `${plan.maxServers} servers`}`,
                    plan.maxBackupSlots > 0 ? `${plan.maxBackupSlots} backup slots` : 'no backup slots',
                ].map((line) => (
                    <li key={line} className="flex items-center gap-2">
                        <Check className="size-4 shrink-0 text-[color:var(--lime)]" aria-hidden="true" />
                        {line}
                    </li>
                ))}
            </ul>

            <div className="mt-7 pt-1">
                <Button
                    asChild
                    className={cn(
                        'w-full',
                        popular ? 'accent-cta border-0 hover:bg-[color:var(--lime-strong)]' : ''
                    )}
                    variant={popular ? 'default' : 'outline'}
                >
                    <Link to={plan.custom ? '/contact' : '/signup'}>
                        {plan.custom ? 'Talk to us' : price === 'Free' ? 'Start free' : `Choose ${plan.name}`}
                    </Link>
                </Button>
            </div>
        </div>
    );
}

/**
 * Prices and resources are read from the public plan API — the same list the
 * admin manages. Nothing is hardcoded, so a price change in the dashboard shows
 * up here without a frontend deploy. Loading, error and empty states are real
 * states, never hidden behind fake numbers.
 */
export default function Plans({ hideHeader = false }) {
    const { data, isLoading, isError, error, isFetching, refetch } = usePublicPlans();
    const [showAll, setShowAll] = useState(false);

    const plans = useMemo(() => {
        const rows = data ?? [];
        const sorted = [...rows].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        return sorted;
    }, [data]);

    const visible = showAll ? plans : plans.slice(0, 4);

    return (
        <section id="pricing" className={cn('border-t border-hairline bg-[color:var(--surface-0)]', hideHeader ? 'py-16' : 'section-shell')}>
            <div className="container-page">
                {!hideHeader && (
                    <header className="mx-auto max-w-[680px] text-center">
                        <p className="mb-3 font-mono text-[0.72rem] font-bold tracking-[0.22em] text-[color:var(--lime)] uppercase">
                            Pricing
                        </p>
                        <h2 className="text-[1.7rem] leading-[1.18] font-extrabold tracking-[-0.03em] text-foreground min-[400px]:text-[1.9rem] sm:text-[2.3rem] lg:text-[2.5rem]">
                            Pay for the resources you use
                        </h2>
                        <p className="mx-auto mt-4 max-w-[560px] text-[0.98rem] leading-[1.7] text-ink-secondary">
                            Start free, then grow into more RAM, CPU, storage and backup slots. Prices are per server, per
                            month, and come straight from the platform.
                        </p>
                    </header>
                )}

                {isLoading ? (
                    <div className="mt-12 flex items-center justify-center gap-2.5 rounded-2xl border border-hairline bg-[color:var(--surface-1)] px-6 py-16 text-[0.92rem] text-ink-secondary">
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        Loading the current plans…
                    </div>
                ) : isError ? (
                    <div
                        className="mx-auto mt-12 flex max-w-[560px] flex-col items-center gap-3 rounded-2xl border border-red-500/25 bg-red-500/5 px-6 py-12 text-center"
                        role="alert"
                    >
                        <AlertTriangle className="size-5 text-red-300" aria-hidden="true" />
                        <p className="text-[0.95rem] font-bold text-red-200">The plan list could not be loaded</p>
                        <p className="text-[0.86rem] leading-[1.6] text-red-200/80">
                            {error?.message ?? 'The pricing service did not answer.'} You can still create an account and
                            see the plans from the dashboard.
                        </p>
                        <Button variant="outline" size="sm" onClick={() => refetch()}>
                            <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} aria-hidden="true" />
                            Try again
                        </Button>
                    </div>
                ) : plans.length === 0 ? (
                    <div className="mx-auto mt-12 max-w-[520px] rounded-2xl border border-dashed border-hairline bg-[color:var(--surface-1)] px-6 py-12 text-center">
                        <Server className="mx-auto size-6 text-ink-muted" aria-hidden="true" />
                        <p className="mt-3 text-[0.95rem] font-bold text-foreground">No plans are published yet</p>
                        <p className="mt-1.5 text-[0.86rem] text-ink-secondary">
                            The team is preparing the plan list. Create an account and we will show your options in the
                            dashboard.
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="mt-12 grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            {visible.map((plan) => (
                                <PlanCard key={plan.id} plan={plan} popular={plan.id === HIGHLIGHTED_PLAN} />
                            ))}
                        </div>

                        {plans.length > 4 && (
                            <div className="mt-8 flex justify-center">
                                <Button variant="outline" onClick={() => setShowAll((v) => !v)}>
                                    {showAll ? 'Show fewer plans' : `Show all ${plans.length} plans`}
                                </Button>
                            </div>
                        )}

                        <p className="mx-auto mt-8 max-w-[620px] text-center text-[0.84rem] leading-[1.7] text-ink-muted">
                            Backup slots, server limits and resources follow the plan. Changing a plan is done from the
                            dashboard —{' '}
                            <Link to="/pricing" className="font-bold text-ink-secondary underline decoration-dotted hover:text-foreground">
                                compare every plan
                            </Link>
                            .
                        </p>
                    </>
                )}
            </div>
        </section>
    );
}
