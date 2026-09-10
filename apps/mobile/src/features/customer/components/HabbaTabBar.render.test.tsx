/**
 * The tab bar, rendered.
 *
 * These exist because of a specific failure: generating the `<Tabs.Screen>`
 * children from an array removed the tab bar from the app entirely, and the
 * typecheck, the lint and 56 unit tests all stayed green. Nothing in this repo
 * had ever rendered a component, so nothing could have caught it.
 *
 * What they assert is deliberately shallow — that the three tabs exist, that
 * the reading order is right in Arabic, that tapping one navigates. A tab bar
 * that renders three tabs in the right order and responds to a tap is a tab
 * bar; the rest is styling, and styling is not what broke.
 */

import { fireEvent, render } from '@testing-library/react-native';
import { I18nManager, Text as RNText } from 'react-native';
import { ThemeProvider } from '@habba/ui';
import { HabbaTabBar } from './HabbaTabBar';

type TabBarProps = Parameters<typeof HabbaTabBar>[0];

/**
 * The shape React Navigation hands a custom `tabBar`, cut down to what this
 * component reads. Built by hand rather than by mounting a real navigator:
 * the navigator would drag in the whole router and test itself rather than us.
 */
function navigatorProps(focusedIndex = 0) {
  const routes = [
    { key: 'vehicles-1', name: 'vehicles', params: undefined },
    { key: 'orders-1', name: 'orders', params: undefined },
    { key: 'account-1', name: 'account', params: undefined },
  ];

  const titles: Record<string, string> = {
    'vehicles-1': 'الرئيسية',
    'orders-1': 'طلباتي',
    'account-1': 'حسابي',
  };

  const navigate = jest.fn();
  const emit = jest.fn(() => ({ defaultPrevented: false }));

  return {
    navigate,
    emit,
    props: {
      state: {
        index: focusedIndex,
        routes,
        key: 'tabs',
        routeNames: [],
        type: 'tab',
        stale: false,
      },
      descriptors: Object.fromEntries(
        routes.map((route) => [
          route.key,
          {
            options: {
              title: titles[route.key],
              tabBarIcon: ({ color }: { color: string }) => <RNText>{`icon:${color}`}</RNText>,
            },
          },
        ]),
      ),
      navigation: { emit, navigate },
      insets: { top: 0, bottom: 34, left: 0, right: 0 },
      // The navigator's props are far wider than what this component reads;
      // the cast says "this is the subset under test", which is the honest
      // description of a hand-built fixture.
    } as unknown as TabBarProps,
  };
}

/**
 * `render` is asynchronous in @testing-library/react-native 14 — React 19
 * renders concurrently, and the result resolves once the tree has committed.
 * Awaiting it is not optional: the un-awaited value is a Promise, and every
 * query on it is `undefined`.
 */
async function renderBar(locale: 'ar' | 'en', focusedIndex = 0) {
  const { props, navigate, emit } = navigatorProps(focusedIndex);

  const view = await render(
    <ThemeProvider locale={locale}>
      <HabbaTabBar {...props} />
    </ThemeProvider>,
  );

  // Returned whole rather than spread: the queries are not own enumerable
  // properties on the render result, so spreading silently drops them.
  return { view, navigate, emit };
}

/** The resolved `flexDirection` of the row the tabs sit in. */
function rowDirectionOf(view: Awaited<ReturnType<typeof renderBar>>['view']): string {
  const [row] = view.getByTestId('tab-bar').children;
  if (row === undefined || typeof row === 'string') throw new Error('the tab bar rendered no row');

  const style = row.props.style as { flexDirection: string };
  return style.flexDirection;
}

describe('the tab bar', () => {
  test('renders all three tabs', async () => {
    // The regression, stated plainly: this is what disappeared.
    const { view } = await renderBar('ar');

    expect(view.getByTestId('tab-vehicles')).toBeTruthy();
    expect(view.getByTestId('tab-orders')).toBeTruthy();
    expect(view.getByTestId('tab-account')).toBeTruthy();
  });

  test('labels come from the navigator, not from the component', async () => {
    const { view } = await renderBar('ar');

    expect(view.getByText('الرئيسية')).toBeTruthy();
    expect(view.getByText('حسابي')).toBeTruthy();
  });

  test('in Arabic the row runs right-to-left', async () => {
    // The requirement in the user's words: الرئيسية on the right, حسابي on the
    // left. Which physical direction achieves that depends on whether the
    // platform's RTL flag has caught up with the locale, so the assertion is
    // on the resolved `flexDirection` — the thing that decides it.
    const { view } = await renderBar('ar');

    expect(rowDirectionOf(view)).toBe(I18nManager.isRTL ? 'row' : 'row-reverse');
  });

  test('in English the row runs left-to-right', async () => {
    const { view } = await renderBar('en');

    expect(rowDirectionOf(view)).toBe(I18nManager.isRTL ? 'row-reverse' : 'row');
  });

  test('tapping a tab navigates to it', async () => {
    const { view, navigate } = await renderBar('ar');

    fireEvent.press(view.getByTestId('tab-orders'));

    expect(navigate).toHaveBeenCalledWith('orders', undefined);
  });

  test('tapping the focused tab does not navigate again', async () => {
    // People press the tab they are already on to confirm where they are.
    const { view, navigate } = await renderBar('ar', 1);

    fireEvent.press(view.getByTestId('tab-orders'));

    expect(navigate).not.toHaveBeenCalled();
  });

  test('a press emits tabPress, so listeners still fire', async () => {
    // A custom bar that navigates directly would look identical and quietly
    // break scroll-to-top and anything else listening for the event.
    const { view, emit } = await renderBar('ar');

    fireEvent.press(view.getByTestId('tab-orders'));

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tabPress', target: 'orders-1' }),
    );
  });

  test('the focused tab is announced as selected', async () => {
    const { view } = await renderBar('ar', 2);

    expect(view.getByTestId('tab-account').props.accessibilityState.selected).toBe(true);
    expect(view.getByTestId('tab-vehicles').props.accessibilityState.selected).toBe(false);
  });
});
