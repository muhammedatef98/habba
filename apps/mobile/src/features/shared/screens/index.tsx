/**
 * Phone entry — the first screen.
 *
 * Build prompt §9.1: onboarding is phone OTP. Validation runs through
 * @habba/core so the app and the database agree on what a Saudi number is.
 *
 * §5.1.1: it asks for a phone number and nothing else. There is no "are you a
 * customer or a technician?" step here or anywhere — everyone starts as a
 * customer, and becoming a provider is an upgrade from the profile screen.
 *
 * For a signed-in user this screen is also the entry point that restores the
 * last active mode (§5.1.4).
 */

import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { parseSaudiPhone, SAUDI_COUNTRY_CODE } from '@habba/core';
import { Button, Field, HabbaWordmark, Screen, Text, useTheme } from '@habba/ui';
import { otpProvider } from '@/features/shared/lib/otp';
import { repository } from '@/features/shared/data/repository';
import { useIsApprovedProvider } from '@/features/shared/hooks/use-roles';
import { useMode } from '@/features/shared/state/mode';
import { useIsAuthenticated, useSession } from '@/features/shared/state/session';

export default function PhoneScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const isAuthenticated = useIsAuthenticated();
  const setPendingPhone = useSession((state) => state.setPendingPhone);
  const signInAsGuest = useSession((state) => state.signInAsGuest);
  const mode = useMode((state) => state.mode);
  const isProvider = useIsApprovedProvider();

  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [enteringAsGuest, setEnteringAsGuest] = useState(false);

  // The stored mode is a preference, not a permission: it only picks the
  // landing screen, and only when the server says the role is still held. A
  // revoked technician lands on their own logbook, not on a job feed.
  if (isAuthenticated) {
    return <Redirect href={mode === 'provider' && isProvider ? '/shift' : '/vehicles'} />;
  }

  async function handleGuest() {
    setEnteringAsGuest(true);
    setError(undefined);

    try {
      const profile = await repository.signInAsGuest();
      signInAsGuest(profile.id, profile.fullName);
      router.replace('/vehicles');
    } catch {
      setError(t('auth.errors.network'));
    } finally {
      setEnteringAsGuest(false);
    }
  }

  async function handleSend() {
    const parsed = parseSaudiPhone(phone);
    if (!parsed.ok) {
      setError(t('auth.errors.invalidPhone'));
      return;
    }

    setSending(true);
    setError(undefined);

    const result = await otpProvider.send(parsed.e164);
    setSending(false);

    if (!result.ok) {
      // CLAUDE.md §12: every error is surfaced in Arabic, plainly, with a next
      // action — never a raw provider code.
      setError(
        result.reason === 'rate_limited'
          ? t('auth.errors.tooManyAttempts')
          : result.reason === 'invalid_phone'
            ? t('auth.errors.invalidPhone')
            : t('auth.errors.network'),
      );
      return;
    }

    setPendingPhone(parsed.e164);
    router.push('/verify');
  }

  return (
    <Screen scrollable>
      <View style={{ flex: 1, justifyContent: 'center', gap: theme.spacing.lg }}>
        <View style={{ gap: theme.spacing.sm }}>
          {/* The full lockup, not the mark alone: this is the one screen that
              introduces the brand, and the wordmark is where the name and the
              gust are shown together. */}
          <HabbaWordmark size={56} />
          <Text variant="display">{t('auth.welcomeTitle')}</Text>
          <Text variant="body" tone="muted">
            {t('auth.welcomeSubtitle')}
          </Text>
        </View>

        <Field
          testID="phone-input"
          label={t('auth.phoneLabel')}
          value={phone}
          onChangeText={(value) => {
            setPhone(value);
            if (error !== undefined) setError(undefined);
          }}
          placeholder={t('auth.phonePlaceholder')}
          hint={t('auth.phoneHint')}
          error={error}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          maxLength={16}
          // The dialling code, shown rather than assumed. `parseSaudiPhone`
          // accepts 05…, 5…, +966… and 00966… equally, so this is not
          // validation — it is the app answering "do I type the zero?" before
          // the question is asked, on the very first screen. The prefix is not
          // part of the value, so every form the parser accepts still works.
          prefix={`+${SAUDI_COUNTRY_CODE}`}
          forceLtrInput
        />

        <Button
          testID="send-code"
          label={t('auth.sendCode')}
          onPress={() => void handleSend()}
          loading={sending}
          disabled={phone.length === 0}
        />

        {/* Phone stays the primary path (§9.1). These are alternatives, and
            their weight in the hierarchy says so — secondary, then ghost. */}
        <Button
          testID="email-signin"
          label={t('auth.useEmail')}
          variant="secondary"
          onPress={() => router.push('/email')}
        />

        {/* §11: the logbook is top-of-funnel and must never be gated. Letting
            someone in before they hand over a phone number is what that
            actually means in an onboarding screen. */}
        <View style={{ gap: theme.spacing.xs }}>
          <Button
            testID="continue-as-guest"
            label={t('auth.continueAsGuest')}
            variant="ghost"
            onPress={() => void handleGuest()}
            loading={enteringAsGuest}
          />
          <Text variant="caption" tone="subtle" align="center">
            {t('auth.guestHint')}
          </Text>
        </View>
      </View>
    </Screen>
  );
}
