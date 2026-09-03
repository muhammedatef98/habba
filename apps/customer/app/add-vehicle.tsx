/**
 * Add a vehicle.
 *
 * Build prompt §9.1: "Add first vehicle in ≤3 taps (make → model → year).
 * Plate optional at first." So the plate and nickname sit below the fold and
 * the primary action is enabled as soon as the three required choices are
 * made — asking for a plate up front costs signups.
 */

import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { normalisePlate } from '@habba/core';
import { Button, Field, Screen, Text, useTheme } from '@habba/ui';
import { ChipRow } from '@/components/form/ChipRow';
import { repository } from '@/data/repository';
import { useIsAuthenticated } from '@/state/session';

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 26 }, (_, index) => CURRENT_YEAR + 1 - index);

/**
 * Above this and it is a typo, not an odometer.
 *
 * A 25-year-old taxi in the Eastern Province can genuinely show 900,000 km, so
 * the ceiling is deliberately generous — the check exists to catch a slipped
 * digit, not to argue with someone about their own car.
 */
const MAX_PLAUSIBLE_MILEAGE = 2_000_000;

export default function AddVehicleScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const isAuthenticated = useIsAuthenticated();
  const isArabic = i18n.language === 'ar';

  const [makeId, setMakeId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [plate, setPlate] = useState('');
  const [nickname, setNickname] = useState('');
  const [mileage, setMileage] = useState('');
  const [plateError, setPlateError] = useState<string | undefined>(undefined);
  const [mileageError, setMileageError] = useState<string | undefined>(undefined);

  const makes = useQuery({ queryKey: ['makes'], queryFn: () => repository.listMakes() });
  const models = useQuery({
    queryKey: ['models', makeId],
    queryFn: () => repository.listModels(makeId ?? ''),
    enabled: makeId !== null,
  });

  const addVehicle = useMutation({
    mutationFn: () =>
      repository.addVehicle({
        makeId: makeId ?? '',
        modelId: modelId ?? '',
        year: year ?? CURRENT_YEAR,
        plate: plate.length > 0 ? plate : undefined,
        nickname: nickname.length > 0 ? nickname : undefined,
        currentMileage: mileage.length > 0 ? Number(mileage) : undefined,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      router.replace('/vehicles');
    },
  });

  if (!isAuthenticated) return <Redirect href="/" />;

  function handleSubmit() {
    // Validate the plate with the same function the database uses, so the user
    // is told here rather than by a failed write (ADR-0011).
    if (plate.length > 0 && normalisePlate(plate) === null) {
      setPlateError(t('vehicle.errors.plateUnparseable'));
      return;
    }
    setPlateError(undefined);

    if (mileage.length > 0) {
      const reading = Number(mileage);
      if (!Number.isInteger(reading) || reading < 0 || reading > MAX_PLAUSIBLE_MILEAGE) {
        setMileageError(t('vehicle.errors.mileageImplausible'));
        return;
      }
    }
    setMileageError(undefined);

    addVehicle.mutate();
  }

  const canSubmit = makeId !== null && modelId !== null && year !== null;

  return (
    <Screen scrollable>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{t('vehicle.addTitle')}</Text>
        <Text variant="body" tone="muted">
          {t('vehicle.addSubtitle')}
        </Text>
      </View>

      <ChipRow
        testIdPrefix="chip"
        label={t('vehicle.makeLabel')}
        options={(makes.data ?? []).map((make) => ({
          key: make.id,
          label: isArabic ? make.nameAr : make.nameEn,
        }))}
        selected={makeId}
        onSelect={(key) => {
          setMakeId(key);
          setModelId(null);
        }}
      />

      {makeId !== null ? (
        <ChipRow
          testIdPrefix="chip"
          label={t('vehicle.modelLabel')}
          options={(models.data ?? []).map((model) => ({
            key: model.id,
            label: isArabic ? model.nameAr : model.nameEn,
          }))}
          selected={modelId}
          onSelect={setModelId}
        />
      ) : null}

      {modelId !== null ? (
        <ChipRow
          testIdPrefix="chip"
          label={t('vehicle.yearLabel')}
          options={YEARS.map((value) => ({ key: String(value), label: String(value) }))}
          selected={year === null ? null : String(year)}
          onSelect={(key) => setYear(Number(key))}
        />
      ) : null}

      {/* Optional, below the required three. */}
      <Field
        testID="plate-input"
        label={`${t('vehicle.plateLabel')} — ${t('common.optional')}`}
        value={plate}
        onChangeText={(value) => {
          setPlate(value);
          if (plateError !== undefined) setPlateError(undefined);
        }}
        hint={t('vehicle.plateHint')}
        error={plateError}
        autoCapitalize="characters"
      />

      {/*
        Optional, but the one optional field worth asking for at registration.
        Without it `currentMileage` is 0, which the home screen has to render as
        "unknown" rather than as a reading, the §7.2 predictor has no baseline
        to extrapolate from, and the first genuinely useful thing the app could
        tell this customer — that a service is due — cannot be computed at all.
      */}
      <Field
        testID="mileage-input"
        label={`${t('vehicle.mileageLabel')} — ${t('common.optional')}`}
        value={mileage}
        onChangeText={(value) => {
          // Digits only: a stray separator or unit turns into NaN at Number().
          setMileage(value.replace(/[^0-9]/g, ''));
          if (mileageError !== undefined) setMileageError(undefined);
        }}
        hint={t('vehicle.mileageHint')}
        error={mileageError}
        keyboardType="number-pad"
        maxLength={7}
        forceLtrInput
      />

      <Field
        label={`${t('vehicle.nicknameLabel')} — ${t('common.optional')}`}
        value={nickname}
        onChangeText={setNickname}
        placeholder={t('vehicle.nicknamePlaceholder')}
      />

      {/* Silence here reads as "nothing happened": the screen stays, the form
          stays filled, and the customer taps Save again. Saying so is also the
          only way they learn the car is not on file yet. */}
      {addVehicle.isError ? (
        <Text variant="caption" tone="emergency">
          {t('vehicle.errors.saveFailed')}
        </Text>
      ) : null}

      <Button
        testID="save-vehicle"
        label={t('common.save')}
        onPress={handleSubmit}
        disabled={!canSubmit}
        loading={addVehicle.isPending}
      />
    </Screen>
  );
}
