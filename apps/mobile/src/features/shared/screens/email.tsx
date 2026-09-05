/**
 * Email sign-in and registration — the secondary auth route.
 *
 * §9.1 specifies phone OTP, and phone remains the default and primary path
 * for the Saudi market. This exists for people who prefer email or whose
 * number is between SIMs; it is deliberately reached from a secondary button
 * rather than presented as an equal choice.
 *
 * One screen handles both modes because the fields are identical and the only
 * difference is which call is made — two near-identical screens would drift.
 */

import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button, Field, Screen, Text, useTheme } from '@habba/ui';
import {
  MIN_PASSWORD_LENGTH,
  isValidEmail,
  normaliseEmail,
} from '@/features/shared/lib/email-auth-provider';
import { emailAuthProvider } from '@/features/shared/lib/email-auth';
import { repository } from '@/features/shared/data/repository';
import { useIsAuthenticated, useSession } from '@/features/shared/state/session';

type Mode = 'signIn' | 'register';

export default function EmailScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const isAuthenticated = useIsAuthenticated();
  const locale = useSession((state) => state.locale);
  const signIn = useSession((state) => state.signIn);

  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  if (isAuthenticated) return <Redirect href="/vehicles" />;

  async function handleSubmit() {
    setBusy(true);
    setError(undefined);

    const result =
      mode === 'register'
        ? await emailAuthProvider.register(email, password)
        : await emailAuthProvider.signIn(email, password);

    if (!result.ok) {
      setBusy(false);
      // CLAUDE.md §12: plain Arabic, with a next action — never a raw code.
      setError(
        {
          invalid_email: t('auth.errors.invalidEmail'),
          weak_password: t('auth.errors.weakPassword', { length: MIN_PASSWORD_LENGTH }),
          email_taken: t('auth.errors.emailTaken'),
          unknown_email: t('auth.errors.unknownEmail'),
          wrong_password: t('auth.errors.wrongPassword'),
          transport_failed: t('auth.errors.network'),
        }[result.reason],
      );
      return;
    }

    const profile = await repository.upsertProfile({
      fullName: mode === 'register' ? fullName.trim() : normaliseEmail(email),
      phone: null,
      email: result.email,
      isGuest: false,
      preferredLocale: locale,
    });

    setBusy(false);
    signIn(profile.id, profile.fullName);
    router.replace('/vehicles');
  }

  const canSubmit =
    isValidEmail(email) &&
    password.length >= MIN_PASSWORD_LENGTH &&
    (mode === 'signIn' || fullName.trim().length > 1);

  return (
    <Screen scrollable>
      <View style={{ flex: 1, justifyContent: 'center', gap: theme.spacing.lg }}>
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="title">
            {mode === 'register' ? t('auth.emailRegisterTitle') : t('auth.emailSignInTitle')}
          </Text>
          <Text variant="body" tone="muted">
            {t('auth.emailSubtitle')}
          </Text>
        </View>

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
          // Email addresses read left-to-right even in an Arabic UI.
          forceLtrInput
        />

        {mode === 'register' ? (
          <Field
            testID="email-name-input"
            label={t('auth.nameLabel')}
            value={fullName}
            onChangeText={setFullName}
            autoComplete="name"
          />
        ) : null}

        <Field
          testID="password-input"
          label={t('auth.passwordLabel')}
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            if (error !== undefined) setError(undefined);
          }}
          hint={
            mode === 'register'
              ? t('auth.passwordHint', { length: MIN_PASSWORD_LENGTH })
              : undefined
          }
          error={error}
          secureTextEntry
          textContentType={mode === 'register' ? 'newPassword' : 'password'}
          autoCapitalize="none"
          forceLtrInput
        />

        <Button
          testID="email-submit"
          label={mode === 'register' ? t('auth.emailRegisterAction') : t('auth.emailSignInAction')}
          onPress={() => void handleSubmit()}
          loading={busy}
          disabled={!canSubmit}
        />

        <Button
          testID="email-toggle-mode"
          label={mode === 'register' ? t('auth.haveAccount') : t('auth.needAccount')}
          variant="ghost"
          onPress={() => {
            setMode(mode === 'register' ? 'signIn' : 'register');
            setError(undefined);
          }}
        />

        <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
