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
import { Icon, readingOrder, useTheme } from '@habba/ui';
import type { IconName } from '@habba/ui';

/**
 * Reading order: الرئيسية first, حسابي last. In Arabic "first" is the right
 * edge, so this list is handed to the navigator in whichever order puts it
 * there — see the note on `readingOrder` below.
 */
const TABS: ReadonlyArray<{
  name: 'vehicles' | 'orders' | 'account';
  titleKey: 'nav.home' | 'nav.orders' | 'nav.account';
  icon: IconName;
}> = [
  { name: 'vehicles', titleKey: 'nav.home', icon: 'home' },
  { name: 'orders', titleKey: 'nav.orders', icon: 'calendar' },
  { name: 'account', titleKey: 'nav.account', icon: 'person' },
];

export default function TabsLayout() {
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
        // The label is not decoration: an icon-only bar in a bilingual app
        // makes people guess, and guessing during an emergency is the thing
        // this product exists to remove.
        tabBarLabelStyle: {
          fontFamily: theme.fontFamily.arabic,
          fontSize: theme.fontSize.xs,
        },
      }}
    >
      {/* The tab bar's own `flexDirection` is the navigator's, not ours, so the
          only thing left to control is the order — and it has to carry the
          direction on the first Arabic launch, when Yoga is still laying out
          left-to-right and the bar would otherwise start with الرئيسية on the
          left. */}
      {readingOrder(TABS, theme.direction, theme.nativeDirection).map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(tab.titleKey),
            tabBarIcon: ({ color }) => <Icon name={tab.icon} color={color} />,
          }}
        />
      ))}
    </Tabs>
  );
}
