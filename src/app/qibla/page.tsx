'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Compass,
  MapPin,
  RotateCw,
  Info,
  Navigation,
  Smartphone,
  Sliders,
  CheckCircle2,
  Globe,
  Radio,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import {
  calculateQiblaBearing,
  calculateDistanceToKaaba,
  getCompassDirection,
  DEFAULT_OBSERVER,
  KAABA_COORDS,
  validateCoordinates,
} from '@/lib/qibla';

/**
 * Sanitizes location names read from storage or user input:
 * strips control characters, HTML tags, trims, and bounds length to 100 chars.
 */
function sanitizeLocationName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const sanitized = raw.replace(/[\x00-\x1F\x7F<>]/g, '').trim().slice(0, 100);
  return sanitized.length > 0 ? sanitized : null;
}
import { useDeviceOrientation } from '@/hooks/useDeviceOrientation';
import { AstrolabeDial } from '@/components/qibla/AstrolabeDial';
import { SpiritLevel } from '@/components/qibla/SpiritLevel';
import { TurnGuidanceCard } from '@/components/qibla/TurnGuidanceCard';
import { CityPickerModal } from '@/components/qibla/CityPickerModal';
import { CalibrationModal } from '@/components/qibla/CalibrationModal';
import type { CityPreset } from '@/types/qibla';

export default function QiblaPage() {
  const { t, lang } = useLanguage();

  // Observer coordinates
  const [coords, setCoords] = useState<{ lat: number; lng: number; isDefault: boolean }>({
    lat: DEFAULT_OBSERVER.lat,
    lng: DEFAULT_OBSERVER.lng,
    isDefault: true,
  });

  const [locationName, setLocationName] = useState<string>(DEFAULT_OBSERVER.cityName);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  // Modal display states
  const [isCityPickerOpen, setIsCityPickerOpen] = useState(false);
  const [isCalibrationOpen, setIsCalibrationOpen] = useState(false);

  // Geodesic Calculations
  const qiblaBearing = useMemo(
    () => calculateQiblaBearing(coords.lat, coords.lng),
    [coords.lat, coords.lng]
  );

  const distanceKm = useMemo(
    () => calculateDistanceToKaaba(coords.lat, coords.lng),
    [coords.lat, coords.lng]
  );

  const cardinalDir = useMemo(
    () => getCompassDirection(qiblaBearing),
    [qiblaBearing]
  );

  // Decoupled 60fps Device Orientation Hook
  const {
    heading,
    turnGuidance,
    tiltMetrics,
    isAligned,
    isSensorAvailable,
    permissionState,
    isSecureContext,
    isSimulating,
    simulatedHeading,
    setSimulatedHeading,
    requestPermission,
    dialRef,
    needleRef,
    unwrappedDialAngle,
    unwrappedNeedleAngle,
  } = useDeviceOrientation({
    qiblaBearing,
  });

  // Restore cached location from localStorage on mount with strict validation
  useEffect(() => {
    try {
      const cached = localStorage.getItem('salahtrack_location');
      const cachedName = localStorage.getItem('salahtrack_city_name');
      if (cached) {
        const parsed = JSON.parse(cached);
        const validation = validateCoordinates(parsed?.lat, parsed?.lng);
        if (validation.valid && validation.lat !== undefined && validation.lng !== undefined) {
          const validLat = validation.lat;
          const validLng = validation.lng;
          const cleanName =
            sanitizeLocationName(cachedName) ||
            `${validLat.toFixed(4)}°, ${validLng.toFixed(4)}°`;

          queueMicrotask(() => {
            setCoords({
              lat: validLat,
              lng: validLng,
              isDefault: false,
            });
            setLocationName(cleanName);
          });
        }
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  // Request browser GPS geolocation with secure context guard
  const detectLocation = useCallback(() => {
    if (typeof window === 'undefined') return;

    if ('isSecureContext' in window && !window.isSecureContext) {
      setGeoError(t.qibla.sensorNotSupported);
      return;
    }

    if (!navigator.geolocation) {
      setGeoError(t.qibla.permissionDenied);
      return;
    }

    setLocating(true);
    setGeoError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const validation = validateCoordinates(pos.coords.latitude, pos.coords.longitude);
        if (!validation.valid || validation.lat === undefined || validation.lng === undefined) {
          setGeoError(t.qibla.invalidCoordinates);
          setLocating(false);
          return;
        }

        const newCoords = {
          lat: Math.round(validation.lat * 10000) / 10000,
          lng: Math.round(validation.lng * 10000) / 10000,
          isDefault: false,
        };
        const label = `${newCoords.lat.toFixed(4)}°, ${newCoords.lng.toFixed(4)}°`;
        setCoords(newCoords);
        setLocationName(label);
        setLocating(false);

        try {
          localStorage.setItem('salahtrack_location', JSON.stringify({
            lat: newCoords.lat,
            lng: newCoords.lng,
          }));
          localStorage.setItem('salahtrack_city_name', label);
        } catch {
          // Ignore storage errors
        }
      },
      (err) => {
        console.warn('Geolocation error:', err.message);
        setGeoError(t.qibla.permissionDenied);
        setLocating(false);
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  }, [t.qibla.permissionDenied, t.qibla.sensorNotSupported, t.qibla.invalidCoordinates]);

  // Handle selection of a preset city with coordinate validation & name sanitization
  const handleSelectCity = useCallback((city: CityPreset) => {
    if (!city || !city.coordinates) return;
    const validation = validateCoordinates(city.coordinates.lat, city.coordinates.lng);
    if (!validation.valid || validation.lat === undefined || validation.lng === undefined) return;

    const newCoords = {
      lat: validation.lat,
      lng: validation.lng,
      isDefault: false,
    };
    const rawLabel = (city.nativeNames && city.nativeNames[lang]) || city.name;
    const cityLabel = sanitizeLocationName(rawLabel) || city.name;
    setCoords(newCoords);
    setLocationName(cityLabel);
    setGeoError(null);

    try {
      localStorage.setItem('salahtrack_location', JSON.stringify({
        lat: newCoords.lat,
        lng: newCoords.lng,
      }));
      localStorage.setItem('salahtrack_city_name', cityLabel);
    } catch {
      // Ignore storage errors
    }
  }, [lang]);

  // Handle custom coordinates input with strict sanitization
  const handleSelectCustomCoords = useCallback((lat: number, lng: number, label: string) => {
    const validation = validateCoordinates(lat, lng);
    if (!validation.valid || validation.lat === undefined || validation.lng === undefined) {
      setGeoError(validation.error || t.qibla.invalidCoordinates);
      return;
    }

    const cleanLabel =
      sanitizeLocationName(label) ||
      `${validation.lat.toFixed(4)}°, ${validation.lng.toFixed(4)}°`;

    const newCoords = { lat: validation.lat, lng: validation.lng, isDefault: false };
    setCoords(newCoords);
    setLocationName(cleanLabel);
    setGeoError(null);

    try {
      localStorage.setItem('salahtrack_location', JSON.stringify({
        lat: validation.lat,
        lng: validation.lng,
      }));
      localStorage.setItem('salahtrack_city_name', cleanLabel);
    } catch {
      // Ignore storage errors
    }
  }, [t.qibla.invalidCoordinates]);

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      {/* Header with Title and Control Triggers */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-slate-200/80 dark:border-slate-800/80">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
            <Compass className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
            <span>{t.qibla.title}</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t.qibla.subtitle}
          </p>
        </div>

        {/* Action Triggers: City Selector & Calibration */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* City Selector Button */}
          <button
            type="button"
            onClick={() => setIsCityPickerOpen(true)}
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/50 border border-emerald-200 dark:border-emerald-800 transition-colors shadow-xs cursor-pointer"
          >
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate max-w-[140px] sm:max-w-[180px]">{locationName}</span>
          </button>

          {/* Calibration Button */}
          <button
            type="button"
            onClick={() => setIsCalibrationOpen(true)}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-colors shadow-xs cursor-pointer"
            aria-label={t.qibla.calibrateButton}
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span className="hidden xs:inline">{t.qibla.calibrateButton}</span>
          </button>
        </div>
      </header>

      {/* Geolocation Notice / Fallback Banner if applicable */}
      {geoError && (
        <div className="flex items-start gap-3 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 text-xs">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <p>{geoError}</p>
        </div>
      )}

      {/* Insecure Context (HTTP) Security Advisory Banner */}
      {!isSecureContext && (
        <div className="flex items-start gap-3 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 text-xs shadow-xs">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">{t.qibla.sensorNotSupported}</p>
            <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-400">
              Browser security policies restrict hardware compass orientation and GPS access to secure contexts (HTTPS). Manual rotation slider and city presets are enabled.
            </p>
          </div>
        </div>
      )}

      {/* iOS Safari Sensor Permission Prompt Banner */}
      {permissionState === 'prompt' && !isSensorAvailable && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-emerald-50/90 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100 shadow-xs">
          <div className="flex items-center gap-3">
            <Radio className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 animate-pulse" />
            <span className="text-xs font-medium">{t.qibla.requestPermissionHint}</span>
          </div>
          <button
            type="button"
            onClick={requestPermission}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-transform active:scale-95 cursor-pointer shrink-0"
          >
            {t.qibla.enableSensor}
          </button>
        </div>
      )}

      {/* Main Astrolabe Instrument Stage */}
      <div className="flex flex-col items-center justify-center p-6 sm:p-10 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm relative overflow-hidden">
        {/* Subtle decorative background gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-amber-500/5 via-transparent to-transparent pointer-events-none" />

        {/* Sensor Status Indicator Chip */}
        <div className="mb-6 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shadow-2xs">
          {isSimulating ? (
            <>
              <Sliders className="w-3.5 h-3.5 text-amber-500" />
              <span>{t.qibla.manualSimulation}</span>
            </>
          ) : isSensorAvailable ? (
            <>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>{t.qibla.compassSensor}</span>
            </>
          ) : (
            <>
              <Smartphone className="w-3.5 h-3.5 text-slate-400" />
              <span>{t.qibla.numericFallback}</span>
            </>
          )}
        </div>

        {/* 60fps Astrolabe Compass Dial Component */}
        <div className="my-2">
          <AstrolabeDial
            qiblaBearing={qiblaBearing}
            dialRef={dialRef}
            needleRef={needleRef}
            dialAngle={unwrappedDialAngle}
            needleAngle={unwrappedNeedleAngle}
            isAligned={isAligned}
          />
        </div>

        {/* Alignment Success Banner */}
        {isAligned && (
          <div className="mt-8 flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-semibold text-xs border border-emerald-300 dark:border-emerald-800 animate-bounce">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>{t.qibla.aligned}</span>
          </div>
        )}

        {/* Azimuth & Cardinal Angle Readout */}
        <div className="mt-6 text-center">
          <div className="text-4xl sm:text-5xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">
            {qiblaBearing}°
            <span className="text-xl sm:text-2xl font-semibold text-emerald-600 dark:text-emerald-400 ml-2">
              {cardinalDir}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-medium">
            {t.qibla.directionBearing} ({t.qibla.headingToKaaba})
          </p>
        </div>
      </div>

      {/* Dynamic Turn Guidance Cue */}
      <TurnGuidanceCard guidance={turnGuidance} />

      {/* Spirit Level Bubble Vial (Tilt Metrics) */}
      <SpiritLevel
        tiltMagnitude={tiltMetrics.tiltMagnitude}
        tiltStatus={tiltMetrics.tiltStatus}
        bubbleX={tiltMetrics.bubbleX}
        bubbleY={tiltMetrics.bubbleY}
      />

      {/* Desktop / Manual Simulation Slider */}
      <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              {t.qibla.manualSimulation}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300">
              {Math.round(simulatedHeading ?? heading)}°
            </span>
            {isSimulating && (
              <button
                type="button"
                onClick={() => setSimulatedHeading(null)}
                className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
              >
                {t.qibla.resetSensor}
              </button>
            )}
          </div>
        </div>

        {/* Range Slider for Manual Heading Rotation */}
        <input
          type="range"
          min="0"
          max="359"
          value={Math.round(simulatedHeading ?? heading)}
          onChange={(e) => setSimulatedHeading(Number(e.target.value))}
          className="w-full accent-emerald-600 cursor-pointer"
          aria-label={t.qibla.manualSimulation}
        />

        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span>{t.qibla.desktopSliderHint}</span>
          {/* Quick preset buttons: North, East, South, West, Kaaba */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSimulatedHeading(0)}
              className="px-1.5 py-0.5 rounded-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300 font-mono text-[10px]"
            >
              0°
            </button>
            <button
              type="button"
              onClick={() => setSimulatedHeading(90)}
              className="px-1.5 py-0.5 rounded-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300 font-mono text-[10px]"
            >
              90°
            </button>
            <button
              type="button"
              onClick={() => setSimulatedHeading(180)}
              className="px-1.5 py-0.5 rounded-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300 font-mono text-[10px]"
            >
              180°
            </button>
            <button
              type="button"
              onClick={() => setSimulatedHeading(270)}
              className="px-1.5 py-0.5 rounded-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300 font-mono text-[10px]"
            >
              270°
            </button>
            <button
              type="button"
              onClick={() => setSimulatedHeading(qiblaBearing)}
              className="px-2 py-0.5 rounded-xs bg-emerald-100 dark:bg-emerald-950/60 hover:bg-emerald-200 text-emerald-700 dark:text-emerald-300 font-semibold text-[10px]"
            >
              {t.qibla.kaabaBeacon} ({qiblaBearing}°)
            </button>
          </div>
        </div>
      </div>

      {/* Geodesic Calculation & Coordinates Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Distance to Kaaba Card */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-teal-50 dark:bg-teal-950/50 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0">
            <Navigation className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              {t.qibla.distanceToKaaba}
            </span>
            <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {distanceKm.toLocaleString()}{' '}
              <span className="text-xs font-semibold text-slate-500">
                {t.qibla.kmUnit}
              </span>
            </p>
          </div>
        </div>

        {/* Observer Coordinates Card */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <MapPin className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                {coords.isDefault ? t.qibla.defaultLocation : t.qibla.detectedLocation}
              </span>
              <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                {coords.lat.toFixed(4)}° N, {coords.lng.toFixed(4)}° E
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsCityPickerOpen(true)}
            className="p-2 rounded-xl text-slate-400 hover:text-emerald-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            aria-label={t.qibla.selectCity}
          >
            <MapPin className="w-4 h-4" />
          </button>
        </div>

        {/* Qibla Direction Azimuth Card */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <Compass className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              {t.qibla.directionBearing}
            </span>
            <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {qiblaBearing}°{' '}
              <span className="text-xs font-semibold text-slate-500">
                ({cardinalDir})
              </span>
            </p>
          </div>
        </div>

        {/* Destination Target: Holy Kaaba Card */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center shrink-0">
            <Globe className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              {t.qibla.destinationKaaba}
            </span>
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
              {KAABA_COORDS.lat}° N, {KAABA_COORDS.lng}° E
            </p>
          </div>
        </div>
      </div>

      {/* City Picker Modal */}
      <CityPickerModal
        isOpen={isCityPickerOpen}
        onClose={() => setIsCityPickerOpen(false)}
        onSelectCity={handleSelectCity}
        onSelectCustomCoords={handleSelectCustomCoords}
        onDetectGps={detectLocation}
        isLocatingGps={locating}
        currentCoords={coords}
      />

      {/* Calibration Guidance Modal */}
      <CalibrationModal
        isOpen={isCalibrationOpen}
        onClose={() => setIsCalibrationOpen(false)}
      />
    </div>
  );
}
