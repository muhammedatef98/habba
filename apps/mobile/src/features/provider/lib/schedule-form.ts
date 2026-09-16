/**
 * The publishing form's rules, as data rather than as JSX.
 *
 * Every bound here is also enforced by `generate_slots` (0072), and the
 * duplication is deliberate: the server's copy is the control, this one is the
 * courtesy. A workshop that types a working day ending before it starts should
 * be told at the keyboard, not by a `check_violation` it cannot read — and a
 * screen that only validated on the device would still be refused, which is
 * the property that makes duplicating it safe.
 *
 * Pure and separate from the screen because it is the only part of this
 * feature that can be unit-tested in this repo (no React Native test renderer
 * — see provider-access.test.ts), and the arithmetic worth testing is here:
 * "a four-hour day cannot hold a five-hour appointment" is easy to get wrong
 * and invisible until a workshop presses publish and is told it created
 * nothing.
 */

/** Matching 0072's own guards, so a valid form is never refused by the server. */
export const SLOT_FORM_LIMITS = {
  days: { min: 1, max: 14 },
  hour: { min: 0, max: 24 },
  slotMinutes: { min: 15, max: 480 },
  capacity: { min: 1, max: 20 },
} as const;

export const SLOT_FORM_DEFAULTS = {
  days: '7',
  startHour: '8',
  endHour: '20',
  slotMinutes: '60',
  capacity: '1',
} as const;

export interface SlotFormValues {
  readonly days: string;
  readonly startHour: string;
  readonly endHour: string;
  readonly slotMinutes: string;
  readonly capacity: string;
}

/**
 * i18n keys, not sentences. The library carries no copy for the same reason
 * @habba/ui does not: a translation function here would give this module a
 * locale, which is the app's concern (§2.1).
 */
export type SlotFormError =
  | 'schedule.errors.days'
  | 'schedule.errors.hours'
  | 'schedule.errors.tooShort'
  | 'schedule.errors.slotMinutes'
  | 'schedule.errors.capacity';

export interface SlotFormValidation {
  readonly ok: boolean;
  readonly days: SlotFormError | undefined;
  readonly hours: SlotFormError | undefined;
  readonly slotMinutes: SlotFormError | undefined;
  readonly capacity: SlotFormError | undefined;
}

function inRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function validateSlotForm(values: SlotFormValues): SlotFormValidation {
  const days = Number(values.days);
  const startHour = Number(values.startHour);
  const endHour = Number(values.endHour);
  const slotMinutes = Number(values.slotMinutes);
  const capacity = Number(values.capacity);

  const daysBad = !inRange(days, SLOT_FORM_LIMITS.days.min, SLOT_FORM_LIMITS.days.max);
  const hoursBad =
    !inRange(startHour, SLOT_FORM_LIMITS.hour.min, SLOT_FORM_LIMITS.hour.max) ||
    !inRange(endHour, SLOT_FORM_LIMITS.hour.min, SLOT_FORM_LIMITS.hour.max) ||
    startHour >= endHour;
  const minutesBad = !inRange(
    slotMinutes,
    SLOT_FORM_LIMITS.slotMinutes.min,
    SLOT_FORM_LIMITS.slotMinutes.max,
  );
  const capacityBad = !inRange(
    capacity,
    SLOT_FORM_LIMITS.capacity.min,
    SLOT_FORM_LIMITS.capacity.max,
  );

  // ⚠️ A working day shorter than one appointment publishes nothing at all.
  //
  // 0072 accepts it and returns 0, which is honest but useless: "it worked,
  // and created nothing" is the least actionable thing this screen could say.
  // Caught here so the workshop is told which of the two numbers to change.
  const tooShort = !hoursBad && !minutesBad && (endHour - startHour) * 60 < slotMinutes;

  return {
    ok: !daysBad && !hoursBad && !minutesBad && !capacityBad && !tooShort,
    days: daysBad ? 'schedule.errors.days' : undefined,
    hours: hoursBad ? 'schedule.errors.hours' : tooShort ? 'schedule.errors.tooShort' : undefined,
    slotMinutes: minutesBad ? 'schedule.errors.slotMinutes' : undefined,
    capacity: capacityBad ? 'schedule.errors.capacity' : undefined,
  };
}
