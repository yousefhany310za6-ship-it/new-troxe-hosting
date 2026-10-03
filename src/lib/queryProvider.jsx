import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';

// DevTools are dev-only AND lazily imported, so no debugging surface or
// query-cache inspector ships in the production bundle.
const Devtools = import.meta.env.DEV
  ? lazy(() => import('@tanstack/react-query-devtools').then((m) => ({ default: m.ReactQueryDevtools })))
  : () => null;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: 'always',
      retry: (failureCount, error) => {
        if (error?.status === 401 || error?.status === 403) return false;
        return failureCount < 3;
      },
    },
  },
});

export function QueryProvider({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Suspense fallback={null}>
        <Devtools initialIsOpen={false} />
      </Suspense>
    </QueryClientProvider>
  );
}

// Re-export for convenience
export { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
export { queryClient };