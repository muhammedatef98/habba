/**
 * The card form, as a request waiting for an answer.
 *
 * Payment starts deep in the data layer (MoyasarPaymentProvider.authorise),
 * which cannot render anything. It asks here instead: `open` shows the form
 * that <CardFormHost> mounts at the root, and resolves when the customer pays
 * or gives up. One at a time — a second request while one is open cancels
 * the first rather than stacking two card forms.
 */

import { create } from 'zustand';
import type {
  CardPaymentRequest,
  CardPaymentResult,
} from '@/features/shared/lib/moyasar-card-form';

interface CardFormState {
  readonly request: CardPaymentRequest | null;
  readonly open: (request: CardPaymentRequest) => Promise<CardPaymentResult>;
  readonly finish: (result: CardPaymentResult) => void;
}

let settle: ((result: CardPaymentResult) => void) | null = null;

export const useCardForm = create<CardFormState>((set) => ({
  request: null,
  open: (request) =>
    new Promise<CardPaymentResult>((resolve) => {
      settle?.({ status: 'cancelled' });
      settle = resolve;
      set({ request });
    }),
  finish: (result) => {
    const done = settle;
    settle = null;
    set({ request: null });
    done?.(result);
  },
}));
