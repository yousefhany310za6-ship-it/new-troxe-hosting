import Navbar from '../components/Navbar.jsx';
import Footer from '../components/Footer.jsx';
import Cta from '../components/Cta.jsx';
import SectionHeader from '../components/SectionHeader.jsx';
import { Tile } from '../components/Services.jsx';
import { useReveal } from '../hooks/useSiteEffects.js';
import { cn } from '@/lib/utils';
import { SERVICE_GROUPS } from '@/data/services.jsx';

function ServiceDetail({ item, flip }) {
    const [ref, visible] = useReveal();
    const { Icon, StackIcons, variant = 'solo', iconClassName, name, details } = item;

    return (
        <div
            ref={ref}
            className={cn(
                'grid grid-cols-2 items-center gap-10 rounded-xl border border-hairline bg-card p-10 max-lg:grid-cols-1 max-md:p-7 reveal',
                visible && 'reveal-visible'
            )}
        >
            <div className={cn(flip && 'lg:order-2')}>
                <Tile variant={variant} className={iconClassName} label={name}>
                    {StackIcons
                        ? StackIcons.map((StackIcon, i) => <StackIcon key={i} />)
                        : Icon && <Icon />}
                </Tile>
                <p className="mt-5 text-[1rem] font-semibold text-foreground">
                    Deploy {name} in under 60 seconds
                </p>
            </div>
            <p className={cn('text-[0.95rem] leading-[1.8] text-ink-secondary', flip && 'lg:order-1')}>
                {details}
            </p>
        </div>
    );
}

export default function ServicesPage() {
    let flip = false;

    return (
        <div className="min-h-screen bg-background text-foreground">
            <Navbar />
            <main className="container-page pt-36 pb-16">
                <SectionHeader
                    tag="Supported Runtimes"
                    title={
                        <>
                            Any Language, <span className="gradient-text">Any Framework</span>
                        </>
                    }
                    subtitle="Pick your runtime and deploy in under 60 seconds — every stack, in detail."
                />

                {SERVICE_GROUPS.map((group) => (
                    <div key={group.label} className="mt-16">
                        <div className="mb-[18px] text-center text-[0.78rem] font-bold tracking-[1.5px] text-ink-muted uppercase">
                            {group.label}
                        </div>
                        <div className="flex flex-col gap-6">
                            {group.items.map((item) => {
                                flip = !flip;
                                return <ServiceDetail key={item.name} item={item} flip={flip} />;
                            })}
                        </div>
                    </div>
                ))}
            </main>
            <Cta />
            <Footer />
        </div>
    );
}
