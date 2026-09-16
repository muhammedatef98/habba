/**
 * فيديو الفرز — the twenty seconds the customer recorded.
 *
 * §1's third differentiator, and until 0071 it was a badge with nothing behind
 * it: `OpenJobCard` said "there is a video" on offers whose clip the storage
 * policy would not serve, because it authorised on `orders.provider_id` — null
 * until acceptance, which is after the decision the clip exists to inform.
 *
 * The point is what the technician learns BEFORE driving out. A rattle that
 * turns out to be a heat shield is a ten-minute job; the same rattle from a
 * failing bearing means bringing a different van. Guessing wrong is the false
 * dispatch that is the main cost in this business.
 *
 * ⚠️ Audio matters as much as the picture and is NOT muted. A lot of faults are
 * identified by sound, which is why the customer's recorder captures it
 * (`triage.tsx`). A player that started silent would quietly discard half of
 * what was recorded.
 */

import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useTranslation } from 'react-i18next';
import { Button, Card, Icon, Text, rowDirectionFor, useTheme } from '@habba/ui';
import {
  providerRepository,
  type TriageClip as Clip,
} from '@/features/provider/data/provider-repository';

export function TriageClip({ orderId }: { readonly orderId: string }) {
  const { t } = useTranslation();
  const theme = useTheme();

  const [clip, setClip] = useState<Clip | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');

  // Fetched on demand rather than on mount. A signed URL is a bearer capability
  // for private video of a stranger's car, and minting one for every job in a
  // list — most of which the technician will never open — hands out links
  // nobody asked for.
  const load = async () => {
    setState('loading');
    const result = await providerRepository.getTriageClip(orderId);
    if (result === null) {
      setState('unavailable');
      return;
    }
    setClip(result);
    setState('ready');
  };

  const player = useVideoPlayer(clip?.url ?? null, (instance) => {
    instance.loop = false;
    // Twenty seconds of a fault is the sort of thing you watch twice, and
    // hunting for a scrubber while holding a torch is not the moment for it.
    instance.timeUpdateEventInterval = 1;
  });

  // The URL expires (see TRIAGE_CLIP_URL_SECONDS). Dropping it when the
  // component goes away means a stale link is not sitting in memory behind a
  // screen the technician has left.
  useEffect(() => {
    return () => setClip(null);
  }, [orderId]);

  if (state === 'idle') {
    return (
      <Card
        elevation="none"
        style={{ backgroundColor: theme.colors.surfaceSunken, gap: theme.spacing.sm }}
      >
        <View
          style={{
            flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
            alignItems: 'center',
            gap: theme.spacing.sm,
          }}
        >
          <Icon name="mic" size={theme.iconSize.md} color={theme.colors.accent} />
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            {t('triage.title')}
          </Text>
        </View>
        <Text variant="caption" tone="muted">
          {t('triage.why')}
        </Text>
        <Button
          testID="play-triage"
          label={t('triage.watch')}
          variant="accent"
          onPress={() => void load()}
        />
      </Card>
    );
  }

  if (state === 'loading') {
    return (
      <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
        <Text variant="caption" tone="muted">
          {t('common.loading')}
        </Text>
      </Card>
    );
  }

  if (state === 'unavailable') {
    return (
      <Card
        elevation="none"
        style={{ backgroundColor: theme.colors.surfaceSunken, gap: theme.spacing.sm }}
      >
        {/* One message for every reason there is nothing to play — no clip, an
            expired offer, a declined one. The technician can act on none of
            them differently, and naming which would say more about the
            customer's order than they are entitled to know. */}
        <Text variant="caption" tone="muted">
          {t('triage.unavailable')}
        </Text>
        <Button
          testID="retry-triage"
          label={t('common.retry')}
          variant="ghost"
          size="medium"
          onPress={() => void load()}
        />
      </Card>
    );
  }

  return (
    <Card style={{ gap: theme.spacing.sm }}>
      <Text variant="bodyStrong">{t('triage.title')}</Text>
      <View
        style={{
          height: 220,
          borderRadius: theme.radius.lg,
          overflow: 'hidden',
          backgroundColor: theme.colors.surfaceSunken,
        }}
      >
        <VideoView
          testID="triage-video"
          player={player}
          style={{ flex: 1 }}
          nativeControls
          allowsFullscreen
        />
      </View>
      <Text variant="caption" tone="subtle">
        {t('triage.privacy')}
      </Text>
    </Card>
  );
}
