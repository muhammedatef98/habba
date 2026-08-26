/**
 * Phone entry — the first screen.
 *
 * Build prompt §9.1: onboarding is phone OTP. Validation runs through
 * @habba/core so the app and the database agree on what a Saudi number is.
 */

import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { parseSaudiPhone } from '@habba/core';
import { Button, Field, Screen, Text, useTheme } from '@habba/ui';
import { otpProvider } from '@/lib/otp';
import { useIsAuthenticated, useSession } from '@/state/session';

export default function PhoneScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const isAuthenticated = useIsAuthenticated();
  const setPendingPhone = useSession((state) => state.setPendingPhone);

  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);

  if (isAuthenticated) return <Redirect href="/vehicles" />;

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
          // Phone numbers read left-to-right even in an Arabic UI.
          forceLtrInput
        />

        <Button
          testID="send-code"
          label={t('auth.sendCode')}
          onPress={() => void handleSend()}
          loading={sending}
          disabled={phone.length === 0}
        />
      </View>
    </Screen>
  );
}
