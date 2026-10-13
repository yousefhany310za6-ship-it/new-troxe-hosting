import { useCallback } from 'react';

/**
 * Writes the cursor position, relative to the element, into `--mx` / `--my`.
 *
 * The `.cursor-spotlight` class reads those two variables to place a radial
 * gradient, so the light follows the pointer without ever re-rendering React.
 */
export function useSpotlight() {
    return useCallback((event) => {
        const el = event.currentTarget;
        const rect = el.getBoundingClientRect();
        el.style.setProperty('--mx', `${event.clientX - rect.left}px`);
        el.style.setProperty('--my', `${event.clientY - rect.top}px`);
    }, []);
}

export default useSpotlight;