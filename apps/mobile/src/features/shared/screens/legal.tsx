/**
 * The terms, the privacy policy or the provider terms (0083), read in the app:
 * from the sign-in sentence, from «حسابي», from the provider application, and
 * from the acceptance screen. Readable signed out — that is when it matters.
 */

import { Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LEGAL_DOCUMENT_KINDS, type LegalDocumentKind } from '@habba/core';
import { Icon, Row, Screen, useTheme } from '@habba/ui';
import { LegalDocumentView } from '@/features/shared/components/LegalDocumentView';

function kindOf(value: string | string[] | undefined): LegalDocumentKind {
  const kind = Array.isArray(value) ? value[0] : value;
  return LEGAL_DOCUMENT_KINDS.find((known) => known === kind) ?? 'terms';
}

export default function LegalScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { kind } = useLocalSearchParams<{ kind?: string }>();

  return (
    <Screen scrollable style={{ gap: theme.spacing.lg }}>
      <Row>
        <Pressable
          testID="legal-back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={({ pressed }) => [
            {
              width: 40,
              height: 40,
              borderRadius: theme.radius.full,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.colors.surfaceSunken,
            },
            pressed ? { opacity: 0.6 } : null,
          ]}
        >
          <Icon name="chevronBack" size={theme.iconSize.sm} color={theme.colors.text} />
        </Pressable>
      </Row>
      <LegalDocumentView kind={kindOf(kind)} />
    </Screen>
  );
}
