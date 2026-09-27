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
 * counts. The server seals them in Vault (0089); the device keeps nothing.
 */

import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { isValidNationalId, isValidSaudiIban, normaliseIban, toLatinDigits } from '@habba/core';
import { Button, Card, Field, ListRow, Row, Screen, Text, useTheme } from '@habba/ui';
import { repository } from '@/features/shared/data/repository';
import { ConsentCheck } from '@/features/shared/components/ConsentCheck';
import { useLegalDocument } from '@/features/shared/components/LegalDocumentView';
import { useCanApplyAsProvider } from '@/features/shared/hooks/use-roles';
import { useIsAuthenticated } from '@/features/shared/state/session';

type ProviderType = 'individual' | 'workshop';

/** The server's refusals (0089), each to the sentence that tells the person what to fix. */
const REFUSALS: Readonly<Record<string, string>> = {
  already_applied: 'provider.upgrade.errors.alreadyApplied',
  identity_in_use: 'provider.upgrade.errors.identityInUse',
  invalid_national_id: 'provider.upgrade.errors.nationalId',
  invalid_iban: 'provider.upgrade.errors.iban',
  invalid_cr_number: 'provider.upgrade.errors.cr',
  invalid_business_name: 'provider.upgrade.errors.name',
  applications_closed: 'provider.upgrade.errors.closed',
  account_suspended: 'provider.upgrade.errors.suspended',
};

function refusalKey(message: string): string {
  return REFUSALS[message] ?? 'provider.upgrade.errors.submit';
}

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
  const [crNumber, setCrNumber] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [agreed, setAgreed] = useState(false);
  // The version in force, so the acceptance names the text that was shown (0083).
  const providerTerms = useLegalDocument('provider_terms');

  if (!isAuthenticated) return <Redirect href="/" />;
  // Covers both cases in one check: applications are closed, or the role is
  // already held and there is nothing here to apply for. The redirect happens
  // before render, so no field that asks for a national ID or an IBAN is ever
  // mounted for someone who cannot apply — not disabled, not hidden, not mounted.
  if (!canApply) return <Redirect href="/profile" />;

  async function handleSubmit() {
    setError(undefined);

    if (businessName.trim().length < 2) return setError(t('provider.upgrade.errors.name'));
    if (cityId === null) return setError(t('provider.upgrade.errors.city'));
    if (!isValidNationalId(nationalId)) return setError(t('provider.upgrade.errors.nationalId'));
    if (!isValidSaudiIban(iban)) return setError(t('provider.upgrade.errors.iban'));
    if (providerType === 'workshop' && !/^[0-9]{10}$/.test(toLatinDigits(crNumber).trim())) {
      return setError(t('provider.upgrade.errors.cr'));
    }
    if (!agreed) return setError(t('legal.providerConsentRequired'));
    if (providerTerms.data === undefined) return setError(t('legal.loadFailed'));

    setSubmitting(true);
    try {
      // The agreement is recorded before the application: an applicant is
      // never on file without the terms they applied under.
      await repository.acceptLegalDocuments([providerTerms.data.id]);
      await repository.applyAsProvider({
        businessNameAr: businessName.trim(),
        providerType,
        cityId,
        nationalId,
        iban: normaliseIban(iban),
        ...(providerType === 'workshop' ? { crNumber: toLatinDigits(crNumber).trim() } : {}),
      });
      setSubmitted(true);
    } catch (cause) {
      setError(t(refusalKey(cause instanceof Error ? cause.message : '')));
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

      <Row gap="sm">
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
      </Row>

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

      {providerType === 'workshop' ? (
        <Field
          testID="cr-number"
          label={t('provider.upgrade.crLabel')}
          hint={t('provider.upgrade.crHint')}
          value={crNumber}
          onChangeText={setCrNumber}
          keyboardType="number-pad"
          forceLtrInput
        />
      ) : null}

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

      <ConsentCheck
        testID="provider-terms-consent"
        checked={agreed}
        onChange={(value) => {
          setAgreed(value);
          if (value && error === t('legal.providerConsentRequired')) setError(undefined);
        }}
        sentence={t('legal.providerConsent')}
      />

      <Button
        testID="submit-application"
        label={t('provider.upgrade.submit')}
        onPress={handleSubmit}
        loading={submitting}
      />
    </Screen>
  );
}
