/**
 * The operators' switches and settings, for any screen that needs them.
 *
 * One query key, so the tracking screen, the account tab and the home screen
 * share one read. Until it arrives — and if it never does — the defaults
 * apply: everything on, which is the safe way round for a customer (the
 * server refuses what is really off, 0081).
 */

import { useQuery } from '@tanstack/react-query';
import { repository } from '@/features/shared/data/repository';
import { DEFAULT_PLATFORM_STATUS } from '@/features/shared/data/platform-status';
import type { AppFeatures, PlatformStatus } from '@/features/shared/data/types';

export function usePlatformStatus(): PlatformStatus {
  const status = useQuery({
    queryKey: ['platform-status'],
    queryFn: () => repository.getPlatformStatus(),
    staleTime: 60_000,
  });
  return status.data ?? DEFAULT_PLATFORM_STATUS;
}

export function useFeatures(): AppFeatures {
  return usePlatformStatus().features;
}
