/**
 * Provider identity strip — avatar, name, rating, and the contact actions.
 *
 * Appears on every screen from "matched" onward so the person coming to the
 * roadside stays named and reachable throughout, rather than being introduced
 * once and then reduced to a dot on a map.
 *
 * ⚠️ Call and chat are inert until a number is supplied, and that is
 * deliberate. They previously dialled a hardcoded `+966500000000`, which is
 * nobody — a customer standing next to a broken-down car would have believed
 * they had reached their technician. A button that does nothing is bad; a
 * button that confidently calls the wrong number during an emergency is worse.
 *
 * The number has to come from the server, and should be a masked relay rather
 * than the technician's own line — handing out a personal mobile is a privacy
 * decision nobody has made, and it survives long after the job ends.
 * `ProviderSummary` carries no phone field yet, so today these render disabled.
 */

import { Linking, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Text, useTheme } from '@habba/ui';
import type { ProviderSummary } from '@/data/types';

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
  readonly testID?: string;
}

export function ProviderRow({
  provider,
  showActions = true,
  detail,
  contactNumber,
  testID,
}: ProviderRowProps) {
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
        <View style={{ gap: theme.spacing.sm }}>
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button
                testID="tracking-call"
                label={t('tracking.callAction')}
                size="medium"
                disabled={contactNumber === undefined}
                onPress={() => {
                  if (contactNumber === undefined) return;
                  void Linking.openURL(`tel:${contactNumber}`);
                }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                testID="tracking-chat"
                label={t('tracking.chatAction')}
                variant="secondary"
                size="medium"
                disabled={contactNumber === undefined}
                onPress={() => {
                  if (contactNumber === undefined) return;
                  void Linking.openURL(`sms:${contactNumber}`);
                }}
              />
            </View>
          </View>

          {contactNumber === undefined ? (
            <Text variant="caption" tone="subtle">
              {t('tracking.contactUnavailable')}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
