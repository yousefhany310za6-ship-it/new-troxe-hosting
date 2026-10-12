import { useEffect, useState } from 'react';

/**
 * Tracks the `prefers-reduced-motion` media query.
 *
 * The demo animates in three places (resource sparklines, console
 * auto-scroll, the start/stop transitions). Each of them reads this
 * so a visitor who asked for less motion gets the same information
 * delivered statically. The listener is torn down on unmount.
 */
export function useReducedMotion() {
    const [reduced, setReduced] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return undefined;

        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        setReduced(mq.matches);

        const onChange = (e) => setReduced(e.matches);
        // Safari < 14 only has the deprecated API.
        if (mq.addEventListener) {
            mq.addEventListener('change', onChange);
            return () => mq.removeEventListener('change', onChange);
        }
        mq.addListener(onChange);
        return () => mq.removeListener(onChange);
    }, []);

    return reduced;
}

export default useReducedMotion;