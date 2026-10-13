import { Link } from 'react-router-dom';

import { useReveal } from '../hooks/useSiteEffects.js';
import SectionHeader from './SectionHeader.jsx';
import SectionBackdrop from './effects/SectionBackdrop.jsx';
import { useSpotlight } from './effects/useSpotlight.js';
import { Button } from './ui/button.jsx';
import { cn } from '@/lib/utils';
import { IconArrowRight } from './icons.jsx';
import { FEATURES } from '@/data/features.jsx';

/**
 * Bento placement. The landing page is not a uniform 3×2 grid any more —
 * the first and last cards stretch so the eye lands on the deploy promise
 * and then on the support promise, with the rest as supporting tiles.
 */
const SPANS = ['lg:col-span-2', '', '', '', '', 'lg:col-span-3'];

function CardVisual() {
    // A tiny animated "uptime" readout — pure CSS, no canvas, no library.
    const bars = [38, 62, 48, 80, 55, 92, 70, 45, 74, 60, 85, 52];
    return (
        <div className="relative hidden h-full min-h-[150px] flex-1 flex-col justify-end overflow-hidden rounded-xl border border-white/[0.06] bg-black/40 p-5 lg:flex">
            <div className="mb-4 flex items-center gap-2 font-mono text-[0.68rem] text-ink-muted">
                <span className="size-1.5 animate-beat rounded-full bg-white/70" />
                deploy pipeline
            </div>
            <div className="flex h-20 items-end gap-1.5">
                {bars.map((h, i) => (
                    <span
                        key={i}
                        className="rise flex-1 origin-bottom rounded-sm bg-[linear-gradient(to_top,rgba(255,255,255,0.12),rgba(255,255,255,0.55))]"
                        style={{ height: `${h}%`, animationDelay: `${i * 70}ms` }}
                    />
                ))}
            </div>
            <div
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-24 bg-[linear-gradient(to_bottom,transparent,rgba(255,255,255,0.04),transparent)]"
            />
        </div>
    );
}

/**
 * A single feature tile.
 *
 * Shared by the landing bento and the /features grid, so it stays a plain
 * card: spotlight on hover, a hairline that lights up along the top, and an
 * icon chip that inverts on hover.
 */
export function FeatureCard({ Icon, title, text, index, span = '', className }) {
    const [ref, visible] = useReveal();
    const onMouseMove = useSpotlight();
    const wide = span.includes('col-span-2');
    const banner = span.includes('col-span-3');

    return (
        <div
            ref={ref}
            onMouseMove={onMouseMove}
            className={cn(
                'group cursor-spotlight relative flex overflow-hidden rounded-2xl border border-hairline bg-card/60 p-8 backdrop-blur-sm transition duration-500 hover:-translate-y-1.5 hover:border-white/20 hover:bg-surface-hover/70 max-[480px]:p-6 reveal',
                wide && 'gap-8 max-lg:flex-col max-lg:gap-0',
                banner && 'flex-col justify-center p-9 sm:flex-row sm:items-center sm:gap-10 max-md:p-7',
                visible && 'reveal-visible',
                span,
                className
            )}
        >
            {/* Hairline that brightens along the top edge on hover. */}
            <div
                aria-hidden="true"
                className="absolute inset-x-8 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.55),transparent)] opacity-0 transition-opacity duration-500 group-hover:opacity-100"
            />

            {/* Number sits in the card's top-right corner rather than in the
                flow — on the wide bento tile the text column is narrow and a
                right-aligned index ends up glued to the visual panel. */}
            {index != null && !wide && (
                <span className="absolute top-8 right-8 z-[1] font-mono text-sm text-ink-muted transition group-hover:text-foreground max-[480px]:top-6 max-[480px]:right-6">
                    {String(index).padStart(2, '0')}
                </span>
            )}

            <div className={cn('relative z-[1]', banner && 'sm:flex-1')}>
                <div className="mb-6 flex size-12 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-foreground transition duration-500 group-hover:border-white/25 group-hover:bg-white group-hover:text-black">
                    <Icon />
                </div>
                <h3 className="mb-2.5 text-[1.2rem] font-bold tracking-[-0.01em]">{title}</h3>
                <p className="text-[0.92rem] leading-[1.75] text-ink-secondary">{text}</p>
                <Link
                    to="/features"
                    className="mt-5 inline-flex items-center gap-1.5 text-[0.85rem] font-semibold text-ink-muted transition hover:gap-2.5 hover:text-foreground"
                >
                    Learn more
                    <IconArrowRight className="size-4" />
                </Link>
            </div>

            {wide && (
                <div className="relative z-[1] lg:flex lg:w-[42%]">
                    <CardVisual />
                </div>
            )}
        </div>
    );
}

export default function Features() {
    return (
        <section id="features" className="section-shell relative">
            <SectionBackdrop variant="dots" />

            <div className="container-page relative z-[1]">
                <SectionHeader
                    tag="Why Troxe?"
                    title={
                        <>
                            Features that <span className="gradient-text">make a difference</span>
                        </>
                    }
                    subtitle="Tools and services designed to save your time and boost productivity"
                />

                <div className="grid grid-cols-3 gap-5 max-lg:grid-cols-2 max-md:grid-cols-1">
                    {FEATURES.map((feature, i) => (
                        <FeatureCard
                            key={feature.title}
                            index={i + 1}
                            span={SPANS[i] ?? ''}
                            {...feature}
                        />
                    ))}
                </div>

                <div className="mt-10 text-center">
                    <Button variant="outline" size="lg" asChild>
                        <Link to="/features">Explore all features</Link>
                    </Button>
                </div>
            </div>
        </section>
    );
}