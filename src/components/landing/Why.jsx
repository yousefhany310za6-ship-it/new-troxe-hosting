import { Boxes, Gauge, KeyRound, ScrollText, ShieldCheck, LifeBuoy } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useReveal } from '@/hooks/useSiteEffects.js';
import { WHY } from '@/data/landing.js';

const ICONS = {
    isolation: Boxes,
    visibility: Gauge,
    control: KeyRound,
    hardening: ShieldCheck,
    recovery: ScrollText,
    support: LifeBuoy,
};

/**
 * Differentiators, each tied to something that exists in the product. No
 * uptime percentages, no "world's fastest", no unlimited anything.
 */
export default function Why() {
    return (
        <section id="why" className="section-shell border-t border-hairline bg-[color:var(--surface-1)]">
            <div className="container-page">
                <header className="mx-auto max-w-[680px] text-center">
                    <p className="mb-3 font-mono text-[0.72rem] font-bold tracking-[0.22em] text-[color:var(--lime)] uppercase">
                        Why Troxe
                    </p>
                    <h2 className="text-[1.7rem] leading-[1.18] font-extrabold tracking-[-0.03em] text-foreground min-[400px]:text-[1.9rem] sm:text-[2.3rem] lg:text-[2.5rem]">
                        Built for people who ship projects
                    </h2>
                    <p className="mx-auto mt-4 max-w-[560px] text-[0.98rem] leading-[1.7] text-ink-secondary">
                        The dashboard shows what your server is doing and gives you the tools to fix it — without handing
                        over the whole machine.
                    </p>
                </header>

                <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-hairline bg-hairline sm:grid-cols-2 lg:grid-cols-3">
                    {WHY.map((item) => (
                        <WhyCard key={item.id} item={item} />
                    ))}
                </div>
            </div>
        </section>
    );
}

function WhyCard({ item }) {
    const [ref, visible] = useReveal();
    const Icon = ICONS[item.id] ?? Boxes;

    return (
        <div
            ref={ref}
            className={cn(
                'reveal group flex flex-col bg-[color:var(--surface-1)] p-7 transition hover:bg-[color:var(--surface-2)]',
                visible && 'reveal-visible'
            )}
        >
            <span className="flex size-11 items-center justify-center rounded-xl border border-hairline bg-black/40 text-ink-secondary transition group-hover:border-[color:var(--lime)]/40 group-hover:text-[color:var(--lime)]">
                <Icon className="size-5" aria-hidden="true" />
            </span>
            <h3 className="mt-5 text-[1.02rem] font-bold text-foreground">{item.title}</h3>
            <p className="mt-2.5 text-[0.88rem] leading-[1.7] text-ink-secondary">{item.text}</p>
        </div>
    );
}
