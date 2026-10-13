import { useNavigate } from 'react-router-dom';

import { useReveal } from '../hooks/useSiteEffects.js';
import { useSpotlight } from './effects/useSpotlight.js';
import { Button } from './ui/button.jsx';
import { cn } from '@/lib/utils';
import { IconCheck, IconX } from './icons.jsx';

/**
 * One pricing tier.
 *
 * Owns no knowledge of which family it belongs to — the feature rows arrive
 * pre-selected by the caller, so the same card renders a bot plan, an app plan
 * and a game plan without knowing the difference.
 */
export default function PricingCard({ plan, dense = false }) {
    const [ref, visible] = useReveal();
    const onMouseMove = useSpotlight();
    const navigate = useNavigate();
    const target = plan.ctaTarget ?? '/signup';

    /* A real price always opens with the currency symbol. Anything else is a
       label — rendering "Contact Us" at the 2.9rem numeric size made it four
       times wider than every other price and broke the grid's rhythm. */
    const isAmount = typeof plan.price === 'string' && /^\$/.test(plan.price);

    return (
        // `isolate` keeps the featured plan's glow at -z-10 inside this card
        // instead of letting it fall behind the section background. The card
        // itself must NOT clip overflow: `.shine-ring` draws at inset -1px,
        // and `overflow-hidden` would cut that ring off entirely.
        <div className="relative isolate flex">
            {plan.popular && (
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] bg-[radial-gradient(60%_50%_at_50%_0%,rgba(255,255,255,0.14),transparent_70%)] blur-xl"
                />
            )}

            <div
                ref={ref}
                onMouseMove={onMouseMove}
                data-shine={plan.popular ? 'on' : undefined}
                className={cn(
                    'group cursor-spotlight shine-ring relative flex w-full flex-col rounded-2xl border border-hairline bg-card/70 backdrop-blur-sm transition duration-500 hover:-translate-y-2 hover:border-white/20',
                    dense ? 'p-6' : 'p-9 max-[480px]:p-6',
                    plan.popular
                        ? 'border-white/25 bg-surface-hover/70 shadow-[0_30px_80px_-40px_rgba(255,255,255,0.4)]'
                        : 'hover:bg-surface-hover/60',
                    visible && 'reveal-visible',
                    !visible && 'reveal'
                )}
            >
                {plan.popular && (
                    <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.9),transparent)]" />
                )}

                {plan.popular && (
                    <div className="absolute top-5 right-5 rounded-full border border-white/20 bg-white/[0.06] px-3 py-1 text-[0.68rem] font-bold tracking-[0.6px] text-foreground uppercase backdrop-blur-xl">
                        Popular
                    </div>
                )}

                <div className="relative z-[1] mb-6">
                    <h3 className="mb-1.5 pr-20 text-[1.25rem] font-extrabold tracking-[-0.02em] max-[480px]:text-[1.2rem]">
                        {plan.name}
                    </h3>
                    <p className="text-[0.85rem] text-ink-muted">{plan.desc}</p>
                </div>

                <div className="relative z-[1] mb-6 border-b border-hairline pb-6">
                    {isAmount ? (
                        <>
                            <span
                                className={cn(
                                    'leading-none font-extrabold tracking-[-0.035em] tabular-nums text-foreground',
                                    dense ? 'text-[2.3rem]' : 'text-[2.9rem]'
                                )}
                            >
                                {plan.price}
                            </span>
                            {plan.period && (
                                <span className="ml-1 text-[0.95rem] font-semibold text-ink-muted">{plan.period}</span>
                            )}
                        </>
                    ) : (
                        <div>
                            <span className="block text-[1.9rem] leading-none font-extrabold tracking-[-0.03em] text-foreground">
                                {plan.price}
                            </span>
                            <span className="mt-1.5 block text-[0.88rem] font-medium text-ink-muted">
                                {plan.priceNote}
                            </span>
                        </div>
                    )}
                </div>

                {/* First icon = status (check/x), second = the resource this row is about */}
                <ul className={cn('relative z-[1] mb-6 flex flex-col', dense ? 'gap-2.5' : 'gap-3')}>
                    {plan.features.map((feature) => {
                        const FeatureIcon = feature.icon;

                        return (
                            <li
                                key={feature.label}
                                className={cn(
                                    'flex items-center gap-2.5 text-ink-secondary [&>svg:first-child]:shrink-0 [&>svg:first-child]:text-foreground [&>svg:not(:first-child)]:shrink-0 [&>svg:not(:first-child)]:text-ink-muted',
                                    dense ? 'text-[0.86rem]' : 'text-[0.9rem]',
                                    !feature.included && 'text-ink-muted [&_svg]:text-ink-muted [&_svg]:opacity-50'
                                )}
                            >
                                {feature.included ? <IconCheck /> : <IconX />} {FeatureIcon && <FeatureIcon />}{' '}
                                {feature.label}
                            </li>
                        );
                    })}
                </ul>

                <div className="relative z-[1] mt-auto">
                    <Button
                        variant={plan.popular ? 'default' : 'outline'}
                        className="w-full"
                        type="button"
                        onClick={() => navigate(target)}
                    >
                        {plan.cta}
                    </Button>
                </div>
            </div>
        </div>
    );
}