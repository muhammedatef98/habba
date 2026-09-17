/**
 * The toast, rendered.
 *
 * `toast-queue.test.ts` covers the ordering rules as data. This covers the
 * part that data cannot: that `show()` actually puts words on screen, that
 * they leave again on their own, and that a burst of mutations produces one
 * message rather than a stack — which is the whole reason the queue exists and
 * is invisible to a test of the reducer alone.
 *
 * It lives in `apps/mobile` rather than beside the component in `@habba/ui`
 * because this repo has exactly one runner that can render React Native
 * (jest-expo, matching `*.render.test.tsx`) and it is configured here. Vitest,
 * which runs the design system's own tests, cannot parse `react-native` at all
 * — see apps/mobile/jest.config.js.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { AccessibilityInfo, Pressable, Text as RNText } from 'react-native';
import { ThemeProvider, ToastProvider, useToast, type ShowToastOptions } from '@habba/ui';

/**
 * The toast sits above the tab bar by reading `insets.bottom`, so it needs a
 * safe-area value or it does not render at all. Mocking the one hook rather
 * than mounting a `SafeAreaProvider`: the real provider measures a native view
 * that never reports back in a test renderer, so it would supply no value
 * either. A notched phone's insets, so the offset is exercised rather than zero.
 */
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

/**
 * A button per message, so a test can fire them in sequence and in order.
 *
 * `useToast` has to be called from inside the provider, which means a child
 * component — there is no way to reach into the context from the test body.
 */
function Trigger({ label, options }: { label: string; options: ShowToastOptions }) {
  const toast = useToast();
  return (
    <Pressable accessibilityRole="button" onPress={() => toast.show(options)}>
      <RNText>{label}</RNText>
    </Pressable>
  );
}

// Awaited, like the tab-bar render test: this version of RNTL returns a
// thenable and the queries are not on it until it resolves.
async function mount(children: React.ReactNode) {
  return await render(
    <ThemeProvider locale="ar">
      <ToastProvider>{children}</ToastProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  // Reduce Motion on: the exit path then dismisses directly instead of waiting
  // for an Animated callback that fake timers do not drive. It also means these
  // tests exercise the accessibility path rather than only the decorative one.
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('ToastProvider', () => {
  it('shows the message it was given', async () => {
    const view = await mount(<Trigger label="save" options={{ message: 'تم الحفظ' }} />);

    await act(async () => {
      fireEvent.press(view.getByText('save'));
    });

    expect(view.getByText('تم الحفظ')).toBeTruthy();
  });

  it('takes the message away again on its own', async () => {
    const view = await mount(<Trigger label="save" options={{ message: 'تم الحفظ' }} />);

    await act(async () => {
      fireEvent.press(view.getByText('save'));
    });
    expect(view.queryByText('تم الحفظ')).not.toBeNull();

    // Past any tone's dwell time. A toast that needs dismissing is a dialog.
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });

    expect(view.queryByText('تم الحفظ')).toBeNull();
  });

  it('shows one at a time when several arrive at once', async () => {
    // The real burst: a screen that invalidates four queries and settles three
    // mutations inside the same second.
    const view = await mount(
      <>
        <Trigger label="first" options={{ message: 'الأولى' }} />
        <Trigger label="second" options={{ message: 'الثانية' }} />
      </>,
    );

    await act(async () => {
      fireEvent.press(view.getByText('first'));
      fireEvent.press(view.getByText('second'));
    });

    expect(view.queryByText('الأولى')).not.toBeNull();
    expect(view.queryByText('الثانية')).toBeNull();
  });

  it('promotes the queued one once the first has gone', async () => {
    const view = await mount(
      <>
        <Trigger label="first" options={{ message: 'الأولى' }} />
        <Trigger label="second" options={{ message: 'الثانية' }} />
      </>,
    );

    await act(async () => {
      fireEvent.press(view.getByText('first'));
      fireEvent.press(view.getByText('second'));
    });

    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });

    expect(view.queryByText('الأولى')).toBeNull();
    expect(view.queryByText('الثانية')).not.toBeNull();
  });

  it('runs the action and closes when it is pressed', async () => {
    const onAction = jest.fn();
    const view = await mount(
      <Trigger
        label="share"
        options={{ message: 'تم إنشاء التقرير', actionLabel: 'عرض', onAction }}
      />,
    );

    await act(async () => {
      fireEvent.press(view.getByText('share'));
    });

    await act(async () => {
      fireEvent.press(view.getByText('عرض'));
    });

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(view.queryByText('تم إنشاء التقرير')).toBeNull();
  });

  it('announces the message, because the toast is the only notice of it', async () => {
    const view = await mount(<Trigger label="save" options={{ message: 'تم الحفظ' }} />);

    await act(async () => {
      fireEvent.press(view.getByText('save'));
    });

    // It is gone before focus would ever reach it, so a live region alone is
    // not enough on iOS.
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('تم الحفظ');
  });
});

describe('useToast outside a provider', () => {
  it('is a no-op rather than a crash', async () => {
    // A missing provider should cost a confirmation, not the screen — this is
    // feedback about something that has already succeeded.
    const view = await render(
      <ThemeProvider locale="ar">
        <Trigger label="save" options={{ message: 'تم الحفظ' }} />
      </ThemeProvider>,
    );

    await act(async () => {
      expect(() => fireEvent.press(view.getByText('save'))).not.toThrow();
    });
  });
});
