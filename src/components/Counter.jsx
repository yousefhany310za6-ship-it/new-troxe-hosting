import { useEffect, useRef, useState } from 'react';
import { runCounter } from '../hooks/useSiteEffects.js';

/** Animated hero statistic, fired at 50% visibility exactly like before. */
export function Counter({ target, suffix = '', label }) {
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
        <div className="text-center">
            <div
                ref={ref}
                data-target={target}
                data-suffix={suffix}
                className="font-mono text-[2rem] font-extrabold text-foreground max-md:text-[1.5rem]"
            >
                {display}
            </div>
            <div className="text-[0.85rem] font-semibold text-ink-muted">{label}</div>
        </div>
    );
}
