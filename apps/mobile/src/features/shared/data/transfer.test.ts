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

    // Refused exactly the way a wrong code is. The server has one return path
    // for every refusal a caller must not be able to tell apart (0056), so a
    // stub that still said "not found" here would let a screen branch on a
    // distinction production does not make.
    await expect(repo.acceptTransfer(minted.id, minted.code)).rejects.toThrow(/Incorrect code/);
  });

  test('five wrong codes lock the transfer, and the right one no longer opens it', async () => {
    const minted = await repo.initiateTransfer({ vehicleId, phone: '+966505550000' });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(repo.acceptTransfer(minted.id, '000000')).rejects.toThrow(/Incorrect code/);
    }

    // The assertion the lock exists for: a lock the right answer opens is a
    // delay, not a lock.
    await expect(repo.acceptTransfer(minted.id, minted.code)).rejects.toThrow(/Incorrect code/);

    const timeline = await repo.listTimeline(vehicleId);
    expect(timeline.filter((event) => event.eventType === 'ownership_transferred')).toHaveLength(0);
  });

  test('the lock is visible to both sides, while the refusal stays undifferentiated', async () => {
    const minted = await repo.initiateTransfer({ vehicleId, phone: '+966505550000' });

    expect((await repo.getOutgoingTransfer(vehicleId))?.attemptsExhausted).toBe(false);
    expect((await repo.getIncomingTransfer())?.attemptsExhausted).toBe(false);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(repo.acceptTransfer(minted.id, '000000')).rejects.toThrow(/Incorrect code/);
    }

    // The dead end 0057 closes: the row is still `pending`, so without this the
    // seller's screen goes on saying "waiting for the buyer" over a code that
    // has stopped working, and the buyer goes on being told they typed it wrong.
    expect((await repo.getOutgoingTransfer(vehicleId))?.attemptsExhausted).toBe(true);
    expect((await repo.getIncomingTransfer())?.attemptsExhausted).toBe(true);

    // And the thing that must NOT have changed. The reads are gated on being
    // able to see the row at all; `acceptTransfer` is not, so it stays the same
    // one answer for every refusal.
    await expect(repo.acceptTransfer(minted.id, minted.code)).rejects.toThrow(/Incorrect code/);
  });

  test('re-issuing is one act: the old code dies and a new one works', async () => {
    const locked = await repo.initiateTransfer({ vehicleId, phone: '+966505550000' });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(repo.acceptTransfer(locked.id, '000000')).rejects.toThrow(/Incorrect code/);
    }

    const fresh = await repo.reissueTransfer(locked.id);

    expect(fresh.id).not.toBe(locked.id);
    expect(fresh.code).not.toBe(locked.code);

    // Carried from the row rather than re-typed: re-typing the address is how a
    // buyer who is already waiting gets addressed to a typo.
    const outgoing = await repo.getOutgoingTransfer(vehicleId);
    expect(outgoing?.id).toBe(fresh.id);
    expect(outgoing?.toPhone).toBe('+966505550000');
    expect(outgoing?.attemptsExhausted).toBe(false);

    await expect(repo.acceptTransfer(locked.id, locked.code)).rejects.toThrow(/Incorrect code/);
    await expect(repo.acceptTransfer(fresh.id, fresh.code)).resolves.toBe(vehicleId);
  });

  test('there is nothing to re-issue on a transfer that is not pending', async () => {
    const minted = await repo.initiateTransfer({ vehicleId, phone: '+966505550000' });
    await repo.cancelTransfer(minted.id);

    await expect(repo.reissueTransfer(minted.id)).rejects.toThrow(/no longer pending/);
  });

  test('cancelling and re-issuing is the remedy for a locked transfer', async () => {
    const locked = await repo.initiateTransfer({ vehicleId, phone: '+966505550000' });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(repo.acceptTransfer(locked.id, '000000')).rejects.toThrow(/Incorrect code/);
    }

    // A locked row is still `pending`, so it still occupies the car's one slot
    // and the seller cannot simply issue a second one around it.
    await expect(repo.initiateTransfer({ vehicleId, phone: '+966505550000' })).rejects.toThrow(
      /already pending/,
    );

    await repo.cancelTransfer(locked.id);
    const fresh = await repo.initiateTransfer({ vehicleId, phone: '+966505550000' });

    // A new row, a new code, and its own count starting at zero.
    await expect(repo.acceptTransfer(fresh.id, fresh.code)).resolves.toBe(vehicleId);
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
