/**
 * The appointment being put together, across the three booking screens.
 *
 * Same argument as the emergency draft: §3 restricts Zustand to UI state, and
 * nothing here exists server-side until `bookAppointment` claims a slot on the
 * last screen. The draft spans three routes, so it cannot live in one screen's
 * `useState`, and a slot id in a route param would survive a back-navigation
 * into a slot that has since been taken.
 *
 * Choosing a service clears everything downstream of it. A provider who does
 * oil changes is not necessarily the provider you want for a brake job, and
 * silently carrying the old selection forward is how someone ends up booked
 * with a workshop they never chose.
 */

import { create } from 'zustand';
import type { AppointmentSlot, BookingMode, BookingProvider, Service } from '@/data/types';

interface BookingDraftState {
  readonly service: Service | null;
  readonly vehicleId: string | null;
  readonly mode: BookingMode | null;
  readonly provider: BookingProvider | null;
  readonly slot: AppointmentSlot | null;
  readonly problem: string;

  selectService: (service: Service) => void;
  selectVehicle: (vehicleId: string) => void;
  selectMode: (mode: BookingMode) => void;
  selectProvider: (provider: BookingProvider) => void;
  selectSlot: (slot: AppointmentSlot | null) => void;
  setProblem: (problem: string) => void;
  reset: () => void;
}

const EMPTY = {
  service: null,
  vehicleId: null,
  mode: null,
  provider: null,
  slot: null,
  problem: '',
};

export const useBookingDraft = create<BookingDraftState>((set) => ({
  ...EMPTY,

  selectService: (service) =>
    set((state) =>
      state.service?.id === service.id
        ? { service }
        : // A different service invalidates the mode, the provider and the slot.
          { service, mode: null, provider: null, slot: null },
    ),
  selectVehicle: (vehicleId) => set({ vehicleId }),
  selectMode: (mode) =>
    set((state) => (state.mode === mode ? { mode } : { mode, provider: null, slot: null })),
  selectProvider: (provider) =>
    set((state) => (state.provider?.id === provider.id ? { provider } : { provider, slot: null })),
  selectSlot: (slot) => set({ slot }),
  setProblem: (problem) => set({ problem }),
  reset: () => set(EMPTY),
}));
