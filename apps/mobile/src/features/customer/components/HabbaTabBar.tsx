/**
 * The bottom tab bar, drawn by us.
 *
 * The requirement is one sentence: in Arabic الرئيسية sits on the right and
 * حسابي on the left. React Navigation's own bar already does that — but it
 * decides with `I18nManager.isRTL`, which `forceRTL` only changes on the *next*
 * process start. So on a first Arabic launch, and for a session after any
 * language switch, its bar runs the wrong way. In Expo Go that state is the
 * normal one, because a config plugin (`forcesRTL`) never applies there.
 *
 * There was an earlier attempt at this that generated the `<Tabs.Screen>`
 * children from an array to control their order. Expo Router reads that child
 * list statically to register the routes, so it cost the tab bar entirely. The
 * screens are static again; `tabBar` is the supported way to control the
 * rendering, and it is the one this uses.
 *
 * Everything else — which route is focused, the labels, the icons — comes from
 * the navigator. This owns the direction and the styling, nothing more.
 */

import { Pressable, View } from 'react-native';
import type { BottomTabBarProps } from 'expo-router/tabs';
import { Row, Text, useTheme } from '@habba/ui';

export function HabbaTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const theme = useTheme();

  return (
    <View
      testID="tab-bar"
      accessibilityRole="tablist"
      style={{
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        backgroundColor: theme.colors.surface,
        paddingTop: theme.spacing.sm,
        // The home indicator sits under this on modern iPhones; without the
        // inset the last row of taps lands on the system gesture area.
        paddingBottom: Math.max(insets.bottom, theme.spacing.sm),
      }}
    >
      {/* <Row> resolves the direction from the locale *and* the platform, so
          the first tab is on the reading side in both states (direction.ts). */}
      <Row gap="none" align="stretch">
        {state.routes.map((route, index) => {
          // No `?? {}` fallback: an empty object would widen `options` to a
          // type with no `title` or `tabBarIcon` on it, and the labels would
          // silently fall back to route names.
          const options = descriptors[route.key]?.options;
          const isFocused = state.index === index;
          const color = isFocused ? theme.colors.primary : theme.colors.textSubtle;
          const label =
            typeof options?.title === 'string' && options.title.length > 0
              ? options.title
              : route.name;

          const onPress = () => {
            // The navigator's own event, so `unmountOnBlur`, scroll-to-top and
            // anything else listening still behave as they would with the
            // default bar. Skipping it would make this look right and act
            // subtly differently.
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });

            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          return (
            <Pressable
              key={route.key}
              testID={`tab-${route.name}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: isFocused }}
              accessibilityLabel={label}
              onPress={onPress}
              onLongPress={() => {
                navigation.emit({ type: 'tabLongPress', target: route.key });
              }}
              style={{
                flex: 1,
                minHeight: theme.minTouchTarget,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                paddingVertical: theme.spacing.xs,
              }}
            >
              {options?.tabBarIcon?.({ focused: isFocused, color, size: theme.iconSize.md })}
              <Text variant="caption" align="center" style={{ color }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </Row>
    </View>
  );
}
