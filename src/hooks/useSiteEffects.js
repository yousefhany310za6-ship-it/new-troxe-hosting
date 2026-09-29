import { useEffect, useRef, useState } from 'react';

/* ============================================================
   Port of the original script.js behaviours into React hooks.
   Every rule (thresholds, easing, offsets, durations) is kept
   identical to the vanilla version.
   ============================================================ */

/** Adds `.scrolled` to the navbar past 50px of scroll. */
export function useScrolled(threshold = 50) {
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > threshold);
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, [threshold]);

    return scrolled;
}

/** Smooth-scrolls every in-page `a[href^="#"]` with an 80px top offset. */
export function useSmoothScroll() {
    useEffect(() => {
        const onClick = (e) => {
            // Router <Link>s handle their own clicks (and already prevented the
            // default), and a bare "#" is left to the browser/router too.
            if (e.defaultPrevented) return;

            const anchor = e.target.closest && e.target.closest('a[href^="#"]');
            if (!anchor) return;

            const href = anchor.getAttribute('href');
            if (!href || !/^#[A-Za-z][\w-]*$/.test(href)) return;

            const target = document.getElementById(href.slice(1));
            if (!target) return;

            e.preventDefault();
            const offset = 80;
            const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - offset;
            window.scrollTo({ top: targetPosition, behavior: 'smooth' });
        };

        document.addEventListener('click', onClick);
        return () => document.removeEventListener('click', onClick);
    }, []);
}

/** `.reveal` -> `.visible` once the element scrolls into view. */
export function useReveal() {
    const ref = useRef(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return undefined;

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        setVisible(true);
                        observer.unobserve(entry.target);
                    }
                });
            },
            { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
        );

        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    return [ref, visible];
}

/**
 * Same easing curve as the original: 2000ms, ease-out cubic,
 * 1 decimal when the target has one, plain integer otherwise.
 */
export function runCounter(target, suffix, setDisplay) {
    const duration = 2000;
    const startTime = performance.now();
    const isDecimal = target % 1 !== 0;
    let frame;

    const update = (currentTime) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = eased * target;

        setDisplay(isDecimal ? `${current.toFixed(1)}${suffix}` : `${Math.floor(current)}${suffix}`);

        if (progress < 1) {
            frame = requestAnimationFrame(update);
        } else {
            setDisplay(`${target}${suffix}`);
        }
    };

    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
}
