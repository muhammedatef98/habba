/**
 * The technician's dashboard (0095), shared by the shift, earnings and profile
 * tabs under one cache key: three tabs, one request.
 *
 * Tabs stay mounted, so a query that only ran on mount would show this
 * morning's figures all day. It refreshes whenever one of those tabs comes
 * into view — a job finished a minute ago is in today's figure by the time
 * the technician looks.
 */

import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { providerRepository } from '@/features/provider/data/provider-repository';

export const DASHBOARD_KEY = ['provider-dashboard'] as const;

export function useProviderDashboard() {
  const queryClient = useQueryClient();

  useFocusEffect(
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: DASHBOARD_KEY });
    }, [queryClient]),
  );

  return useQuery({
    queryKey: DASHBOARD_KEY,
    queryFn: () => providerRepository.getDashboard(),
    staleTime: 30_000,
  });
}
