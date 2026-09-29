import { Link } from 'react-router-dom';

import { cn } from '@/lib/utils';
import SectionHeader from './SectionHeader.jsx';
import { Button } from './ui/button.jsx';
import { SERVICE_GROUPS } from '@/data/services.jsx';

/* Logo box: a lone mark fills 32x32, wide wordmarks keep their aspect ratio,
   and the static-site shields keep their own badge heights. */
const TILE_VARIANTS = {
    solo: 'size-8 [&>svg]:size-full',
    wide: 'w-auto [&>svg]:h-7 [&>svg]:w-auto',
    stack: 'w-auto gap-2 [&>svg]:w-auto',
};

export function Tile({ variant = 'solo', className, children, label }) {
    return (
        <div className="group flex cursor-default items-center gap-3 rounded-md border border-hairline bg-card py-3 pr-[22px] pl-[18px] transition hover:-translate-y-0.5 hover:border-hairline-hover hover:bg-surface-hover">
            <div
                className={cn(
                    'flex shrink-0 items-center justify-center',
                    TILE_VARIANTS[variant],
                    className
                )}
            >
                {children}
            </div>
            <span className="whitespace-nowrap text-[0.95rem] font-semibold text-ink-secondary transition group-hover:text-foreground">
                {label}
            </span>
        </div>
    );
}

function ServiceTile({ item }) {
    const { Icon, StackIcons, variant = 'solo', iconClassName, name } = item;
    return (
        <Tile variant={variant} className={iconClassName} label={name}>
            {StackIcons ? StackIcons.map((StackIcon, i) => <StackIcon key={i} />) : <Icon />}
        </Tile>
    );
}

/* Landing teaser: compact tile rows + a button to the full services page. */
export default function Services() {
    return (
        <section id="services" className="section-shell bg-background">
            <div className="container-page">
                <SectionHeader
                    tag="Supported Runtimes"
                    title={
                        <>
                            Any Language, <span className="gradient-text">Any Framework</span>
                        </>
                    }
                    subtitle="Pick your runtime and deploy in under 60 seconds"
                />

                {SERVICE_GROUPS.map((group) => (
                    <div key={group.label}>
                        <div className="mt-12 mb-[18px] text-center text-[0.78rem] font-bold tracking-[1.5px] text-ink-muted uppercase">
                            {group.label}
                        </div>
                        <div className="flex flex-wrap justify-center gap-3">
                            {group.items.map((item) => (
                                <ServiceTile key={item.name} item={item} />
                            ))}
                        </div>
                    </div>
                ))}

                <div className="mt-10 text-center">
                    <Button variant="outline" size="lg" asChild>
                        <Link to="/services">Explore all runtimes</Link>
                    </Button>
                </div>
            </div>
        </section>
    );
}
