import { Suspense, lazy } from 'react';
import { Counter } from './Counter.jsx';
import RotatingText from './RotatingText.jsx';
import { IconArrowRight, IconPlay } from './icons.jsx';
import { Button } from './ui/button.jsx';

// The globe (d3 + topojson + land data + the dot-field computation) is the
// heaviest thing on this page: it loads in its own chunk AFTER first paint
// so parsing it never freezes the initial render on a phone. The fallback
// keeps the exact layout so nothing shifts when it arrives.
const WireframeDottedGlobe = lazy(() => import('./ui/WireframeDottedGlobe.jsx'));

const GLOBE_CLASS =
    'hero-globe-mask pointer-events-none absolute top-1/2 left-1/2 z-0 aspect-square w-[min(1180px,132vw)] -translate-x-1/2 -translate-y-1/2 opacity-[0.34] max-md:w-[min(760px,150vw)] max-md:opacity-[0.28] max-[480px]:w-[min(560px,170vw)] max-[480px]:opacity-[0.24]';

export default function Hero() {
    return (
        <section
            id="hero"
            className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 pt-[120px] pb-20"
        >
            <div className="absolute inset-0 z-0">
                <div className="grid-pattern absolute inset-0" />

                {/* Sits behind the hero copy: large, centred, faded at the edges,
                    and masked so the middle band (where the headline sits) stays readable. */}
                <Suspense fallback={<div className={GLOBE_CLASS} aria-hidden="true" />}>
                    <WireframeDottedGlobe className={GLOBE_CLASS} />
                </Suspense>

                <div className="absolute -top-[150px] -right-[100px] size-[500px] animate-float rounded-full bg-white opacity-[0.09] blur-[140px]" />
                <div className="absolute -bottom-[100px] -left-[100px] size-[400px] animate-float-reverse rounded-full bg-[#a1a1aa] opacity-[0.09] blur-[140px]" />
            </div>

            <div className="relative z-[1] max-w-[800px] text-center">
                <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-hairline bg-veil px-[18px] py-2 text-[0.85rem] font-semibold text-ink-secondary max-[480px]:px-[14px] max-[480px]:py-1.5 max-[480px]:text-[0.75rem]">
                    <span className="size-2 animate-beat rounded-full bg-foreground" />
                    <span>Easy Hosting for Everyone</span>
                </div>

                <h1 className="mb-6 text-[3.25rem] font-extrabold leading-[1.15] tracking-[-0.03em] text-foreground max-lg:text-[2.8rem] max-md:text-[2.2rem] max-[480px]:text-[1.8rem]">
                    Host Your <RotatingText />
                    <br />
                    <span className="gradient-text">Fast, Secure, Always On</span>
                </h1>

                <p className="mx-auto mb-10 max-w-[560px] text-[1.05rem] leading-[1.75] text-ink-secondary max-md:text-[1rem]">
                    Discord, Telegram, Node.js, Bun, Python, PHP, and static websites —
                    everything you need in one place. Instant deployment, zero latency,
                    99.9% uptime.
                </p>

                <div className="mb-16 flex flex-wrap items-center justify-center gap-4 max-[480px]:w-full max-[480px]:flex-col max-[480px]:[&>button]:w-full">
                    <Button size="lg" type="button">
                        Start for Free
                        <IconArrowRight />
                    </Button>
                    <Button variant="outline" size="lg" type="button">
                        View Services
                        <IconPlay />
                    </Button>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-10 max-md:gap-6">
                    <Counter target={15000} label="+ Active Bots" />
                    <div className="h-10 w-px bg-hairline max-md:hidden" />
                    <Counter target={99.9} suffix="%" label="Uptime" />
                    <div className="h-10 w-px bg-hairline max-md:hidden" />
                    <Counter target={50} suffix="ms" label="Response Time" />
                    <div className="h-10 w-px bg-hairline max-md:hidden" />
                    <Counter target={24} suffix="/7" label="Support" />
                </div>
            </div>
        </section>
    );
}
