import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';
import PricingCard from './PricingCard.jsx';
import { CUSTOM_TIER, PRICING_CATEGORIES, getCategory } from '@/data/pricing.jsx';

/**
 * PricingPicker — one family at a time, picked with three buttons.
 *
 * A dropdown hid the choice: a visitor could not see that two other families
 * existed without opening it, which is the wrong default on a page whose whole
 * job is to explain that hosting is priced by what you run. Three visible
 * buttons answer "what else is there?" before the question is asked.
 *
 * The selected button cycles that family's own product icons — Discord,
 * Telegram, Slack for bots; Node, Python, Go for apps; Minecraft, FiveM for
 * games. The two unselected buttons sit on their generic glyph and stay
 * completely still, so the movement reads as "this is what you are looking at"
 * rather than as decoration.
 *
 * The three are not tabs in the ARIA sense — they swap a whole panel of
 * pricing rather than a fragment of one — so `role="radiogroup"` is honest
 * about there being exactly one active option, and the arrow keys move between
 * them the way a radio group is expected to.
 */

/** How long each mark holds before the next one takes its place. */
const CAROUSEL_MS = 2000;

/**
 * The glyph inside a family button.
 *
 * Selected, it walks that family's product marks. Not selected, it sits on
 * the generic one and is rendered through a *separate* branch with no `key`
 * and no animation class. That split matters: a single element with
 * `key={index}` re-mounts on every tick even when its icon never changes,
 * which restarts the swap animation on all three buttons at once and makes the
 * two idle ones twitch in sympathy with the selected one.
 */
function FamilyIcon({ category, active, index }) {
    const { Icon, icons } = category;

    const chip = cn(
        'flex size-7 shrink-0 items-center justify-center rounded-full transition-colors duration-300 [&_svg]:size-[17px]',
        active ? 'text-foreground' : 'text-ink-muted group-hover:text-foreground'
    );

    if (!active || !icons?.length) {
        return (
            <span className={chip}>
                <Icon strokeWidth={1.8} />
            </span>
        );
    }

    const Current = icons[index % icons.length];

    return (
        <span className={chip}>
            <Current key={index} className="animate-icon-swap" strokeWidth={1.8} />
        </span>
    );
}

export default function PricingPicker({ initialCategory = 'bots', className, showCustom = true }) {
    const [categoryId, setCategoryId] = useState(initialCategory);
    const [iconIndex, setIconIndex] = useState(0);
    const category = getCategory(categoryId);

    /* Only runs while a family is selected — the whole point is that the other
       two buttons are still. Paused for reduced motion, which leaves the first
       product mark parked on the active button. */
    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

        setIconIndex(0);
        const timer = setInterval(() => setIconIndex((i) => i + 1), CAROUSEL_MS);

        return () => clearInterval(timer);
    }, [categoryId]);

    function onKeyDown(event) {
        const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (!delta) return;

        event.preventDefault();
        const i = PRICING_CATEGORIES.findIndex((c) => c.id === categoryId);
        const next = PRICING_CATEGORIES[(i + delta + PRICING_CATEGORIES.length) % PRICING_CATEGORIES.length];

        setCategoryId(next.id);
        event.currentTarget.querySelectorAll('button')[next.id === PRICING_CATEGORIES[0].id ? 0 : PRICING_CATEGORIES.indexOf(next)]?.focus();
    }

    return (
        <div className={className}>
            {/* One container, three segments. The selection is a raised light plate
                sitting inside it rather than a second set of borders — three
                separately outlined buttons read as three cards, which is not
                what a set of mutually exclusive choices should look like. */}
            <div
                role="radiogroup"
                aria-label="What are you hosting"
                onKeyDown={onKeyDown}
                className="mx-auto mb-9 flex w-full max-w-full items-center justify-center gap-1 rounded-full border border-hairline bg-card/50 p-1.5 backdrop-blur-sm sm:w-fit"
            >
                {PRICING_CATEGORIES.map((c) => {
                    const active = c.id === categoryId;

                    return (
                        <button
                            key={c.id}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            aria-label={`${c.label} — ${c.hint}`}
                            onClick={() => setCategoryId(c.id)}
                            className={cn(
                                'group flex min-w-0 items-center gap-2 rounded-full px-3 py-2.5 whitespace-nowrap transition duration-300 sm:px-4',
                                active
                                    ? 'bg-white/[0.11] shadow-[0_6px_20px_-10px_rgba(255,255,255,0.5)] ring-1 ring-white/15 ring-inset'
                                    : 'hover:bg-white/[0.04]'
                            )}
                        >
                            <FamilyIcon category={c} active={active} index={iconIndex} />

                            {/* "Bot hosting" + icon + padding needs ~150px;
                                three of those is wider than a 390px screen.
                                The short name is why `short` exists — it fits,
                                and `aria-label` keeps the full name for anyone
                                not looking at the page. */}
                            <span
                                className={cn(
                                    'text-[0.85rem] font-semibold transition-colors duration-300 sm:text-[0.88rem]',
                                    active ? 'text-foreground' : 'text-ink-secondary group-hover:text-foreground'
                                )}
                            >
                                <span className="sm:hidden">{c.short}</span>
                                <span className="hidden sm:inline">{c.label}</span>
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* The hint moved off the buttons, so it is carried here instead — it is the
                runtime list, and losing it would leave "App hosting" vague. */}
            <p className="mx-auto mb-10 max-w-[620px] text-center text-[0.95rem] leading-[1.7] text-ink-secondary">
                <span className="font-mono text-[0.7rem] tracking-[0.1em] text-ink-muted uppercase">
                    {category.hint}
                </span>
                <span className="mx-2 text-ink-muted" aria-hidden="true">
                    ·
                </span>
                {category.blurb}
            </p>

            {/* Keyed on the family so switching re-runs the card reveal. */}
            <div
                key={category.id}
                className="grid grid-cols-3 items-stretch gap-6 max-lg:grid-cols-2 max-md:grid-cols-1"
            >
                {category.tiers.map((tier) => (
                    <PricingCard key={tier.id ?? tier.name} plan={tier} />
                ))}
            </div>

            {showCustom && (
                <div className="mt-6 flex flex-col items-start gap-5 rounded-2xl border border-hairline bg-card/50 p-8 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between sm:p-9">
                    <div>
                        <h3 className="mb-1.5 text-[1.35rem] font-extrabold tracking-[-0.02em]">
                            {CUSTOM_TIER.name}
                        </h3>
                        <p className="text-[0.88rem] text-ink-secondary">
                            {CUSTOM_TIER.desc} {CUSTOM_TIER.blurb}
                        </p>
                    </div>
                    <a
                        href="/contact"
                        className={cn(
                            'shrink-0 rounded-full border border-white/25 px-6 py-3 text-[0.9rem] font-semibold',
                            'transition duration-300 hover:border-white/60 hover:bg-white/[0.06]'
                        )}
                    >
                        Talk to us
                    </a>
                </div>
            )}
        </div>
    );
}