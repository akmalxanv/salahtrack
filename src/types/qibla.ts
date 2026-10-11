/**
 * Type definitions for Qibla & Geodesic Calculation Engine
 */

export type TiltStatus = 'LEVEL' | 'SLIGHT_TILT' | 'EXCESSIVE_TILT';

export type GuidanceState = 'ALIGNED' | 'TURN_LEFT' | 'TURN_RIGHT';

export interface QiblaCoordinates {
  lat: number;
  lng: number;
}

export interface QiblaGeodesicData {
  bearing: number;           // Forward azimuth in degrees [0, 360)
  distanceKm: number;        // Great-circle distance to Holy Kaaba in km
  compassDirection: string;  // 16-point cardinal compass direction (e.g. 'WSW', 'ENE')
  observer: QiblaCoordinates;
  destination: QiblaCoordinates;
}

export interface DeviceOrientationFiltered {
  heading: number;             // Smoothed continuous or normalized heading in degrees [0, 360)
  rawHeading: number | null;   // Raw device orientation alpha or webkitCompassHeading
  beta: number | null;         // Pitch in degrees [-180, 180]
  gamma: number | null;        // Roll in degrees [-90, 90]
  tiltMagnitude: number;       // Combined tilt angle deviation from horizontal in degrees
  tiltStatus: TiltStatus;      // 'LEVEL' | 'SLIGHT_TILT' | 'EXCESSIVE_TILT'
  bubbleX: number;             // Spirit level normalized bubble X offset [-1, 1]
  bubbleY: number;             // Spirit level normalized bubble Y offset [-1, 1]
  accuracy?: number | null;    // Compass sensor accuracy in degrees if provided
  isCalibrated?: boolean;      // True if compass sensor meets calibration standards
}

export interface TurnGuidance {
  state: GuidanceState;        // 'ALIGNED' | 'TURN_LEFT' | 'TURN_RIGHT'
  deltaDegrees: number;        // Shortest signed angle difference in degrees [-180, 180)
  isAligned: boolean;          // True when delta is within alignment tolerance
  remainingTurnDeg: number;    // Absolute angle remaining to face Kaaba (0 to 180)
  directionLabel?: string;     // Textual direction cue (e.g. 'Turn left', 'Turn right', 'Aligned')
}

export interface CoordinateValidationResult {
  valid: boolean;
  error?: string;
  lat?: number;
  lng?: number;
}

export interface CityNativeNames {
  uz: string;
  ru: string;
  en: string;
  ar?: string;
}

export interface CityPreset {
  id: string;                  // Unique slug (e.g. 'tashkent', 'makkah')
  name: string;                // Default English name
  nativeNames: CityNativeNames;
  country: string;             // English country name
  countryCode: string;         // ISO 3166-1 alpha-2 code
  region?: string;             // Administrative region / province
  coordinates: QiblaCoordinates;
  timezone?: string;           // IANA timezone identifier
  qiblaBearing: number;        // Pre-computed Qibla forward azimuth
  distanceKm: number;          // Pre-computed Haversine distance in km
}
