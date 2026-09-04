/**
 * Profile — the shared surface both modes come back to (§9.0).
 *
 * It hosts two things the amendment puts here deliberately:
 *
 *   1. «اشتغل معنا كفنّي», the in-app upgrade to a provider account. It lives
 *      in `shared/` because the people who use it are not providers yet, so it
 *      cannot sit behind the provider route group.
 *   2. The mode switcher — rendered ONLY for a user holding an approved
 *      provider role (§5.1.4). A customer-only user never sees it, and never
 *      sees a disabled version of it either: a greyed-out "provider mode"
 *      button is still provider UI.
 */

import { View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Card, ListRow, Screen, Text, useTheme } from '@habba/ui';
import { repository } from '@/features/shared/data/repository';
import { useIsApprovedProvider, useProviderApplication } from '@/features/shared/hooks/use-roles';
import { useMode } from '@/features/shared/state/mode';
import { useIsAuthenticated, useIsGuest, useSession } from '@/features/shared/state/session';
import type { ProviderApplicationStatus } from '@/features/shared/data/types';

const STATUS_KEY: Record<ProviderApplicationStatus, string> = {
  none: 'provider.upgrade.statusNone',
  pending: 'provider.upgrade.statusPending',
  in_review: 'provider.upgrade.statusInReview',
  approved: 'provider.upgrade.statusApproved',
  rejected: 'provider.upgrade.statusRejected',
  suspended: 'provider.upgrade.statusSuspended',
};

export default function ProfileScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const isAuthenticated = useIsAuthenticated();
  const isGuest = useIsGuest();
  const isProvider = useIsApprovedProvider();
  const application = useProviderApplication();
  const setMode = useMode((state) => state.setMode);
  const signOut = useSession((state) => state.signOut);

  const profile = useQuery({ queryKey: ['profile'], queryFn: () => repository.getProfile() });

  if (!isAuthenticated) return <Redirect href="/" />;

  const status = application.data?.status ?? 'none';
  const hasApplied = status !== 'none' && status !== 'rejected';

  function enterProviderMode() {
    setMode('provider');
    router.replace('/shift');
  }

  return (
    <Screen scrollable>
      <Text variant="title">{t('profile.title')}</Text>

      <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="heading">{profile.data?.fullName ?? t('profile.unnamed')}</Text>
          <Text variant="caption" tone="muted">
            {profile.data?.phone ?? profile.data?.email ?? t('profile.noIdentity')}
          </Text>
        </View>
      </Card>

      {/* The switcher. Gated on the SERVER's answer, not on a local flag. */}
      {isProvider ? (
        <Card testID="mode-switcher">
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="bodyStrong">{t('profile.modeTitle')}</Text>
            <Text variant="caption" tone="muted">
              {t('profile.modeBody')}
            </Text>
            <Button
              testID="switch-to-provider"
              label={t('profile.switchToProvider')}
              onPress={enterProviderMode}
            />
          </View>
        </Card>
      ) : null}

      {/* «اشتغل معنا كفنّي». Hidden once the role is held — there is nothing
          left to apply for — and replaced by status while one is in flight. */}
      {!isProvider ? (
        <Card testID="provider-upgrade">
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="bodyStrong">{t('provider.upgrade.cardTitle')}</Text>
            <Text variant="caption" tone="muted">
              {hasApplied ? t(STATUS_KEY[status]) : t('provider.upgrade.cardBody')}
            </Text>
            {hasApplied ? null : (
              <Button
                testID="become-provider"
                label={t('provider.upgrade.cta')}
                variant="accent"
                onPress={() => router.push('/become-provider')}
              />
            )}
          </View>
        </Card>
      ) : null}

      <View style={{ gap: theme.spacing.xs }}>
        <ListRow
          testID="profile-vehicles"
          title={t('profile.myVehicles')}
          onPress={() => router.push('/vehicles')}
        />
        {isGuest ? (
          <ListRow
            testID="profile-save-account"
            title={t('auth.guestBannerAction')}
            subtitle={t('auth.guestBannerBody')}
            onPress={() => router.push('/save-account')}
          />
        ) : null}
      </View>

      <Button
        testID="sign-out"
        label={t('profile.signOut')}
        variant="secondary"
        onPress={() => {
          signOut();
          router.replace('/');
        }}
      />
    </Screen>
  );
}
