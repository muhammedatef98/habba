/**
 * OTP verification.
 *
 * On success the user gets a name, a profile, and a session. The name step is
 * folded in here rather than given its own screen — build prompt §9.1 wants a
 * vehicle added in as few taps as possible, and an extra full screen for one
 * text field works against that.
 */

import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ltrIsolate, maskPhone } from '@habba/core';
import { Button, CodeInput, Field, HabbaMark, Screen, Text, useTheme } from '@habba/ui';
import { OTP_LENGTH, OTP_RESEND_COOLDOWN_SECONDS } from '@/lib/otp-provider';
import { otpProvider } from '@/lib/otp';
import { repository } from '@/data/repository';
import { useSession } from '@/state/session';

export default function VerifyScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const phoneE164 = useSession((state) => state.phoneE164);
  const locale = useSession((state) => state.locale);
  const signIn = useSession((state) => state.signIn);

  const [code, setCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(OTP_RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  if (phoneE164 === null) return <Redirect href="/" />;

  async function handleVerify() {
    if (phoneE164 === null) return;

    setBusy(true);
    setError(undefined);

    const result = await otpProvider.verify(phoneE164, code);

    if (!result.ok) {
      setBusy(false);
      setError(
        result.reason === 'expired'
          ? t('auth.errors.otpExpired')
          : result.reason === 'too_many_attempts'
            ? t('auth.errors.tooManyAttempts')
            : t('auth.errors.invalidOtp'),
      );
      return;
    }

    const profile = await repository.upsertProfile({
      fullName: fullName.trim(),
      phone: phoneE164,
      email: null,
      isGuest: false,
      preferredLocale: locale,
    });

    setBusy(false);
    signIn(profile.id, profile.fullName);
    router.replace('/vehicles');
  }

  async function handleResend() {
    if (phoneE164 === null) return;
    const result = await otpProvider.send(phoneE164);
    if (result.ok) {
      setCooldown(OTP_RESEND_COOLDOWN_SECONDS);
      setError(undefined);
    } else {
      setError(t('auth.errors.tooManyAttempts'));
    }
  }

  const canSubmit = code.length === OTP_LENGTH && fullName.trim().length > 1;

  return (
    <Screen scrollable>
      <View style={{ flex: 1, justifyContent: 'center', gap: theme.spacing.lg }}>
        <View style={{ gap: theme.spacing.sm }}>
          <HabbaMark size={40} />
          <Text variant="title">{t('auth.otpTitle')}</Text>
          <Text variant="body" tone="muted">
            {/* Masked: a full number should not sit on screen unnecessarily.
                Isolated: inside an RTL sentence the bidi algorithm reorders the
                neutral characters in `05• •••• •67` and renders it as
                `670••••050`, which reads as the app showing the wrong number. */}
            {t('auth.otpSubtitle', {
              length: OTP_LENGTH,
              phone: ltrIsolate(maskPhone(phoneE164)),
            })}
          </Text>
        </View>

        {/* The label was `auth.verify` — "تحقّق" — which is the button's
            words, not the field's. A field labelled with its own submit action
            tells a screen-reader user nothing about what to type. */}
        <CodeInput
          testID="otp-input"
          label={t('auth.otpLabel')}
          value={code}
          onChangeText={(value) => {
            setCode(value);
            if (error !== undefined) setError(undefined);
          }}
          length={OTP_LENGTH}
          error={error}
        />

        <Field
          testID="name-input"
          label={t('auth.nameLabel')}
          value={fullName}
          onChangeText={setFullName}
          autoComplete="name"
        />

        <Button
          testID="verify-button"
          label={t('auth.verify')}
          onPress={() => void handleVerify()}
          loading={busy}
          disabled={!canSubmit}
        />

        <Button
          label={cooldown > 0 ? t('auth.resendIn', { seconds: cooldown }) : t('auth.resend')}
          variant="ghost"
          onPress={() => void handleResend()}
          disabled={cooldown > 0}
        />

        {/* There was no way back from here. A mistyped digit in the phone
            number left the customer waiting for an SMS that was never coming,
            with the app offering only "resend" to the same wrong number. */}
        <Button
          testID="change-phone"
          label={t('auth.changePhone')}
          variant="ghost"
          size="medium"
          onPress={() => router.replace('/')}
        />
      </View>
    </Screen>
  );
}
