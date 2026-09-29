import { useState } from 'react';
import { Link } from 'react-router-dom';

import SectionHeader from './SectionHeader.jsx';
import { Button } from './ui/button.jsx';
import { cn } from '@/lib/utils';
import { IconChevronDown } from './icons.jsx';
import { QUESTIONS } from '@/data/faqs.js';

export function FaqAccordion({ items }) {
    const [active, setActive] = useState(null);

    // Same behaviour as the original accordion: only one panel open,
    // clicking the open one closes it.
    const toggle = (index) => {
        setActive((current) => (current === index ? null : index));
    };

    return (
        <div className="mx-auto flex max-w-[700px] flex-col gap-3">
            {items.map((item, index) => {
                const isActive = active === index;

                return (
                    <div
                        key={item.q}
                        data-active={isActive}
                        className={cn(
                            'group overflow-hidden rounded-md border bg-card transition',
                            isActive
                                ? 'border-hairline-hover bg-surface-hover'
                                : 'border-hairline hover:border-hairline-hover'
                        )}
                    >
                        <button
                            type="button"
                            aria-expanded={isActive}
                            onClick={() => toggle(index)}
                            className="flex w-full items-center justify-between gap-4 bg-transparent px-6 py-5 text-left text-[1rem] font-bold text-foreground transition"
                        >
                            {item.q}
                            <IconChevronDown className="shrink-0 text-ink-muted transition group-data-[active=true]:rotate-180 group-data-[active=true]:text-foreground" />
                        </button>
                        <div
                            className={cn(
                                'max-h-0 overflow-hidden transition-[max-height] duration-[400ms]',
                                isActive && 'max-h-[300px]'
                            )}
                        >
                            <p className="px-6 pb-5 text-[0.92rem] leading-[1.8] text-ink-secondary">
                                {item.a}
                            </p>
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
        <section id="faq" className="section-shell">
            <div className="container-page">
                <SectionHeader
                    tag="FAQ"
                    title={
                        <>
                            Got <span className="gradient-text">Questions?</span>
                        </>
                    }
                />

                <FaqAccordion items={QUESTIONS.slice(0, 4)} />

                <div className="mt-10 text-center">
                    <Button variant="outline" size="lg" asChild>
                        <Link to="/faq">View all {QUESTIONS.length} FAQs</Link>
                    </Button>
                </div>
            </div>
        </section>
    );
}
