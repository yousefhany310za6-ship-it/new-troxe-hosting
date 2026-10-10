import { useQuery } from '@tanstack/react-query';
import { apiGet, apiBase, ApiError } from '@/lib/api.js';

/**
 * Public marketing data. Both endpoints are unauthenticated on the API
 * (`/plans` and `/health/ready`), and both are the REAL source of truth:
 * prices and resources are what the admin manages in the database, and the
 * service status is what the platform itself reports.
 */

export const publicKeys = {
    plans: () => ['public', 'plans'],
    health: () => ['public', 'health'],
};

/**
 * The plan list. No prices or resource numbers are hardcoded anywhere in the
 * UI: if the API is unreachable the section says so instead of inventing them.
 */
export function usePublicPlans() {
    return useQuery({
        queryKey: publicKeys.plans(),
        queryFn: async () => {
            const rows = await apiGet('/plans');
            return Array.isArray(rows) ? rows : [];
        },
        staleTime: 5 * 60_000,
        retry: 1,
    });
}

/**
 * Live service status from the readiness probe (database + docker daemon).
 * A failed request is reported as "unknown" — never as a green light.
 */
export function useServiceHealth() {
    return useQuery({
        queryKey: publicKeys.health(),
        queryFn: async () => {
            const res = await fetch(`${apiBase()}/health/ready`, { headers: { Accept: 'application/json' } });
            if (!res.ok) throw new ApiError(res.status, 'HEALTH_UNAVAILABLE', 'The status endpoint did not answer');
            return res.json();
        },
        staleTime: 60_000,
        retry: 1,
        refetchInterval: 120_000,
    });
}
