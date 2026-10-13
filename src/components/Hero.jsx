import { Suspense, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { Counter } from './Counter.jsx';
import RotatingText from './RotatingText.jsx';
import DemoStage from './DemoStage.jsx';
import { IconArrowRight, IconPlay } from './icons.jsx';
import { Button } from './ui/button.jsx';
import AetherHero from './ui/aether-hero.jsx';
import ParticleField from './effects/ParticleField.jsx';
import GlassSolid from './effects/GlassSolid.jsx';

export default function Hero() {
    const navigate = useNavigate();
    const demoRef = useRef(null);

    const scrollToDemo = () => {
        const top = demoRef.current.getBoundingClientRect().top + window.pageYOffset - 80;
        window.scrollTo({ top, behavior: 'smooth' });
    };

    return (
        <>
            {/* ================= hero =================
                `overflow-hidden` stays here: it clips the shader and the grain.
                The demo lives in its own section below precisely because that
                clipping turns this element into a scrollport, which would
                silently kill `position: sticky` inside it.

                Two columns from `lg` up. The old globe could sit behind the
                headline because it was a soft, low-contrast shape; an isometric
                drawing has hard edges that cut straight through the copy, so it
                gets its own column and the headline gets the other one. */}
            <section id="hero" className="relative overflow-hidden px-6 pt-[140px] pb-20 lg:pb-24">
                {/* ---- background: shader, then the CSS layers over it ----
                    The shader paints opaque black, so it has to come first; the
                    aurora and particles then sit on top as accents rather than
                    as the base. The grid-pattern is gone — the shader draws its
                    own grid, brighter at the tile crossings. */}
                {/* Below `lg` the copy goes full-width and centred, so the arc sweeps
                    straight through the headline instead of beside it. The
                    desktop scrim below handles this with a directional
                    gradient; a vertical one cannot protect a full-width
                    block, so the shader itself is dimmed instead. */}
                <div className="absolute inset-0 z-0 max-lg:opacity-60">
                    <AetherHero
                        height="100%"
                        className="absolute inset-0"
                        content="none"
                        overlayGradient="linear-gradient(180deg, #00000080 0%, #00000030 45%, #0000001a 100%)"
                    />
                </div>

                <div className="absolute inset-0 z-0">
                    {/* The aurora blobs are gone. Measured on this page:
                        `filter: blur(90px)` over a full-viewport area nearly
                        doubled the hero's frame rate when removed (3.4 -> 6.0
                        fps), because a large blur forces the whole hero — the
                        animating shader canvas included — to re-rasterise
                        rather than just re-composite. The shader already draws
                        its own light, so the blobs were paying for nothing.

                        `noise-overlay` keeps `mix-blend-overlay` nowhere in the
                        hero for the same reason: any blend mode promotes the
                        layer and costs a separate pass. Plain 4% grain over a
                        near-black background is visually indistinguishable and
                        costs nothing. */}
                    <div className="absolute inset-x-0 top-0 h-[900px] opacity-50 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_20%,#000,transparent_75%)]">
                        <ParticleField density={0.7} />
                    </div>

                    {/* Copy scrim. The shader's brightest band drifts through
                        the middle of the hero, which is exactly where the
                        headline sits, so the text column gets its own weighted
                        gradient. Desktop is a left-to-right wash (copy left,
                        arc right); below `lg` the layout stacks, so it becomes
                        a top-down one. */}
                    <div className="absolute inset-0 bg-[linear-gradient(100deg,rgba(0,0,0,0.88)_0%,rgba(0,0,0,0.62)_34%,transparent_60%)] max-lg:bg-[linear-gradient(180deg,rgba(0,0,0,0.5)_0%,rgba(0,0,0,0.2)_38%,rgba(0,0,0,0.4)_68%,rgba(0,0,0,0.7)_100%)]" />

                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(255,255,255,0.05),transparent_70%)]" />
                    <div className="noise-overlay absolute inset-0 opacity-[0.035]" />
                </div>

                <div className="relative z-[1] mx-auto grid max-w-[1200px] grid-cols-[1.02fr_0.98fr] items-center gap-12 lg:gap-16 max-lg:grid-cols-1">
                    <div className="relative z-[1] text-center lg:text-left">
                        <div
                            className="rise shine-ring mb-9 inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.04] px-[18px] py-2 text-[0.82rem] font-semibold text-ink-secondary backdrop-blur-xl max-[480px]:px-[14px] max-[480px]:py-1.5 max-[480px]:text-[0.74rem]"
                            data-shine="on"
                            style={{ animationDelay: '60ms' }}
                        >
                            <span className="relative flex size-2">
                                <span className="animate-ring absolute inset-0 rounded-full bg-white/70" />
                                <span className="size-2 rounded-full bg-white" />
                            </span>
                            <span>Instant deploys — live in under 60 seconds</span>
                        </div>

                        <h1
                            className="rise mb-7 text-[3.1rem] leading-[1.08] font-extrabold tracking-[-0.04em] text-foreground max-lg:mx-auto max-lg:text-[2.6rem] max-md:text-[2.1rem] max-[480px]:text-[1.8rem]"
                            style={{ animationDelay: '140ms' }}
                        >
                            Host your{' '}
                            <span className="text-sheen">
                                <RotatingText />
                            </span>
                            <br />
                            <span className="text-ink-secondary">without touching a terminal.</span>
                        </h1>

                        <p
                            className="rise mx-auto mb-10 max-w-[520px] text-[1.02rem] leading-[1.75] text-ink-secondary lg:mx-0 max-md:text-[1rem]"
                            style={{ animationDelay: '220ms' }}
                        >
                            Discord, Telegram, Node.js, Bun, Python, Go and static sites — each on its
                            own container with live metrics, logs, files and backups. Pick a runtime,
                            press deploy, watch it run.
                        </p>

                        <div
                            className="rise flex flex-wrap items-center justify-center gap-4 lg:justify-start max-[480px]:w-full max-[480px]:flex-col"
                            style={{ animationDelay: '300ms' }}
                        >
                            <Button
                                size="lg"
                                type="button"
                                onClick={() => navigate('/signup')}
                                className="glow-pulse group relative bg-white text-black hover:bg-[#e4e4e7]"
                            >
                                <span className="relative z-[1] flex items-center gap-2">
                                    Start for Free
                                    <IconArrowRight className="transition-transform duration-300 group-hover:translate-x-1" />
                                </span>
                            </Button>

                            <Button
                                variant="outline"
                                size="lg"
                                type="button"
                                onClick={scrollToDemo}
                                className="group border-white/25 bg-white/[0.04] backdrop-blur-xl hover:border-white/60 hover:bg-white/[0.09] hover:text-foreground"
                            >
                                <span className="flex items-center gap-2">
                                    Try the dashboard
                                    <IconPlay className="transition-transform duration-300 group-hover:scale-110" />
                                </span>
                            </Button>
                        </div>

                        <p
                            className="rise mt-7 text-[0.8rem] text-ink-muted"
                            style={{ animationDelay: '380ms' }}
                        >
                            No credit card required · Free plan forever · Cancel anytime
                        </p>

                        {/* Social proof belongs next to the CTA, not 1,200px
                            below it under the demo. Two columns here, one line
                            on mobile — four counters across a 560px column
                            would wrap to two ragged rows. */}
                        <div
                            className="rise mt-9 grid grid-cols-2 gap-x-8 gap-y-6 border-t border-hairline pt-7 max-sm:gap-x-6 lg:max-w-[420px]"
                            style={{ animationDelay: '440ms' }}
                        >
                            <Counter target={15000} label="+ Active Bots" className="lg:text-left" />
                            <Counter target={99.9} suffix="%" label="Uptime" className="lg:text-left" />
                            <Counter target={50} suffix="ms" label="Response Time" className="lg:text-left" />
                            <Counter target={24} suffix="/7" label="Support" className="lg:text-left" />
                        </div>
                    </div>

                    {/* The solid gets its own column so nothing overlaps the
                        copy. An isometric drawing has hard edges that cut
                        straight through text; a single lit solid reads as a
                        soft shape from any angle. */}
                    <div
                        className="rise relative hidden h-[380px] lg:block"
                        style={{ animationDelay: '240ms' }}
                    >
                        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_55%_50%_at_50%_50%,rgba(255,255,255,0.08),transparent_72%)]" />
                        <GlassSolid />
                    </div>
                </div>
            </section>

            {/* ================= interactive demo =================
                Its own section so it is not trapped in the hero's scrollport.
                DemoStage packs the panel into a window and measures the page
                itself; no fixed height and no inner scrollbar. */}
            <section id="demo" className="relative px-6 pb-24">
                <div ref={demoRef} className="mx-auto max-w-[1200px] scroll-mt-24">
                    <div className="mb-5 flex flex-col items-center text-center">
                        <h2 className="mb-2 text-[1.5rem] font-extrabold tracking-[-0.02em] max-md:text-[1.3rem]">
                            Take the dashboard for a spin
                        </h2>
                        <p className="max-w-[620px] text-[0.9rem] leading-[1.7] text-ink-secondary">
                            The real panel — overview, console, files, backups and settings. Click through it, no
                            account needed.
                        </p>
                    </div>

                    <DemoStage />

                    <p className="mx-auto mt-5 max-w-[720px] text-center text-[0.8rem] leading-relaxed text-ink-muted">
                        Demo environment — sample data running in your browser. No real server, no uploads, no
                        charges. Create a free account to run your own.
                    </p>
                </div>
            </section>
        </>
    );
}