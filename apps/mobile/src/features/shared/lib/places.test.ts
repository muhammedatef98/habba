import { describe, expect, test } from 'vitest';
import {
  MAX_RECENT,
  distanceMetres,
  formatAddress,
  orderedPlaces,
  parsePlaces,
  rememberRecent,
  setLabelledPlace,
} from './places';

const RIYADH = { lat: 24.7136, lon: 46.6753 };
const NEARBY = { lat: 24.7138, lon: 46.6755 }; // ~30 m away
const DAMMAM = { lat: 26.4207, lon: 50.1033 };

describe('distanceMetres', () => {
  test('is about right', () => {
    expect(distanceMetres(RIYADH, NEARBY)).toBeLessThan(50);
    const km = distanceMetres(RIYADH, DAMMAM) / 1000;
    expect(km).toBeGreaterThan(380);
    expect(km).toBeLessThan(420);
  });
});

describe('rememberRecent', () => {
  test('puts the newest place first and forgets the same spot twice', () => {
    let places = rememberRecent([], RIYADH, 'الرياض');
    places = rememberRecent(places, DAMMAM, 'الدمام');
    places = rememberRecent(places, NEARBY, 'الرياض مرة أخرى');
    expect(places.map((entry) => entry.label)).toEqual(['الرياض مرة أخرى', 'الدمام']);
  });

  test('keeps only the last few', () => {
    let places = rememberRecent([], RIYADH, '0');
    for (let index = 1; index <= MAX_RECENT + 2; index++) {
      places = rememberRecent(places, { lat: 24 + index * 0.1, lon: 46 }, String(index));
    }
    expect(places).toHaveLength(MAX_RECENT);
    expect(places[0]?.label).toBe(String(MAX_RECENT + 2));
  });

  test('does not repeat home as a recent place', () => {
    const places = setLabelledPlace([], 'home', RIYADH, 'البيت');
    expect(rememberRecent(places, NEARBY, 'x')).toEqual(places);
  });
});

describe('setLabelledPlace', () => {
  test('replaces the old home and absorbs a recent duplicate', () => {
    let places = rememberRecent([], RIYADH, 'قريب');
    places = setLabelledPlace(places, 'home', DAMMAM, 'بيت قديم');
    places = setLabelledPlace(places, 'home', NEARBY, 'بيت جديد');
    expect(places).toEqual([{ kind: 'home', lat: NEARBY.lat, lon: NEARBY.lon, label: 'بيت جديد' }]);
  });
});

describe('orderedPlaces', () => {
  test('home, then work, then recent', () => {
    const places = orderedPlaces([
      { kind: 'recent', lat: 1, lon: 1, label: 'r' },
      { kind: 'work', lat: 2, lon: 2, label: 'w' },
      { kind: 'home', lat: 3, lon: 3, label: 'h' },
    ]);
    expect(places.map((entry) => entry.kind)).toEqual(['home', 'work', 'recent']);
  });
});

describe('parsePlaces', () => {
  test('reads what was written and drops what is broken', () => {
    const raw = JSON.stringify([
      { kind: 'home', lat: 24.7, lon: 46.6, label: 'البيت' },
      { kind: 'office', lat: 1, lon: 1, label: 'x' },
      { kind: 'recent', lat: 200, lon: 1, label: 'x' },
      'nonsense',
    ]);
    expect(parsePlaces(raw)).toEqual([{ kind: 'home', lat: 24.7, lon: 46.6, label: 'البيت' }]);
    expect(parsePlaces('{not json')).toEqual([]);
    expect(parsePlaces(null)).toEqual([]);
  });
});

describe('formatAddress', () => {
  test('district, street, city — without repeats or a bare number', () => {
    expect(
      formatAddress({
        name: 'طريق أنس بن مالك',
        street: 'طريق أنس بن مالك',
        district: 'حي الملقا',
        city: 'الرياض',
      }),
    ).toBe('حي الملقا، طريق أنس بن مالك، الرياض');
    expect(formatAddress({ name: '4312', district: 'حي الشاطئ', region: 'الشرقية' })).toBe(
      'حي الشاطئ، الشرقية',
    );
    expect(formatAddress({})).toBe('');
  });
});
