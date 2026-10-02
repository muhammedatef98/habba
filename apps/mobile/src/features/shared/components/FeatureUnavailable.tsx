/**
 * What a switched-off part of the app shows (0081) — reached from a stale
 * screen, an old notification, or a link, since the ways in are hidden.
 *
 * Says it is paused rather than gone, and offers support when there is any:
 * someone opening the emergency flow while it is off may be stranded, and the
 * one useful thing left is a person to call.
 */

import { Linking, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button, Icon, Screen, Text, useTheme } from '@habba/ui';
import { usePlatformStatus } from '@/features/shared/hooks/use-platform';

export function FeatureUnavailable({ testID }: { readonly testID?: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { supportPhone } = usePlatformStatus();

  return (
    <Screen>
      <View
        testID={testID ?? 'feature-unavailable'}
        style={{ flex: 1, justifyContent: 'center', gap: theme.spacing.lg }}
      >
        <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: theme.radius.full,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.colors.surfaceSunken,
            }}
          >
            <Icon name="alert" size={28} color={theme.colors.textSubtle} />
          </View>
          <Text variant="heading" align="center">
            {t('features.unavailableTitle')}
          </Text>
          <Text variant="bodySmall" tone="muted" align="center">
            {t('features.unavailableBody')}
          </Text>
        </View>
        <View style={{ gap: theme.spacing.sm }}>
          {supportPhone !== '' ? (
            <Button
              label={t('settings.supportCall')}
              onPress={() => void Linking.openURL(`tel:${supportPhone}`)}
            />
          ) : null}
          <Button
            label={t('common.back')}
            variant="ghost"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          />
        </View>
      </View>
    </Screen>
  );
}
