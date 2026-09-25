/**
 * «بالمتابعة فإنك توافق على الشروط والأحكام وسياسة الخصوصية» — under the
 * sign-in buttons, before a phone number or an email is handed over (0082).
 *
 * The documents are links set in the console. Until one is published the
 * sentence names only the other, and with neither it is not shown at all:
 * agreeing to a document that cannot be opened is not agreeing to anything.
 */

import { Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@habba/ui';
import { usePlatformStatus } from '@/features/shared/hooks/use-platform';
import { openableLink, splitTagged } from '@/features/shared/lib/links';

export function LegalConsent() {
  const { t } = useTranslation();
  const { termsUrl, privacyUrl } = usePlatformStatus();
  const links: Record<string, string | null> = {
    terms: openableLink(termsUrl),
    privacy: openableLink(privacyUrl),
  };

  const sentence =
    links['terms'] !== null && links['privacy'] !== null
      ? t('legal.consentBoth')
      : links['terms'] !== null
        ? t('legal.consentTerms')
        : links['privacy'] !== null
          ? t('legal.consentPrivacy')
          : null;
  if (sentence === null) return null;

  return (
    <Text testID="legal-consent" variant="caption" tone="subtle" align="center">
      {splitTagged(sentence).map((segment, index) => {
        const url = segment.tag === null ? null : (links[segment.tag] ?? null);
        if (url === null) return segment.text;
        return (
          <Text
            key={index}
            testID={`legal-${segment.tag ?? ''}`}
            variant="caption"
            tone="primary"
            accessibilityRole="link"
            onPress={() => void Linking.openURL(url)}
            style={{ textDecorationLine: 'underline' }}
          >
            {segment.text}
          </Text>
        );
      })}
    </Text>
  );
}
