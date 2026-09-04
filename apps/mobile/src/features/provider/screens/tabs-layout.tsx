/**
 * The provider app's two tabs.
 *
 * Navigation was a ghost "طلباتي" button at the bottom of the shift screen and
 * a "رجوع" at the bottom of the jobs list — a two-screen app pretending to be
 * a stack. A technician switches between "what can I take" and "what am I on"
 * constantly, often with one hand and a torch in the other, and a tab bar is
 * the difference between one thumb-reach and a scroll to the end of a list.
 *
 * A route group, so `/shift` and `/my-jobs` keep their URLs and every existing
 * `router.push` still resolves.
 */

import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Icon, useTheme } from '@habba/ui';

export default function ProviderTabsLayout() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textSubtle,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
        },
        tabBarLabelStyle: {
          fontFamily: theme.fontFamily.arabic,
          fontSize: theme.fontSize.xs,
        },
      }}
    >
      <Tabs.Screen
        name="shift"
        options={{
          title: t('provider.navShift'),
          tabBarIcon: ({ color }) => <Icon name="locate" color={color} />,
        }}
      />
      <Tabs.Screen
        name="my-jobs"
        options={{
          title: t('provider.navJobs'),
          tabBarIcon: ({ color }) => <Icon name="wrench" color={color} />,
        }}
      />
    </Tabs>
  );
}
