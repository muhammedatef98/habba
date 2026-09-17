import { describe, expect, it } from 'vitest';
import {
  advanceToastQueue,
  clearToastQueue,
  emptyToastQueue,
  enqueueToast,
  MAX_PENDING_TOASTS,
  TOAST_DURATION_MS,
  type ToastItem,
  type ToastTone,
} from './toast-queue.js';

let counter = 0;
function toast(message: string, tone: ToastTone = 'success'): ToastItem {
  counter += 1;
  return { id: `t${counter}`, message, tone, durationMs: TOAST_DURATION_MS[tone] };
}

describe('enqueueToast', () => {
  it('shows the first one immediately', () => {
    const state = enqueueToast(emptyToastQueue, toast('تم الحفظ'));

    expect(state.current?.message).toBe('تم الحفظ');
    expect(state.pending).toEqual([]);
  });

  it('queues the second rather than stacking it', () => {
    const first = enqueueToast(emptyToastQueue, toast('تم الحفظ'));
    const second = enqueueToast(first, toast('تم التحديث'));

    expect(second.current?.message).toBe('تم الحفظ');
    expect(second.pending.map((item) => item.message)).toEqual(['تم التحديث']);
  });

  it('restarts rather than repeats a message already on screen', () => {
    // Double-tapping "save" must not mean reading the same sentence twice.
    const first = enqueueToast(emptyToastQueue, toast('تم الحفظ'));
    const again = toast('تم الحفظ');
    const second = enqueueToast(first, again);

    expect(second.pending).toEqual([]);
    // A new id is how the view knows to reset its dismiss timer.
    expect(second.current?.id).toBe(again.id);
    expect(second.current?.id).not.toBe(first.current?.id);
  });

  it('collapses a duplicate that is already waiting', () => {
    let state = enqueueToast(emptyToastQueue, toast('على الشاشة'));
    state = enqueueToast(state, toast('في الانتظار'));
    state = enqueueToast(state, toast('في الانتظار'));

    expect(state.pending.map((item) => item.message)).toEqual(['في الانتظار']);
  });

  it('sends an error to the front of the queue', () => {
    let state = enqueueToast(emptyToastQueue, toast('تم الحفظ'));
    state = enqueueToast(state, toast('تم التحديث'));
    state = enqueueToast(state, toast('تعذّر الحفظ', 'error'));

    // The failure does not wait behind a confirmation.
    expect(state.pending.map((item) => item.message)).toEqual(['تعذّر الحفظ', 'تم التحديث']);
  });

  it('never leaves the one on screen for an error', () => {
    // Interrupting the queue is allowed; yanking a message out from under
    // someone mid-read is not.
    const state = enqueueToast(
      enqueueToast(emptyToastQueue, toast('تم الحفظ')),
      toast('تعذّر الحفظ', 'error'),
    );

    expect(state.current?.message).toBe('تم الحفظ');
  });

  it('caps the queue, dropping the stalest', () => {
    let state = enqueueToast(emptyToastQueue, toast('على الشاشة'));
    for (let index = 0; index < MAX_PENDING_TOASTS + 3; index += 1) {
      state = enqueueToast(state, toast(`رسالة ${index}`));
    }

    expect(state.pending).toHaveLength(MAX_PENDING_TOASTS);
    expect(state.pending.map((item) => item.message)).toEqual(['رسالة 0', 'رسالة 1']);
  });
});

describe('advanceToastQueue', () => {
  it('promotes the next one', () => {
    let state = enqueueToast(emptyToastQueue, toast('الأولى'));
    state = enqueueToast(state, toast('الثانية'));

    const advanced = advanceToastQueue(state);

    expect(advanced.current?.message).toBe('الثانية');
    expect(advanced.pending).toEqual([]);
  });

  it('empties out when nothing is waiting', () => {
    const state = enqueueToast(emptyToastQueue, toast('الوحيدة'));

    expect(advanceToastQueue(state)).toEqual(emptyToastQueue);
  });

  it('is safe on an already-empty queue', () => {
    expect(advanceToastQueue(emptyToastQueue)).toEqual(emptyToastQueue);
  });
});

describe('durations', () => {
  it('gives an error longer than a confirmation', () => {
    // Arabic error copy here is a sentence, and a sentence at 2.6s is a
    // sentence half-read.
    expect(TOAST_DURATION_MS.error).toBeGreaterThan(TOAST_DURATION_MS.info);
    expect(TOAST_DURATION_MS.info).toBeGreaterThan(TOAST_DURATION_MS.success);
  });
});

describe('clearToastQueue', () => {
  it('drops everything, current and pending alike', () => {
    const state = enqueueToast(enqueueToast(emptyToastQueue, toast('الأولى')), toast('الثانية'));
    expect(state.current).not.toBeNull();
    expect(state.pending).toHaveLength(1);

    expect(clearToastQueue()).toEqual(emptyToastQueue);
  });
});
