/**
 * Failed-to-load state.
 *
 * CLAUDE.md §12: an error reaches the customer in Arabic, plainly, with a next
 * action. The failure this exists to prevent is quieter than a crash — a failed
 * fetch falling through to the empty state. "Your logbook starts here" to
 * someone with two years of history in it is not an error message, it is a
 * confident lie, and the next thing they do is re-enter what they already own.
 *
 * §2.7 is why the retry lives in the component rather than in each screen: a
 * customer in a basement car park will hit this often, and the way out has to
 * be one tap in the same place every time.
 *
 * Deliberately not red. §8 reserves the emergency colour for emergencies, and a
 * request that needs retrying is not one — it is the amber "something needs
 * your attention" state, which is what `warning` means everywhere else here.
 */

import { View } from 'react-native';
import { Button } from './Button.js';
import { Icon } from './Icon.js';
import { Row } from './Row.js';
import { Text } from './Text.js';
import { useTheme } from './theme.js';

export interface ErrorStateProps {
  /** What went wrong, in the customer's language. Never a provider code. */
  readonly message: string;
  /** What to do about it. Omit only when there is genuinely nothing to retry. */
  readonly onRetry?: (() => void) | undefined;
  readonly retryLabel?: string | undefined;
  /** True while the retry is in flight, so the button can say so. */
  readonly retrying?: boolean | undefined;
  readonly testID?: string | undefined;
}

export function ErrorState({ message, onRetry, retryLabel, retrying, testID }: ErrorStateProps) {
  const theme = useTheme();

  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      style={{
        gap: theme.spacing.md,
        padding: theme.spacing.base,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.warningBorder,
        backgroundColor: theme.colors.warningSubtle,
      }}
    >
      <Row gap="sm" align="flex-start">
        <Icon name="alert" size={theme.iconSize.md} color={theme.colors.warningFg} />
        <Text variant="bodySmall" tone="warning" style={{ flex: 1 }}>
          {message}
        </Text>
      </Row>

      {onRetry === undefined || retryLabel === undefined ? null : (
        <Button
          {...(testID === undefined ? {} : { testID: `${testID}-retry` })}
          label={retryLabel}
          variant="secondary"
          size="medium"
          loading={retrying === true}
          onPress={onRetry}
        />
      )}
    </View>
  );
}
