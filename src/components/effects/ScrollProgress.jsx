import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * ScrollProgress — a hairline bar pinned under the navbar showing how far
 * through the page the visitor is.
 *
 * The width is written straight to the DOM inside a rAF loop rather than
 * through state: at 60fps a re-render per scroll event would be the single
 * most expensive thing on the page, and this is pure decoration.
 */
export default function ScrollProgress({ className }) {
    const barRef = useRef(null);

    useEffect(() => {
        const bar = barRef.current;
        if (!bar) return undefined;

        let raf = 0;
        let queued = false;

        const paint = () => {
            queued = false;
            const scrollable = document.documentElement.scrollHeight - window.innerHeight;
            const progress = scrollable > 0 ? Math.min(window.scrollY / scrollable, 1) : 0;
            bar.style.transform = `scaleX(${progress})`;
        };

        const onScroll = () => {
            if (queued) return;
            queued = true;
            raf = requestAnimationFrame(paint);
        };

        paint();
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll, { passive: true });

        return () => {
            window.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', onScroll);
            if (raf) cancelAnimationFrame(raf);
        };
    }, []);

    return (
        <div
            aria-hidden="true"
            className={cn(
                'pointer-events-none fixed inset-x-0 top-0 z-[1001] h-px origin-left bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.9))]',
                className
            )}
        >
            <div ref={barRef} className="h-full w-full origin-left scale-x-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.15),#ffffff)]" />
        </div>
    );
}