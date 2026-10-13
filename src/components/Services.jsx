import { Link } from 'react-router-dom';

import { cn } from '@/lib/utils';
import SectionHeader from './SectionHeader.jsx';
import SectionBackdrop from './effects/SectionBackdrop.jsx';
import { useSpotlight } from './effects/useSpotlight.js';
import Marquee from './effects/Marquee.jsx';
import { Button } from './ui/button.jsx';
import { SERVICE_GROUPS } from '@/data/services.jsx';

/* Logo box: a lone mark fills 32x32, wide wordmarks keep their aspect ratio,
   and the static-site shields keep their own badge heights.
   `[&>img]` is here as well as `[&>svg]`: an `<img>` child would otherwise be
   sized by nothing and render at its intrinsic size. */
const TILE_VARIANTS = {
    solo: 'size-8 [&>svg]:size-full [&>img]:size-full',
    wide: 'w-auto [&>svg]:h-7 [&>svg]:w-auto [&>img]:h-7 [&>img]:w-auto',
    stack: 'w-auto gap-2 [&>svg]:w-auto [&>img]:w-auto',
};

/* Same three shapes, one step larger than the compact pill on /services. */
const CARD_VARIANTS = {
    solo: 'size-9 [&>svg]:size-full [&>img]:size-full',
    wide: 'w-auto [&>svg]:h-7 [&>svg]:w-auto [&>img]:h-7 [&>img]:w-auto',
    stack: 'w-auto gap-2 [&>svg]:w-auto [&>img]:w-auto',
};

/* Renders an item's mark, whether it is one icon or a stacked set.
   Marks that draw with `currentColor` need something to inherit, and inheriting
   `--foreground` off the card blows them out to pure white. They sit at
   --ink-secondary and brighten with the card instead. */
export function ServiceIcon({ item, variants }) {
    const { Icon, StackIcons, variant = 'solo', iconClassName } = item;
    const size = variants[variant] ?? variants.solo;

    return (
        <div
            className={cn(
                'flex shrink-0 items-center justify-center text-ink-secondary transition-colors duration-300 group-hover:text-foreground',
                size,
                iconClassName
            )}
        >
            {StackIcons
                ? StackIcons.map((StackIcon, i) => <StackIcon key={i} />)
                : Icon && <Icon />}
        </div>
    );
}

/** Kept for /services, which renders the compact pill next to the long copy. */
export function Tile({ variant = 'solo', className, children, label }) {
    return (
        <div className="group flex cursor-default items-center gap-3 rounded-md border border-hairline bg-card py-3 pr-[22px] pl-[18px] transition hover:-translate-y-0.5 hover:border-hairline-hover hover:bg-surface-hover">
            <div className={cn('flex shrink-0 items-center justify-center', TILE_VARIANTS[variant], className)}>
                {children}
            </div>
            <span className="whitespace-nowrap text-[0.95rem] font-semibold text-ink-secondary transition group-hover:text-foreground">
                {label}
            </span>
        </div>
    );
}

/* `.container-page` is `max-width: 1200px` INCLUDING 24px gutters, so the
   usable width is 1152. Four cards plus their gaps have to fit inside that or
   the row wraps to a 3 + 1 orphan, which reads as a layout bug.
       4 × 240 + 3 × 12 = 996 ≤ 1152                                          */
const CARD_WIDTH = 240;
const GAP = 12;

/* Below this count a row does not scroll. A marquee needs one copy wider than
   the column, so a two-item group has to repeat — and "Minecraft, FiveM,
   Minecraft" reads as a rendering bug, not as motion. */
const MIN_SCROLL_ITEMS = 5;

function RuntimeCard({ item }) {
    const onMouseMove = useSpotlight();

    return (
        <div
            onMouseMove={onMouseMove}
            // Fixed on desktop so four cards fit one line; capped to the viewport below
            // `md` or the row pushes the page sideways.
            style={{ width: CARD_WIDTH }}
            className="group cursor-spotlight relative shrink-0 overflow-hidden rounded-2xl border border-hairline bg-card/60 p-5 backdrop-blur-sm transition duration-500 hover:-translate-y-1 hover:border-white/20 hover:bg-surface-hover/70 max-md:w-[min(240px,78vw)]"
        >
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-5 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.55),transparent)] opacity-0 transition-opacity duration-500 group-hover:opacity-100"
            />

            <div className="relative z-[1]">
                <ServiceIcon item={item} variants={CARD_VARIANTS} />

                <h3 className="mt-4 text-[0.98rem] font-bold tracking-[-0.01em] text-foreground">
                    {item.name}
                </h3>
                <p className="mt-1 truncate text-[0.78rem] text-ink-secondary" title={item.short}>
                    {item.short}
                </p>
            </div>
        </div>
    );
}

function GroupRow({ group, index }) {
    const { items, label } = group;
    const scrolls = items.length >= MIN_SCROLL_ITEMS;

    return (
        <div className="mb-9 last:mb-0">
            <div className="mb-3 flex items-baseline justify-between gap-4 px-1">
                <h3 className="text-[0.74rem] font-bold tracking-[1.6px] text-ink-muted uppercase">
                    {label}
                </h3>
                <span className="font-mono text-[0.68rem] text-ink-muted">
                    {items.length} {items.length === 1 ? 'option' : 'options'}
                </span>
            </div>

            {scrolls ? (
                // Alternate direction so adjacent rows drift apart, not together.
                <Marquee speed={46 + index * 8} reverse={index % 2 === 1} pauseOnHover gap="gap-3">
                    {items.map((item) => (
                        <RuntimeCard key={item.name} item={item} />
                    ))}
                </Marquee>
            ) : (
                <div className="flex flex-wrap justify-center gap-3 max-md:flex-col max-md:items-center">
                    {items.map((item) => (
                        <RuntimeCard key={item.name} item={item} />
                    ))}
                </div>
            )}
        </div>
    );
}

/* Landing: every group scrolls sideways, so the page never shows a ragged
   row of pills and the whole section reads as one moving system. */
export default function Services() {
    return (
        <section id="services" className="section-shell relative">
            <SectionBackdrop variant="dots" />

            <div className="container-page relative z-[1]">
                <SectionHeader
                    tag="Supported Runtimes"
                    title={
                        <>
                            Any Language, <span className="gradient-text">Any Framework</span>
                        </>
                    }
                    subtitle="Pick your runtime and deploy in under 60 seconds"
                />

                {SERVICE_GROUPS.map((group, i) => (
                    <GroupRow key={group.label} group={group} index={i} />
                ))}

                <div className="mt-12 text-center">
                    <Button variant="outline" size="lg" asChild>
                        <Link to="/services">Explore all runtimes</Link>
                    </Button>
                </div>
            </div>
        </section>
    );
}