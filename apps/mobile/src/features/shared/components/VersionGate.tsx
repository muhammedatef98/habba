/**
 * Holds the whole app behind «حدّث التطبيق» when this build is older than the
 * floor operators set (min_app_version, 0081). The floor existed before and
 * nothing read it, so a build with a known problem stayed in use until each
 * person happened to update.
 *
 * Only a definite answer blocks: until the setting is read, or if it cannot
 * be, the app opens as usual (lib/app-version.ts).
 */

import type { ReactNode } from 'react';
import { Linking, Platform, View } from 'react-native';
import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';
import { Button, HabbaMark, Screen, Text, useTheme } from '@habba/ui';
import { usePlatformStatus } from '@/features/shared/hooks/use-platform';
import { isBelowMinimumVersion } from '@/features/shared/lib/app-version';
import { openableLink } from '@/features/shared/lib/links';

export function VersionGate({ children }: { readonly children: ReactNode }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const status = usePlatformStatus();
  const current = Constants.expoConfig?.version ?? '';

  if (!isBelowMinimumVersion(current, status.minAppVersion)) return <>{children}</>;

  // Only an https link is handed to the OS (lib/links.ts).
  const storeUrl = openableLink(Platform.OS === 'ios' ? status.appStoreUrl : status.playStoreUrl);

  return (
    <Screen>
      <View
        testID="update-required"
        style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: theme.spacing.lg }}
      >
        <HabbaMark size={72} />
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="title" align="center">
            {t('update.title')}
          </Text>
          <Text variant="body" tone="muted" align="center">
            {t('update.body')}
          </Text>
          <Text variant="caption" tone="subtle" align="center" numeric>
            {current}
          </Text>
        </View>
        {storeUrl !== null ? (
          <Button
            testID="update-open-store"
            label={t('update.action')}
            onPress={() => void Linking.openURL(storeUrl)}
          />
        ) : null}
      </View>
    </Screen>
  );
}
