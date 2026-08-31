/**
 * Provider identity strip — avatar, name, rating, and the contact actions.
 *
 * Appears on every screen from "matched" onward so the person coming to the
 * roadside stays named and reachable throughout, rather than being introduced
 * once and then reduced to a dot on a map.
 */

import { Linking, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Text, useTheme } from '@habba/ui';
import type { ProviderSummary } from '@/data/types';

export interface ProviderRowProps {
  readonly provider: ProviderSummary;
  readonly showActions?: boolean;
  readonly detail?: string | undefined;
  readonly testID?: string;
}

export function ProviderRow({ provider, showActions = true, detail, testID }: ProviderRowProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const initial = provider.businessNameAr.trim().charAt(0);

  return (
    <View testID={testID} style={{ gap: theme.spacing.base }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.base }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: theme.radius.full,
            backgroundColor: theme.colors.primarySubtle,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text variant="heading" tone="primary">
            {initial}
          </Text>
        </View>

        <View style={{ flex: 1, gap: theme.spacing.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <Text variant="bodyStrong">{provider.businessNameAr}</Text>
            <View
              style={{
                borderRadius: theme.radius.sm,
                backgroundColor: theme.colors.verifiedSubtle,
                paddingHorizontal: theme.spacing.sm,
                paddingVertical: 3,
              }}
            >
              <Text variant="caption" tone="primary" style={{ fontSize: theme.fontSize.xs }}>
                {t('common.verified')}
              </Text>
            </View>
          </View>

          <Text variant="caption" tone="muted">
            {t('tracking.ratingLabel', {
              rating: provider.ratingAvg.toFixed(1),
              count: provider.ratingCount,
            })}
          </Text>

          {detail !== undefined ? (
            <Text variant="caption" tone="muted">
              {detail}
            </Text>
          ) : null}
        </View>
      </View>

      {showActions ? (
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button
              testID="tracking-call"
              label={t('tracking.callAction')}
              size="medium"
              onPress={() => void Linking.openURL('tel:+966500000000')}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              testID="tracking-chat"
              label={t('tracking.chatAction')}
              variant="secondary"
              size="medium"
              onPress={() => void Linking.openURL('sms:+966500000000')}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}
