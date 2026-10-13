import { useState } from 'react';
import { Link } from 'react-router-dom';

import SectionHeader from './SectionHeader.jsx';
import SectionBackdrop from './effects/SectionBackdrop.jsx';
import { Button } from './ui/button.jsx';
import { cn } from '@/lib/utils';
import { IconArrowRight } from './icons.jsx';
import { QUESTIONS } from '@/data/faqs.js';

export function FaqAccordion({ items, className }) {
    const [active, setActive] = useState(null);

    // Same behaviour as the original accordion: only one panel open,
    // clicking the open one closes it.
    const toggle = (index) => {
        setActive((current) => (current === index ? null : index));
    };

    return (
        <div className={cn('flex flex-col gap-3', className)}>
            {items.map((item, index) => {
                const isActive = active === index;

                return (
                    <div
                        key={item.q}
                        data-active={isActive}
                        className={cn(
                            'group relative overflow-hidden rounded-2xl border bg-card/60 backdrop-blur-sm transition duration-500',
                            isActive
                                ? 'border-white/20 bg-surface-hover/60'
                                : 'border-hairline hover:border-white/15 hover:bg-surface-hover/40'
                        )}
                    >
                        {/* The open row gets a hairline of light across its top. */}
                        <div
                            aria-hidden="true"
                            className={cn(
                                'absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.8),transparent)] transition-opacity duration-500',
                                isActive ? 'opacity-100' : 'opacity-0'
                            )}
                        />

                        <button
                            type="button"
                            aria-expanded={isActive}
                            onClick={() => toggle(index)}
                            className="relative flex w-full items-center gap-4 bg-transparent px-7 py-6 text-left transition max-[480px]:px-5 max-[480px]:py-5"
                        >
                            <span
                                className={cn(
                                    'font-mono text-[0.72rem] tracking-wider transition-colors duration-300',
                                    isActive ? 'text-foreground' : 'text-ink-muted'
                                )}
                            >
                                {String(index + 1).padStart(2, '0')}
                            </span>

                            <span className="flex-1 text-[1.02rem] font-bold tracking-[-0.01em] text-foreground">
                                {item.q}
                            </span>

                            {/* Plus that rotates into a minus when the row opens. */}
                            <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full border border-white/15 transition duration-500 group-hover:border-white/40 group-data-[active=true]:rotate-90 group-data-[active=true]:border-white/60 group-data-[active=true]:bg-white/10">
                                <span className="absolute h-px w-3 bg-current" />
                                <span className="absolute h-3 w-px bg-current" />
                            </span>
                        </button>

                        {/* 0fr -> 1fr keeps the open/close animation smooth at any
                            content height, unlike a max-height guess. */}
                        <div
                            className={cn(
                                'grid transition-[grid-template-rows] duration-500 ease-out',
                                isActive ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                            )}
                        >
                            <div className="overflow-hidden">
                                <p className="px-7 pb-7 pl-[3.9rem] text-[0.93rem] leading-[1.85] text-ink-secondary max-[480px]:px-5 max-[480px]:pb-6 max-[480px]:pl-5">
                                    {item.a}
                                </p>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/* Landing teaser: the first questions + a button to the full FAQ page. */
export default function Faq() {
    return (
        // No `overflow-hidden` here on purpose: an overflow ancestor becomes the
        // sticky scrollport, which would pin the intro column 112px down for
        // the whole section. `SectionBackdrop` clips its own layers instead.
        <section id="faq" className="section-shell relative">
            <SectionBackdrop variant="dots" />

            <div className="container-page relative z-[1]">
                <div className="grid grid-cols-[0.8fr_1.2fr] items-start gap-14 max-lg:grid-cols-1 max-lg:gap-8">
                    {/* Sticky intro column — stays put while the list scrolls. */}
                    <div className="max-lg:mb-2 lg:sticky lg:top-28">
                        <span className="mb-5 inline-block rounded-full border border-hairline bg-veil px-[14px] py-[5px] text-[0.72rem] font-semibold tracking-[1.4px] text-ink-muted uppercase">
                            FAQ
                        </span>
                        <h2 className="mb-4 text-[2.4rem] leading-[1.15] font-extrabold tracking-[-0.03em] max-md:text-[1.8rem]">
                            Got <span className="gradient-text">questions?</span>
                        </h2>
                        <p className="mb-7 max-w-[360px] text-[0.98rem] leading-[1.75] text-ink-secondary">
                            Everything people ask before their first deploy. If something isn't
                            covered, our engineers answer on Discord within minutes.
                        </p>

                        <div className="flex flex-wrap gap-3">
                            <Button variant="outline" asChild>
                                <Link to="/faq">
                                    All {QUESTIONS.length} FAQs
                                    <IconArrowRight className="size-4" />
                                </Link>
                            </Button>
                            <Button variant="ghost" asChild>
                                <Link to="/contact">Contact us</Link>
                            </Button>
                        </div>
                    </div>

                    <FaqAccordion items={QUESTIONS.slice(0, 5)} />
                </div>
            </div>
        </section>
    );
}