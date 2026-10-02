import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateQiblaBearing,
  calculateDistanceToKaaba,
  getCompassDirection,
  KAABA_COORDS,
  DEFAULT_OBSERVER,
} from '../../src/lib/qibla.ts';

describe('Qibla & Geodesic Calculation Engine', () => {
  it('calculates correct Qibla forward azimuth for Tashkent (Uzbekistan)', () => {
    const bearing = calculateQiblaBearing(DEFAULT_OBSERVER.lat, DEFAULT_OBSERVER.lng);
    // Tashkent Great-Circle forward azimuth is ~240.3° (West-South-West)
    assert.ok(bearing >= 239.5 && bearing <= 241.5, `Expected bearing around 240.3°, got ${bearing}`);
    const direction = getCompassDirection(bearing);
    assert.equal(direction, 'WSW');
  });

  it('calculates correct Qibla bearing for London (UK)', () => {
    const bearing = calculateQiblaBearing(51.5074, -0.1278);
    // London Qibla bearing is ~118.9° (East-South-East)
    assert.ok(bearing >= 118 && bearing <= 120, `Expected bearing around 118.9°, got ${bearing}`);
    const direction = getCompassDirection(bearing);
    assert.equal(direction, 'ESE');
  });

  it('calculates correct Qibla bearing for New York (USA)', () => {
    const bearing = calculateQiblaBearing(40.7128, -74.006);
    // New York Great-Circle Qibla bearing is ~58.5° (East-North-East)
    assert.ok(bearing >= 57 && bearing <= 60, `Expected bearing around 58.5°, got ${bearing}`);
    const direction = getCompassDirection(bearing);
    assert.equal(direction, 'ENE');
  });

  it('calculates 0 distance when at the Holy Kaaba coordinates', () => {
    const distance = calculateDistanceToKaaba(KAABA_COORDS.lat, KAABA_COORDS.lng);
    assert.equal(distance, 0);
  });

  it('calculates realistic great-circle distances to Kaaba', () => {
    const tashkentDist = calculateDistanceToKaaba(DEFAULT_OBSERVER.lat, DEFAULT_OBSERVER.lng);
    // Tashkent to Mecca is ~3,531 km
    assert.ok(tashkentDist >= 3500 && tashkentDist <= 3560, `Expected distance ~3531 km, got ${tashkentDist}`);

    const londonDist = calculateDistanceToKaaba(51.5074, -0.1278);
    // London to Mecca is ~4,790 km
    assert.ok(londonDist >= 4750 && londonDist <= 4850, `Expected distance ~4790 km, got ${londonDist}`);
  });

  it('accurately resolves 16-point cardinal compass directions', () => {
    assert.equal(getCompassDirection(0), 'N');
    assert.equal(getCompassDirection(360), 'N');
    assert.equal(getCompassDirection(90), 'E');
    assert.equal(getCompassDirection(180), 'S');
    assert.equal(getCompassDirection(270), 'W');
    assert.equal(getCompassDirection(45), 'NE');
    assert.equal(getCompassDirection(135), 'SE');
    assert.equal(getCompassDirection(225), 'SW');
    assert.equal(getCompassDirection(315), 'NW');
  });
});
