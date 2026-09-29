import Navbar from '../components/Navbar.jsx';
import Footer from '../components/Footer.jsx';
import Cta from '../components/Cta.jsx';
import SectionHeader from '../components/SectionHeader.jsx';
import { FeatureCard } from '../components/Features.jsx';
import { useReveal } from '../hooks/useSiteEffects.js';
import { cn } from '@/lib/utils';
import { FEATURES } from '@/data/features.jsx';

function FeatureDetail({ Icon, title, text, details, flip }) {
    const [ref, visible] = useReveal();

    return (
        <div
            ref={ref}
            className={cn(
                'grid grid-cols-2 items-center gap-10 rounded-xl border border-hairline bg-card p-10 max-lg:grid-cols-1 max-md:p-7 reveal',
                visible && 'reveal-visible'
            )}
        >
            <div className={cn(flip && 'lg:order-2')}>
                <div className="mb-[18px] flex size-12 items-center justify-center rounded-md border border-hairline bg-veil text-foreground">
                    <Icon />
                </div>
                <h3 className="mb-2 text-[1.4rem] font-bold">{title}</h3>
                <p className="text-[1rem] font-semibold text-ink-secondary">{text}</p>
            </div>
            <p
                className={cn(
                    'text-[0.95rem] leading-[1.8] text-ink-secondary',
                    flip && 'lg:order-1'
                )}
            >
                {details}
            </p>
        </div>
    );
}

export default function FeaturesPage() {
    return (
        <div className="min-h-screen bg-background text-foreground">
            <Navbar />
            <main className="container-page pt-36 pb-16">
                <SectionHeader
                    tag="Why Troxe?"
                    title={
                        <>
                            Features That <span className="gradient-text">Make a Difference</span>
                        </>
                    }
                    subtitle="Tools and services designed to save your time and boost productivity — every feature, in detail."
                />

                <div className="grid grid-cols-3 gap-6 max-lg:grid-cols-2 max-md:grid-cols-1">
                    {FEATURES.map((feature, i) => (
                        <FeatureCard key={feature.title} index={i + 1} {...feature} />
                    ))}
                </div>

                <div className="mt-16 flex flex-col gap-6">
                    {FEATURES.map((feature, i) => (
                        <FeatureDetail key={feature.title} {...feature} flip={i % 2 === 1} />
                    ))}
                </div>
            </main>
            <Cta />
            <Footer />
        </div>
    );
}
