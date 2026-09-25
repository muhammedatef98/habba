/**
 * «بالمتابعة فإنك توافق على الشروط والأحكام وسياسة الخصوصية» — under the
 * sign-in buttons, before a phone number or an email is handed over.
 *
 * Each document opens in the app (0083), readable before signing in. The
 * agreement itself is recorded after sign-in, by a tap on the acceptance
 * screen (LegalGate): this sentence tells, that tap is the evidence.
 */

import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text } from '@habba/ui';
import { splitTagged } from '@/features/shared/lib/links';

export function LegalConsent() {
  const { t } = useTranslation();

  return (
    <Text testID="legal-consent" variant="caption" tone="subtle" align="center">
      {splitTagged(t('legal.consentBoth')).map((segment, index) =>
        segment.tag === null ? (
          segment.text
        ) : (
          <Text
            key={index}
            testID={`legal-${segment.tag}`}
            variant="caption"
            tone="primary"
            accessibilityRole="link"
            onPress={() =>
              router.push({
                pathname: '/legal',
                params: { kind: segment.tag === 'privacy' ? 'privacy' : 'terms' },
              })
            }
            style={{ textDecorationLine: 'underline' }}
          >
            {segment.text}
          </Text>
        ),
      )}
    </Text>
  );
}
