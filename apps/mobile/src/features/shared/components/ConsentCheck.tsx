/**
 * A tick box beside a sentence that links to a document — «قرأت شروط مقدّمي
 * الخدمة وأوافق عليها». The box is the agreement; the link opens the text
 * in the app (0083) without leaving the form.
 */

import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import type { LegalDocumentKind } from '@habba/core';
import { Icon, Row, Text, useTheme } from '@habba/ui';
import { splitTagged } from '@/features/shared/lib/links';

export interface ConsentCheckProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  /** A sentence with the document's name in `<kind>…</kind>`. */
  readonly sentence: string;
  readonly testID?: string;
}

export function ConsentCheck({ checked, onChange, sentence, testID }: ConsentCheckProps) {
  const theme = useTheme();

  return (
    <Row gap="sm" align="flex-start">
      <Pressable
        testID={testID}
        onPress={() => onChange(!checked)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: theme.radius.sm,
            borderWidth: 2,
            borderColor: checked ? theme.colors.primary : theme.colors.borderStrong,
            backgroundColor: checked ? theme.colors.primary : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {checked ? <Icon name="check" size={16} color={theme.colors.textInverse} /> : null}
        </View>
      </Pressable>
      <Text variant="bodySmall" tone="muted" style={{ flex: 1 }}>
        {splitTagged(sentence).map((segment, index) =>
          segment.tag === null ? (
            segment.text
          ) : (
            <Text
              key={index}
              variant="bodySmall"
              tone="primary"
              accessibilityRole="link"
              onPress={() =>
                router.push({
                  pathname: '/legal',
                  params: { kind: segment.tag as LegalDocumentKind },
                })
              }
              style={{ textDecorationLine: 'underline' }}
            >
              {segment.text}
            </Text>
          ),
        )}
      </Text>
    </Row>
  );
}
