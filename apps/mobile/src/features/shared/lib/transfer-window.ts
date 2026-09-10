/**
 * How long a handover has left.
 *
 * Its own module because both halves of the flow need the same answer and must
 * not disagree: the seller reads "expires in 3 days" while the buyer reads
 * "expires in 2" is a small bug with a large consequence — one of them plans a
 * meeting around the wrong day.
 *
 * Whole days, rounded UP. `expires_at` is an instant, and a transfer with six
 * hours left has not run out; calling that "0 days" would put the screen into
 * its expired state while the code still works. The seller sees «تنتهي المهلة
 * اليوم» at 1 instead.
 */
export function daysUntil(iso: string, now: number = Date.now()): number {
  const remainingMs = new Date(iso).getTime() - now;
  if (Number.isNaN(remainingMs) || remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
}
