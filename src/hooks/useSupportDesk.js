import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch } from '@/lib/api.js';

/**
 * Live totals for every queue tab. Five tiny requests (limit=1) are cheaper
 * than a bespoke summary endpoint, and they always agree with the list itself
 * because they come from the same code path.
 */
export function useQueueSummary() {
  return useQuery({
    queryKey: ['support', 'queue', 'summary'],
    queryFn: async () => {
      const views = ['available', 'mine', 'team', 'escalated', 'resolved'];
      const out = {};
      await Promise.all(
        views.map(async (view) => {
          const r = await apiGet(`/support/queue?view=${view}&limit=1`);
          out[view] = r.total ?? 0;
        }),
      );
      return out;
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

/** Priority is a staff decision: only the holder of the ticket passes. */
export function useSetPriority(id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (priority) => apiPatch(`/support/tickets/${id}/priority`, { priority }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['support', 'ticket', id] });
      qc.invalidateQueries({ queryKey: ['support', 'queue'] });
    },
  });
}

/** Staff-only lifecycle: resolve or close (the owner never can). */
export function useStaffStatus(id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status) => apiPatch(`/support/tickets/${id}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['support'] });
    },
  });
}
