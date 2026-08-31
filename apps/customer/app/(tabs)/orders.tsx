/**
 * Order history.
 *
 * The home screen shows the most recent order because its job is the next
 * action; the full list belongs here. Tapping one goes to tracking, which
 * renders the right state for it whether the job is live or long finished.
 */

import { View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Screen, Text, useTheme } from '@habba/ui';
import { repository } from '@/data/repository';
import { useIsAuthenticated } from '@/state/session';
import { RecentOrderRow } from '@/components/home/RecentOrderRow';

export default function OrdersScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const isAuthenticated = useIsAuthenticated();

  const orders = useQuery({
    queryKey: ['orders', 'all'],
    queryFn: () => repository.listRecentOrders(50),
  });

  if (!isAuthenticated) return <Redirect href="/" />;

  const rows = orders.data ?? [];

  return (
    <Screen scrollable>
      <Text variant="title">{t('home.recentTitle')}</Text>

      {orders.isLoading ? (
        <Text variant="body" tone="muted">
          {t('common.loading')}
        </Text>
      ) : rows.length === 0 ? (
        <View style={{ paddingTop: theme.spacing.lg }}>
          <Text variant="body" tone="muted">
            {t('home.noRecent')}
          </Text>
        </View>
      ) : (
        rows.map((order) => (
          <RecentOrderRow
            key={order.id}
            order={order}
            onPress={() => router.push({ pathname: '/tracking', params: { id: order.id } })}
          />
        ))
      )}
    </Screen>
  );
}
