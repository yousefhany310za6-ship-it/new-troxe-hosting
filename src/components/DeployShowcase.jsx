import SectionBackdrop from './effects/SectionBackdrop.jsx';
import { useReveal } from '../hooks/useSiteEffects.js';
import { cn } from '@/lib/utils';
import { IconZap, IconShield, IconRefresh } from './icons.jsx';
import DeployPipeline from './ui/deploy-pipeline.jsx';

const HIGHLIGHTS = [
    { Icon: IconZap, title: '4.8s cold deploy', text: 'Incremental builds and a warm image cache keep redeploys under five seconds.' },
    { Icon: IconRefresh, title: 'Zero-downtime swaps', text: 'The new container boots and passes health checks before the old one is retired.' },
    { Icon: IconShield, title: 'Isolated by design', text: 'Every project gets its own container, network and resource limits.' },
];

function Highlight({ Icon, title, text }) {
    const [ref, visible] = useReveal();
    const onMouseMove = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty('--mx', `${e.clientX - rect.left}px`);
        e.currentTarget.style.setProperty('--my', `${e.clientY - rect.top}px`);
    };

    return (
        <div
            ref={ref}
            onMouseMove={onMouseMove}
            className={cn(
                'group cursor-spotlight relative overflow-hidden rounded-xl border border-hairline bg-card/60 p-6 backdrop-blur-sm transition duration-500 hover:-translate-y-1 hover:border-white/20 hover:bg-surface-hover/70 reveal',
                visible && 'reveal-visible'
            )}
        >
            <div className="relative z-[1] flex items-start gap-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-foreground transition duration-500 group-hover:border-white/30 group-hover:bg-white/10">
                    <Icon width="20" height="20" />
                </div>
                <div>
                    <h3 className="mb-1.5 text-[0.98rem] font-bold">{title}</h3>
                    <p className="text-[0.85rem] leading-[1.7] text-ink-secondary">{text}</p>
                </div>
            </div>
        </div>
    );
}

export default function DeployShowcase() {
    return (
        <section id="deploy" className="section-shell relative bg-background">
            <SectionBackdrop variant="dots" />

            <div className="container-page relative z-[1]">
                <div className="grid grid-cols-[1.15fr_0.85fr] items-center gap-14 max-lg:grid-cols-1 max-lg:gap-10">
                    <div className="rise">
                        <span className="mb-5 inline-block rounded-full border border-hairline bg-veil px-[14px] py-[5px] text-[0.72rem] font-semibold tracking-[1.4px] text-ink-muted uppercase">
                            Ship it
                        </span>
                        <h2 className="mb-5 text-[2.4rem] leading-[1.15] font-extrabold tracking-[-0.03em] max-md:text-[1.8rem]">
                            One command between your
                            <br className="max-md:hidden" /> <span className="gradient-text">repo and production</span>
                        </h2>
                        <p className="mb-8 max-w-[440px] text-[1rem] leading-[1.75] text-ink-secondary">
                            Connect a repository once. After that every push builds, health-checks and
                            swaps itself — you watch the deploy log right here in the dashboard.
                        </p>
                    </div>

                    <div className="flex flex-col gap-4">
                        {HIGHLIGHTS.map((h, i) => (
                            <div key={h.title} style={{ transitionDelay: `${i * 90}ms` }}>
                                <Highlight {...h} />
                            </div>
                        ))}
                    </div>
                </div>

                <div className="rise mt-14" style={{ animationDelay: '150ms' }}>
                    <DeployPipeline />
                </div>
            </div>
        </section>
    );
}