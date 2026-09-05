/**
 * A titled break between home-screen sections.
 *
 * The old home ran eight blocks together with one uniform gap, so nothing on
 * it was grouped — the recent order sat as close to the booking button as the
 * booking button sat to the emergency block. Naming the groups is what lets
 * the spacing mean something.
 */

import { Pressable } from 'react-native';
import { Row, Text } from '@habba/ui';

export interface SectionHeaderProps {
  readonly title: string;
  readonly actionLabel?: string | undefined;
  readonly onAction?: (() => void) | undefined;
  readonly testID?: string | undefined;
}

export function SectionHeader({ title, actionLabel, onAction, testID }: SectionHeaderProps) {
  return (
    // <Row>, not a hand-written row: on the first Arabic launch Yoga is still
    // laying out left-to-right (forceRTL applies next process start), which put
    // every section title — التفضيلات, عن هبّة, and the rest — on the left.
    <Row testID={testID} gap="md" align="baseline" justify="space-between">
      <Text variant="subheading">{title}</Text>

      {actionLabel !== undefined && onAction !== undefined ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          // The label alone is under 48dp tall; the hit slop makes the target
          // legal without padding the row out of alignment with the title.
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
        >
          {({ pressed }) => (
            <Text variant="label" tone="primary" style={pressed ? { opacity: 0.6 } : undefined}>
              {actionLabel}
            </Text>
          )}
        </Pressable>
      ) : null}
    </Row>
  );
}
