/**
 * The in-flight emergency request, while the customer is still building it.
 *
 * §3 restricts Zustand to UI state, and this qualifies: nothing here exists
 * server-side until `createEmergencyOrder` is called on the final screen. The
 * draft spans three routes (service → location → optional triage), so it
 * cannot live in one screen's `useState`, and putting it in route params would
 * put a location in a URL.
 *
 * Cleared on submit and on abandon — a stale service selection surviving into
 * a later, unrelated emergency would be worse than starting over.
 */

import { create } from 'zustand';
import type { DeviceLocation } from '@/lib/location-provider';
import type { Service } from '@/data/types';

/** Where the vehicle is standing. Changes what the technician brings. */
export type PlaceKind = 'roadside' | 'parking';

interface EmergencyDraftState {
  readonly service: Service | null;
  readonly vehicleId: string | null;
  readonly location: DeviceLocation | null;
  readonly addressAr: string;
  readonly placeKind: PlaceKind;
  readonly problem: string;

  selectService: (service: Service) => void;
  selectVehicle: (vehicleId: string) => void;
  setLocation: (location: DeviceLocation) => void;
  setAddress: (addressAr: string) => void;
  setPlaceKind: (placeKind: PlaceKind) => void;
  setProblem: (problem: string) => void;
  reset: () => void;
}

const EMPTY = {
  service: null,
  vehicleId: null,
  location: null,
  addressAr: '',
  placeKind: 'roadside' as PlaceKind,
  problem: '',
};

export const useEmergencyDraft = create<EmergencyDraftState>((set) => ({
  ...EMPTY,

  selectService: (service) => set({ service }),
  selectVehicle: (vehicleId) => set({ vehicleId }),
  setLocation: (location) => set({ location }),
  setAddress: (addressAr) => set({ addressAr }),
  setPlaceKind: (placeKind) => set({ placeKind }),
  setProblem: (problem) => set({ problem }),
  reset: () => set(EMPTY),
}));
