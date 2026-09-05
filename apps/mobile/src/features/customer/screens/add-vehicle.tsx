/**
 * Add a vehicle.
 *
 * Build prompt §9.1: "Add first vehicle in ≤3 taps (make → model → year).
 * Plate optional at first." So the plate and nickname sit below the fold and
 * the primary action is enabled as soon as the three required choices are
 * made — asking for a plate up front costs signups.
 */

import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { normalisePlate } from '@habba/core';
import { Button, Field, Screen, Text, useTheme } from '@habba/ui';
import { repository } from '@/features/shared/data/repository';
import { useIsAuthenticated } from '@/features/shared/state/session';

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 26 }, (_, index) => CURRENT_YEAR + 1 - index);

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
  const [plateError, setPlateError] = useState<string | undefined>(undefined);

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

      <Field
        label={`${t('vehicle.nicknameLabel')} — ${t('common.optional')}`}
        value={nickname}
        onChangeText={setNickname}
        placeholder={t('vehicle.nicknamePlaceholder')}
      />

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

interface ChipRowProps {
  readonly label: string;
  readonly options: ReadonlyArray<{ key: string; label: string }>;
  readonly selected: string | null;
  readonly onSelect: (key: string) => void;
}

function ChipRow({ label, options, selected, onSelect }: ChipRowProps) {
  const theme = useTheme();

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: theme.spacing.sm, paddingVertical: theme.spacing.xs }}
      >
        {options.map((option) => {
          const isSelected = option.key === selected;
          return (
            <Pressable
              key={option.key}
              testID={`chip-${option.key}`}
              onPress={() => onSelect(option.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={option.label}
              style={{
                minHeight: theme.minTouchTarget,
                justifyContent: 'center',
                paddingHorizontal: theme.spacing.base,
                borderRadius: theme.radius.full,
                borderWidth: 1.5,
                borderColor: isSelected ? theme.colors.primary : theme.colors.border,
                backgroundColor: isSelected ? theme.colors.primarySubtle : theme.colors.surface,
              }}
            >
              <Text
                variant={isSelected ? 'bodyStrong' : 'body'}
                style={{ color: isSelected ? theme.colors.primary : theme.colors.text }}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
