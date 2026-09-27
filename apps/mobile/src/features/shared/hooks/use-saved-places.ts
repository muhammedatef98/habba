/**
 * Home, work and recent places (places.ts), read from and written to this
 * phone. One query key, so the map screen and anything else that shows them
 * stay in step.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DeviceLocation } from '@/features/shared/lib/location-provider';
import {
  orderedPlaces,
  rememberRecent,
  setLabelledPlace,
  type SavedPlace,
} from '@/features/shared/lib/places';
import { readSavedPlaces, writeSavedPlaces } from '@/features/shared/lib/preferences';

const KEY = ['saved-places'] as const;

export interface SavedPlaces {
  readonly places: readonly SavedPlace[];
  readonly remember: (at: DeviceLocation, label: string) => Promise<void>;
  readonly save: (kind: 'home' | 'work', at: DeviceLocation, label: string) => Promise<void>;
}

export function useSavedPlaces(): SavedPlaces {
  const queryClient = useQueryClient();
  const stored = useQuery({ queryKey: KEY, queryFn: readSavedPlaces, staleTime: Infinity });
  const current = stored.data ?? [];

  const write = async (next: readonly SavedPlace[]) => {
    queryClient.setQueryData(KEY, next);
    await writeSavedPlaces(next);
  };

  return {
    places: orderedPlaces(current),
    remember: (at, label) => write(rememberRecent(current, at, label)),
    save: (kind, at, label) => write(setLabelledPlace(current, kind, at, label)),
  };
}
