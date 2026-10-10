import { Link } from 'react-router-dom';
import { ArrowRight, Play, Radio } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '../ui/button.jsx';
import { IconNode, IconPython, IconBun, IconPhp } from '../icons.jsx';
import { useReveal } from '@/hooks/useSiteEffects.js';

const RUNTIME_ICONS = { 'Node.js': IconNode, Python: IconPython, Bun: IconBun, PHP: IconPhp };

/**
 * An illustration of the product dashboard, not a fake screenshot: the shapes,
 * numbers and copy are the ones the real dashboard shows (server name, runtime,
 * status, CPU/RAM bars, log lines). It is built from real UI patterns and makes
 * no claim the product does not have. Pure CSS — nothing is fetched for it.
 */
function CommandCenter() {
    const [ref, visible] = useReveal();

    return (
        <div
            ref={ref}
            className={cn(
                'reveal relative w-full max-w-[560px] lg:max-w-none',
                visible && 'reveal-visible'
            )}
        >
            {/* faint lime glow behind the panel, kept very low */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute -inset-8 rounded-[40px] bg-[color:var(--lime)] opacity-[0.05] blur-[80px]"
            />

            <div className="relative overflow-hidden rounded-2xl border border-hairline bg-[color:var(--surface-1)] shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]">
                {/* window chrome */}
                <div className="flex items-center gap-3 border-b border-hairline bg-[color:var(--surface-2)] px-4 py-3">
                    <span className="flex gap-1.5" aria-hidden="true">
                        <span className="size-2.5 rounded-full bg-hairline-hover" />
                        <span className="size-2.5 rounded-full bg-hairline-hover" />
                        <span className="size-2.5 rounded-full bg-hairline-hover" />
                    </span>
                    <span className="ml-1 rounded-md border border-hairline bg-black/40 px-2 py-1 font-mono text-[0.68rem] text-ink-muted">
                        hosting.troxe.dev/dashboard/servers
                    </span>
                    <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-[color:var(--lime)]/30 bg-[color:var(--lime)]/10 px-2 py-0.5 text-[0.66rem] font-bold text-[color:var(--lime)]">
                        <span className="status-dot size-1.5 rounded-full bg-[color:var(--lime)]" />
                        live
                    </span>
                </div>

                {/* server rows, shaped exactly like the dashboard list */}
                <div className="flex flex-col gap-2.5 p-4">
                    {SERVERS.map((s) => {
                        const Icon = RUNTIME_ICONS[s.runtime];
                        return (
                            <div
                                key={s.name}
                                className="rounded-xl border border-hairline bg-black/40 p-3.5 transition hover:border-hairline-hover"
                            >
                                <div className="flex items-center gap-2.5">
                                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-hairline bg-[color:var(--surface-2)] [&>svg]:size-4">
                                        {Icon ? <Icon /> : null}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-[0.86rem] font-bold text-foreground">{s.name}</span>
                                        <span className="block font-mono text-[0.68rem] text-ink-muted">
                                            {s.runtime} · {s.region}
                                        </span>
                                    </span>
                                    <span
                                        className={cn(
                                            'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.66rem] font-bold',
                                            s.online
                                                ? 'border-[color:var(--lime)]/30 bg-[color:var(--lime)]/10 text-[color:var(--lime)]'
                                                : 'border-hairline bg-veil text-ink-secondary'
                                        )}
                                    >
                                        <span className={cn('size-1.5 rounded-full', s.online ? 'bg-[color:var(--lime)]' : 'bg-zinc-500')} />
                                        {s.online ? 'online' : 'offline'}
                                    </span>
                                </div>

                                <div className="mt-3 grid grid-cols-3 gap-2.5">
                                    {[
                                        { label: 'CPU', value: s.cpu },
                                        { label: 'RAM', value: s.ram },
                                        { label: 'Disk', value: s.disk },
                                    ].map((m) => (
                                        <div key={m.label}>
                                            <div className="flex items-baseline justify-between">
                                                <span className="font-mono text-[0.62rem] tracking-[0.14em] text-ink-muted uppercase">{m.label}</span>
                                                <span className="font-mono text-[0.68rem] font-bold text-foreground">{m.value}%</span>
                                            </div>
                                            <div className="mt-1 h-1 overflow-hidden rounded-full bg-hairline">
                                                <div
                                                    className={cn('h-full rounded-full', s.online ? 'bg-[color:var(--lime)]' : 'bg-zinc-600')}
                                                    style={{ width: `${m.value}%` }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* console strip */}
                <div className="border-t border-hairline bg-black/60 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <span className="font-mono text-[0.66rem] tracking-[0.14em] text-ink-muted uppercase">console</span>
                        <span className="ml-auto font-mono text-[0.64rem] text-ink-muted">stdout</span>
                    </div>
                    <pre className="mt-1.5 overflow-hidden font-mono text-[0.68rem] leading-relaxed text-ink-secondary">
                        <span className="text-[color:var(--lime)]">$</span> npm start{'\n'}
                        <span className="text-ink-muted">› bot ready in 1.4s</span>
                    </pre>
                </div>
            </div>
        </div>
    );
}

/* Illustrative rows for the panel above — the dashboard's own shapes. */
const SERVERS = [
    { name: 'discord-bot', runtime: 'Node.js', region: 'fra-de', online: true, cpu: 34, ram: 58, disk: 21 },
    { name: 'payments-api', runtime: 'Python', region: 'fra-de', online: true, cpu: 12, ram: 41, disk: 17 },
    { name: 'worker-queue', runtime: 'Bun', region: 'fra-de', online: false, cpu: 0, ram: 0, disk: 22 },
];

export default function Hero() {
    return (
        <section id="hero" className="relative overflow-hidden bg-[color:var(--surface-0)] pt-[132px] pb-16 sm:pb-20">
            {/* quiet grid + a single soft light source; no moving backgrounds */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                <div className="grid-pattern absolute inset-0 opacity-70" />
                <div className="absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-[color:var(--lime)] opacity-[0.06] blur-[120px]" />
            </div>

            <div className="container-page relative">
                <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)] lg:gap-10">
                    <div className="min-w-0">
                        <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-hairline bg-[color:var(--surface-1)] px-3.5 py-1.5 text-[0.78rem] font-semibold text-ink-secondary">
                            <Radio className="size-3.5 text-[color:var(--lime)]" aria-hidden="true" />
                            Bot &amp; app hosting, run for you
                        </p>

                        <h1 className="text-[2.05rem] leading-[1.1] font-extrabold tracking-[-0.035em] text-foreground min-[400px]:text-[2.3rem] sm:text-[2.9rem] lg:text-[3.3rem] xl:text-[3.6rem]">
                            Ship your bot or app,
                            <br />
                            <span className="text-[color:var(--lime)]">we keep it running.</span>
                        </h1>

                        <p className="mt-6 max-w-[540px] text-[1.02rem] leading-[1.7] text-ink-secondary">
                            Troxe gives every project its own container, live CPU, RAM and disk metrics, a console, logs,
                            files and backups — managed from one dashboard. Start free, no card.
                        </p>

                        <div className="mt-9 flex flex-wrap items-center gap-3 max-[480px]:flex-col max-[480px]:items-stretch">
                            <Button asChild size="lg" className="accent-cta border-0 font-extrabold hover:bg-[color:var(--lime-strong)]">
                                <Link to="/signup">
                                    Start for free
                                    <ArrowRight className="size-4" aria-hidden="true" />
                                </Link>
                            </Button>
                            <Button asChild variant="outline" size="lg">
                                <Link to="/pricing">
                                    <Play className="size-4" aria-hidden="true" />
                                    See plans
                                </Link>
                            </Button>
                        </div>

                        <dl className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3">
                            {[
                                { k: '4 runtimes', v: 'Node.js · Python · Bun · PHP' },
                                { k: 'Dedicated container', v: 'per server' },
                                { k: 'Support tickets', v: 'inside the dashboard' },
                            ].map((item) => (
                                <div key={item.k}>
                                    <dt className="text-[0.8rem] font-bold text-foreground">{item.k}</dt>
                                    <dd className="text-[0.78rem] text-ink-muted">{item.v}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>

                    <div className="min-w-0">
                        <CommandCenter />
                    </div>
                </div>
            </div>
        </section>
    );
}
