import { Link } from 'react-router-dom';
import { ArrowUpRight, Boxes } from 'lucide-react';

import { useReveal } from '@/hooks/useSiteEffects.js';
import { Button } from '../ui/button.jsx';
import { RUNTIMES } from '@/data/landing.js';
import { IconNode, IconPython, IconBun, IconPhp } from '../icons.jsx';

const ICONS = { IconNode, IconPython, IconBun, IconPhp };

/**
 * Only the runtimes the platform can actually provision (the backend
 * `server_runtime` enum). Anything you can run on one of them works — the
 * list stays truthful and grows by one entry when a runtime is added.
 */
export default function Runtimes() {
    const [ref, visible] = useReveal();

    return (
        <section id="runtimes" className="section-shell border-t border-hairline bg-[color:var(--surface-1)]">
            <div className="container-page">
                <div className="flex flex-wrap items-end justify-between gap-6">
                    <div className="min-w-0">
                        <p className="mb-3 inline-flex items-center gap-2 font-mono text-[0.72rem] font-bold tracking-[0.22em] text-[color:var(--lime)] uppercase">
                            <Boxes className="size-3.5" aria-hidden="true" />
                            Supported runtimes
                        </p>
                        <h2 className="text-[1.7rem] leading-[1.18] font-extrabold tracking-[-0.03em] text-foreground min-[400px]:text-[1.9rem] sm:text-[2.3rem] lg:text-[2.5rem]">
                            Bring the code. Pick the runtime.
                        </h2>
                        <p className="mt-4 max-w-[560px] text-[0.98rem] leading-[1.7] text-ink-secondary">
                            Each runtime is pinned to a maintained image, so you choose the version you need and we keep the
                            container running.
                        </p>
                    </div>
                    <Button asChild variant="outline">
                        <Link to="/services">
                            See services
                            <ArrowUpRight className="size-4" aria-hidden="true" />
                        </Link>
                    </Button>
                </div>

                <div ref={ref} className={cn0('mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4', visible && '')}>
                    {RUNTIMES.map((r) => {
                        const Icon = ICONS[r.Icon];
                        return (
                            <div
                                key={r.id}
                                className="group rounded-2xl border border-hairline bg-[color:var(--surface-2)] p-6 transition hover:-translate-y-1 hover:border-hairline-hover"
                            >
                                <span className="flex size-11 items-center justify-center rounded-lg border border-hairline bg-black/40 transition group-hover:border-[color:var(--lime)]/40 [&>svg]:size-6">
                                    {Icon ? <Icon /> : null}
                                </span>
                                <h3 className="mt-5 text-[1.05rem] font-bold text-foreground">{r.name}</h3>
                                <p className="mt-2 text-[0.86rem] leading-[1.6] text-ink-secondary">{r.blurb}</p>
                            </div>
                        );
                    })}
                </div>

                <p className="mx-auto mt-8 max-w-[620px] text-center text-[0.84rem] leading-[1.7] text-ink-muted">
                    Discord, Telegram and Slack bots, REST APIs, webhooks, cron workers and static sites all run on these
                    runtimes. Databases are not offered as a managed product — you can run one inside your own server.
                </p>
            </div>
        </section>
    );
}

function cn0(...args) {
    return args.filter(Boolean).join(' ');
}
