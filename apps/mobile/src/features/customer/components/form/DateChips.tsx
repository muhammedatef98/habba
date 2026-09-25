/**
 * A past date, picked rather than typed.
 *
 * The manual service entry asked for «2025-05-14» in a text field: a format
 * nobody writes a date in, typed on a phone keyboard that hides the dash, for
 * an answer most people only know as "last spring". Three chip rows — year,
 * month, day — are the same control the car's year already uses (ChipRow),
 * and every combination they can produce is a real date. Days past the end
 * of the chosen month are not offered.
 *
 * Emits `YYYY-MM-DD`, the format the screen already validates and the server
 * takes; the future is refused there, with a message, as before. It opens with
 * nothing chosen and emits `''` until all three are: opened on today, the
 * chosen month and day sat scrolled out of sight, so the owner could not see
 * what the form was about to save.
 */

import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@habba/ui';
import { toLatinDigits } from '@habba/core';
import { ChipRow } from './ChipRow';

export interface DateChipsProps {
  /** `YYYY-MM-DD`. */
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** How many years back the year row reaches. */
  readonly years?: number;
  readonly testIdPrefix?: string;
}

interface Picked {
  readonly year: number | null;
  readonly month: number | null;
  readonly day: number | null;
}

function parts(value: string): Picked {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match === null
    ? { year: null, month: null, day: null }
    : { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${`${month}`.padStart(2, '0')}-${`${day}`.padStart(2, '0')}`;
}

export function DateChips({ value, onChange, years = 15, testIdPrefix = 'date' }: DateChipsProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const tag = i18n.language.startsWith('ar') ? 'ar-u-nu-latn' : i18n.language;
  const [picked, setPicked] = useState<Picked>(() => parts(value));
  const thisYear = new Date().getFullYear();

  // Keeps the day when the month changes, unless the new month is shorter.
  const set = (next: Picked) => {
    const day =
      next.day !== null && next.year !== null && next.month !== null
        ? Math.min(next.day, daysIn(next.year, next.month))
        : next.day;
    const settled = { ...next, day };
    setPicked(settled);
    onChange(
      settled.year !== null && settled.month !== null && settled.day !== null
        ? iso(settled.year, settled.month, settled.day)
        : '',
    );
  };
  const dayCount =
    picked.year !== null && picked.month !== null ? daysIn(picked.year, picked.month) : 31;

  const monthName = (month: number) =>
    toLatinDigits(
      new Date(Date.UTC(2000, month - 1, 15)).toLocaleDateString(tag, { month: 'long' }),
    );

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <ChipRow
        label={t('logbook.dateYear')}
        testIdPrefix={`${testIdPrefix}-year`}
        options={Array.from({ length: years }, (_, index) => {
          const year = thisYear - index;
          return { key: String(year), label: String(year) };
        })}
        selected={picked.year === null ? null : String(picked.year)}
        onSelect={(key) => set({ ...picked, year: Number(key) })}
      />
      <ChipRow
        label={t('logbook.dateMonth')}
        testIdPrefix={`${testIdPrefix}-month`}
        options={Array.from({ length: 12 }, (_, index) => ({
          key: String(index + 1),
          label: monthName(index + 1),
        }))}
        selected={picked.month === null ? null : String(picked.month)}
        onSelect={(key) => set({ ...picked, month: Number(key) })}
      />
      <ChipRow
        label={t('logbook.dateDay')}
        testIdPrefix={`${testIdPrefix}-day`}
        options={Array.from({ length: dayCount }, (_, index) => ({
          key: String(index + 1),
          label: String(index + 1),
        }))}
        selected={picked.day === null ? null : String(picked.day)}
        onSelect={(key) => set({ ...picked, day: Number(key) })}
      />
    </View>
  );
}
