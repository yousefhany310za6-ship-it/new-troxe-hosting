import { useNavigate } from 'react-router-dom';

import { Button } from './ui/button.jsx';
import Aurora from './effects/Aurora.jsx';
import ParticleField from './effects/ParticleField.jsx';
import { IconArrowRight } from './icons.jsx';

const PROOF = [
    { value: '60s', label: 'to first deploy' },
    { value: '$0', label: 'to get started' },
    { value: '24/7', label: 'engineer support' },
];

export default function Cta() {
    const navigate = useNavigate();

    return (
        <section id="cta" className="relative px-6 py-[80px]">
            <div className="mx-auto max-w-[1200px]">
                {/* The travelling light ring lives on this wrapper, a pixel proud
                    of the panel. It can't live on the panel itself: `.shine-ring`
                    draws at inset -1px, and the panel clips its overflow. */}
                <div data-shine="on" className="shine-ring relative rounded-3xl p-px">
                    <div className="relative overflow-hidden rounded-3xl border border-white/12 bg-card px-12 py-16 text-center max-md:px-7 max-md:py-12">
                        {/* Background stack: network, glow, grain — all behind the copy. */}
                        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                            <div className="absolute inset-0 [mask-image:radial-gradient(ellipse_60%_70%_at_50%_50%,#000,transparent_75%)]">
                                <ParticleField density={0.7} linkColor="rgba(255,255,255,0.1)" />
                            </div>
                            <Aurora
                                blobs={[
                                    {
                                        className: 'animate-aurora',
                                        style: {
                                            top: '-40%',
                                            left: '10%',
                                            width: '55%',
                                            height: '55vw',
                                            opacity: 0.14,
                                        },
                                    },
                                    {
                                        className: 'animate-aurora-reverse',
                                        style: {
                                            bottom: '-55%',
                                            right: '5%',
                                            width: '50%',
                                            height: '50vw',
                                            opacity: 0.1,
                                        },
                                    },
                                ]}
                            />
                            <div className="noise-overlay absolute inset-0 opacity-[0.04] mix-blend-overlay" />
                        </div>

                        <div className="relative z-[1]">
                            <div className="rise mb-7 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-4 py-1.5 text-[0.78rem] font-semibold text-ink-secondary backdrop-blur-xl">
                                <span className="size-1.5 animate-beat rounded-full bg-white/80" />
                                Free forever plan
                            </div>

                            <h2 className="rise mx-auto mb-4 max-w-[640px] text-[2.6rem] leading-[1.1] font-extrabold tracking-[-0.035em] max-md:text-[1.9rem]">
                                Your bot deserves better than a{' '}
                                <span className="gradient-text">VPS you babysit</span>
                            </h2>

                            <p className="rise mx-auto mb-10 max-w-[520px] text-[1.02rem] leading-[1.75] text-ink-secondary">
                                Join thousands of developers who deploy with Troxe. Create an
                                account, pick a runtime, and be online before the page finishes
                                loading.
                            </p>

                            <div className="rise mb-12 flex flex-wrap items-center justify-center gap-4 max-[480px]:w-full max-[480px]:flex-col">
                                <Button
                                    size="lg"
                                    type="button"
                                    onClick={() => navigate('/signup')}
                                    className="glow-pulse group relative bg-white text-black hover:bg-[#e4e4e7]"
                                >
                                    <span className="relative z-[1] flex items-center gap-2">
                                        Create Free Account
                                        <IconArrowRight className="transition-transform duration-300 group-hover:translate-x-1" />
                                    </span>
                                </Button>

                                <Button
                                    variant="outline"
                                    size="lg"
                                    type="button"
                                    onClick={() => navigate('/contact')}
                                >
                                    Talk to Support
                                </Button>
                            </div>

                            <div className="rise flex flex-wrap items-center justify-center gap-x-14 gap-y-5 border-t border-hairline pt-9">
                                {PROOF.map(({ value, label }) => (
                                    <div key={label} className="text-center">
                                        <div className="text-[1.6rem] font-extrabold tracking-[-0.02em] tabular-nums">
                                            {value}
                                        </div>
                                        <div className="text-[0.8rem] text-ink-muted">{label}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}