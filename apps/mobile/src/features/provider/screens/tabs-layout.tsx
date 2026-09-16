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
import { useCanManageSchedule } from '@/features/shared/hooks/use-roles';

export default function ProviderTabsLayout() {
  const { t } = useTranslation();
  const theme = useTheme();
  // A calendar of appointment bays means nothing to a mobile technician, and a
  // tab that opens on an empty screen is worse than no tab. `href: null`
  // removes the route rather than hiding a button that still resolves.
  const canManageSchedule = useCanManageSchedule();

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
      {/* Third, not second. The order is what a technician reaches for through
          a shift: what can I take, what am I on, what have I made. Earnings is
          the one they open at the end of the day rather than mid-job, and it is
          the only tab that was missing while `payouts` sat unread since 0031. */}
      <Tabs.Screen
        name="earnings"
        options={{
          title: t('provider.navEarnings'),
          tabBarIcon: ({ color }) => <Icon name="wallet" color={color} />,
        }}
      />
      {/* Fourth and workshop-only. It sits after earnings because publishing a
          month of availability is a weekly job, not one done between cars —
          and because a technician never sees it at all, the order a technician
          reads is left undisturbed. */}
      <Tabs.Screen
        name="schedule"
        options={{
          title: t('provider.navSchedule'),
          // Spread rather than `href: undefined`: under
          // `exactOptionalPropertyTypes` an explicit undefined is not the same
          // as an absent key, and `href` takes a route or null, never both.
          ...(canManageSchedule ? {} : { href: null }),
          tabBarIcon: ({ color }) => <Icon name="calendar" color={color} />,
        }}
      />
    </Tabs>
  );
}
