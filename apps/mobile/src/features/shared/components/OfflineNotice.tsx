/**
 * A standing notice while the device has no connection.
 *
 * Until now, being offline was indistinguishable from the server being down or
 * the request being slow: every failure produced the same "check your
 * connection and try again", including when the customer's own connection was
 * the thing that had gone. That is a retry loop nobody can win — §2.7's
 * basement car park, where the answer is to wait rather than to keep tapping.
 *
 * Deliberately a banner rather than a blocking screen. The logbook, the saved
 * vehicles and the last known order state are all in the query cache and stay
 * readable offline; hiding them behind a modal would take away the only part
 * of the app that still works.
 *
 * Not red either (§8). Losing signal is normal in a car park, not an emergency.
 */

import { View } from 'react-native';
import { useNetworkState } from 'expo-network';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, Row, Text, useTheme } from '@habba/ui';

export function OfflineNotice({ testID }: { readonly testID?: string | undefined }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const network = useNetworkState();
  const insets = useSafeAreaInsets();

  // `isInternetReachable` is the honest one: a phone can be joined to a Wi-Fi
  // network that has no route out, which is exactly the airport-and-hotel case
  // where `isConnected` alone says everything is fine.
  //
  // Both start undefined before the first probe resolves. Treating unknown as
  // offline would flash this banner on every cold start.
  const offline = network.isInternetReachable === false || network.isConnected === false;
  if (!offline) return null;

  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        // Its own inset: it sits above the navigator, so it is the thing
        // drawing under the status bar while it is on screen.
        paddingTop: insets.top + theme.spacing.sm,
        paddingBottom: theme.spacing.sm,
        paddingHorizontal: theme.spacing.base,
        backgroundColor: theme.colors.warningSubtle,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.warningBorder,
      }}
    >
      <Row gap="sm" align="flex-start">
        <Icon name="alert" size={theme.iconSize.sm} color={theme.colors.warningFg} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="caption" tone="warning" style={{ fontWeight: theme.fontWeight.semibold }}>
            {t('errors.offlineTitle')}
          </Text>
          <Text variant="caption" tone="muted">
            {t('errors.offlineBody')}
          </Text>
        </View>
      </Row>
    </View>
  );
}
