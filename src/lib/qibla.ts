/**
 * Qibla & Geodesic Calculation Engine
 * Implements Great-Circle forward azimuth, Haversine distance,
 * angular unwrapping, adaptive circular EMA filtering, deadband suppression,
 * device tilt metrics, turn guidance, and strict coordinate validation.
 *
 * Target: The Holy Kaaba in Makkah (21.422487° N, 39.826206° E).
 */

import type {
  QiblaCoordinates,
  QiblaGeodesicData,
  TiltStatus,
  TurnGuidance,
  CoordinateValidationResult,
} from '@/types/qibla';

export const KAABA_COORDS: QiblaCoordinates = Object.freeze({
  lat: 21.422487,
  lng: 39.826206,
});

export const DEFAULT_OBSERVER = Object.freeze({
  lat: 41.2995,
  lng: 69.2401,
  cityName: 'Tashkent',
});

// Calibration & filtering constants
export const DEFAULT_DEADBAND_THRESHOLD = 0.6; // degrees
export const DEFAULT_ALIGNMENT_TOLERANCE = 3.5; // degrees (+/- tolerance)
export const EMA_ALPHA_MIN = 0.12; // High smoothing during hand tremor
export const EMA_ALPHA_MAX = 0.45; // Low smoothing during fast intentional turn
export const TILT_LEVEL_THRESHOLD = 8.0; // degrees
export const TILT_SLIGHT_THRESHOLD = 20.0; // degrees
export const MAX_BUBBLE_TILT_DEG = 20.0; // degrees for 100% spirit level deflection

const toRadians = (deg: number): number => (deg * Math.PI) / 180;
const toDegrees = (rad: number): number => (rad * 180) / Math.PI;

/**
 * Normalizes any angle in degrees to the standard [0, 360) range.
 */
export function normalizeAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  return ((angle % 360) + 360) % 360;
}

/**
 * Calculates the shortest signed angular difference required to transition
 * from `fromAngle` to `toAngle` along a circle.
 *
 * Mathematically:
 *   Δθ = toAngle - fromAngle
 *   signedDiff = (((Δθ + 540) mod 360) - 180)
 *
 * Returns a signed value in the half-open interval [-180, 180):
 *   - Positive (> 0): Clockwise rotation (turn right)
 *   - Negative (< 0): Counter-clockwise rotation (turn left)
 *   - Zero (0): Perfectly aligned
 */
export function calculateShortestAngleDiff(fromAngle: number, toAngle: number): number {
  if (!Number.isFinite(fromAngle) || !Number.isFinite(toAngle)) {
    return 0;
  }
  const delta = toAngle - fromAngle;
  // Two-step modulo prevents negative dividend issues in JavaScript
  const diff = ((((delta + 540) % 360) + 360) % 360) - 180;
  return Math.round(diff * 1e9) / 1e9;
}

/**
 * Angle unwrap accumulator for smooth continuous angular animations.
 * Eliminates the 360°/0° boundary spin artifact (e.g., rotating 355° -> 5°).
 *
 * Returns the continuous cumulative angle.
 *
 * @param currentAngle Current continuous rotation accumulator (may be < 0 or > 360)
 * @param targetAngle New incoming compass target angle [0, 360)
 */
export function unwrapAngle(currentAngle: number, targetAngle: number): number {
  if (!Number.isFinite(currentAngle)) {
    return Number.isFinite(targetAngle) ? targetAngle : 0;
  }
  if (!Number.isFinite(targetAngle)) {
    return currentAngle;
  }
  const diff = calculateShortestAngleDiff(currentAngle, targetAngle);
  return currentAngle + diff;
}

/**
 * Velocity-adaptive circular Exponential Moving Average (EMA) filter.
 *
 * Prevents jitter from micro-tremors when the user holds the device still (alpha = 0.12),
 * while rapidly adapting without noticeable lag when the user turns their phone (alpha = 0.45).
 *
 * Correctly interpolates across circular wrap-around boundaries.
 *
 * @param currentFiltered Previous filtered angle
 * @param rawTarget New raw sensor reading
 * @param dtSeconds Optional delta time in seconds between readings
 */
export function adaptiveCircularEma(
  currentFiltered: number,
  rawTarget: number,
  dtSeconds?: number
): number {
  if (!Number.isFinite(currentFiltered)) {
    return Number.isFinite(rawTarget) ? rawTarget : 0;
  }
  if (!Number.isFinite(rawTarget)) {
    return currentFiltered;
  }

  const diff = calculateShortestAngleDiff(currentFiltered, rawTarget);
  const absDiff = Math.abs(diff);

  let alpha: number;
  if (typeof dtSeconds === 'number' && Number.isFinite(dtSeconds) && dtSeconds > 0) {
    // Angular velocity in degrees per second
    const angularVelocity = absDiff / dtSeconds;
    // Velocity scaling: 5°/s (micro-tremor) to 60°/s (deliberate motion)
    const factor = Math.min(1, Math.max(0, (angularVelocity - 5) / 55));
    alpha = EMA_ALPHA_MIN + (EMA_ALPHA_MAX - EMA_ALPHA_MIN) * factor;
  } else {
    // Angular difference scaling: 1° (micro-jitter) to 20° (active rotation)
    const factor = Math.min(1, Math.max(0, (absDiff - 1) / 19));
    alpha = EMA_ALPHA_MIN + (EMA_ALPHA_MAX - EMA_ALPHA_MIN) * factor;
  }

  // Smooth along the shortest circular path
  const smoothed = currentFiltered + alpha * diff;

  // If input was in standard [0, 360) domain, keep output within [0, 360)
  if (currentFiltered >= 0 && currentFiltered < 360) {
    const normalized = normalizeAngle(smoothed);
    return Math.round(normalized * 1000) / 1000;
  }

  // Otherwise maintain continuous unwrap accumulator
  return Math.round(smoothed * 1000) / 1000;
}

/**
 * Deadband filter to suppress sub-degree sensor noise when the device is stationary.
 * If angular change is less than the threshold, preserves `currentAngle`.
 *
 * @param currentAngle Current stable angle
 * @param newAngle Candidate updated angle
 * @param threshold Deadband threshold in degrees (default 0.6°)
 */
export function applyDeadband(
  currentAngle: number,
  newAngle: number,
  threshold: number = DEFAULT_DEADBAND_THRESHOLD
): number {
  if (!Number.isFinite(currentAngle)) {
    return Number.isFinite(newAngle) ? newAngle : 0;
  }
  if (!Number.isFinite(newAngle)) {
    return currentAngle;
  }

  const diff = calculateShortestAngleDiff(currentAngle, newAngle);
  if (Math.abs(diff) < threshold) {
    return currentAngle;
  }
  return newAngle;
}

/**
 * Computes 2D/3D tilt magnitude and spirit level bubble offsets from DeviceOrientation
 * beta (pitch: [-180, 180]) and gamma (roll: [-90, 90]).
 *
 * Evaluates whether the device is held sufficiently flat for reliable magnetometer readings:
 *   - LEVEL (<= 8°): Optimal orientation for magnetometer compass accuracy.
 *   - SLIGHT_TILT (8° - 20°): Tolerable tilt with slight deviation.
 *   - EXCESSIVE_TILT (> 20°): Severe tilt; user should be prompted to lay phone flat.
 *
 * Returns normalized bubble coordinates [-1, 1] for UI bubble level indicators.
 */
export function computeTiltMetrics(
  beta: number | null,
  gamma: number | null
): {
  tiltMagnitude: number;
  tiltStatus: TiltStatus;
  bubbleX: number;
  bubbleY: number;
} {
  if (
    beta === null ||
    gamma === null ||
    !Number.isFinite(beta) ||
    !Number.isFinite(gamma)
  ) {
    return {
      tiltMagnitude: 0,
      tiltStatus: 'LEVEL',
      bubbleX: 0,
      bubbleY: 0,
    };
  }

  // Clamp sensor ranges to physical orientation limits
  const clampedBeta = Math.max(-180, Math.min(180, beta));
  const clampedGamma = Math.max(-90, Math.min(90, gamma));

  // Combined angular tilt deviation from horizontal plane
  const rawMagnitude = Math.sqrt(clampedBeta * clampedBeta + clampedGamma * clampedGamma);
  const tiltMagnitude = Math.round(rawMagnitude * 10) / 10;

  let tiltStatus: TiltStatus;
  if (tiltMagnitude <= TILT_LEVEL_THRESHOLD) {
    tiltStatus = 'LEVEL';
  } else if (tiltMagnitude <= TILT_SLIGHT_THRESHOLD) {
    tiltStatus = 'SLIGHT_TILT';
  } else {
    tiltStatus = 'EXCESSIVE_TILT';
  }

  // Normalized spirit level bubble offsets [-1, 1]
  // clampedGamma (roll) deflects horizontally (X); clampedBeta (pitch) deflects vertically (Y)
  const rawBubbleX = clampedGamma / MAX_BUBBLE_TILT_DEG;
  const rawBubbleY = clampedBeta / MAX_BUBBLE_TILT_DEG;

  const bubbleX = Math.round(Math.max(-1, Math.min(1, rawBubbleX)) * 1000) / 1000;
  const bubbleY = Math.round(Math.max(-1, Math.min(1, rawBubbleY)) * 1000) / 1000;

  return {
    tiltMagnitude,
    tiltStatus,
    bubbleX,
    bubbleY,
  };
}

/**
 * Calculates turning direction and alignment state to guide the user towards the Kaaba.
 *
 * @param deviceHeading Current device heading in degrees [0, 360) (0 = North)
 * @param qiblaBearing Calculated forward azimuth to the Kaaba [0, 360)
 * @param toleranceDegrees Acceptable alignment window in degrees (default 3.5°)
 */
export function calculateTurnGuidance(
  deviceHeading: number,
  qiblaBearing: number,
  toleranceDegrees: number = DEFAULT_ALIGNMENT_TOLERANCE
): TurnGuidance {
  if (!Number.isFinite(deviceHeading) || !Number.isFinite(qiblaBearing)) {
    return {
      state: 'TURN_RIGHT',
      deltaDegrees: 0,
      isAligned: false,
      remainingTurnDeg: 0,
      directionLabel: 'Calibrating...',
    };
  }

  const rawDelta = calculateShortestAngleDiff(deviceHeading, qiblaBearing);
  const deltaDegrees = Math.round(rawDelta * 10) / 10;
  const absDelta = Math.abs(deltaDegrees);
  const remainingTurnDeg = Math.round(absDelta * 10) / 10;

  if (absDelta <= toleranceDegrees) {
    return {
      state: 'ALIGNED',
      deltaDegrees,
      isAligned: true,
      remainingTurnDeg,
      directionLabel: 'Aligned with Kaaba',
    };
  }

  if (deltaDegrees > 0) {
    return {
      state: 'TURN_RIGHT',
      deltaDegrees,
      isAligned: false,
      remainingTurnDeg,
      directionLabel: `Turn right by ${remainingTurnDeg}°`,
    };
  }

  return {
    state: 'TURN_LEFT',
    deltaDegrees,
    isAligned: false,
    remainingTurnDeg,
    directionLabel: `Turn left by ${remainingTurnDeg}°`,
  };
}

/**
 * Strict validator for latitude and longitude coordinates.
 * Rejects non-finite numbers, strings that do not represent valid numbers,
 * and coordinates outside physical terrestrial bounds:
 *   - Latitude: [-90, 90]
 *   - Longitude: [-180, 180]
 */
export function validateCoordinates(lat: unknown, lng: unknown): CoordinateValidationResult {
  if (lat === null || lat === undefined || lng === null || lng === undefined) {
    return {
      valid: false,
      error: 'Latitude and longitude coordinates are required',
    };
  }

  const numLat =
    typeof lat === 'number'
      ? lat
      : typeof lat === 'string' && lat.trim() !== ''
        ? Number(lat)
        : NaN;

  const numLng =
    typeof lng === 'number'
      ? lng
      : typeof lng === 'string' && lng.trim() !== ''
        ? Number(lng)
        : NaN;

  if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) {
    return {
      valid: false,
      error: 'Latitude and longitude must be valid finite numbers',
    };
  }

  if (numLat < -90 || numLat > 90) {
    return {
      valid: false,
      error: `Latitude must be between -90 and 90 degrees (received: ${numLat})`,
    };
  }

  if (numLng < -180 || numLng > 180) {
    return {
      valid: false,
      error: `Longitude must be between -180 and 180 degrees (received: ${numLng})`,
    };
  }

  return {
    valid: true,
    lat: Math.round(numLat * 1000000) / 1000000,
    lng: Math.round(numLng * 1000000) / 1000000,
  };
}

/**
 * Calculates the forward azimuth / bearing from observer coordinates to the Kaaba.
 * Formula:
 *   Δλ = λ_kaaba - λ_observer
 *   y = sin(Δλ) * cos(φ_kaaba)
 *   x = cos(φ_observer) * sin(φ_kaaba) - sin(φ_observer) * cos(φ_kaaba) * cos(Δλ)
 *   bearing = (atan2(y, x) * 180 / π + 360) % 360
 *
 * @param observerLat Latitude in decimal degrees
 * @param observerLng Longitude in decimal degrees
 * @returns Initial bearing in degrees [0, 360) rounded to 1 decimal place
 */
export function calculateQiblaBearing(observerLat: number, observerLng: number): number {
  const phi1 = toRadians(observerLat);
  const lambda1 = toRadians(observerLng);
  const phi2 = toRadians(KAABA_COORDS.lat);
  const lambda2 = toRadians(KAABA_COORDS.lng);

  const deltaLambda = lambda2 - lambda1;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  const initialBearingRad = Math.atan2(y, x);
  const initialBearingDeg = (toDegrees(initialBearingRad) + 360) % 360;

  return Math.round(initialBearingDeg * 10) / 10;
}

/**
 * Calculates the great-circle distance to the Kaaba in kilometers using the Haversine formula.
 *
 * @param observerLat Latitude in decimal degrees
 * @param observerLng Longitude in decimal degrees
 * @returns Distance in kilometers rounded to the nearest integer
 */
export function calculateDistanceToKaaba(observerLat: number, observerLng: number): number {
  const EARTH_RADIUS_KM = 6371;

  const phi1 = toRadians(observerLat);
  const phi2 = toRadians(KAABA_COORDS.lat);
  const deltaPhi = toRadians(KAABA_COORDS.lat - observerLat);
  const deltaLambda = toRadians(KAABA_COORDS.lng - observerLng);

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(EARTH_RADIUS_KM * c);
}

/**
 * Returns 16-point cardinal compass direction abbreviation for a given degree bearing.
 */
export function getCompassDirection(bearing: number): string {
  const normalized = normalizeAngle(bearing);
  const directions = [
    'N', 'NNE', 'NE', 'ENE',
    'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW',
    'W', 'WNW', 'NW', 'NNW',
  ];
  const index = Math.round(normalized / 22.5) % 16;
  return directions[index];
}

const LOCALIZED_DIRECTIONS: Record<'ru' | 'uz' | 'en', string[]> = {
  en: [
    'N', 'NNE', 'NE', 'ENE',
    'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW',
    'W', 'WNW', 'NW', 'NNW',
  ],
  ru: [
    'С', 'ССВ', 'СВ', 'ВСВ',
    'В', 'ВЮВ', 'ЮВ', 'ЮЮВ',
    'Ю', 'ЮЮЗ', 'ЮЗ', 'ЗЮЗ',
    'З', 'ЗСЗ', 'СЗ', 'ССЗ',
  ],
  uz: [
    'Sh', 'Sh-Shq', 'Sh-Shq', 'Shq-Sh',
    'Shq', 'Shq-J', 'J-Shq', 'J-Shq',
    'J', 'J-G‘', 'J-G‘', 'G‘-J-G‘',
    'G‘', 'G‘-Sh', 'Sh-G‘', 'Sh-G‘',
  ],
};

/**
 * Returns localized 16-point cardinal compass direction abbreviation for uz, ru, and en.
 */
export function getLocalizedCompassDirection(bearing: number, lang: 'ru' | 'uz' | 'en' = 'en'): string {
  const normalized = normalizeAngle(bearing);
  const list = LOCALIZED_DIRECTIONS[lang] || LOCALIZED_DIRECTIONS.en;
  const index = Math.round(normalized / 22.5) % 16;
  return list[index];
}

/**
 * Convenience helper compiling full geodesic data for a given observer location.
 */
export function getQiblaGeodesicData(observerLat: number, observerLng: number): QiblaGeodesicData {
  const bearing = calculateQiblaBearing(observerLat, observerLng);
  const distanceKm = calculateDistanceToKaaba(observerLat, observerLng);
  const compassDirection = getCompassDirection(bearing);

  return {
    bearing,
    distanceKm,
    compassDirection,
    observer: { lat: observerLat, lng: observerLng },
    destination: { lat: KAABA_COORDS.lat, lng: KAABA_COORDS.lng },
  };
}
