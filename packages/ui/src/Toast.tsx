/**
 * The app's answer to "did that work?".
 *
 * There was not one. Recording a service dismissed the screen; recording
 * mileage cleared the field; sharing a تقرير هبّة set a boolean nobody rendered
 * as anything the eye catches. In each case the server had committed something
 * permanent to the logbook — the one artefact this product exists to build —
 * and the interface said nothing at all. Silence after a write is indis-
 * tinguishable from a write that never happened, which is how someone ends up
 * recording the same oil change three times.
 *
 * A toast rather than a dialog, because none of these need a decision: they
 * need an acknowledgement that does not cost a tap to dismiss. `Alert.alert`
 * would be worse than silence here — it takes the screen hostage to say "yes".
 *
 * ---
 *
 * PLACEMENT. Bottom, clear of the tab bar rather than over it. A snackbar
 * covering the navigation for three seconds is the standard behaviour and the
 * standard complaint; the container is `box-none` so anything it does overlap
 * stays tappable through it.
 *
 * MOTION. It rises and fades — §8's "eased and directional", the same grammar
 * as the sheet. Under Reduce Motion it simply appears (reduced-motion.ts): the
 * confirmation is the point, the travel is not.
 *
 * READING IT OUT. The toast is the *only* notice of the thing that happened, so
 * a screen reader has to get it too. It announces once per message, through a
 * live region and an explicit announcement, rather than waiting to be reached
 * by focus — by then it is gone.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './Icon.js';
import { Row } from './Row.js';
import { Text } from './Text.js';
import { haptic } from './haptics.js';
import { useReducedMotion } from './reduced-motion.js';
import { useTheme } from './theme.js';
import {
  advanceToastQueue,
  emptyToastQueue,
  enqueueToast,
  TOAST_DURATION_MS,
  TOAST_WITH_ACTION_DURATION_MS,
  type ToastItem,
  type ToastQueueState,
  type ToastTone,
} from './toast-queue.js';
import type { IconName } from './icon-names.js';

export interface ShowToastOptions {
  readonly message: string;
  /** Defaults to `success` — the overwhelming majority of call sites. */
  readonly tone?: ToastTone | undefined;
  /** One action at most. Two is a dialog wearing a toast's clothes. */
  readonly actionLabel?: string | undefined;
  readonly onAction?: (() => void) | undefined;
  /** Override the tone's dwell time. Rarely the right call. */
  readonly durationMs?: number | undefined;
}

export interface ToastApi {
  readonly show: (options: ShowToastOptions) => void;
  readonly dismiss: () => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Sits above the tab bar rather than on it.
 *
 * The bar is roughly 56dp plus its own bottom inset, and `Screen` already
 * reserves the home indicator separately — this clears both without having to
 * know which kind of screen is underneath.
 */
const TAB_BAR_CLEARANCE = 68;

const TONE_ICON: Readonly<Record<ToastTone, IconName>> = {
  success: 'check',
  error: 'alert',
  info: 'info',
};

/**
 * Tone → haptic. The reason the two live together: a confirmation that is felt
 * and a failure that is felt must not be the same tap, and pairing them at the
 * point the toast is shown is the only way they cannot drift apart.
 */
const TONE_HAPTIC = { success: 'success', error: 'error', info: 'light' } as const;

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [queue, setQueue] = useState<ToastQueueState>(emptyToastQueue);
  // Held in a ref rather than in the item: a function in state would make every
  // queue comparison reference-unstable, and the action belongs to the toast
  // on screen, never to one still waiting.
  const actions = useRef(new Map<string, () => void>());

  const show = useCallback((options: ShowToastOptions) => {
    const tone = options.tone ?? 'success';
    const hasAction = options.actionLabel !== undefined && options.onAction !== undefined;

    const item: ToastItem = {
      // `Date.now()` alone collides when two mutations settle in the same
      // millisecond, which is exactly the burst this queue exists for.
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      message: options.message,
      tone,
      actionLabel: options.actionLabel,
      durationMs:
        options.durationMs ?? (hasAction ? TOAST_WITH_ACTION_DURATION_MS : TOAST_DURATION_MS[tone]),
    };

    if (options.onAction !== undefined) actions.current.set(item.id, options.onAction);

    setQueue((previous) => enqueueToast(previous, item));
  }, []);

  const dismiss = useCallback(() => {
    setQueue((previous) => {
      if (previous.current !== null) actions.current.delete(previous.current.id);
      return advanceToastQueue(previous);
    });
  }, []);

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  const current = queue.current;

  return (
    <ToastContext.Provider value={api}>
      {children}
      {current === null ? null : (
        <ToastView
          // Keyed by id so a repeat of the same message remounts and restarts
          // its timer — which is what `enqueueToast` promises by handing back a
          // new id for an identical message.
          key={current.id}
          item={current}
          onDismiss={dismiss}
          {...(actions.current.has(current.id)
            ? { onAction: actions.current.get(current.id) }
            : {})}
        />
      )}
    </ToastContext.Provider>
  );
}

/**
 * Non-throwing on purpose, unlike `useTheme`.
 *
 * A missing `ToastProvider` should cost a confirmation, not the screen. This is
 * feedback about something that already succeeded; a crash here would turn the
 * absence of a nicety into the loss of the work it was confirming.
 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  return api ?? NO_TOAST;
}

const NO_TOAST: ToastApi = {
  show: () => undefined,
  dismiss: () => undefined,
};

function ToastView({
  item,
  onDismiss,
  onAction,
}: {
  readonly item: ToastItem;
  readonly onDismiss: () => void;
  readonly onAction?: (() => void) | undefined;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;

  const tone = item.tone;

  // Announce once, on arrival. `accessibilityLiveRegion` alone covers Android;
  // iOS needs to be told, and the toast is gone before focus would reach it.
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(item.message);
    haptic(TONE_HAPTIC[tone]);
  }, [item.message, tone]);

  useEffect(() => {
    if (reducedMotion) {
      progress.setValue(1);
      return;
    }

    Animated.timing(progress, {
      toValue: 1,
      duration: theme.duration.normal,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, reducedMotion, theme.duration.normal]);

  // Auto-dismiss. Deliberately not paused on press — a toast the customer is
  // touching is one they are about to act on, and the action dismisses it
  // anyway.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (reducedMotion) {
        onDismiss();
        return;
      }

      Animated.timing(progress, {
        toValue: 0,
        duration: theme.duration.fast,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        // Only on a clean finish: an interrupted exit means this component is
        // already being torn down, and advancing the queue from under it would
        // drop the toast that replaced it.
        if (finished) onDismiss();
      });
    }, item.durationMs);

    return () => clearTimeout(timer);
  }, [item.durationMs, onDismiss, progress, reducedMotion, theme.duration.fast]);

  const surface: Record<ToastTone, { background: string; border: string; foreground: string }> = {
    success: {
      background: theme.colors.successSubtle,
      border: theme.colors.successBorder,
      foreground: theme.colors.successFg,
    },
    error: {
      background: theme.colors.emergencySubtle,
      border: theme.colors.emergencyBorder,
      foreground: theme.colors.emergencyFg,
    },
    info: {
      background: theme.colors.surfaceRaised,
      border: theme.colors.borderStrong,
      foreground: theme.colors.textMuted,
    },
  };

  const skin = surface[tone];

  return (
    <View
      // `box-none` so the container itself never eats a tap — only the card
      // inside it is interactive, and whatever it overlaps stays reachable.
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: Math.max(insets.bottom, theme.spacing.md) + TAB_BAR_CLEARANCE,
        paddingHorizontal: theme.spacing.base,
        zIndex: theme.zIndex.toast,
        // Android draws by elevation, not by zIndex, so a high zIndex alone
        // leaves the toast behind the tab bar there.
        ...(Platform.OS === 'android' ? { elevation: theme.zIndex.toast } : {}),
      }}
    >
      <Animated.View
        accessibilityLiveRegion="polite"
        style={{
          opacity: progress,
          transform: [
            {
              // Rises a short distance. A long travel reads as an arrival from
              // somewhere else; this is the same object fading into place.
              translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }),
            },
          ],
        }}
      >
        <View
          style={{
            backgroundColor: skin.background,
            borderColor: skin.border,
            borderWidth: 1,
            borderRadius: theme.radius.lg,
            paddingVertical: theme.spacing.md,
            paddingHorizontal: theme.spacing.base,
            shadowColor: '#000',
            ...theme.elevation.md,
          }}
        >
          <Row gap="md" align="center">
            <Icon name={TONE_ICON[tone]} size={theme.iconSize.md} color={skin.foreground} />

            <View style={{ flex: 1 }}>
              <Text variant="bodySmall" style={{ color: theme.colors.text }}>
                {item.message}
              </Text>
            </View>

            {item.actionLabel !== undefined && onAction !== undefined ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.actionLabel}
                onPress={() => {
                  haptic('selection');
                  onAction();
                  onDismiss();
                }}
                // The card is only ~48dp tall; the label inside it is smaller
                // than that, so the target is grown rather than the row.
                hitSlop={theme.spacing.md}
                style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
              >
                <Text variant="label" style={{ color: skin.foreground }}>
                  {item.actionLabel}
                </Text>
              </Pressable>
            ) : null}
          </Row>
        </View>
      </Animated.View>
    </View>
  );
}
