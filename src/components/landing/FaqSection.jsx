import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, MessagesSquare } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '../ui/button.jsx';
import { FAQS } from '@/data/landing.js';

/**
 * Keyboard-operable accordion: real buttons, aria-expanded/aria-controls, and
 * one panel open at a time. The content is already in the DOM for crawlers.
 */
export default function FaqSection() {
    const [open, setOpen] = useState(0);

    return (
        <section id="faq" className="section-shell border-t border-hairline bg-[color:var(--surface-0)]">
            <div className="container-page">
                <div className="grid gap-10 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:gap-16">
                    <header className="lg:sticky lg:top-28 lg:self-start">
                        <p className="mb-3 font-mono text-[0.72rem] font-bold tracking-[0.22em] text-[color:var(--lime)] uppercase">
                            FAQ
                        </p>
                        <h2 className="text-[1.7rem] leading-[1.18] font-extrabold tracking-[-0.03em] text-foreground min-[400px]:text-[1.9rem] sm:text-[2.3rem] lg:text-[2.5rem]">
                            Questions, answered
                        </h2>
                        <p className="mt-4 text-[0.95rem] leading-[1.7] text-ink-secondary">
                            Something not covered here? Open a ticket from the dashboard and a specialist will pick it up.
                        </p>
                        <Button asChild variant="outline" className="mt-6">
                            <Link to="/contact">
                                <MessagesSquare className="size-4" aria-hidden="true" />
                                Contact us
                            </Link>
                        </Button>
                    </header>

                    <ul className="flex flex-col gap-3">
                        {FAQS.map((item, i) => {
                            const expanded = open === i;
                            return (
                                <li
                                    key={item.q}
                                    className={cn(
                                        'overflow-hidden rounded-2xl border bg-[color:var(--surface-1)] transition',
                                        expanded ? 'border-hairline-hover' : 'border-hairline hover:border-hairline-hover'
                                    )}
                                >
                                    <h3>
                                        <button
                                            type="button"
                                            onClick={() => setOpen(expanded ? -1 : i)}
                                            aria-expanded={expanded}
                                            aria-controls={`faq-panel-${i}`}
                                            id={`faq-button-${i}`}
                                            className="flex w-full cursor-pointer items-center gap-4 px-5 py-4 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                                        >
                                            <span className="min-w-0 flex-1 text-[0.95rem] font-bold text-foreground">{item.q}</span>
                                            <ChevronDown
                                                className={cn(
                                                    'size-4 shrink-0 text-ink-muted transition-transform duration-300',
                                                    expanded && 'rotate-180 text-[color:var(--lime)]'
                                                )}
                                                aria-hidden="true"
                                            />
                                        </button>
                                    </h3>
                                    <div
                                        id={`faq-panel-${i}`}
                                        role="region"
                                        aria-labelledby={`faq-button-${i}`}
                                        hidden={!expanded}
                                        className="px-5 pb-5"
                                    >
                                        <p className="text-[0.9rem] leading-[1.75] text-ink-secondary">{item.a}</p>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </div>
        </section>
    );
}
