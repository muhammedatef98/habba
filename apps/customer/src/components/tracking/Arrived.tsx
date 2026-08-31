/**
 * Screen 08a — the technician is here.
 *
 * The handover code is the point of this screen: it stops a vehicle being
 * released to the wrong person. It is therefore rendered only when the server
 * supplies one — a code generated on the device would verify nothing, since
 * the device is the party being verified.
 *
 * The digits stay in Latin order inside an RTL screen (the design calls this
 * out explicitly), so the row is direction-locked rather than inheriting the
 * page's writing direction.
 */

import { I18nManager, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card, Text, useTheme } from '@habba/ui';
import { ProviderRow } from './ProviderRow';
import type { JobProgress, Order, ProviderSummary } from '@/data/types';

export interface ArrivedProps {
  readonly order: Order;
  readonly provider: ProviderSummary | null;
  readonly progress: JobProgress | undefined;
}

export function Arrived({ order, provider, progress }: ArrivedProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const code = progress?.handoverCode;
  const providerName = provider?.businessNameAr ?? '';

  return (
    <View style={{ gap: theme.spacing.base, flex: 1 }}>
      <Card
        testID="arrived-banner"
        elevation="none"
        style={{
          backgroundColor: theme.colors.successSubtle,
          borderColor: theme.colors.successBorder,
        }}
      >
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="bodyStrong" tone="success">
            {t('tracking.providerArrived', { name: providerName })}
          </Text>
          <Text variant="caption" tone="success">
            {t('tracking.waitingAtVehicle')}
          </Text>
        </View>
      </Card>

      {code !== undefined ? (
        <Card testID="handover-code" style={{ alignItems: 'center' }}>
          <View style={{ gap: theme.spacing.md, alignItems: 'center' }}>
            <Text variant="caption" tone="muted" align="center">
              {t('tracking.handoverCodePrompt', { name: providerName })}
            </Text>
            <View
              style={{
                flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row',
                gap: theme.spacing.sm,
              }}
            >
              {[...code].map((digit, index) => (
                <View
                  key={`${digit}-${index}`}
                  style={{
                    width: 52,
                    height: 60,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.primarySubtle,
                    borderWidth: 1,
                    borderColor: theme.colors.borderStrong,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text variant="title" tone="primary" numeric>
                    {digit}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </Card>
      ) : null}

      {provider !== null ? <ProviderRow testID="arrived-provider" provider={provider} /> : null}

      <View style={{ flex: 1 }} />

      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="body" tone="muted">
          {t('tracking.agreedTotal')}
        </Text>
        <Text variant="bodyStrong" numeric>
          {t('emergency.priceFixed', { amount: order.totalAmount ?? '—' })}
        </Text>
      </View>
    </View>
  );
}
