import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { takeScrollRequest } from '@/lib/scrollRequest';

/** Same 80px offset the in-page smooth scroll uses (it clears the fixed navbar). */
const NAV_OFFSET = 80;

/**
 * Runs on every route change: scrolls to a requested section, otherwise back to
 * the top. Lives next to the routes so it fires after the new page rendered.
 */
export default function ScrollManager() {
    const { pathname } = useLocation();

    useEffect(() => {
        const { type, id } = takeScrollRequest();

        if (type === 'section') {
            const target = document.getElementById(id);
            if (target) {
                const top = target.getBoundingClientRect().top + window.pageYOffset - NAV_OFFSET;
                window.scrollTo({ top, behavior: 'smooth' });
                return;
            }
        }

        window.scrollTo({ top: 0, behavior: 'auto' });
    }, [pathname]);

    return null;
}
