import { afterEach, describe, expect, it, vi } from 'vitest';
import { haptic, setHapticDriver, type HapticSignal } from './haptics.js';

function recorder() {
  const played: HapticSignal[] = [];
  return { played, play: (signal: HapticSignal) => void played.push(signal) };
}

afterEach(() => {
  setHapticDriver(null);
});

describe('haptic', () => {
  it('does nothing when no driver is installed', () => {
    // The default state for a test renderer, a web build, and every process
    // before the root layout has run.
    expect(() => haptic('success')).not.toThrow();
  });

  it('passes the signal through to the installed driver', () => {
    const driver = recorder();
    setHapticDriver(driver);

    haptic('selection');
    haptic('heavy');

    expect(driver.played).toEqual(['selection', 'heavy']);
  });

  it('stops playing once the driver is removed', () => {
    const driver = recorder();
    setHapticDriver(driver);
    haptic('light');
    setHapticDriver(null);
    haptic('light');

    expect(driver.played).toEqual(['light']);
  });

  it('swallows a throwing driver rather than failing the press', () => {
    // Android can revoke the vibration permission under a running app. The
    // button that was pressed must still work.
    setHapticDriver({
      play: () => {
        throw new Error('vibration permission revoked');
      },
    });

    expect(() => haptic('error')).not.toThrow();
  });

  it('does not call the driver more than once per signal', () => {
    const play = vi.fn();
    setHapticDriver({ play });

    haptic('warning');

    expect(play).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledWith('warning');
  });
});
