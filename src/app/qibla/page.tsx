'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Compass,
  Navigation,
  MapPin,
  RotateCw,
  CheckCircle2,
  Info,
  Smartphone,
  LocateFixed,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import {
  calculateQiblaBearing,
  calculateDistanceToKaaba,
  getCompassDirection,
  DEFAULT_OBSERVER,
} from '@/lib/qibla';

export default function QiblaPage() {
  const { t } = useLanguage();

  // Observer coordinates
  const [coords, setCoords] = useState<{ lat: number; lng: number; isDefault: boolean }>({
    lat: DEFAULT_OBSERVER.lat,
    lng: DEFAULT_OBSERVER.lng,
    isDefault: true,
  });

  const [locationName, setLocationName] = useState<string>(DEFAULT_OBSERVER.cityName);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  // Compass sensor state
  const [deviceHeading, setDeviceHeading] = useState<number | null>(null);
  const [sensorAvailable, setSensorAvailable] = useState<boolean | null>(null);
  const [permissionRequested, setPermissionRequested] = useState(false);

  // Calculate mathematical bearing and distance
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

  // Check if phone is aligned with Kaaba (within +/- 4 degrees)
  const isAligned = useMemo(() => {
    if (deviceHeading === null) return false;
    const diff = Math.abs(deviceHeading - qiblaBearing);
    return diff <= 4 || diff >= 356;
  }, [deviceHeading, qiblaBearing]);

  // Request browser geolocation
  const detectLocation = useCallback(() => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setGeoError(t.qibla.permissionDenied);
      return;
    }

    setLocating(true);
    setGeoError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const newCoords = {
          lat: Math.round(pos.coords.latitude * 10000) / 10000,
          lng: Math.round(pos.coords.longitude * 10000) / 10000,
          isDefault: false,
        };
        setCoords(newCoords);
        setLocationName(`${newCoords.lat}°, ${newCoords.lng}°`);
        setLocating(false);

        // Cache in localStorage for subsequent visits and prayer times
        try {
          localStorage.setItem('salahtrack_location', JSON.stringify({
            lat: newCoords.lat,
            lng: newCoords.lng,
          }));
        } catch {
          // ignore
        }
      },
      (err) => {
        console.warn('Geolocation error:', err.message);
        setGeoError(t.qibla.permissionDenied);
        setLocating(false);
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  }, [t.qibla.permissionDenied]);

  // Check cached location on mount
  useEffect(() => {
    try {
      const cached = localStorage.getItem('salahtrack_location');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (typeof parsed.lat === 'number' && typeof parsed.lng === 'number') {
          queueMicrotask(() => {
            setCoords({
              lat: parsed.lat,
              lng: parsed.lng,
              isDefault: false,
            });
            setLocationName(`${parsed.lat}°, ${parsed.lng}°`);
          });
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // Request iOS permission if needed
  const requestCompassPermission = async () => {
    setPermissionRequested(true);
    if (
      typeof window !== 'undefined' &&
      typeof (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission === 'function'
    ) {
      try {
        const response = await (DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission();
        if (response === 'granted') {
          setSensorAvailable(true);
        } else {
          setSensorAvailable(false);
        }
      } catch (err) {
        console.warn('DeviceOrientation permission error:', err);
        setSensorAvailable(false);
      }
    }
  };

  // Device orientation event listener
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOrientation = (event: DeviceOrientationEvent) => {
      // iOS Safari provides webkitCompassHeading directly
      const webkitHeading = (event as unknown as { webkitCompassHeading?: number }).webkitCompassHeading;

      if (typeof webkitHeading === 'number' && !isNaN(webkitHeading)) {
        setDeviceHeading(Math.round(webkitHeading));
        setSensorAvailable(true);
        return;
      }

      // Android provides alpha
      if (event.alpha !== null && !isNaN(event.alpha)) {
        // Absolute orientation
        const heading = (360 - event.alpha) % 360;
        setDeviceHeading(Math.round(heading));
        setSensorAvailable(true);
        return;
      }
    };

    // Listen to standard or absolute orientation
    window.addEventListener('deviceorientation', handleOrientation, true);
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute' as unknown as keyof WindowEventMap, handleOrientation as EventListener, true);
    }

    // Set fallback timeout if no sensor event fires within 1.5 seconds
    const timeoutId = setTimeout(() => {
      setSensorAvailable((prev) => (prev === true ? true : false));
    }, 1500);

    return () => {
      window.removeEventListener('deviceorientation', handleOrientation, true);
      if ('ondeviceorientationabsolute' in window) {
        window.removeEventListener('deviceorientationabsolute' as unknown as keyof WindowEventMap, handleOrientation as EventListener, true);
      }
      clearTimeout(timeoutId);
    };
  }, []);

  // Relative needle rotation:
  // If sensor is active: rotate dial with heading, needle points to Kaaba
  // If sensor is NOT active: fixed north dial, needle points to qiblaBearing
  const dialRotation = deviceHeading !== null ? -deviceHeading : 0;
  const needleAngle = deviceHeading !== null
    ? (qiblaBearing - deviceHeading + 360) % 360
    : qiblaBearing;

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      {/* Header */}
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

        {/* Location Detection Button */}
        <button
          type="button"
          onClick={detectLocation}
          disabled={locating}
          className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/50 border border-emerald-200 dark:border-emerald-800 transition-colors shadow-xs cursor-pointer disabled:opacity-60 self-start sm:self-auto"
        >
          {locating ? (
            <RotateCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <LocateFixed className="w-3.5 h-3.5" />
          )}
          <span>{locating ? '...' : locationName}</span>
        </button>
      </header>

      {/* Geolocation Notice / Fallback Banner */}
      {geoError && (
        <div className="flex items-start gap-3 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 text-xs">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <p>{geoError}</p>
        </div>
      )}

      {/* Main Interactive Compass Dial Card */}
      <div className="flex flex-col items-center justify-center p-8 sm:p-12 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm relative overflow-hidden">
        {/* Subtle decorative background pattern */}
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/5 via-transparent to-transparent pointer-events-none" />

        {/* Sensor Status Chip */}
        <div className="mb-6 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shadow-2xs">
          {sensorAvailable ? (
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

        {/* iOS Sensor Permission Button if not yet granted on iOS */}
        {typeof window !== 'undefined' &&
          'DeviceOrientationEvent' in window &&
          typeof (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission === 'function' &&
          !sensorAvailable &&
          !permissionRequested && (
            <button
              type="button"
              onClick={requestCompassPermission}
              className="mb-6 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-transform active:scale-95"
            >
              Enable Device Sensor
            </button>
          )}

        {/* Compass Dial Outer Ring */}
        <div
          className={`relative w-64 h-64 sm:w-80 sm:h-80 rounded-full border-4 transition-colors duration-300 flex items-center justify-center ${
            isAligned
              ? 'border-emerald-500 shadow-lg shadow-emerald-500/25 ring-4 ring-emerald-500/20'
              : 'border-slate-200 dark:border-slate-700 shadow-inner'
          }`}
          style={{
            background: 'radial-gradient(circle, rgba(16,185,129,0.04) 0%, rgba(15,23,42,0.02) 100%)',
          }}
        >
          {/* Rotating Compass Dial Plate */}
          <div
            className="absolute inset-2 rounded-full transition-transform duration-200 ease-out"
            style={{ transform: `rotate(${dialRotation}deg)` }}
          >
            {/* Cardinal Markers: N, E, S, W */}
            <span className="absolute top-2 left-1/2 -translate-x-1/2 text-xs font-bold text-rose-500 tracking-wider">
              N
            </span>
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">
              E
            </span>
            <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs font-semibold text-slate-400">
              S
            </span>
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">
              W
            </span>

            {/* Dial Ticks (Every 30 degrees) */}
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="absolute w-full top-1/2 left-0 -translate-y-1/2 flex justify-between px-1 pointer-events-none"
                style={{ transform: `rotate(${i * 30}deg)` }}
              >
                <div
                  className={`h-0.5 rounded-full ${
                    i % 3 === 0
                      ? 'w-3 bg-slate-400 dark:bg-slate-500'
                      : 'w-1.5 bg-slate-300 dark:bg-slate-700'
                  }`}
                />
                <div
                  className={`h-0.5 rounded-full ${
                    i % 3 === 0
                      ? 'w-3 bg-slate-400 dark:bg-slate-500'
                      : 'w-1.5 bg-slate-300 dark:bg-slate-700'
                  }`}
                />
              </div>
            ))}
          </div>

          {/* Qibla Needle Pointer */}
          <div
            className="absolute inset-0 flex items-center justify-center transition-transform duration-300 ease-out pointer-events-none"
            style={{ transform: `rotate(${needleAngle}deg)` }}
          >
            {/* Upper Needle (Pointing to Kaaba) */}
            <div className="relative w-2 h-28 -top-14 flex flex-col items-center">
              {/* Kaaba Icon / Target marker */}
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-white shadow-md transition-all ${
                  isAligned
                    ? 'bg-emerald-500 ring-4 ring-emerald-400/40 scale-110'
                    : 'bg-emerald-600'
                }`}
              >
                <Navigation className="w-3.5 h-3.5 fill-current" />
              </div>
              <div
                className={`w-1.5 flex-1 rounded-full transition-colors ${
                  isAligned ? 'bg-emerald-500' : 'bg-emerald-600'
                }`}
              />
            </div>

            {/* Lower Needle (Opposite Direction) */}
            <div className="relative w-1 h-20 top-10 bg-slate-300 dark:bg-slate-700 rounded-full" />
          </div>

          {/* Center Hub */}
          <div className="relative w-6 h-6 rounded-full bg-slate-900 dark:bg-slate-100 border-2 border-white dark:border-slate-800 shadow-md flex items-center justify-center z-10">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
          </div>
        </div>

        {/* Alignment Indicator Banner */}
        {isAligned && (
          <div className="mt-6 flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-semibold text-xs border border-emerald-300 dark:border-emerald-800 animate-bounce">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>{t.qibla.headingToKaaba} — Kaaba Aligned!</span>
          </div>
        )}

        {/* Prominent Bearing and Angle Readout */}
        <div className="mt-8 text-center">
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

      {/* Metrics & Geodesic Calculation Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Distance Card */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-xs flex items-center gap-4">
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
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <MapPin className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              {coords.isDefault ? DEFAULT_OBSERVER.cityName : 'Detected Location'}
            </span>
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
              {coords.lat}° N, {coords.lng}° E
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
