/**
 * OTP verification.
 *
 * The code first, and the name only if there is nobody yet to call by one.
 * The name used to sit under the code on every sign-in, so a returning
 * customer typed their own name again to get back into their own account —
 * and whatever they typed that day overwrote what was saved. Who is signing in
 * is only known once the code is right, so that is when the question is
 * decided: an account that exists goes straight in, a new number gets one
 * short step on this same screen.
 */

import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ltrIsolate, maskPhone } from '@habba/core';
import { Button, CodeInput, Field, HabbaMark, Row, Screen, Text, useTheme } from '@habba/ui';
import { OTP_LENGTH, OTP_RESEND_COOLDOWN_SECONDS } from '@/features/shared/lib/otp-provider';
import { otpProvider } from '@/features/shared/lib/otp';
import { repository } from '@/features/shared/data/repository';
import { useSession } from '@/features/shared/state/session';

export default function VerifyScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const phoneE164 = useSession((state) => state.phoneE164);
  const locale = useSession((state) => state.locale);
  const signIn = useSession((state) => state.signIn);

  const [step, setStep] = useState<'code' | 'name'>('code');
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

    // The code was right. A number that already has an account is signed
    // straight in, with the name it already has. Reading it can fail on a
    // dropped connection like any request; left uncaught, the button spun
    // forever with no way on.
    try {
      const existing = await repository.getProfile();
      if (existing !== null && !existing.isGuest) {
        setBusy(false);
        signIn(existing.id, existing.fullName);
        router.replace('/vehicles');
        return;
      }
    } catch {
      setBusy(false);
      setError(t('auth.errors.network'));
      return;
    }

    setBusy(false);
    setStep('name');
  }

  async function handleCreate() {
    if (phoneE164 === null) return;

    setBusy(true);
    setError(undefined);

    let profile: Awaited<ReturnType<typeof repository.upsertProfile>>;
    try {
      profile = await repository.upsertProfile({
        fullName: fullName.trim(),
        phone: phoneE164,
        email: null,
        isGuest: false,
        preferredLocale: locale,
      });
    } catch {
      setBusy(false);
      setError(t('auth.errors.network'));
      return;
    }

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

  if (step === 'name') {
    return (
      <Screen scrollable>
        <View style={{ flex: 1, justifyContent: 'center', gap: theme.spacing.lg }}>
          <View style={{ gap: theme.spacing.sm }}>
            <Row>
              <HabbaMark size={40} />
            </Row>
            <Text variant="title">{t('auth.nameStepTitle')}</Text>
            <Text variant="body" tone="muted">
              {t('auth.nameStepSubtitle')}
            </Text>
          </View>

          <Field
            testID="name-input"
            label={t('auth.nameLabel')}
            value={fullName}
            onChangeText={(value) => {
              setFullName(value);
              if (error !== undefined) setError(undefined);
            }}
            autoComplete="name"
            error={error}
          />

          <Button
            testID="name-continue"
            label={t('common.continue')}
            onPress={() => void handleCreate()}
            loading={busy}
            disabled={fullName.trim().length < 2}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scrollable>
      <View style={{ flex: 1, justifyContent: 'center', gap: theme.spacing.lg }}>
        <View style={{ gap: theme.spacing.sm }}>
          {/* In a Row so it sits at the reading start (the right, in Arabic)
              on every launch, including the first, when the platform still
              lays columns out left-to-right. */}
          <Row>
            <HabbaMark size={40} />
          </Row>
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

        <Button
          testID="verify-button"
          label={t('auth.verify')}
          onPress={() => void handleVerify()}
          loading={busy}
          disabled={code.length !== OTP_LENGTH}
        />

        <Button
          label={cooldown > 0 ? t('auth.resendIn', { count: cooldown }) : t('auth.resend')}
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
