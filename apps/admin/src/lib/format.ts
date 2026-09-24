/**
 * How the console writes numbers, money, dates and phones.
 *
 * Latin digits throughout (`nu-latn`): the console is columns of figures that
 * operators read aloud to customers and compare against bank statements, and
 * those are written in Latin digits. Riyadh time always, whatever the
 * operator's machine is set to — an order's time is the customer's time.
 */

const TIME_ZONE = 'Asia/Riyadh';

export function money(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  const value = Number(amount);
  return `${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ر.س`;
}

export function count(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return Number(value).toLocaleString('en-US');
}

export function dateTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return '—';
  return new Date(iso).toLocaleString('ar-SA-u-nu-latn-ca-gregory', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function date(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return '—';
  return new Date(iso).toLocaleDateString('ar-SA-u-nu-latn-ca-gregory', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** The Hijri date beside the Gregorian (CLAUDE.md §5), Umm al-Qura as used in the Kingdom. */
export function hijri(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return '';
  return new Date(iso).toLocaleDateString('ar-SA-u-nu-latn-ca-islamic-umalqura', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** Today in Riyadh, as the YYYY-MM-DD a date filter takes. */
export function riyadhToday(offsetDays = 0): string {
  const shifted = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(shifted);
  return parts;
}

/**
 * +966501234567 → 050 123 4567, the way it is said on the phone.
 *
 * Wrapped in a left-to-right isolate: inside Arabic text the three digit
 * groups would otherwise be laid out right to left, and the number read back
 * to a customer would be in the wrong order.
 */
export function phone(e164: string | null | undefined): string {
  if (e164 === null || e164 === undefined || e164 === '') return '—';
  const match = /^\+966(5\d)(\d{3})(\d{4})$/.exec(e164);
  if (match === null) return `\u2066${e164}\u2069`;
  return `\u20660${match[1]} ${match[2]} ${match[3]}\u2069`;
}

/** "12 دقيقة" — how long ago, in the unit an operator thinks in. */
export function since(iso: string | null | undefined, from: number = Date.now()): string {
  if (iso === null || iso === undefined) return '—';
  const minutes = Math.max(0, Math.round((from - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} ساعة`;
  return `${Math.floor(hours / 24)} يوم`;
}
