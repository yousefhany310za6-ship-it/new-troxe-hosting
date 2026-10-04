import { lazy } from 'react';

/**
 * `lazy()` with retries for flaky mobile networks: a single dropped chunk
 * fetch no longer kills the route on the first attempt. After the retries
 * are exhausted the error propagates to RouteErrorBoundary, whose fallback
 * offers a full reload (which also resolves stale-chunk-after-deploy).
 */
export function lazyRetry(importer, attempts = 3, delayMs = 600) {
    return lazy(async () => {
        let lastError = null;
        for (let i = 0; i < attempts; i++) {
            try {
                return await importer();
            } catch (e) {
                lastError = e;
                if (i < attempts - 1) {
                    await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
                }
            }
        }
        throw lastError;
    });
}
