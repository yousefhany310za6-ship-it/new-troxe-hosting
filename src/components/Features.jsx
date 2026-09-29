import { Link } from 'react-router-dom';

import { useReveal } from '../hooks/useSiteEffects.js';
import SectionHeader from './SectionHeader.jsx';
import { Button } from './ui/button.jsx';
import { cn } from '@/lib/utils';
import { IconArrowRight } from './icons.jsx';
import { FEATURES } from '@/data/features.jsx';

export function FeatureCard({ Icon, title, text, index }) {
    const [ref, visible] = useReveal();

    // Spotlight follows the cursor (CSS vars, no re-renders)
    const handleMouseMove = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty('--mx', `${e.clientX - rect.left}px`);
        e.currentTarget.style.setProperty('--my', `${e.clientY - rect.top}px`);
    };

    return (
        <div
            ref={ref}
            onMouseMove={handleMouseMove}
            className={cn(
                'group relative overflow-hidden rounded-xl border border-hairline bg-card p-8 transition hover:-translate-y-1 hover:border-hairline-hover hover:bg-surface-hover hover:shadow-[0_20px_60px_-20px_rgba(255,255,255,0.15)] max-[480px]:p-6 reveal',
                visible && 'reveal-visible'
            )}
        >
            {/* Cursor spotlight */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                style={{
                    background:
                        'radial-gradient(260px circle at var(--mx, 50%) var(--my, 50%), rgba(255,255,255,0.09), transparent 70%)',
                }}
            />
            {/* Top hairline glow */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            />

            <div className="relative z-[1]">
                <div className="mb-6 flex items-start justify-between">
                    <div className="flex size-12 items-center justify-center rounded-md border border-hairline bg-veil text-foreground transition group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground">
                        <Icon />
                    </div>
                    {index != null && (
                        <span className="font-mono text-sm text-ink-muted transition group-hover:text-foreground">
                            {String(index).padStart(2, '0')}
                        </span>
                    )}
                </div>
                <h3 className="mb-2 text-[1.15rem] font-bold">{title}</h3>
                <p className="text-[0.9rem] leading-[1.7] text-ink-secondary">{text}</p>
                <Link
                    to="/features"
                    className="mt-5 inline-flex items-center gap-1.5 text-[0.85rem] font-semibold text-ink-muted transition hover:gap-2.5 hover:text-foreground"
                >
                    Learn more
                    <IconArrowRight className="size-4" />
                </Link>
            </div>
        </div>
    );
}

export default function Features() {
    return (
        <section id="features" className="section-shell">
            <div className="container-page">
                <SectionHeader
                    tag="Why Troxe?"
                    title={
                        <>
                            Features That <span className="gradient-text">Make a Difference</span>
                        </>
                    }
                    subtitle="Tools and services designed to save your time and boost productivity"
                />

                <div className="grid grid-cols-3 gap-6 max-lg:grid-cols-2 max-md:grid-cols-1">
                    {FEATURES.map((feature, i) => (
                        <FeatureCard key={feature.title} index={i + 1} {...feature} />
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
