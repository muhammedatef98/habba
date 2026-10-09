/**
 * ورشتي — where the workshop is, and when it is open (0023, 0107).
 *
 * A workshop booking shows the workshop's address and the customer drives
 * there. Nothing in the app ever set it, so an approved workshop was listed
 * as «يأتيك إلى موقعك» or not bookable at all. This screen writes it through
 * upsert_workshop: the address as customers read it, the map point (taken
 * from where the owner stands, which at setup is the workshop), the number of
 * bays, and the opening hours — one daily window with the days off unchosen.
 */

import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toLatinDigits } from '@habba/core';
import { Button, Card, Field, Icon, Row, Screen, Skeleton, Text, useTheme } from '@habba/ui';
import {
  providerRepository,
  type WorkshopProfile,
} from '@/features/provider/data/provider-repository';
import { clampWindow, minuteLabel } from '@/features/provider/lib/availability';
import {
  WEEK_KEYS,
  hoursFromWindow,
  windowFromHours,
  type WeekKey,
} from '@/features/provider/lib/workshop-hours';
import { SectionTitle } from '@/features/provider/components/ProParts';
import { BackBar } from '@/features/shared/components/BackBar';
import { locationProvider } from '@/features/shared/lib/location';
import { useToast } from '@/features/shared/state/toast';

const STEP = 30;

export default function WorkshopScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const locale = i18n.language;

  const current = useQuery({
    queryKey: ['my-workshop'],
    queryFn: () => providerRepository.getMyWorkshop(),
  });

  const [address, setAddress] = useState('');
  const [point, setPoint] = useState<{ lat: number; lon: number } | null>(null);
  const [bays, setBays] = useState(1);
  const [days, setDays] = useState<readonly WeekKey[]>(['sat', 'sun', 'mon', 'tue', 'wed', 'thu']);
  const [hours, setHours] = useState({ startMinute: 8 * 60, endMinute: 20 * 60 });
  const [locating, setLocating] = useState(false);

  // What is saved, once, as the starting point of the form.
  useEffect(() => {
    const saved = current.data;
    if (saved === undefined || saved === null) return;
    setAddress(saved.addressAr);
    setPoint({ lat: saved.lat, lon: saved.lon });
    setBays(saved.bayCount);
    const window = windowFromHours(saved.openingHours);
    if (window !== null) {
      setDays(window.days);
      setHours({ startMinute: window.startMinute, endMinute: window.endMinute });
    }
  }, [current.data]);

  const save = useMutation({
    mutationFn: () => {
      if (point === null) throw new Error('no-point');
      const profile: WorkshopProfile = {
        addressAr: address.trim(),
        lat: point.lat,
        lon: point.lon,
        bayCount: bays,
        openingHours: hoursFromWindow(days, hours.startMinute, hours.endMinute),
      };
      return providerRepository.saveWorkshop(profile);
    },
    meta: { inlineError: true },
    onSuccess: async () => {
      showToast(t('workshop.saved'), 'success');
      await queryClient.invalidateQueries({ queryKey: ['my-workshop'] });
    },
    onError: () => showToast(t('workshop.saveFailed')),
  });

  const locate = async () => {
    setLocating(true);
    try {
      const fix = await locationProvider.getCurrentLocation();
      if (!fix.ok) {
        showToast(t('workshop.noFix'));
        return;
      }
      setPoint(fix.location);
      if (address.trim().length === 0) {
        const line = await locationProvider.describe(fix.location);
        if (line !== null) setAddress(line);
      }
    } finally {
      setLocating(false);
    }
  };

  const dayNames = useMemo(() => {
    const tag = locale.startsWith('ar') ? 'ar-u-ca-gregory-nu-latn' : locale;
    // 4 January 2026 was a Sunday; WEEK_KEYS runs Sunday first.
    return Object.fromEntries(
      WEEK_KEYS.map((key, index) => [
        key,
        new Date(Date.UTC(2026, 0, 4 + index, 12)).toLocaleDateString(tag, {
          weekday: 'short',
          timeZone: 'UTC',
        }),
      ]),
    ) as Record<WeekKey, string>;
  }, [locale]);

  const ready = address.trim().length >= 5 && point !== null && days.length > 0;

  if (current.isPending) {
    return (
      <Screen>
        <BackBar label={t('workshop.title')} />
        <Skeleton height={160} />
      </Screen>
    );
  }

  const edge = (which: 'start' | 'end') => {
    const value = which === 'start' ? hours.startMinute : hours.endMinute;
    const move = (delta: number) =>
      setHours((now) =>
        clampWindow(
          which === 'start' ? now.startMinute + delta : now.startMinute,
          which === 'end' ? now.endMinute + delta : now.endMinute,
          60,
        ),
      );
    return (
      <Row gap="sm" align="center">
        <Text variant="label" tone="muted" style={{ flex: 1 }}>
          {t(which === 'start' ? 'workshop.opens' : 'workshop.closes')}
        </Text>
        <RoundButton
          icon="minus"
          label={t('availability.earlier')}
          onPress={() => move(-STEP)}
          testID={`workshop-${which}-minus`}
        />
        <Text variant="bodyStrong" numeric style={{ minWidth: 96, textAlign: 'center' }}>
          {toLatinDigits(minuteLabel(value, locale))}
        </Text>
        <RoundButton
          icon="plus"
          label={t('availability.later')}
          onPress={() => move(STEP)}
          testID={`workshop-${which}-plus`}
        />
      </Row>
    );
  };

  return (
    <Screen scrollable style={{ gap: theme.spacing.lg }} testID="workshop-screen">
      <BackBar label={t('workshop.title')} />
      <Text variant="body" tone="muted">
        {current.data === null ? t('workshop.introNew') : t('workshop.intro')}
      </Text>

      <Card style={{ gap: theme.spacing.base }}>
        <SectionTitle title={t('workshop.whereTitle')} />
        <Field
          testID="workshop-address"
          label={t('workshop.address')}
          hint={t('workshop.addressHint')}
          value={address}
          onChangeText={setAddress}
          maxLength={200}
        />
        <Row gap="sm" align="center">
          <Icon
            name="pin"
            size={theme.iconSize.sm}
            color={point === null ? theme.colors.textSubtle : theme.colors.success}
          />
          <Text
            variant="caption"
            tone={point === null ? 'subtle' : 'success'}
            style={{ flex: 1 }}
            testID="workshop-point"
          >
            {point === null ? t('workshop.noPoint') : t('workshop.pointSet')}
          </Text>
        </Row>
        <Button
          testID="workshop-locate"
          label={t('workshop.useHere')}
          variant="secondary"
          size="medium"
          loading={locating}
          onPress={() => void locate()}
        />
      </Card>

      <Card style={{ gap: theme.spacing.base }}>
        <SectionTitle title={t('workshop.hoursTitle')} />
        <Row gap="xs" wrap>
          {WEEK_KEYS.map((key) => {
            const on = days.includes(key);
            return (
              <Pressable
                key={key}
                testID={`workshop-day-${key}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() =>
                  setDays((now) => (on ? now.filter((day) => day !== key) : [...now, key]))
                }
                style={({ pressed }) => ({
                  minWidth: 56,
                  paddingVertical: theme.spacing.sm,
                  paddingHorizontal: theme.spacing.xs,
                  alignItems: 'center',
                  borderRadius: theme.radius.md,
                  borderWidth: 1,
                  borderColor: on ? theme.colors.primary : theme.colors.border,
                  backgroundColor: on ? theme.colors.primary : theme.colors.surface,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text variant="caption" tone={on ? 'inverse' : 'muted'}>
                  {dayNames[key]}
                </Text>
              </Pressable>
            );
          })}
        </Row>
        <View style={{ gap: theme.spacing.sm }}>
          {edge('start')}
          {edge('end')}
        </View>
        <Row gap="sm" align="center">
          <Text variant="label" tone="muted" style={{ flex: 1 }}>
            {t('workshop.bays')}
          </Text>
          <RoundButton
            icon="minus"
            label={t('workshop.fewerBays')}
            onPress={() => setBays((now) => Math.max(1, now - 1))}
            testID="workshop-bays-minus"
          />
          <Text variant="bodyStrong" numeric style={{ minWidth: 48, textAlign: 'center' }}>
            {toLatinDigits(String(bays))}
          </Text>
          <RoundButton
            icon="plus"
            label={t('workshop.moreBays')}
            onPress={() => setBays((now) => Math.min(50, now + 1))}
            testID="workshop-bays-plus"
          />
        </Row>
      </Card>

      <Button
        testID="workshop-save"
        label={t('workshop.save')}
        loading={save.isPending}
        disabled={!ready}
        onPress={() => save.mutate()}
      />
      {!ready ? (
        <Text variant="caption" tone="subtle" style={{ textAlign: 'center' }}>
          {t('workshop.incomplete')}
        </Text>
      ) : null}
    </Screen>
  );
}

function RoundButton({
  icon,
  label,
  onPress,
  testID,
}: {
  readonly icon: 'plus' | 'minus';
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: theme.radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceSunken,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name={icon} size={theme.iconSize.sm} color={theme.colors.text} />
    </Pressable>
  );
}
