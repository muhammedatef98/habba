/**
 * Live screens: a change in the database refreshes the screen showing it.
 *
 * Until now "live" meant polling — the tracking screen every few seconds,
 * the home screen only when its tab was opened again. So a technician
 * accepting a job reached the customer up to a poll later, and an order that
 * finished while the customer sat on الرئيسية still showed as in progress.
 *
 * This subscribes to Supabase Realtime for the rows a screen shows and, on
 * any change, invalidates that screen's queries: the refetch goes through the
 * same repository and the same RLS as always, so the push carries no data of
 * its own to trust. Realtime delivers only rows the subscriber may select
 * (the tables' RLS applies), and 0076 adds the tables to the publication.
 *
 * Polling stays where it was, slower, as the fallback — a dropped socket in a
 * car park must not freeze the screen.
 *
 * In the in-memory dev build there is no server to listen to; it is a no-op.
 */

import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { getSupabaseClient } from '@/features/shared/lib/supabase';

export interface LiveSource {
  readonly table: 'orders' | 'order_parts' | 'order_offers';
  /** A Realtime filter, e.g. `id=eq.<uuid>`. Omitted: every row RLS allows. */
  readonly filter?: string | undefined;
}

let counter = 0;

export function useLiveRefresh(
  sources: readonly LiveSource[],
  queryKeys: readonly QueryKey[],
  enabled = true,
): void {
  const queryClient = useQueryClient();
  // Stable identity for the effect: the arrays are usually literals.
  const sourceKey = JSON.stringify(sources);
  const keysKey = JSON.stringify(queryKeys);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!enabled || client === null) return;

    counter += 1;
    const channel = client.channel(`live-${counter}`);
    const parsedSources = JSON.parse(sourceKey) as LiveSource[];
    const parsedKeys = JSON.parse(keysKey) as QueryKey[];

    for (const source of parsedSources) {
      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: source.table,
          ...(source.filter === undefined ? {} : { filter: source.filter }),
        },
        () => {
          for (const key of parsedKeys) void queryClient.invalidateQueries({ queryKey: key });
        },
      );
    }
    channel.subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [enabled, keysKey, queryClient, sourceKey]);
}
