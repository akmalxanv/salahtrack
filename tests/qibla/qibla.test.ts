import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateQiblaBearing,
  calculateDistanceToKaaba,
  getCompassDirection,
  getQiblaGeodesicData,
  calculateShortestAngleDiff,
  unwrapAngle,
  adaptiveCircularEma,
  applyDeadband,
  computeTiltMetrics,
  calculateTurnGuidance,
  validateCoordinates,
  normalizeAngle,
  KAABA_COORDS,
  DEFAULT_OBSERVER,
} from '../../src/lib/qibla.ts';
import {
  CITIES,
  UZBEKISTAN_CITIES,
  INTERNATIONAL_CITIES,
  searchCities,
  findCityById,
} from '../../src/lib/cities.ts';

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

  it('normalizes degrees to [0, 360) cleanly', () => {
    assert.equal(normalizeAngle(0), 0);
    assert.equal(normalizeAngle(360), 0);
    assert.equal(normalizeAngle(720), 0);
    assert.equal(normalizeAngle(-90), 270);
    assert.equal(normalizeAngle(-450), 270);
    assert.equal(normalizeAngle(450), 90);
    assert.equal(normalizeAngle(NaN), 0);
  });

  it('compiles full geodesic bundle via getQiblaGeodesicData', () => {
    const data = getQiblaGeodesicData(DEFAULT_OBSERVER.lat, DEFAULT_OBSERVER.lng);
    assert.equal(typeof data.bearing, 'number');
    assert.ok(data.bearing >= 239 && data.bearing <= 242);
    assert.ok(data.distanceKm > 3500);
    assert.equal(data.compassDirection, 'WSW');
    assert.equal(data.destination.lat, KAABA_COORDS.lat);
    assert.equal(data.destination.lng, KAABA_COORDS.lng);
  });
});

describe('Angular Math & Continuity Unwrapping', () => {
  it('calculates shortest signed angle differences across 0/360 boundary', () => {
    // Normal cases
    assert.equal(calculateShortestAngleDiff(10, 20), 10);
    assert.equal(calculateShortestAngleDiff(20, 10), -10);
    assert.equal(calculateShortestAngleDiff(90, 90), 0);

    // Crossing 0/360 boundary clockwise
    assert.equal(calculateShortestAngleDiff(350, 10), 20);
    assert.equal(calculateShortestAngleDiff(355, 5), 10);

    // Crossing 0/360 boundary counter-clockwise
    assert.equal(calculateShortestAngleDiff(10, 350), -20);
    assert.equal(calculateShortestAngleDiff(5, 355), -10);

    // Opposite angle (180°)
    const diff180 = Math.abs(calculateShortestAngleDiff(0, 180));
    assert.equal(diff180, 180);

    // Arbitrary unnormalized degrees
    assert.equal(calculateShortestAngleDiff(720, 730), 10);
    assert.equal(calculateShortestAngleDiff(-10, 10), 20);

    // Non-finite guards
    assert.equal(calculateShortestAngleDiff(NaN, 10), 0);
    assert.equal(calculateShortestAngleDiff(10, Infinity), 0);
  });

  it('unwraps angles continuously preventing dial spin flips', () => {
    // Crossing 360 clockwise: from 355° to 5° should accumulate to 365°
    assert.equal(unwrapAngle(355, 5), 365);

    // Rotating further clockwise: from 365° to 15° should accumulate to 375°
    assert.equal(unwrapAngle(365, 15), 375);

    // Crossing 0 counter-clockwise: from 5° to 355° should accumulate to -5°
    assert.equal(unwrapAngle(5, 355), -5);

    // Turning from 0° to 350° should accumulate to -10°
    assert.equal(unwrapAngle(0, 350), -10);

    // Preserves values when input is not finite
    assert.equal(unwrapAngle(120, NaN), 120);
    assert.equal(unwrapAngle(NaN, 45), 45);
  });
});

describe('Adaptive Circular EMA & Deadband Filters', () => {
  it('applies heavy damping (alpha_min) during small tremor jitter', () => {
    // Small tremor: 0.5° diff -> should scale near alpha_min = 0.12
    const filtered = adaptiveCircularEma(100.0, 100.5);
    const expected = 100.0 + 0.12 * 0.5; // ~100.06
    assert.ok(Math.abs(filtered - expected) < 0.01, `Expected ~${expected}, got ${filtered}`);
  });

  it('increases alpha towards alpha_max during large active rotation', () => {
    // Large rotation: 60° diff -> should use max alpha = 0.45
    const filtered = adaptiveCircularEma(0.0, 60.0);
    const expected = 0.0 + 0.45 * 60.0; // 27.0
    assert.ok(Math.abs(filtered - expected) < 0.1, `Expected ~${expected}, got ${filtered}`);
  });

  it('smooths across 0/360 boundary correctly without jumping', () => {
    // Smooth from 359° towards 1° (diff is +2°)
    const filtered = adaptiveCircularEma(359.0, 1.0);
    // Result should be slightly greater than 359 (around 359.24 - 359.3)
    assert.ok(filtered > 359.0 && filtered < 360.0, `Got ${filtered}`);

    // Smooth from 1° towards 359° (diff is -2°)
    const filteredReverse = adaptiveCircularEma(1.0, 359.0);
    // Result should be slightly less than 1.0 (around 0.7)
    assert.ok(filteredReverse < 1.0 && filteredReverse > 0.5, `Got ${filteredReverse}`);
  });

  it('adjusts alpha dynamically based on dtSeconds velocity if provided', () => {
    // Fast rotation with dt = 0.02s: 20° in 0.02s = 1000°/s -> max alpha
    const fastFiltered = adaptiveCircularEma(0, 20, 0.02);
    assert.equal(fastFiltered, 9); // 0 + 0.45 * 20 = 9

    // Slow rotation with dt = 1.0s: 2° in 1s = 2°/s -> min alpha (0.12)
    const slowFiltered = adaptiveCircularEma(0, 2, 1.0);
    assert.equal(slowFiltered, 0.24); // 0 + 0.12 * 2 = 0.24
  });

  it('handles non-finite inputs safely in adaptiveCircularEma', () => {
    assert.equal(adaptiveCircularEma(NaN, 50), 50);
    assert.equal(adaptiveCircularEma(50, NaN), 50);
  });

  it('applies deadband threshold suppressing micro-fluctuations', () => {
    // Sub-threshold change (0.3° < 0.6°) -> preserves currentAngle
    assert.equal(applyDeadband(100.0, 100.3, 0.6), 100.0);
    assert.equal(applyDeadband(100.0, 99.7, 0.6), 100.0);

    // Super-threshold change (0.8° >= 0.6°) -> accepts newAngle
    assert.equal(applyDeadband(100.0, 100.8, 0.6), 100.8);
    assert.equal(applyDeadband(100.0, 99.1, 0.6), 99.1);

    // Deadband across 0/360 boundary
    assert.equal(applyDeadband(359.8, 0.1, 0.6), 359.8); // 0.3° diff -> suppressed
    assert.equal(applyDeadband(359.8, 0.8, 0.6), 0.8);   // 1.0° diff -> accepted

    // Non-finite guards
    assert.equal(applyDeadband(NaN, 10), 10);
    assert.equal(applyDeadband(10, NaN), 10);
  });
});

describe('Device Tilt & Bubble Level Metrics', () => {
  it('evaluates flat device as LEVEL with centered bubble coordinates', () => {
    const metrics = computeTiltMetrics(0, 0);
    assert.equal(metrics.tiltMagnitude, 0);
    assert.equal(metrics.tiltStatus, 'LEVEL');
    assert.equal(metrics.bubbleX, 0);
    assert.equal(metrics.bubbleY, 0);
  });

  it('classifies tilt <= 8° as LEVEL', () => {
    // 5° pitch, 5° roll: sqrt(25 + 25) = sqrt(50) = ~7.1°
    const metrics = computeTiltMetrics(5, 5);
    assert.equal(metrics.tiltMagnitude, 7.1);
    assert.equal(metrics.tiltStatus, 'LEVEL');
    assert.equal(metrics.bubbleX, 0.25); // 5 / 20 = 0.25
    assert.equal(metrics.bubbleY, 0.25);
  });

  it('classifies tilt between 8° and 20° as SLIGHT_TILT', () => {
    // 12° pitch, 0° roll: magnitude = 12°
    const metrics = computeTiltMetrics(12, 0);
    assert.equal(metrics.tiltMagnitude, 12);
    assert.equal(metrics.tiltStatus, 'SLIGHT_TILT');
    assert.equal(metrics.bubbleX, 0);
    assert.equal(metrics.bubbleY, 0.6); // 12 / 20 = 0.6
  });

  it('classifies tilt > 20° as EXCESSIVE_TILT and clamps bubble to [-1, 1]', () => {
    // 30° pitch, -25° roll: magnitude = sqrt(900 + 625) = ~39.1°
    const metrics = computeTiltMetrics(30, -25);
    assert.ok(metrics.tiltMagnitude > 20);
    assert.equal(metrics.tiltStatus, 'EXCESSIVE_TILT');
    assert.equal(metrics.bubbleX, -1); // Clamped from -1.25 to -1
    assert.equal(metrics.bubbleY, 1);  // Clamped from 1.5 to 1
  });

  it('safely handles null, undefined, and non-finite tilt sensors', () => {
    const metrics1 = computeTiltMetrics(null, null);
    assert.equal(metrics1.tiltStatus, 'LEVEL');
    assert.equal(metrics1.tiltMagnitude, 0);

    const metrics2 = computeTiltMetrics(NaN, 10);
    assert.equal(metrics2.tiltStatus, 'LEVEL');
  });
});

describe('Kaaba Turn Guidance & Alignment', () => {
  it('detects ALIGNED state when within tolerance window', () => {
    // Exactly on bearing
    const alignedExact = calculateTurnGuidance(240.3, 240.3);
    assert.equal(alignedExact.state, 'ALIGNED');
    assert.equal(alignedExact.isAligned, true);
    assert.equal(alignedExact.deltaDegrees, 0);

    // Within default 3.5° tolerance
    const alignedNear = calculateTurnGuidance(238.0, 240.3);
    assert.equal(alignedNear.state, 'ALIGNED');
    assert.equal(alignedNear.isAligned, true);
    assert.equal(alignedNear.deltaDegrees, 2.3);

    // Aligned across 0/360 wrap-around (heading 359°, qibla 1° -> diff +2°)
    const alignedWrap = calculateTurnGuidance(359, 1);
    assert.equal(alignedWrap.state, 'ALIGNED');
    assert.equal(alignedWrap.isAligned, true);
    assert.equal(alignedWrap.deltaDegrees, 2);
  });

  it('directs TURN_RIGHT when Kaaba bearing is clockwise', () => {
    // Heading 200°, Qibla 240.3° -> turn right by 40.3°
    const guidance = calculateTurnGuidance(200, 240.3);
    assert.equal(guidance.state, 'TURN_RIGHT');
    assert.equal(guidance.isAligned, false);
    assert.equal(guidance.deltaDegrees, 40.3);
    assert.equal(guidance.remainingTurnDeg, 40.3);
    assert.ok(guidance.directionLabel?.includes('Turn right'));
  });

  it('directs TURN_LEFT when Kaaba bearing is counter-clockwise', () => {
    // Heading 280°, Qibla 240.3° -> turn left by 39.7°
    const guidance = calculateTurnGuidance(280, 240.3);
    assert.equal(guidance.state, 'TURN_LEFT');
    assert.equal(guidance.isAligned, false);
    assert.equal(guidance.deltaDegrees, -39.7);
    assert.equal(guidance.remainingTurnDeg, 39.7);
    assert.ok(guidance.directionLabel?.includes('Turn left'));
  });

  it('respects custom alignment tolerance', () => {
    // Diff 4°: ALIGNED with tolerance 5°, but TURN_RIGHT with tolerance 2°
    const loose = calculateTurnGuidance(200, 204, 5.0);
    assert.equal(loose.state, 'ALIGNED');

    const strict = calculateTurnGuidance(200, 204, 2.0);
    assert.equal(strict.state, 'TURN_RIGHT');
  });

  it('handles non-finite numbers safely in calculateTurnGuidance', () => {
    const fallback = calculateTurnGuidance(NaN, 240);
    assert.equal(fallback.isAligned, false);
    assert.equal(fallback.deltaDegrees, 0);
  });
});

describe('Strict Terrestrial Coordinate Validation', () => {
  it('accepts valid decimal coordinates', () => {
    const res = validateCoordinates(41.2995, 69.2401);
    assert.equal(res.valid, true);
    assert.equal(res.lat, 41.2995);
    assert.equal(res.lng, 69.2401);
  });

  it('parses valid numeric strings cleanly', () => {
    const res = validateCoordinates('41.2995', '69.2401');
    assert.equal(res.valid, true);
    assert.equal(res.lat, 41.2995);
    assert.equal(res.lng, 69.2401);
  });

  it('accepts valid terrestrial boundary values', () => {
    assert.equal(validateCoordinates(90, 180).valid, true);
    assert.equal(validateCoordinates(-90, -180).valid, true);
    assert.equal(validateCoordinates(0, 0).valid, true);
  });

  it('rejects latitude outside [-90, 90]', () => {
    const resHigh = validateCoordinates(90.1, 50);
    assert.equal(resHigh.valid, false);
    assert.ok(resHigh.error?.includes('Latitude'));

    const resLow = validateCoordinates(-90.1, 50);
    assert.equal(resLow.valid, false);
    assert.ok(resLow.error?.includes('Latitude'));
  });

  it('rejects longitude outside [-180, 180]', () => {
    const resHigh = validateCoordinates(45, 180.1);
    assert.equal(resHigh.valid, false);
    assert.ok(resHigh.error?.includes('Longitude'));

    const resLow = validateCoordinates(45, -180.1);
    assert.equal(resLow.valid, false);
    assert.ok(resLow.error?.includes('Longitude'));
  });

  it('rejects non-numeric, null, undefined, and malformed inputs', () => {
    assert.equal(validateCoordinates(null, 50).valid, false);
    assert.equal(validateCoordinates(50, undefined).valid, false);
    assert.equal(validateCoordinates(NaN, 50).valid, false);
    assert.equal(validateCoordinates(50, Infinity).valid, false);
    assert.equal(validateCoordinates('invalid', 50).valid, false);
    assert.equal(validateCoordinates({}, []).valid, false);
    assert.equal(validateCoordinates('', '').valid, false);
  });
});

describe('City Catalog & Fast Search Engine', () => {
  it('contains verified catalog of at least 30 cities with Uzbekistan and International groups', () => {
    assert.ok(CITIES.length >= 31, `Expected >= 31 cities, got ${CITIES.length}`);
    assert.equal(UZBEKISTAN_CITIES.length, 14);
    assert.equal(INTERNATIONAL_CITIES.length, 17);

    // Verify all cities have valid coordinates, non-NaN bearings and distances
    for (const city of CITIES) {
      assert.ok(city.id.length > 0);
      assert.ok(city.name.length > 0);
      assert.ok(city.nativeNames.uz.length > 0);
      assert.ok(city.nativeNames.ru.length > 0);
      assert.ok(city.nativeNames.en.length > 0);
      assert.ok(city.country.length > 0);
      assert.ok(city.countryCode.length === 2);
      assert.ok(city.coordinates.lat >= -90 && city.coordinates.lat <= 90);
      assert.ok(city.coordinates.lng >= -180 && city.coordinates.lng <= 180);
      assert.ok(Number.isFinite(city.qiblaBearing));
      assert.ok(Number.isFinite(city.distanceKm));
    }
  });

  it('resolves city presets via findCityById', () => {
    const tashkent = findCityById('tashkent');
    assert.ok(tashkent);
    assert.equal(tashkent.name, 'Tashkent');
    assert.equal(tashkent.countryCode, 'UZ');
    assert.equal(tashkent.qiblaBearing, 240.3);

    const makkah = findCityById('makkah');
    assert.ok(makkah);
    assert.equal(makkah.name, 'Makkah');
    assert.equal(makkah.countryCode, 'SA');
    assert.equal(makkah.distanceKm, 0);

    const samarkand = findCityById('SAMARKAND'); // Case-insensitive
    assert.ok(samarkand);
    assert.equal(samarkand.id, 'samarkand');

    assert.equal(findCityById('non-existent-city'), undefined);
    assert.equal(findCityById(''), undefined);
  });

  it('returns all cities when search query is empty', () => {
    const all = searchCities('');
    assert.equal(all.length, CITIES.length);

    const whitespace = searchCities('   ');
    assert.equal(whitespace.length, CITIES.length);
  });

  it('searches cities across Uzbek, Russian, English, and Arabic names', () => {
    // English search
    const tashkentEn = searchCities('Tashkent');
    assert.ok(tashkentEn.length > 0);
    assert.equal(tashkentEn[0].id, 'tashkent');

    // Uzbek search with apostrophe handling (Farg'ona / fargona)
    const ferganaUz = searchCities("Farg'ona");
    assert.ok(ferganaUz.length > 0);
    assert.equal(ferganaUz[0].id, 'fergana');

    const ferganaNormalized = searchCities('fargona');
    assert.ok(ferganaNormalized.length > 0);
    assert.equal(ferganaNormalized[0].id, 'fergana');

    // Russian Cyrillic search
    const samarkandRu = searchCities('Самарканд');
    assert.ok(samarkandRu.length > 0);
    assert.equal(samarkandRu[0].id, 'samarkand');

    const moscowRu = searchCities('Москва');
    assert.ok(moscowRu.length > 0);
    assert.equal(moscowRu[0].id, 'moscow');

    // Arabic search
    const makkahAr = searchCities('مكة');
    assert.ok(makkahAr.length > 0);
    assert.equal(makkahAr[0].id, 'makkah');

    // Search by country
    const uzbekistanCities = searchCities('Uzbekistan');
    assert.equal(uzbekistanCities.length, 14);

    // Search by country code
    const turkeyCities = searchCities('TR');
    assert.ok(turkeyCities.some((c) => c.id === 'istanbul'));
  });
});

describe('Qibla Security, Privacy & Sensor Policy Verification', () => {
  it('rejects prototype pollution and dangerous object payloads in validateCoordinates', () => {
    // Malicious objects attempting prototype pollution or unexpected type coercions
    const maliciousPayload1 = { __proto__: { admin: true } };
    const maliciousPayload2 = { toString: () => 'NaN' };
    const maliciousPayload3 = Object.create(null);

    const res1 = validateCoordinates(maliciousPayload1, 69.24);
    assert.equal(res1.valid, false);

    const res2 = validateCoordinates(41.29, maliciousPayload2);
    assert.equal(res2.valid, false);

    const res3 = validateCoordinates(maliciousPayload3, maliciousPayload3);
    assert.equal(res3.valid, false);
  });

  it('rejects non-finite IEEE 754 numbers (NaN, Infinity, -Infinity)', () => {
    assert.equal(validateCoordinates(NaN, 69.24).valid, false);
    assert.equal(validateCoordinates(41.29, NaN).valid, false);
    assert.equal(validateCoordinates(Infinity, 69.24).valid, false);
    assert.equal(validateCoordinates(41.29, -Infinity).valid, false);
  });

  it('safely handles massive search strings and prototype keys in searchCities', () => {
    // Massive string (10,000 characters) - should not hang or cause ReDoS
    const massiveQuery = 'a'.repeat(10000);
    const massiveResults = searchCities(massiveQuery);
    assert.ok(Array.isArray(massiveResults));

    // Prototype injection attempts
    const protoResults = searchCities('__proto__');
    assert.ok(Array.isArray(protoResults));
    assert.equal((Object.prototype as unknown as { polluted?: boolean }).polluted, undefined);

    const constructorResults = searchCities('constructor');
    assert.ok(Array.isArray(constructorResults));
  });

  it('verifies next.config.ts exports required Permissions-Policy and security headers', async () => {
    // Dynamically import nextConfig
    const nextConfigModule = await import('../../next.config.ts');
    const config = nextConfigModule.default;

    assert.ok(typeof config.headers === 'function', 'nextConfig must export a headers function');
    const headersList = await config.headers();
    assert.ok(Array.isArray(headersList), 'headersList must be an array');

    const globalHeaders = headersList.find((h: { source: string }) => h.source === '/(.*)');
    assert.ok(globalHeaders, 'Must define global headers for /(.*)');

    const headerMap = new Map<string, string>();
    for (const h of globalHeaders.headers) {
      headerMap.set(h.key, h.value);
    }

    // Verify Permissions-Policy includes sensor and location permissions
    const permissionsPolicy = headerMap.get('Permissions-Policy');
    assert.ok(permissionsPolicy, 'Permissions-Policy header must exist');
    assert.ok(permissionsPolicy.includes('accelerometer=(self)'), 'Must allow accelerometer for self');
    assert.ok(permissionsPolicy.includes('gyroscope=(self)'), 'Must allow gyroscope for self');
    assert.ok(permissionsPolicy.includes('magnetometer=(self)'), 'Must allow magnetometer for self');
    assert.ok(permissionsPolicy.includes('geolocation=(self)'), 'Must allow geolocation for self');
    assert.ok(permissionsPolicy.includes('camera=()'), 'Must restrict camera access');
    assert.ok(permissionsPolicy.includes('microphone=()'), 'Must restrict microphone access');

    // Verify critical standard OWASP security headers
    assert.equal(headerMap.get('X-Frame-Options'), 'DENY');
    assert.equal(headerMap.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(headerMap.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
    assert.ok(headerMap.get('Strict-Transport-Security')?.includes('max-age='));
  });
});

