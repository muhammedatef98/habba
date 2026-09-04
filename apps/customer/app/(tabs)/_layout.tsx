/**
 * The app's main tabs.
 *
 * Three, not the design's four. The design shows الرئيسية / طلباتي / المحفظة /
 * حسابي, but nothing in the system holds a balance, a saved card, or a
 * transaction — escrow is per-order and lives on the order. A wallet tab would
 * open onto an empty screen and teach the customer that a quarter of the app
 * does nothing. It goes in when there is something in it.
 *
 * A route group, so the URLs stay `/vehicles`, `/orders`, `/account` and every
 * existing `router.push` keeps working.
 */

import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Icon, useTheme } from '@habba/ui';
import { HabbaTabBar } from '@/components/HabbaTabBar';

export default function TabsLayout() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Tabs
      // Drawn by us so the order follows the locale rather than the platform's
      // RTL flag, which lags it by a restart and never flips at all in Expo Go
      // (src/components/HabbaTabBar.tsx). The screens below stay static —
      // Expo Router registers the routes from that list.
      tabBar={(props) => <HabbaTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textSubtle,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
        },
        // The label is not decoration: an icon-only bar in a bilingual app
        // makes people guess, and guessing during an emergency is the thing
        // this product exists to remove.
        tabBarLabelStyle: {
          fontFamily: theme.fontFamily.arabic,
          fontSize: theme.fontSize.xs,
        },
      }}
    >
      {/* Static children, one per route, and deliberately so. An earlier
          version generated these from an array to control the order in Arabic;
          Expo Router reads this list statically to register the routes, so a
          `.map()` here cost the tab bar entirely. The visual order is the
          platform's job: it reverses the bar under RTL, which `forcesRTL` in
          app.json now guarantees from the first launch of a real build. */}
      <Tabs.Screen
        name="vehicles"
        options={{
          title: t('nav.home'),
          tabBarIcon: ({ color }) => <Icon name="home" color={color} />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: t('nav.orders'),
          tabBarIcon: ({ color }) => <Icon name="calendar" color={color} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: t('nav.account'),
          tabBarIcon: ({ color }) => <Icon name="person" color={color} />,
        }}
      />
    </Tabs>
  );
}
