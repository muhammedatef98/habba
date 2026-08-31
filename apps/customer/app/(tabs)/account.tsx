/**
 * Account and settings.
 *
 * The `settings` copy has existed in the locale files since Phase 1 with no
 * screen behind it — language, theme and sign out were all written and never
 * rendered.
 *
 * Changing the language restarts the app. That is not laziness: RTL is
 * established before the first render (§2.1) and React Native will not flip
 * layout direction on a live tree, so pretending otherwise would leave the app
 * half mirrored.
 */

import { View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Card, Screen, Text, useTheme } from '@habba/ui';
import type { Locale } from '@habba/i18n';
import { repository } from '@/data/repository';
import { useIsAuthenticated, useSession } from '@/state/session';

type ThemePreference = 'system' | 'light' | 'dark';

export default function AccountScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const isAuthenticated = useIsAuthenticated();

  const locale = useSession((state) => state.locale);
  const setLocale = useSession((state) => state.setLocale);
  const themePreference = useSession((state) => state.themePreference);
  const setThemePreference = useSession((state) => state.setThemePreference);
  const signOut = useSession((state) => state.signOut);
  const isGuest = useSession((state) => state.isGuest);

  const profile = useQuery({ queryKey: ['profile'], queryFn: () => repository.getProfile() });

  if (!isAuthenticated) return <Redirect href="/" />;

  const chip = (label: string, selected: boolean, onPress: () => void, testID: string) => (
    <Card
      key={label}
      testID={testID}
      elevation="none"
      onPress={onPress}
      style={{
        flex: 1,
        alignItems: 'center',
        backgroundColor: selected ? theme.colors.primarySubtle : theme.colors.surfaceSunken,
        borderColor: selected ? theme.colors.primary : theme.colors.border,
        borderWidth: selected ? 1.5 : 1,
      }}
    >
      <Text variant="bodySmall" tone={selected ? 'primary' : 'muted'}>
        {label}
      </Text>
    </Card>
  );

  const locales: readonly { readonly value: Locale; readonly label: string }[] = [
    { value: 'ar', label: t('settings.arabic') },
    { value: 'en', label: t('settings.english') },
  ];

  const themes: readonly { readonly value: ThemePreference; readonly label: string }[] = [
    { value: 'system', label: t('settings.themeSystem') },
    { value: 'light', label: t('settings.themeLight') },
    { value: 'dark', label: t('settings.themeDark') },
  ];

  return (
    <Screen scrollable>
      <Text variant="title">{t('settings.title')}</Text>

      {profile.data !== null && profile.data !== undefined ? (
        <Card>
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="bodyStrong">{profile.data.fullName}</Text>
            {profile.data.phone !== null ? (
              <Text variant="bodySmall" tone="muted" numeric>
                {profile.data.phone}
              </Text>
            ) : null}
            {profile.data.email !== null ? (
              <Text variant="bodySmall" tone="muted">
                {profile.data.email}
              </Text>
            ) : null}
          </View>
        </Card>
      ) : null}

      {isGuest ? (
        <Button
          testID="account-save"
          label={t('auth.guestBannerAction')}
          variant="accent"
          onPress={() => router.push('/save-account')}
        />
      ) : null}

      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="label" tone="muted">
          {t('settings.language')}
        </Text>
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          {locales.map((option) =>
            chip(
              option.label,
              locale === option.value,
              () => setLocale(option.value),
              `locale-${option.value}`,
            ),
          )}
        </View>
        <Text variant="caption" tone="subtle">
          {t('settings.restartRequired')}
        </Text>
      </View>

      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="label" tone="muted">
          {t('settings.theme')}
        </Text>
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          {themes.map((option) =>
            chip(
              option.label,
              themePreference === option.value,
              () => setThemePreference(option.value),
              `theme-${option.value}`,
            ),
          )}
        </View>
      </View>

      <Button
        testID="account-sign-out"
        label={t('settings.signOut')}
        variant="ghost"
        onPress={() => {
          signOut();
          router.replace('/');
        }}
      />
    </Screen>
  );
}
