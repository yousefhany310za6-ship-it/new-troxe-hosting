import { Link } from 'react-router-dom';

import SectionHeader from './SectionHeader.jsx';
import SectionBackdrop from './effects/SectionBackdrop.jsx';
import { useReveal } from '../hooks/useSiteEffects.js';
import { useSpotlight } from './effects/useSpotlight.js';
import { Button } from './ui/button.jsx';
import { cn } from '@/lib/utils';
import { PRICING_CATEGORIES, getHeadline } from '@/data/pricing.jsx';

/**
 * Landing pricing teaser — one price per family, not the whole ladder.
 *
 * The previous version rendered every tier of all three families: twenty-four
 * cards between the section header and the FAQ. It was accurate and it was
 * unreadable — nobody scrolls a wall of near-identical cards to learn whether
 * bots cost more than games, because the answer is on /pricing and they know
 * it. What the teaser has to do is answer one question per family at a glance:
 * roughly what does this cost me?
 *
 * So each family quotes exactly one tier — the recommended one — with its
 * headline resource, and links to the picker for the rest. Three numbers, three
 * families, three decisions instead of twenty-four.
 */
function FamilyTeaser({ category }) {
    const [ref, visible] = useReveal();
    const onMouseMove = useSpotlight();
    const plan = getHeadline(category);

    return (
        <div
            ref={ref}
            onMouseMove={onMouseMove}
            className={cn(
                'group cursor-spotlight reveal relative flex flex-col overflow-hidden rounded-2xl border border-hairline bg-card/60 p-7 backdrop-blur-sm transition duration-500 hover:-translate-y-1.5 hover:border-white/20 hover:bg-surface-hover/70',
                visible && 'reveal-visible'
            )}
        >
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-7 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.55),transparent)] opacity-0 transition-opacity duration-500 group-hover:opacity-100"
            />

            <div className="relative z-[1] flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-hairline bg-white/[0.04] text-ink-secondary transition duration-500 group-hover:border-white/25 group-hover:text-foreground [&>svg]:size-[18px]">
                    <category.Icon strokeWidth={1.8} />
                </span>
                <div>
                    <h3 className="text-[1.05rem] font-extrabold tracking-[-0.02em]">{category.label}</h3>
                    <span className="font-mono text-[0.66rem] tracking-[0.08em] text-ink-muted uppercase">
                        {category.hint}
                    </span>
                </div>
            </div>

            <div className="relative z-[1] mt-7 flex items-end gap-1.5">
                <span className="text-[2.6rem] leading-none font-extrabold tracking-[-0.035em] tabular-nums text-foreground">
                    {plan.price}
                </span>
                <span className="mb-1 text-[0.9rem] font-semibold text-ink-muted">{plan.period}</span>
            </div>

            <p className="relative z-[1] mt-2 text-[0.84rem] text-ink-secondary">
                <span className="font-semibold text-foreground">{plan.name}</span> · {plan.desc}
            </p>

            <ul className="relative z-[1] mt-5 flex flex-col gap-2">
                {plan.features.slice(0, 3).map((f) => (
                    <li key={f.label} className="flex items-center gap-2 text-[0.82rem] text-ink-secondary">
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="shrink-0 text-foreground"
                        >
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                        {f.label}
                    </li>
                ))}
            </ul>

            <div className="relative z-[1] mt-auto pt-7">
                <Link
                    to={`/pricing?cat=${category.id}`}
                    className="inline-flex items-center gap-1.5 text-[0.85rem] font-semibold text-foreground transition-colors hover:text-white"
                >
                    See all {category.tiers.length} plans
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="transition-transform duration-300 group-hover:translate-x-1"
                    >
                        <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                </Link>
            </div>
        </div>
    );
}

export default function Pricing() {
    return (
        <section id="pricing" className="section-shell relative bg-background">
            <SectionBackdrop variant="grid" />

            <div className="container-page relative z-[1]">
                <SectionHeader
                    tag="Pricing"
                    title={
                        <>
                            Pay for what you <span className="gradient-text">actually run</span>
                        </>
                    }
                    subtitle="Bots, apps and game servers are priced separately, because they compete for different resources. Here is what each one starts at — every tier is on the pricing page."
                />

                <div className="grid grid-cols-3 gap-5 max-lg:grid-cols-1">
                    {PRICING_CATEGORIES.map((category) => (
                        <FamilyTeaser key={category.id} category={category} />
                    ))}
                </div>

                <div className="mt-12 flex flex-col items-center gap-4">
                    <Button variant="outline" size="lg" asChild>
                        <Link to="/pricing">Compare every plan side by side</Link>
                    </Button>
                    <p className="text-[0.8rem] text-ink-muted">
                        Prices in USD · VAT not included · Upgrade or downgrade any time
                    </p>
                </div>
            </div>
        </section>
    );
}