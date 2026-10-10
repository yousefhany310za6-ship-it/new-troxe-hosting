import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, UserPlus, CreditCard, Server, LineChart } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useReveal } from '@/hooks/useSiteEffects.js';

const STEP_ICONS = [UserPlus, CreditCard, Server, LineChart];
const STEPS = [
    { id: 'account', title: 'Create your account', text: 'Email, Google or Discord. The free plan needs no card.' },
    { id: 'plan', title: 'Pick a plan', text: 'Start free, or choose the RAM, CPU and storage you need.' },
    { id: 'server', title: 'Create a server', text: 'Choose Node.js, Python, Bun or PHP and set the startup command.' },
    { id: 'manage', title: 'Watch it run', text: 'Metrics, logs, files, backups and support — all in the dashboard.' },
];

export default function Steps() {
    return (
        <section id="how" className="section-shell border-t border-hairline bg-[color:var(--surface-0)]">
            <div className="container-page">
                <header className="mx-auto max-w-[640px] text-center">
                    <p className="mb-3 font-mono text-[0.72rem] font-bold tracking-[0.22em] text-[color:var(--lime)] uppercase">
                        How it works
                    </p>
                    <h2 className="text-[1.7rem] leading-[1.18] font-extrabold tracking-[-0.03em] text-foreground min-[400px]:text-[1.9rem] sm:text-[2.3rem] lg:text-[2.5rem]">
                        From signup to a running server
                    </h2>
                </header>

                <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {STEPS.map((step, i) => {
                        const Icon = STEP_ICONS[i] ?? Server;
                        return <StepCard key={step.id} step={step} index={i} Icon={Icon} />;
                    })}
                </ol>

                <p className="mt-8 text-center text-[0.86rem] text-ink-secondary">
                    Already have an account?{' '}
                    <Link to="/signin" className="font-bold text-foreground underline decoration-[color:var(--lime)] decoration-2 underline-offset-4">
                        Sign in
                    </Link>{' '}
                    and your servers are where you left them.
                </p>
            </div>
        </section>
    );
}

function StepCard({ step, index, Icon }) {
    const [ref, visible] = useReveal();

    return (
        <li
            ref={ref}
            className={cn(
                'reveal relative flex flex-col rounded-2xl border border-hairline bg-[color:var(--surface-1)] p-6 transition hover:border-hairline-hover',
                visible && 'reveal-visible'
            )}
            style={{ transitionDelay: `${index * 70}ms` }}
        >
            <div className="flex items-center justify-between">
                <span className="flex size-10 items-center justify-center rounded-xl border border-hairline bg-black/40 text-[color:var(--lime)]">
                    <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className="font-mono text-[0.8rem] font-bold text-ink-muted">0{index + 1}</span>
            </div>
            <h3 className="mt-5 text-[1rem] font-bold text-foreground">{step.title}</h3>
            <p className="mt-2 text-[0.86rem] leading-[1.6] text-ink-secondary">{step.text}</p>
        </li>
    );
}
