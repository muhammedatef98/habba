/**
 * Supabase-backed repository — the production implementation.
 *
 * Every read relies on RLS rather than filtering by owner in the query: the
 * server decides what this user can see (CLAUDE.md §2.2). A `.eq('owner_id',
 * userId)` filter here would look equivalent and would quietly become the only
 * thing standing between users if a policy were ever dropped.
 *
 * Timeline writes go through the `append_vehicle_timeline_event` RPC. There is
 * deliberately no insert path — direct INSERT is revoked at the grant level
 * (ADR-0003), so a forged entry is not constructible from a client even with a
 * stolen token.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  NewVehicleInput,
  Profile,
  TimelineEvent,
  Vehicle,
  VehicleMake,
  VehicleModel,
} from './types.js';
import type { PastServiceInput, Repository } from './repository.js';

interface VehicleRow {
  id: string;
  owner_id: string;
  make_id: string;
  model_id: string;
  year: number;
  plate_en: string | null;
  plate_ar: string | null;
  plate_normalised: string | null;
  vin: string | null;
  nickname: string | null;
  current_mileage: number;
}

interface ProfileRow {
  id: string;
  full_name: string;
  phone: string;
  preferred_locale: 'ar' | 'en';
}

interface TimelineRow {
  id: string;
  vehicle_id: string;
  event_type: TimelineEvent['eventType'];
  occurred_at: string;
  recorded_at: string;
  mileage: number | null;
  provenance: TimelineEvent['provenance'];
  summary_ar: string;
  summary_en: string;
}

function toVehicle(row: VehicleRow): Vehicle {
  return {
    id: row.id,
    ownerId: row.owner_id,
    makeId: row.make_id,
    modelId: row.model_id,
    year: row.year,
    plateEn: row.plate_en,
    plateAr: row.plate_ar,
    plateNormalised: row.plate_normalised,
    vin: row.vin,
    nickname: row.nickname,
    currentMileage: row.current_mileage,
  };
}

function toTimelineEvent(row: TimelineRow): TimelineEvent {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    mileage: row.mileage,
    provenance: row.provenance,
    summaryAr: row.summary_ar,
    summaryEn: row.summary_en,
  };
}

/**
 * Errors are thrown, never swallowed (CLAUDE.md — no silent failures).
 *
 * Returns `NonNullable<T>` rather than `T`: supabase-js types `data` as
 * `T | null`, and inference otherwise carries the null into T, so callers end
 * up re-checking something this function has already guaranteed.
 */
function unwrap<T>(
  result: { data: T | null; error: { message: string } | null },
  context: string,
): NonNullable<T> {
  if (result.error !== null) {
    throw new Error(`${context}: ${result.error.message}`);
  }
  if (result.data === null || result.data === undefined) {
    throw new Error(`${context}: no data returned`);
  }
  return result.data as NonNullable<T>;
}

export class SupabaseRepository implements Repository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly userId: () => string | null,
  ) {}

  async listMakes(): Promise<readonly VehicleMake[]> {
    const rows = unwrap(
      await this.client
        .from('vehicle_makes')
        .select('id, name_ar, name_en')
        .eq('is_active', true)
        .order('sort_order'),
      'listMakes',
    );

    return rows.map((row) => ({ id: row.id, nameAr: row.name_ar, nameEn: row.name_en }));
  }

  async listModels(makeId: string): Promise<readonly VehicleModel[]> {
    const rows = unwrap(
      await this.client
        .from('vehicle_models')
        .select('id, make_id, name_ar, name_en, year_from, year_to')
        .eq('make_id', makeId)
        .eq('is_active', true)
        .order('name_en'),
      'listModels',
    );

    return rows.map((row) => ({
      id: row.id,
      makeId: row.make_id,
      nameAr: row.name_ar,
      nameEn: row.name_en,
      yearFrom: row.year_from,
      yearTo: row.year_to,
    }));
  }

  async listVehicles(): Promise<readonly Vehicle[]> {
    // No owner filter: RLS decides. See the note at the top of this file.
    const rows = unwrap(
      await this.client
        .from('vehicles')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false }),
      'listVehicles',
    );

    return (rows as VehicleRow[]).map(toVehicle);
  }

  async getVehicle(id: string): Promise<Vehicle | null> {
    const { data, error } = await this.client
      .from('vehicles')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error !== null) throw new Error(`getVehicle: ${error.message}`);
    return data === null ? null : toVehicle(data as VehicleRow);
  }

  async addVehicle(input: NewVehicleInput): Promise<Vehicle> {
    const ownerId = this.userId();
    if (ownerId === null) throw new Error('addVehicle: not authenticated');

    const row = unwrap(
      await this.client
        .from('vehicles')
        .insert({
          owner_id: ownerId,
          make_id: input.makeId,
          model_id: input.modelId,
          year: input.year,
          // plate_normalised is a generated column — the server computes the
          // search key from this, and the client never supplies it.
          plate_en: input.plate ?? null,
          nickname: input.nickname ?? null,
          current_mileage: input.currentMileage ?? 0,
          created_by: ownerId,
        })
        .select()
        .single(),
      'addVehicle',
    );

    const vehicle = toVehicle(row as VehicleRow);

    // The registration event. Provenance is derived server-side — this call
    // cannot request a trust level (ADR-0005).
    const { error } = await this.client.rpc('append_vehicle_timeline_event', {
      p_vehicle_id: vehicle.id,
      p_event_type: 'vehicle_registered',
      p_summary_ar: 'تم تسجيل السيارة في هبّة',
      p_summary_en: 'Vehicle registered with Habba',
    });
    if (error !== null) throw new Error(`addVehicle/timeline: ${error.message}`);

    return vehicle;
  }

  async listTimeline(vehicleId: string): Promise<readonly TimelineEvent[]> {
    const rows = unwrap(
      await this.client
        .from('vehicle_timeline')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('occurred_at', { ascending: false }),
      'listTimeline',
    );

    return (rows as TimelineRow[]).map(toTimelineEvent);
  }

  async getProfile(): Promise<Profile | null> {
    const userId = this.userId();
    if (userId === null) return null;

    const { data, error } = await this.client
      .from('profiles')
      .select('id, full_name, phone, preferred_locale')
      .eq('id', userId)
      .maybeSingle();

    if (error !== null) throw new Error(`getProfile: ${error.message}`);
    if (data === null) return null;

    return {
      id: data.id,
      fullName: data.full_name,
      phone: data.phone,
      preferredLocale: data.preferred_locale,
    };
  }

  async upsertProfile(profile: Omit<Profile, 'id'>): Promise<Profile> {
    const userId = this.userId();
    if (userId === null) throw new Error('upsertProfile: not authenticated');

    // Cast because the client is untyped: without generated database types
    // supabase-js infers `never` for the returned row. `supabase gen types
    // typescript` replaces these casts once a project exists (see types.ts).
    const row = unwrap(
      await this.client
        .from('profiles')
        .upsert({
          id: userId,
          full_name: profile.fullName,
          phone: profile.phone,
          preferred_locale: profile.preferredLocale,
        })
        .select()
        .single(),
      'upsertProfile',
    ) as ProfileRow;

    return {
      id: row.id,
      fullName: row.full_name,
      phone: row.phone,
      preferredLocale: row.preferred_locale,
    };
  }

  async recordPastService(input: PastServiceInput): Promise<void> {
    // record_past_service takes no provenance parameter — the server decides,
    // and with no order attached it can only ever be self_reported or
    // self_documented (ADR-0005).
    const { error } = await this.client.rpc('record_past_service', {
      p_vehicle_id: input.vehicleId,
      p_summary_ar: input.summaryAr,
      p_occurred_at: input.occurredAt.toISOString(),
      p_mileage: input.mileage ?? null,
      p_details: input.details ?? {},
    });

    if (error !== null) throw new Error(`recordPastService: ${error.message}`);
  }

  async recordMileage(vehicleId: string, mileage: number): Promise<void> {
    const { error } = await this.client.rpc('record_mileage', {
      p_vehicle_id: vehicleId,
      p_mileage: mileage,
    });

    if (error !== null) throw new Error(`recordMileage: ${error.message}`);
  }

  async generateReport(vehicleId: string): Promise<string> {
    const { data, error } = await this.client.rpc('generate_habba_report', {
      p_vehicle_id: vehicleId,
    });

    // A broken chain surfaces here as a refusal, and the UI must say so
    // plainly rather than retrying — the logbook needs support, not another
    // attempt.
    if (error !== null) throw new Error(`generateReport: ${error.message}`);

    return data as string;
  }
}
