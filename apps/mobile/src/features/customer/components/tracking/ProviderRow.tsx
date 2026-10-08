/**
 * Provider identity strip — avatar, name, rating, and the contact actions.
 *
 * Appears on every screen from "matched" onward so the person coming to the
 * roadside stays named and reachable throughout, rather than being introduced
 * once and then reduced to a dot on a map.
 *
 * Chat is the order's own thread (0101): it opens at acceptance and closes
 * at hand-back, and neither side ever sees the other's number.
 *
 * ⚠️ Call appears only when a number is supplied, and that is deliberate. It
 * previously dialled a hardcoded `+966500000000`, which is nobody — a
 * customer standing next to a broken-down car would have believed they had
 * reached their technician. The number has to come from the server, and
 * should be a masked relay rather than the technician's own line;
 * `ProviderSummary` carries no phone field yet, so today it is absent.
 */

import { Linking, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button, Text, rowDirectionFor, useTheme } from '@habba/ui';
import type { ProviderSummary } from '@/features/shared/data/types';

export interface ProviderRowProps {
  readonly provider: ProviderSummary;
  readonly showActions?: boolean;
  readonly detail?: string | undefined;
  /**
   * Masked relay number for this job. Absent until the backend issues one, in
   * which case the actions render disabled rather than dialling something
   * that is not the technician.
   */
  readonly contactNumber?: string | undefined;
  /** The order whose thread the chat button opens; absent while it is closed. */
  readonly chatOrderId?: string | undefined;
  readonly testID?: string;
}

export function ProviderRow({
  provider,
  showActions = true,
  detail,
  contactNumber,
  chatOrderId,
  testID,
}: ProviderRowProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const initial = provider.businessNameAr.trim().charAt(0);

  return (
    <View testID={testID} style={{ gap: theme.spacing.base }}>
      <View
        style={{
          flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
          alignItems: 'center',
          gap: theme.spacing.base,
        }}
      >
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
          <View
            style={{
              flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
              alignItems: 'center',
              gap: theme.spacing.sm,
            }}
          >
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

      {showActions && (contactNumber !== undefined || chatOrderId !== undefined) ? (
        <View
          style={{
            flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
            gap: theme.spacing.sm,
          }}
        >
          {chatOrderId !== undefined ? (
            <View style={{ flex: 1 }}>
              <Button
                testID="tracking-chat"
                label={t('tracking.chatAction')}
                size="medium"
                onPress={() =>
                  router.push({ pathname: '/chat', params: { id: chatOrderId, side: 'customer' } })
                }
              />
            </View>
          ) : null}
          {contactNumber !== undefined ? (
            <View style={{ flex: 1 }}>
              <Button
                testID="tracking-call"
                label={t('tracking.callAction')}
                variant="secondary"
                size="medium"
                onPress={() => void Linking.openURL(`tel:${contactNumber}`)}
              />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
