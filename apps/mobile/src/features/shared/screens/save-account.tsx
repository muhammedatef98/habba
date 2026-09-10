/**
 * Guest → account conversion.
 *
 * The uid does not change here, which is the entire point: the guest's
 * vehicles and timeline stay theirs (migration 0039). The copy says so plainly
 * because the fear this screen has to answer is "will I lose my logbook."
 *
 * A phone claimed here is unverified until an SMS proves it, and the same for
 * email — `guard_profile_columns` refuses a self-set verification flag. So
 * this screen attaches an identity; it does not assert one has been checked.
 */

import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { parseSaudiPhone, SAUDI_COUNTRY_CODE } from '@habba/core';
import { Button, Card, Field, Screen, Text, rowDirectionFor, useTheme } from '@habba/ui';
import { isValidEmail, normaliseEmail } from '@/features/shared/lib/email-auth-provider';
import { repository } from '@/features/shared/data/repository';
import { useIsAuthenticated, useIsGuest, useSession } from '@/features/shared/state/session';

type Method = 'phone' | 'email';

export default function SaveAccountScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const isAuthenticated = useIsAuthenticated();
  const isGuest = useIsGuest();
  const completeGuestUpgrade = useSession((state) => state.completeGuestUpgrade);

  const [method, setMethod] = useState<Method>('phone');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  if (!isAuthenticated) return <Redirect href="/" />;
  // Not a guest means there is nothing to convert — a real account landing
  // here would otherwise see a form that cannot do anything useful.
  if (!isGuest) return <Redirect href="/vehicles" />;

  async function handleSave() {
    setBusy(true);
    setError(undefined);

    try {
      if (method === 'phone') {
        const parsed = parseSaudiPhone(phone);
        if (!parsed.ok) {
          setError(t('auth.errors.invalidPhone'));
          return;
        }
        const profile = await repository.upgradeGuest({
          fullName: fullName.trim(),
          phone: parsed.e164,
        });
        completeGuestUpgrade(profile.fullName);
      } else {
        if (!isValidEmail(email)) {
          setError(t('auth.errors.invalidEmail'));
          return;
        }
        const profile = await repository.upgradeGuest({
          fullName: fullName.trim(),
          email: normaliseEmail(email),
        });
        completeGuestUpgrade(profile.fullName);
      }

      router.replace('/vehicles');
    } catch {
      setError(t('errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    fullName.trim().length > 1 && (method === 'phone' ? phone.length > 0 : isValidEmail(email));

  return (
    <Screen scrollable>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{t('auth.guestUpgradeTitle')}</Text>
        <Text variant="body" tone="muted">
          {t('auth.guestUpgradeBody')}
        </Text>
      </View>

      <View
        style={{
          flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
          gap: theme.spacing.sm,
        }}
      >
        <View style={{ flex: 1 }}>
          <Button
            testID="save-method-phone"
            label={t('auth.guestUpgradePhone')}
            variant={method === 'phone' ? 'primary' : 'secondary'}
            size="medium"
            onPress={() => {
              setMethod('phone');
              setError(undefined);
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            testID="save-method-email"
            label={t('auth.guestUpgradeEmail')}
            variant={method === 'email' ? 'primary' : 'secondary'}
            size="medium"
            onPress={() => {
              setMethod('email');
              setError(undefined);
            }}
          />
        </View>
      </View>

      <Field
        testID="save-name"
        label={t('auth.nameLabel')}
        value={fullName}
        onChangeText={setFullName}
        autoComplete="name"
      />

      {method === 'phone' ? (
        <Field
          testID="save-phone"
          label={t('auth.phoneLabel')}
          value={phone}
          onChangeText={(value) => {
            setPhone(value);
            if (error !== undefined) setError(undefined);
          }}
          placeholder={t('auth.phonePlaceholder')}
          error={error}
          // Same affix as the sign-in screen: a guest attaching a number here
          // is answering the same question, and answering it differently on
          // two screens is how a product stops feeling like one product.
          prefix={`+${SAUDI_COUNTRY_CODE}`}
          keyboardType="phone-pad"
          autoComplete="tel"
          maxLength={16}
          forceLtrInput
        />
      ) : (
        <Field
          testID="save-email"
          label={t('auth.emailLabel')}
          value={email}
          onChangeText={(value) => {
            setEmail(value);
            if (error !== undefined) setError(undefined);
          }}
          placeholder="name@example.com"
          error={error}
          keyboardType="email-address"
          autoComplete="email"
          autoCapitalize="none"
          forceLtrInput
        />
      )}

      <Card elevation="none" style={{ backgroundColor: theme.colors.verifiedSubtle }}>
        <Text variant="caption" style={{ color: theme.colors.verified }}>
          {t('auth.guestUpgradeBody')}
        </Text>
      </Card>

      <Button
        testID="save-account-submit"
        label={t('auth.guestUpgradeAction')}
        onPress={() => void handleSave()}
        loading={busy}
        disabled={!canSubmit}
      />

      <Button label={t('common.cancel')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
