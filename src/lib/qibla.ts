/**
 * Qibla & Geodesic Calculation Engine
 * Implements Great-Circle forward azimuth and Haversine distance
 * to the Holy Kaaba in Makkah (21.422487° N, 39.826206° E).
 */

export const KAABA_COORDS = {
  lat: 21.422487,
  lng: 39.826206,
};

export const DEFAULT_OBSERVER = {
  lat: 41.2995,
  lng: 69.2401,
  cityName: 'Tashkent',
};

const toRadians = (deg: number) => (deg * Math.PI) / 180;
const toDegrees = (rad: number) => (rad * 180) / Math.PI;

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
 * @returns Initial bearing in degrees [0, 360)
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
 * @returns Distance in kilometers
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
  const normalized = (bearing % 360 + 360) % 360;
  const directions = [
    'N', 'NNE', 'NE', 'ENE',
    'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW',
    'W', 'WNW', 'NW', 'NNW',
  ];
  const index = Math.round(normalized / 22.5) % 16;
  return directions[index];
}
