import { Link } from 'react-router-dom';
import { ArrowUpRight, Cpu, FileTerminal, MemoryStick, HardDrive } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useReveal } from '@/hooks/useSiteEffects.js';
import { Button } from '../ui/button.jsx';
import { CAPABILITIES } from '@/data/landing.js';

/* Small, honest illustrations drawn from the real dashboard widgets. */
function Visual({ kind }) {
    if (kind === 'metrics') {
        return (
            <div className="grid grid-cols-3 gap-2">
                {[
                    { Icon: Cpu, label: 'CPU', value: 34 },
                    { Icon: MemoryStick, label: 'RAM', value: 58 },
                    { Icon: HardDrive, label: 'Disk', value: 21 },
                ].map(({ Icon, label, value }) => (
                    <div key={label} className="rounded-lg border border-hairline bg-black/40 p-2.5">
                        <Icon className="size-3.5 text-ink-muted" aria-hidden="true" />
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-hairline">
                            <div className="h-full rounded-full bg-[color:var(--lime)]" style={{ width: `${value}%` }} />
                        </div>
                        <p className="mt-1.5 font-mono text-[0.62rem] text-ink-muted">
                            {label} {value}%
                        </p>
                    </div>
                ))}
            </div>
        );
    }

    if (kind === 'logs') {
        return (
            <div className="rounded-lg border border-hairline bg-black/50 p-3 font-mono text-[0.68rem] leading-relaxed text-ink-secondary">
                <p className="text-ink-muted">14:02:11 server started (node v20)</p>
                <p>14:02:12 connected to gateway</p>
                <p className="text-[color:var(--lime)]">14:02:12 ready in 1.4s</p>
            </div>
        );
    }

    if (kind === 'command') {
        return (
            <div className="rounded-lg border border-hairline bg-black/50 p-3 font-mono text-[0.68rem] leading-relaxed text-ink-secondary">
                <p>
                    <span className="text-[color:var(--lime)]">$</span> create server --runtime node --ram 512
                </p>
                <p className="text-ink-muted">› provisioning container…</p>
                <p className="text-[color:var(--lime)]">› online</p>
            </div>
        );
    }

    return null;
}

function CapabilityCard({ item }) {
    const [ref, visible] = useReveal();
    const wide = item.span === 'wide';

    return (
        <div
            ref={ref}
            className={cn(
                'reveal group relative flex flex-col overflow-hidden rounded-2xl border border-hairline bg-[color:var(--surface-1)] p-6 transition hover:border-hairline-hover max-[480px]:p-5',
                wide && 'lg:col-span-2',
                visible && 'reveal-visible'
            )}
        >
            <div className="relative z-[1] flex h-full flex-col">
                <h3 className="text-[1.02rem] font-bold text-foreground">{item.title}</h3>
                <p className="mt-2 max-w-[46ch] text-[0.88rem] leading-[1.65] text-ink-secondary">{item.text}</p>
                {item.visual ? (
                    <div className="mt-5">
                        <Visual kind={item.visual} />
                    </div>
                ) : (
                    <div className="mt-auto pt-5">
                        <span className="inline-flex items-center gap-1.5 font-mono text-[0.7rem] text-ink-muted">
                            <FileTerminal className="size-3.5" aria-hidden="true" />
                            available in the dashboard
                        </span>
                    </div>
                )}
            </div>
            {/* hairline that warms up on hover */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[color:var(--lime)]/50 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            />
        </div>
    );
}

export default function Bento() {
    return (
        <section id="capabilities" className="section-shell border-t border-hairline bg-[color:var(--surface-0)]">
            <div className="container-page">
                <header className="mx-auto max-w-[680px] text-center">
                    <p className="mb-3 font-mono text-[0.72rem] font-bold tracking-[0.22em] text-[color:var(--lime)] uppercase">
                        What you can do
                    </p>
                    <h2 className="text-[1.7rem] leading-[1.18] font-extrabold tracking-[-0.03em] text-foreground min-[400px]:text-[1.9rem] sm:text-[2.3rem] lg:text-[2.5rem]">
                        Everything a server needs, in one dashboard
                    </h2>
                    <p className="mx-auto mt-4 max-w-[560px] text-[0.98rem] leading-[1.7] text-ink-secondary">
                        No SSH keys, no config files on your laptop, no second tab for logs. Create it, watch it, fix it.
                    </p>
                </header>

                <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {CAPABILITIES.map((item) => (
                        <CapabilityCard key={item.id} item={item} />
                    ))}
                </div>

                <div className="mt-10 flex justify-center">
                    <Button asChild variant="outline">
                        <Link to="/features">
                            Explore all features
                            <ArrowUpRight className="size-4" aria-hidden="true" />
                        </Link>
                    </Button>
                </div>
            </div>
        </section>
    );
}
