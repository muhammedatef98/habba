/**
 * A stored photo, by reference.
 *
 * Completion photos are `storage://` references in a private bucket (0064), so
 * an <Image> cannot load them directly — they are signed on demand, for
 * whoever the bucket's read policy lets see them. Until then, or if this user
 * may not, the frame stays an empty tile: the raw reference is never shown,
 * because it means nothing to a person.
 */

import { Image, View, type StyleProp, type ViewStyle } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '@habba/ui';
import { repository } from '@/features/shared/data/repository';

export interface EvidencePhotoProps {
  readonly reference: string;
  readonly size: number;
  readonly accessibilityLabel: string;
  readonly style?: StyleProp<ViewStyle>;
}

export function EvidencePhoto({ reference, size, accessibilityLabel, style }: EvidencePhotoProps) {
  const theme = useTheme();

  const resolved = useQuery({
    queryKey: ['media-url', reference],
    queryFn: () => repository.resolveMediaUrl(reference),
    // Signed for an hour; refetch well before it lapses on a screen left open.
    staleTime: 45 * 60 * 1000,
  });

  const frame = {
    width: size,
    height: size,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSunken,
    overflow: 'hidden' as const,
  };

  return (
    <View style={[frame, style]} accessibilityLabel={accessibilityLabel}>
      {typeof resolved.data === 'string' ? (
        <Image
          source={{ uri: resolved.data }}
          accessibilityLabel={accessibilityLabel}
          style={{ width: size, height: size }}
        />
      ) : null}
    </View>
  );
}
