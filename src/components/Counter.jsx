import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { runCounter } from '../hooks/useSiteEffects.js';

/** Animated hero statistic, fired at 50% visibility exactly like before.
 *  `className` lands on the root so the caller can align the whole cell — the
 *  hero is centred on mobile and left-aligned from `lg`, and a centred counter
 *  under left-aligned copy reads as a mistake. */
export function Counter({ target, suffix = '', label, className }) {
    const ref = useRef(null);
    const [display, setDisplay] = useState('0');
    const cleanup = useRef(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return undefined;

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        cleanup.current = runCounter(target, suffix, setDisplay);
                        observer.unobserve(entry.target);
                    }
                });
            },
            { threshold: 0.5 }
        );

        observer.observe(el);
        return () => {
            observer.disconnect();
            if (cleanup.current) cleanup.current();
        };
    }, [target, suffix]);

    return (
        <div className={cn('text-center', className)}>
            <div
                ref={ref}
                data-target={target}
                data-suffix={suffix}
                className="font-mono text-[1.75rem] leading-none font-extrabold tracking-[-0.02em] text-foreground max-sm:text-[1.5rem]"
            >
                {display}
            </div>
            <div className="mt-2 text-[0.78rem] font-medium text-ink-muted">{label}</div>
        </div>
    );
}
