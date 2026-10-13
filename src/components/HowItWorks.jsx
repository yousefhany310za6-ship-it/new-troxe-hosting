import { useReveal } from '../hooks/useSiteEffects.js';
import SectionHeader from './SectionHeader.jsx';
import SectionBackdrop from './effects/SectionBackdrop.jsx';
import { useSpotlight } from './effects/useSpotlight.js';
import { cn } from '@/lib/utils';

const STEPS = [
    {
        n: '01',
        title: 'Create a server',
        text: 'Pick a runtime — Node.js, Bun, Python, Go, PHP or a game image — and name it. The container is provisioned in seconds.',
    },
    {
        n: '02',
        title: 'Ship your code',
        text: 'Connect a Git repo, drop a zip, or edit files right in the browser. Every push triggers a build on our runners.',
    },
    {
        n: '03',
        title: 'Watch it run',
        text: 'Live CPU, RAM and network graphs, a real console, searchable logs and one-click rollbacks. No SSH required.',
    },
];

/** The animated rail that threads the three steps together. */
function Pipeline() {
    return (
        <div aria-hidden="true" className="pointer-events-none relative mb-10 h-px w-full max-w-[760px]">
            <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.22)_20%,rgba(255,255,255,0.22)_80%,transparent)]" />
            {[0, 1, 2].map((i) => (
                <span
                    key={i}
                    className="absolute top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-white shadow-[0_0_10px_2px_rgba(255,255,255,0.5)]"
                    style={{
                        left: `${16 + i * 34}%`,
                        animation: `pulse-node ${3.4 + i * 0.5}s ease-in-out ${i * 0.9}s infinite`,
                    }}
                />
            ))}
        </div>
    );
}

function Step({ step, index }) {
    const [ref, visible] = useReveal();
    const onMouseMove = useSpotlight();

    return (
        <div
            ref={ref}
            onMouseMove={onMouseMove}
            className={cn(
                'group relative flex-1 overflow-hidden rounded-2xl border border-hairline bg-card/60 p-8 backdrop-blur-sm transition duration-500 hover:-translate-y-1.5 hover:border-white/20 hover:bg-surface-hover/70 max-md:p-6 reveal',
                visible && 'reveal-visible'
            )}
            style={{ transitionDelay: `${index * 110}ms` }}
        >
            <div className="cursor-spotlight absolute inset-0" aria-hidden="true" />

            {/* Hairline that lights up along the top edge on hover. */}
            <div
                aria-hidden="true"
                className="absolute inset-x-8 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.6),transparent)] opacity-0 transition-opacity duration-500 group-hover:opacity-100"
            />

            <div className="relative z-[1]">
                <div className="mb-6 flex items-center gap-4">
                    <div className="relative flex size-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] font-mono text-[0.85rem] font-bold text-foreground">
                        {step.n}
                        <span className="animate-ring absolute inset-0 rounded-full border border-white/20" />
                    </div>
                    <span className="h-px flex-1 bg-[linear-gradient(90deg,rgba(255,255,255,0.18),transparent)]" />
                </div>

                <h3 className="mb-2.5 text-[1.2rem] font-bold tracking-[-0.01em]">{step.title}</h3>
                <p className="text-[0.9rem] leading-[1.75] text-ink-secondary">{step.text}</p>
            </div>
        </div>
    );
}

export default function HowItWorks() {
    return (
        // Deliberately no `overflow-hidden`: an overflow ancestor becomes the
        // sticky scrollport for anything inside it. `SectionBackdrop` clips
        // its own layers, so nothing escapes the section anyway.
        <section id="how-it-works" className="section-shell relative">
            <SectionBackdrop variant="grid" />

            <div className="container-page relative z-[1]">
                <SectionHeader
                    tag="How it works"
                    title={
                        <>
                            From idea to <span className="gradient-text">live in three steps</span>
                        </>
                    }
                    subtitle="No SSH, no docker-compose, no cloud console. The whole lifecycle lives in one dashboard."
                />

                <div className="mx-auto flex max-w-[760px] justify-center">
                    <Pipeline />
                </div>

                <div className="grid grid-cols-3 gap-6 max-lg:grid-cols-1 max-lg:gap-5">
                    {STEPS.map((step, i) => (
                        <Step key={step.n} step={step} index={i} />
                    ))}
                </div>
            </div>
        </section>
    );
}