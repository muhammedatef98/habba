/**
 * How a vehicle is named in the UI.
 *
 * Centralised because the fallback chain is the whole point: a vehicle that has
 * no nickname and no plate yet still has to read as a car. Screens that ended
 * at `vehicle.id` showed the customer a database row id ("veh-1"), which is
 * both meaningless and, on the emergency flow, actively confusing — it is the
 * one screen where they need to be certain which car they are calling help for.
 */

import type { Vehicle, VehicleMake, VehicleModel } from '@/features/shared/data/types';

export interface VehicleLabelSources {
  readonly makes: readonly VehicleMake[] | undefined;
  readonly models: readonly VehicleModel[] | undefined;
  readonly isArabic: boolean;
}

/** "تويوتا كامري" — make and model in the active locale, blank if unknown. */
export function describeVehicleModel(
  vehicle: Vehicle,
  { makes, models, isArabic }: VehicleLabelSources,
): string {
  const make = makes?.find((candidate) => candidate.id === vehicle.makeId);
  const model = models?.find((candidate) => candidate.id === vehicle.modelId);
  const makeName = isArabic ? make?.nameAr : make?.nameEn;
  const modelName = isArabic ? model?.nameAr : model?.nameEn;
  return [makeName, modelName].filter(Boolean).join(' ');
}

/**
 * The best available name, in the order a customer would recognise it:
 * their own nickname, then the plate, then make and model, and only as a last
 * resort the id — which means the catalogue has not loaded yet, not that the
 * car is nameless.
 */
export function vehicleLabel(vehicle: Vehicle, sources: VehicleLabelSources): string {
  if (vehicle.nickname !== null && vehicle.nickname.trim().length > 0) return vehicle.nickname;

  const plate = sources.isArabic
    ? (vehicle.plateAr ?? vehicle.plateEn)
    : (vehicle.plateEn ?? vehicle.plateAr);
  if (plate !== null && plate !== undefined && plate.trim().length > 0) return plate;

  const described = describeVehicleModel(vehicle, sources);
  return described.length > 0 ? `${described} · ${vehicle.year}` : vehicle.id;
}
