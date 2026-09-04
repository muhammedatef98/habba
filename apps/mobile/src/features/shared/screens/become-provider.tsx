/**
 * «اشتغل معنا كفنّي» — the in-app upgrade to a provider account (§5.1.1).
 *
 * The account does not change: same uid, same vehicles, same logbook. What is
 * created is a `pending` provider record. Submitting it grants nothing — the
 * screen says so plainly rather than implying the user is now a technician —
 * and the role appears only when ops approves (§5.1.1).
 *
 * Identifiers are validated here for the user's sake (a typo caught now beats
 * a rejection in three days) and again on the server, which is the one that
 * counts. They are sealed before they leave the device (§11).
 */

import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { isValidNationalId, isValidSaudiIban, normaliseIban } from '@habba/core';
import { Button, Card, Field, ListRow, Screen, Text, useTheme } from '@habba/ui';
import { repository } from '@/features/shared/data/repository';
import { useCanApplyAsProvider } from '@/features/shared/hooks/use-roles';
import { useIsAuthenticated } from '@/features/shared/state/session';

type ProviderType = 'individual' | 'workshop';

export default function BecomeProviderScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const isAuthenticated = useIsAuthenticated();
  const canApply = useCanApplyAsProvider();
  const isArabic = i18n.language === 'ar';

  const cities = useQuery({ queryKey: ['cities'], queryFn: () => repository.listCities() });

  const [providerType, setProviderType] = useState<ProviderType>('individual');
  const [businessName, setBusinessName] = useState('');
  const [cityId, setCityId] = useState<string | null>(null);
  const [nationalId, setNationalId] = useState('');
  const [iban, setIban] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (!isAuthenticated) return <Redirect href="/" />;
  // Covers both cases in one check: ENABLE_PROVIDER_MODE is off, or the role is
  // already held and there is nothing here to apply for. The redirect happens
  // before render, so with the flag off no field that asks for a national ID or
  // an IBAN is ever mounted — not disabled, not hidden, not mounted.
  if (!canApply) return <Redirect href="/profile" />;

  async function handleSubmit() {
    setError(undefined);

    if (businessName.trim().length < 2) return setError(t('provider.upgrade.errors.name'));
    if (cityId === null) return setError(t('provider.upgrade.errors.city'));
    if (!isValidNationalId(nationalId)) return setError(t('provider.upgrade.errors.nationalId'));
    if (!isValidSaudiIban(iban)) return setError(t('provider.upgrade.errors.iban'));

    setSubmitting(true);
    try {
      await repository.applyAsProvider({
        businessNameAr: businessName.trim(),
        providerType,
        cityId,
        nationalId,
        iban: normaliseIban(iban),
      });
      setSubmitted(true);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message === 'already_applied'
          ? t('provider.upgrade.errors.alreadyApplied')
          : t('provider.upgrade.errors.submit'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <Screen>
        <Text variant="title">{t('provider.upgrade.submittedTitle')}</Text>
        <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="body">{t('provider.upgrade.submittedBody')}</Text>
            {/* Said explicitly, because "applied" and "approved" feeling like
                the same thing is how a provider ends up confused about why the
                job feed is empty. */}
            <Text variant="caption" tone="muted">
              {t('provider.upgrade.submittedNote')}
            </Text>
          </View>
        </Card>
        <Button
          testID="upgrade-done"
          label={t('common.done')}
          onPress={() => router.replace('/profile')}
        />
      </Screen>
    );
  }

  return (
    <Screen scrollable>
      <Text variant="title">{t('provider.upgrade.title')}</Text>
      <Text variant="body" tone="muted">
        {t('provider.upgrade.subtitle')}
      </Text>

      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            testID="type-individual"
            label={t('provider.upgrade.typeIndividual')}
            variant={providerType === 'individual' ? 'primary' : 'secondary'}
            size="medium"
            onPress={() => setProviderType('individual')}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            testID="type-workshop"
            label={t('provider.upgrade.typeWorkshop')}
            variant={providerType === 'workshop' ? 'primary' : 'secondary'}
            size="medium"
            onPress={() => setProviderType('workshop')}
          />
        </View>
      </View>

      <Field
        testID="business-name"
        label={t('provider.upgrade.nameLabel')}
        value={businessName}
        onChangeText={setBusinessName}
      />

      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="label" tone="muted">
          {t('provider.upgrade.cityLabel')}
        </Text>
        {(cities.data ?? []).map((city) => (
          <ListRow
            key={city.id}
            testID={`city-${city.id}`}
            title={isArabic ? city.nameAr : city.nameEn}
            selected={cityId === city.id}
            onPress={() => setCityId(city.id)}
          />
        ))}
      </View>

      <Field
        testID="national-id"
        label={t('provider.upgrade.nationalIdLabel')}
        hint={t('provider.upgrade.nationalIdHint')}
        value={nationalId}
        onChangeText={setNationalId}
        keyboardType="number-pad"
        forceLtrInput
      />

      <Field
        testID="iban"
        label={t('provider.upgrade.ibanLabel')}
        hint={t('provider.upgrade.ibanHint')}
        value={iban}
        onChangeText={setIban}
        autoCapitalize="characters"
        forceLtrInput
      />

      {error !== undefined ? (
        <Text variant="caption" style={{ color: theme.colors.emergency }}>
          {error}
        </Text>
      ) : null}

      {/* Nafath (نفاذ) is the identity step that makes this real; it is stubbed
          until the integration exists (build prompt §3), and saying so beats a
          fake "verified" badge. */}
      <Text variant="caption" tone="subtle">
        {t('provider.upgrade.nafathNote')}
      </Text>

      <Button
        testID="submit-application"
        label={t('provider.upgrade.submit')}
        onPress={handleSubmit}
        loading={submitting}
      />
    </Screen>
  );
}
