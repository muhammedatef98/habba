/**
 * Vehicle list — the home screen.
 *
 * Phase 1 stops here: the emergency and booking actions of §9.1 arrive in
 * Phase 3. What matters now is that the logbook is reachable in one tap,
 * because it is the product's soul (§9.1) and Phase 2 builds on it.
 */

import { View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Card, Screen, Text, useTheme } from '@habba/ui';
import { repository } from '@/data/repository';
import { useIsAuthenticated } from '@/state/session';

export default function VehiclesScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const isAuthenticated = useIsAuthenticated();
  const isArabic = i18n.language === 'ar';

  const vehicles = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => repository.listVehicles(),
  });

  const makes = useQuery({ queryKey: ['makes'], queryFn: () => repository.listMakes() });
  const allModels = useQuery({
    queryKey: ['models', 'all'],
    queryFn: async () => {
      const makeList = await repository.listMakes();
      const lists = await Promise.all(makeList.map((make) => repository.listModels(make.id)));
      return lists.flat();
    },
  });

  if (!isAuthenticated) return <Redirect href="/" />;

  const describe = (makeId: string, modelId: string) => {
    const make = makes.data?.find((m) => m.id === makeId);
    const model = allModels.data?.find((m) => m.id === modelId);
    const makeName = isArabic ? make?.nameAr : make?.nameEn;
    const modelName = isArabic ? model?.nameAr : model?.nameEn;
    return [makeName, modelName].filter(Boolean).join(' ');
  };

  return (
    <Screen scrollable>
      <Text variant="title">{t('vehicle.myVehicles')}</Text>

      {vehicles.data?.length === 0 ? (
        <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="heading">{t('logbook.emptyTitle')}</Text>
            <Text variant="body" tone="muted">
              {t('logbook.emptyBody')}
            </Text>
          </View>
        </Card>
      ) : null}

      <View style={{ gap: theme.spacing.md }}>
        {vehicles.data?.map((vehicle) => (
          <Card
            key={vehicle.id}
            testID={`vehicle-${vehicle.id}`}
            onPress={() => router.push({ pathname: '/logbook', params: { id: vehicle.id } })}
            accessibilityLabel={describe(vehicle.makeId, vehicle.modelId)}
          >
            <View style={{ gap: theme.spacing.xs }}>
              <Text variant="heading">
                {vehicle.nickname ?? describe(vehicle.makeId, vehicle.modelId)}
              </Text>
              <Text variant="caption" tone="muted">
                {describe(vehicle.makeId, vehicle.modelId)} · {vehicle.year}
              </Text>
              {vehicle.plateNormalised !== null ? (
                <Text variant="caption" tone="subtle">
                  {vehicle.plateNormalised}
                </Text>
              ) : null}
            </View>
          </Card>
        ))}
      </View>

      <Button
        testID="add-vehicle"
        label={vehicles.data?.length === 0 ? t('vehicle.addTitle') : t('vehicle.addAnother')}
        onPress={() => router.push('/add-vehicle')}
        variant={vehicles.data?.length === 0 ? 'primary' : 'secondary'}
      />
    </Screen>
  );
}
