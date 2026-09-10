/**
 * The handover, against the in-memory repository.
 *
 * These are the client-side halves of what tests/32 proves in SQL. They cannot
 * prove the security properties — the dev repository has one account, and RLS
 * is the thing being stood in for — so they deliberately assert only what the
 * screens depend on and what a stub could get wrong in a way that would teach
 * the UI a rule production does not have.
 */

import { beforeEach, describe, expect, test } from 'vitest';
import { InMemoryRepository } from './repository.js';

const MAKE = 'make-toyota';
const MODEL = 'model-camry';

async function repoWithCar() {
  const repo = new InMemoryRepository();
  await repo.upsertProfile({
    fullName: 'مالك',
    phone: '+966501234567',
    email: null,
    isGuest: false,
    preferredLocale: 'ar',
  });
  const vehicle = await repo.addVehicle({
    makeId: MAKE,
    modelId: MODEL,
    year: 2021,
    plate: 'ABJ 1234',
  });
  return { repo, vehicleId: vehicle.id };
}

describe('ownership transfer', () => {
  let repo: InMemoryRepository;
  let vehicleId: string;

  beforeEach(async () => {
    ({ repo, vehicleId } = await repoWithCar());
  });

  test('the code is minted here and is never readable again', async () => {
    const minted = await repo.initiateTransfer({ vehicleId, phone: '+966505550000' });

    expect(minted.code).toMatch(/^\d{6}$/);

    // The whole property 0054 exists to establish: the row a client can read
    // carries no route back to the code. A dev repository that put the code on
    // the transfer would let a screen be written against a lookup production
    // refuses — which is how the last three of these gaps happened.
    const outgoing = await repo.getOutgoingTransfer(vehicleId);
    expect(outgoing).not.toBeNull();
    expect(JSON.stringify(outgoing)).not.toContain(minted.code);
  });

  test('a car can only have one live transfer', async () => {
    await repo.initiateTransfer({ vehicleId, phone: '+966505550000' });

    await expect(repo.initiateTransfer({ vehicleId, phone: '+966505550001' })).rejects.toThrow(
      /already pending/,
    );
  });

  test('addressing needs exactly one of a phone and an email', async () => {
    await expect(repo.initiateTransfer({ vehicleId })).rejects.toThrow(/exactly one/);
    await expect(
      repo.initiateTransfer({ vehicleId, phone: '+966505550000', email: 'a@b.co' }),
    ).rejects.toThrow(/exactly one/);
  });

  test('cancelling frees the car, and the new transfer gets a new code', async () => {
    const first = await repo.initiateTransfer({ vehicleId, phone: '+966505550000' });
    await repo.cancelTransfer(first.id);

    expect(await repo.getOutgoingTransfer(vehicleId)).toBeNull();

    const second = await repo.initiateTransfer({ vehicleId, phone: '+966505550000' });
    expect(second.id).not.toBe(first.id);

    // The old code must be dead, or cancelling is decoration.
    await expect(repo.acceptTransfer(second.id, first.code)).rejects.toThrow(/Incorrect code/);
  });

  test('a wrong code is refused and leaves the transfer open', async () => {
    const minted = await repo.initiateTransfer({ vehicleId, phone: '+966505550000' });

    await expect(repo.acceptTransfer(minted.id, '000000')).rejects.toThrow(/Incorrect code/);
    expect(await repo.getOutgoingTransfer(vehicleId)).not.toBeNull();
  });

  test('accepting writes the handover into the logbook and cannot be replayed', async () => {
    const minted = await repo.initiateTransfer({ vehicleId, phone: '+966505550000' });

    await expect(repo.acceptTransfer(minted.id, minted.code)).resolves.toBe(vehicleId);

    const timeline = await repo.listTimeline(vehicleId);
    expect(timeline.filter((event) => event.eventType === 'ownership_transferred')).toHaveLength(1);
    // The moat: the history did not reset.
    expect(timeline.length).toBeGreaterThan(1);

    await expect(repo.acceptTransfer(minted.id, minted.code)).rejects.toThrow(/not found/);
  });

  test('the recipient preview carries the logbook, not just a vehicle id', async () => {
    await repo.initiateTransfer({ vehicleId, phone: '+966505550000' });

    const incoming = await repo.getIncomingTransfer();

    expect(incoming).not.toBeNull();
    expect(incoming?.recordsTotal).toBeGreaterThan(0);
    expect(incoming?.plate).not.toBeNull();
  });

  test('there are no invented warranties', async () => {
    // The dev order simulator carries no warranty windows, so «ساري» here
    // would be cover that does not exist — the exact lie ADR-0021 stops the
    // report telling.
    expect(await repo.listVehicleWarranties(vehicleId)).toEqual([]);
  });
});
