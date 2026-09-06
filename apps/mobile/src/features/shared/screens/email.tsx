/**
 * Email sign-in — the secondary auth route, by one-time code.
 *
 * §9.1 specifies phone OTP, and phone remains the default and primary path for
 * the Saudi market. This exists for people who prefer email or whose number is
 * between SIMs; it is deliberately reached from a secondary button rather than
 * presented as an equal choice.
 *
 * There is no password and no separate "register" mode. An address that has
 * never signed in becomes an account when its code is typed back — the same
 * shape as the phone flow, where nobody registers either. That removes a
 * second secret, a reset flow, and the "is this a sign-in or a sign-up?"
 * question the user could not answer about themselves anyway.
 *
 * Two steps in one screen because they share the address and the error slot:
 * splitting them would mean passing a half-finished sign-in through a route
 * param, which is how a code ends up in a URL.
 */

import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button, Field, Screen, Text, useTheme } from '@habba/ui';
import {
  EMAIL_OTP_LENGTH,
  isValidEmail,
  normaliseEmail,
} from '@/features/shared/lib/email-otp-provider';
import { emailOtpProvider } from '@/features/shared/lib/email-otp';
import { repository } from '@/features/shared/data/repository';
import { useIsAuthenticated, useSession } from '@/features/shared/state/session';

type Step = 'address' | 'code';

export default function EmailScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const isAuthenticated = useIsAuthenticated();
  const locale = useSession((state) => state.locale);
  const signIn = useSession((state) => state.signIn);

  const [step, setStep] = useState<Step>('address');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  if (isAuthenticated) return <Redirect href="/vehicles" />;

  async function handleSend() {
    setBusy(true);
    setError(undefined);

    const result = await emailOtpProvider.send(email);
    setBusy(false);

    if (!result.ok) {
      // CLAUDE.md §12: plain Arabic, with a next action — never a raw code.
      setError(
        {
          invalid_email: t('auth.errors.invalidEmail'),
          rate_limited: t('auth.errors.rateLimited'),
          transport_failed: t('auth.errors.network'),
        }[result.reason],
      );
      return;
    }

    setStep('code');
  }

  async function handleVerify() {
    setBusy(true);
    setError(undefined);

    const result = await emailOtpProvider.verify(email, code);

    if (!result.ok) {
      setBusy(false);
      setError(
        {
          invalid_code: t('auth.errors.invalidCode'),
          expired: t('auth.errors.codeExpired'),
          too_many_attempts: t('auth.errors.tooManyAttempts'),
        }[result.reason],
      );
      return;
    }

    // The address is the identity; the name is what the person is called. An
    // empty name falls back to the address rather than blocking the sign-in on
    // a field nobody has to fill in.
    const normalised = normaliseEmail(email);
    const profile = await repository.upsertProfile({
      fullName: fullName.trim().length > 1 ? fullName.trim() : normalised,
      phone: null,
      email: normalised,
      isGuest: false,
      preferredLocale: locale,
    });

    setBusy(false);
    signIn(profile.id, profile.fullName);
    router.replace('/vehicles');
  }

  return (
    <Screen scrollable>
      <View style={{ flex: 1, justifyContent: 'center', gap: theme.spacing.lg }}>
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="title">{t('auth.emailSignInTitle')}</Text>
          <Text variant="body" tone="muted">
            {step === 'address' ? t('auth.emailSubtitle') : t('auth.emailCodeSubtitle', { email })}
          </Text>
        </View>

        {step === 'address' ? (
          <>
            <Field
              testID="email-input"
              label={t('auth.emailLabel')}
              value={email}
              onChangeText={(value) => {
                setEmail(value);
                if (error !== undefined) setError(undefined);
              }}
              placeholder="name@example.com"
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
              autoCapitalize="none"
              error={error}
              // Email addresses read left-to-right even in an Arabic UI.
              forceLtrInput
            />

            <Button
              testID="email-submit"
              label={t('auth.emailSendCode')}
              onPress={() => void handleSend()}
              loading={busy}
              disabled={!isValidEmail(email)}
            />
          </>
        ) : (
          <>
            <Field
              testID="email-code-input"
              label={t('auth.codeLabel')}
              value={code}
              onChangeText={(value) => {
                setCode(value.replace(/\D/g, '').slice(0, EMAIL_OTP_LENGTH));
                if (error !== undefined) setError(undefined);
              }}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              error={error}
              forceLtrInput
            />

            <Field
              testID="email-name-input"
              label={t('auth.nameLabel')}
              hint={t('auth.nameOptionalHint')}
              value={fullName}
              onChangeText={setFullName}
              autoComplete="name"
            />

            <Button
              testID="email-verify"
              label={t('auth.emailVerifyAction')}
              onPress={() => void handleVerify()}
              loading={busy}
              disabled={code.length !== EMAIL_OTP_LENGTH}
            />

            <Button
              testID="email-change-address"
              label={t('auth.emailChangeAddress')}
              variant="ghost"
              onPress={() => {
                setStep('address');
                setCode('');
                setError(undefined);
              }}
            />
          </>
        )}

        <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
