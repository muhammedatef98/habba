/**
 * Fetches the operators' replacements for the app's words (0093) and applies
 * them. Renders nothing.
 *
 * Refetched every few minutes and on focus, so a fix made in the console
 * reaches a phone that stays open. Never persisted: a launch without a
 * network shows the shipped words, which are always correct, only older.
 */

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { repository } from '@/features/shared/data/repository';
import { applyCopyOverrides } from '@/features/shared/lib/i18n';

export function CopyOverrides() {
  const copy = useQuery({
    queryKey: ['app-copy'],
    queryFn: () => repository.listAppCopy(),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (copy.data !== undefined) applyCopyOverrides(copy.data);
  }, [copy.data]);

  return null;
}
