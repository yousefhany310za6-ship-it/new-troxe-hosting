import { Link, useNavigate } from 'react-router-dom';

import { useReveal } from '../hooks/useSiteEffects.js';
import SectionHeader from './SectionHeader.jsx';
import { Button } from './ui/button.jsx';
import { cn } from '@/lib/utils';
import { IconCheck, IconX } from './icons.jsx';
import { FEATURE_ICONS, PLANS } from '@/data/plans.jsx';

export function PricingCard({ plan }) {
    const [ref, visible] = useReveal();
    const navigate = useNavigate();
    const target = plan.cta === 'Contact Us' ? '/contact' : '/signup';

    return (
        <div
            ref={ref}
            className={cn(
                'relative rounded-xl border border-hairline bg-card px-8 py-9 transition hover:-translate-y-[3px] hover:border-hairline-hover hover:bg-surface-hover max-[480px]:px-6 max-[480px]:py-7 reveal',
                plan.popular && 'border-hairline-hover bg-surface-hover',
                visible && 'reveal-visible'
            )}
        >
            {plan.popular && (
                <div className="absolute -top-[11px] left-1/2 -translate-x-1/2 rounded-full bg-primary px-4 py-[5px] text-[0.75rem] font-bold tracking-[0.4px] text-primary-foreground">
                    Popular
                </div>
            )}

            <div className="mb-6 text-center">
                <h3 className="mb-1.5 text-[1.3rem] font-extrabold">{plan.name}</h3>
                <p className="text-[0.9rem] text-ink-muted">{plan.desc}</p>
            </div>

            <div className="mb-7 border-b border-hairline pb-7 text-center">
                <span className="text-[2.75rem] font-extrabold tracking-[-0.02em] text-foreground">
                    {plan.price}
                </span>
                <span className="text-[0.95rem] font-semibold text-ink-muted">{plan.period}</span>
            </div>

            {/* First icon = status (check/x), second = resource type (cpu/ram/...) */}
            <ul className="mb-7 flex flex-col gap-[11px]">
                {plan.features.map((feature) => {
                    const FeatureIcon = feature.icon ? FEATURE_ICONS[feature.icon] : null;

                    return (
                        <li
                            key={feature.label}
                            className={cn(
                                'flex items-center gap-[9px] text-[0.9rem] text-ink-secondary [&>svg:first-child]:shrink-0 [&>svg:first-child]:text-foreground [&>svg:not(:first-child)]:shrink-0 [&>svg:not(:first-child)]:text-ink-muted',
                                !feature.included &&
                                    'text-ink-muted [&_svg]:text-ink-muted [&_svg]:opacity-50'
                            )}
                        >
                            {feature.included ? <IconCheck /> : <IconX />} {FeatureIcon && (
                                <FeatureIcon />
                            )}{' '}
                            {feature.label}
                        </li>
                    );
                })}
            </ul>

            <Button
                variant={plan.ctaVariant}
                className="w-full"
                type="button"
                onClick={() => navigate(target)}
            >
                {plan.cta}
            </Button>
        </div>
    );
}

/* Landing teaser: the first three plans + a button to the full pricing page. */
export default function Pricing() {
    return (
        <section id="pricing" className="section-shell bg-background">
            <div className="container-page">
                <SectionHeader
                    tag="Pricing"
                    title={
                        <>
                            Plans for <span className="gradient-text">Everyone</span>
                        </>
                    }
                    subtitle="Start free with no card, or take a paid server from $1/month. Billed per server and its resources — no commitments or contracts."
                />

                <div className="grid grid-cols-3 items-start gap-6 max-lg:grid-cols-2 max-md:grid-cols-1">
                    {PLANS.slice(0, 3).map((plan) => (
                        <PricingCard key={plan.name} plan={plan} />
                    ))}
                </div>

                <div className="mt-10 text-center">
                    <Button variant="outline" size="lg" asChild>
                        <Link to="/pricing">View all {PLANS.length} plans</Link>
                    </Button>
                </div>
            </div>
        </section>
    );
}
