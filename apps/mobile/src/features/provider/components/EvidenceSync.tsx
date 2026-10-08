/**
 * Sends queued evidence when it can (ADR-0012).
 *
 * Mounted once under the provider route group. It runs a pass when the
 * technician opens the provider side, whenever the phone gets its
 * connection back, and whenever the app returns to the foreground — the
 * three moments a technician who left a basement is likely to be back in
 * range. Renders nothing.
 */

import { useEffect } from 'react';
import { AppState } from 'react-native';
import { addNetworkStateListener } from 'expo-network';
import { useQueryClient } from '@tanstack/react-query';
import { syncEvidenceNow } from '@/features/provider/lib/evidence-queue';

export function EvidenceSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let alive = true;

    const run = async () => {
      const result = await syncEvidenceNow().catch(() => null);
      if (!alive || result === null) return;
      if (result.recorded.length > 0 || result.refused.length > 0) {
        await queryClient.invalidateQueries({ queryKey: ['evidence-draft'] });
        await queryClient.invalidateQueries({ queryKey: ['my-jobs'] });
        for (const orderId of result.recorded) {
          await queryClient.invalidateQueries({ queryKey: ['job', orderId] });
        }
      }
    };

    void run();
    const network = addNetworkStateListener((state) => {
      if (state.isConnected === true && state.isInternetReachable !== false) void run();
    });
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') void run();
    });

    return () => {
      alive = false;
      network.remove();
      appState.remove();
    };
  }, [queryClient]);

  return null;
}
