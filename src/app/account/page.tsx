'use client';

import React, { useState, Suspense } from 'react';
import Link from 'next/link';
import {
  User as UserIcon,
  ShieldCheck,
  Compass,
  KeyRound,
  LogOut,
  LogIn,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  MapPin,
  Crosshair,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import ContactCreator from '@/components/ContactCreator';
import { findCityByCoordinates, findCityByNameOrId } from '@/lib/cities';
import { CityPickerModal } from '@/components/qibla/CityPickerModal';
import type { CityPreset } from '@/types/qibla';
import type { SafeUser } from '@/lib/auth/guard';

const CALCULATION_METHODS = [
  { id: 'MWL', name: 'Muslim World League (MWL)' },
  { id: 'ISNA', name: 'Islamic Society of North America (ISNA)' },
  { id: 'Egypt', name: 'Egyptian General Authority of Survey' },
  { id: 'Makkah', name: 'Umm al-Qura University, Makkah' },
  { id: 'Karachi', name: 'University of Islamic Sciences, Karachi' },
  { id: 'Tehran', name: 'Institute of Geophysics, University of Tehran' },
];

function AuthenticatedAccountView({
  user,
  refreshUser,
  logout,
}: {
  user: SafeUser;
  refreshUser: () => Promise<SafeUser | null>;
  logout: () => Promise<void>;
}) {
  const { t, lang } = useLanguage();

  // Personal Information State initialized directly from user
  const [name, setName] = useState(user.name || '');
  const [calculationMethod, setCalculationMethod] = useState(user.preferences?.calculationMethod || 'MWL');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Calculation Method Saving State
  const [calcSaving, setCalcSaving] = useState(false);
  const [calcSuccess, setCalcSuccess] = useState<string | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);

  // Password Change State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // City / Location State initialized directly from user or localStorage
  const [locationData, setLocationData] = useState(() => {
    let initialName = user.preferences?.city || '';
    let initialLat = user.preferences?.latitude;
    let initialLng = user.preferences?.longitude;
    let initialTz = user.preferences?.timezone || '';

    if (!initialName && typeof initialLat !== 'number') {
      try {
        const stored = typeof window !== 'undefined' ? localStorage.getItem('salahtrack_location') : null;
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed.city) initialName = parsed.city;
          if (typeof parsed.lat === 'number') initialLat = parsed.lat;
          if (typeof parsed.lng === 'number') initialLng = parsed.lng;
          if (parsed.timezone) initialTz = parsed.timezone;
        }
      } catch {
        // ignore
      }
    }

    const finalLat = typeof initialLat === 'number' && Number.isFinite(initialLat) ? initialLat : 41.2995;
    const finalLng = typeof initialLng === 'number' && Number.isFinite(initialLng) ? initialLng : 69.2401;

    const preset = findCityByCoordinates(finalLat, finalLng, 25) || (initialName ? findCityByNameOrId(initialName) : undefined);
    const finalName = initialName || (preset ? (preset.nativeNames[lang] || preset.name) : 'Tashkent');
    const finalCountry = preset?.country || (Math.abs(finalLat - 41.2995) < 0.05 ? 'Uzbekistan' : '');
    const finalTimezone = initialTz || preset?.timezone || 'Asia/Tashkent';

    return {
      cityName: finalName,
      country: finalCountry,
      latitude: finalLat,
      longitude: finalLng,
      timezone: finalTimezone,
    };
  });

  const [isCityModalOpen, setIsCityModalOpen] = useState(false);
  const [isCustomCoordOpen, setIsCustomCoordOpen] = useState(false);
  const [customLatInput, setCustomLatInput] = useState('');
  const [customLngInput, setCustomLngInput] = useState('');
  const [customCoordError, setCustomCoordError] = useState<string | null>(null);
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationSuccess, setLocationSuccess] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [gpsDetecting, setGpsDetecting] = useState(false);

  const handleDetectGps = () => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setLocationError(t.dashboard.locationUnavailable || 'Geolocation is not supported by your browser');
      return;
    }

    setGpsDetecting(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const preset = findCityByCoordinates(lat, lng, 35);
        if (preset) {
          const localizedName = preset.nativeNames[lang] || preset.name;
          setLocationData({
            cityName: localizedName,
            country: preset.country,
            latitude: lat,
            longitude: lng,
            timezone: preset.timezone || 'Asia/Tashkent',
          });
        } else {
          setLocationData({
            cityName: `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`,
            country: '',
            latitude: lat,
            longitude: lng,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tashkent',
          });
        }
        setGpsDetecting(false);
      },
      (err) => {
        let errorMsg = t.profile.gpsGenericError || 'Could not determine GPS coordinates';
        if (err.code === 1) {
          errorMsg = t.profile.gpsDenied || 'GPS permission denied. Please allow location access in your browser settings.';
        } else if (err.code === 2) {
          errorMsg = t.profile.gpsUnavailable || 'GPS position unavailable.';
        } else if (err.code === 3) {
          errorMsg = t.profile.gpsTimeout || 'GPS detection timed out.';
        }
        setLocationError(errorMsg);
        setGpsDetecting(false);
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  const handleSelectCityPreset = (city: CityPreset) => {
    const localizedName = city.nativeNames[lang] || city.name;
    setLocationData({
      cityName: localizedName,
      country: city.country,
      latitude: city.coordinates.lat,
      longitude: city.coordinates.lng,
      timezone: city.timezone || 'Asia/Tashkent',
    });
    setIsCityModalOpen(false);
  };

  const handleSelectCustomCoords = (lat: number, lng: number, label: string) => {
    const preset = findCityByCoordinates(lat, lng, 35);
    setLocationData({
      cityName: preset ? (preset.nativeNames[lang] || preset.name) : label,
      country: preset ? preset.country : '',
      latitude: lat,
      longitude: lng,
      timezone: preset?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tashkent',
    });
    setIsCityModalOpen(false);
  };

  const handleApplyManualCoords = () => {
    setCustomCoordError(null);
    const lat = parseFloat(customLatInput);
    const lng = parseFloat(customLngInput);
    if (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lng) || lng < -180 || lng > 180) {
      setCustomCoordError(t.qibla.invalidCoordinates);
      return;
    }
    const preset = findCityByCoordinates(lat, lng, 35);
    setLocationData({
      cityName: preset ? (preset.nativeNames[lang] || preset.name) : `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`,
      country: preset ? preset.country : '',
      latitude: lat,
      longitude: lng,
      timezone: preset?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tashkent',
    });
    setIsCustomCoordOpen(false);
  };

  const handleSaveLocation = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLocationSuccess(null);
    setLocationError(null);
    setLocationSaving(true);

    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          preferences: {
            city: locationData.cityName,
            latitude: locationData.latitude,
            longitude: locationData.longitude,
            timezone: locationData.timezone,
          },
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        setLocationError(json.error || t.common.error);
        setLocationSaving(false);
        return;
      }

      localStorage.setItem(
        'salahtrack_location',
        JSON.stringify({
          city: locationData.cityName,
          lat: locationData.latitude,
          lng: locationData.longitude,
          timezone: locationData.timezone,
        })
      );

      window.dispatchEvent(new CustomEvent('salahtrack_location_update'));
      window.dispatchEvent(new Event('local-storage-update'));
      window.dispatchEvent(new Event('storage'));

      setLocationSuccess(t.profile.locationSaved || 'Location saved');
      await refreshUser();
      setTimeout(() => setLocationSuccess(null), 3500);
    } catch {
      setLocationError(t.common.error);
    } finally {
      setLocationSaving(false);
    }
  };

  // Save Personal Info
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSuccess(null);
    setProfileError(null);
    setProfileSaving(true);

    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name: name.trim(),
          preferences: {
            language: lang,
            calculationMethod,
            showOnLeaderboard: user?.preferences?.showOnLeaderboard ?? false,
          },
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        localStorage.setItem('salahtrack_calc_method', calculationMethod);
        window.dispatchEvent(new CustomEvent('salahtrack_location_update'));
        window.dispatchEvent(new Event('local-storage-update'));
        window.dispatchEvent(new Event('storage'));
        setProfileSuccess(t.profile.profileUpdated);
        await refreshUser();
        setTimeout(() => setProfileSuccess(null), 3500);
      } else {
        setProfileError(json.error || t.common.error);
      }
    } catch {
      setProfileError(t.common.error);
    } finally {
      setProfileSaving(false);
    }
  };

  // Save Calculation Method
  const handleSaveCalcMethod = async (e: React.FormEvent) => {
    e.preventDefault();
    setCalcSuccess(null);
    setCalcError(null);
    setCalcSaving(true);

    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          preferences: {
            calculationMethod,
          },
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        localStorage.setItem('salahtrack_calc_method', calculationMethod);
        window.dispatchEvent(new CustomEvent('salahtrack_location_update'));
        window.dispatchEvent(new Event('local-storage-update'));
        window.dispatchEvent(new Event('storage'));
        setCalcSuccess(t.profile.profileUpdated);
        await refreshUser();
        setTimeout(() => setCalcSuccess(null), 3500);
      } else {
        setCalcError(json.error || t.common.error);
      }
    } catch {
      setCalcError(t.common.error);
    } finally {
      setCalcSaving(false);
    }
  };

  // Change Password
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordSuccess(null);
    setPasswordError(null);

    if (newPassword !== confirmNewPassword) {
      setPasswordError(t.auth.validation.passwordsMustMatch);
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError(t.auth.validation.passwordRequirements);
      return;
    }

    setPasswordSaving(true);
    try {
      const res = await fetch('/api/user/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword: confirmNewPassword,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        setPasswordSuccess(t.profile.passwordChanged);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmNewPassword('');
        setTimeout(() => setPasswordSuccess(null), 3500);
      } else {
        setPasswordError(json.error || t.common.error);
      }
    } catch {
      setPasswordError(t.common.error);
    } finally {
      setPasswordSaving(false);
    }
  };

  // Streamlined Cohesive Authenticated View (All settings in one primary view)
  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      {/* Header with Title and Logout Action */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-slate-200/80 dark:border-slate-800/80">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
              <UserIcon className="w-5 h-5" />
            </span>
            <span>{t.account.title}</span>
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {t.account.subtitle}
          </p>
        </div>

        <button
          type="button"
          onClick={() => logout()}
          className="self-start sm:self-auto min-h-[44px] py-2 px-3.5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/50 dark:bg-red-950/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/60 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          <span>{t.profile.logoutButton}</span>
        </button>
      </header>

      {/* Account Info Profile Banner */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 shadow-2xs">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-bold text-xl flex items-center justify-center shadow-md shadow-emerald-600/20 shrink-0 select-none">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
                {user.name}
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              @{user.username} • {user.email}
            </p>
          </div>
        </div>
      </div>

      {/* Section 1: Personal Information Form */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 shadow-2xs space-y-5">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <UserIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>{t.account.sections.personalInfo}</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t.account.sections.personalInfoDesc}
          </p>
        </div>

        {/* Feedback Messages */}
        {profileSuccess && (
          <div
            role="status"
            className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-medium flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{profileSuccess}</span>
          </div>
        )}
        {profileError && (
          <div
            role="alert"
            className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-medium flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{profileError}</span>
          </div>
        )}

        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="name"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300"
            >
              {t.profile.fullName}
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                {t.auth.signup.usernameLabel}
              </span>
              <input
                type="text"
                disabled
                value={`@${user.username}`}
                className="w-full px-3.5 py-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-500 dark:text-slate-400 cursor-not-allowed"
              />
            </div>

            <div className="space-y-1.5">
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                {t.auth.signup.emailLabel}
              </span>
              <input
                type="email"
                disabled
                value={user.email}
                className="w-full px-3.5 py-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-500 dark:text-slate-400 cursor-not-allowed"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={profileSaving}
              className="min-h-[44px] py-2.5 px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {profileSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{t.common.loading}</span>
                </>
              ) : (
                <span>{t.profile.saveProfile}</span>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Section 2: City / Location Selector (Uzbekistan 14 regions + International hubs + GPS) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 shadow-2xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>{t.profile.cityLocation}</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t.profile.cityLocationDesc}
            </p>
          </div>

          {/* GPS Quick Action */}
          <button
            type="button"
            onClick={handleDetectGps}
            disabled={gpsDetecting}
            className="self-start sm:self-auto min-h-[44px] px-3.5 py-2 rounded-xl border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/60 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100/80 dark:hover:bg-emerald-900/60 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-60"
            title={t.profile.detectGps}
          >
            {gpsDetecting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Crosshair className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            )}
            <span>{gpsDetecting ? t.profile.detectingGps : t.profile.detectGps}</span>
          </button>
        </div>

        {locationSuccess && (
          <div
            role="status"
            className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-medium flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{locationSuccess}</span>
          </div>
        )}
        {locationError && (
          <div
            role="alert"
            className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-medium flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{locationError}</span>
          </div>
        )}

        {/* Selected Location Card Display */}
        <div className="p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/50 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {t.profile.currentLocation || 'Current Location'}
                </span>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-600 text-white">
                  {t.profile.activeBadge || 'Active'}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-emerald-600" />
                  <span>{locationData.cityName}</span>
                </span>
                {locationData.country && (
                  <span className="text-xs px-2 py-0.5 rounded-md bg-emerald-100/70 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-medium">
                    {locationData.country}
                  </span>
                )}
              </div>
            </div>

            {/* Change Location Action Button */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsCityModalOpen(true)}
                className="min-h-[44px] px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer"
              >
                <Compass className="w-4 h-4" />
                <span>{t.profile.changeLocation || t.qibla.selectCity}</span>
              </button>
            </div>
          </div>

          {/* Details: Coordinates & Timezone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200/60 dark:border-slate-700/60 text-xs text-slate-600 dark:text-slate-400">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                {t.profile.coordinates || 'Coordinates'}:
              </span>
              <span className="font-mono">
                {locationData.latitude.toFixed(4)}°N, {locationData.longitude.toFixed(4)}°E
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                {t.profile.timezone || 'Timezone'}:
              </span>
              <span>{locationData.timezone}</span>
            </div>
          </div>
        </div>

        {/* Optional Manual Coordinate Input Expandable */}
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setIsCustomCoordOpen((prev) => !prev)}
            className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
          >
            <span>{t.profile.customCoordinates || 'Enter coordinates manually'}</span>
          </button>

          {isCustomCoordOpen && (
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label htmlFor="customLatInput" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Latitude (-90 to 90)
                  </label>
                  <input
                    id="customLatInput"
                    type="number"
                    step="0.0001"
                    min="-90"
                    max="90"
                    value={customLatInput}
                    onChange={(e) => setCustomLatInput(e.target.value)}
                    placeholder={locationData.latitude.toString()}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="customLngInput" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Longitude (-180 to 180)
                  </label>
                  <input
                    id="customLngInput"
                    type="number"
                    step="0.0001"
                    min="-180"
                    max="180"
                    value={customLngInput}
                    onChange={(e) => setCustomLngInput(e.target.value)}
                    placeholder={locationData.longitude.toString()}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  />
                </div>
              </div>

              {customCoordError && (
                <p className="text-xs text-red-600 dark:text-red-400">{customCoordError}</p>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleApplyManualCoords}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium transition-colors cursor-pointer"
                >
                  {t.qibla.applyCoords || 'Apply'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Save Location Button */}
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={handleSaveLocation}
            disabled={locationSaving}
            className="min-h-[44px] py-2.5 px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-60"
          >
            {locationSaving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{t.profile.savingLocation || t.common.loading}</span>
              </>
            ) : (
              <span>{t.profile.saveLocation || t.profile.saveProfile}</span>
            )}
          </button>
        </div>

        {/* CityPickerModal Dialog */}
        {isCityModalOpen && (
          <CityPickerModal
            isOpen={isCityModalOpen}
            onClose={() => setIsCityModalOpen(false)}
            onSelectCity={handleSelectCityPreset}
            onSelectCustomCoords={handleSelectCustomCoords}
            onDetectGps={handleDetectGps}
            isLocatingGps={gpsDetecting}
            currentCoords={{ lat: locationData.latitude, lng: locationData.longitude }}
          />
        )}
      </div>

      {/* Section 2: Prayer Calculation Method (Clear, Dedicated Section) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 shadow-2xs space-y-5">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Compass className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>{t.profile.calcMethod}</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t.account.sections.preferencesDesc}
          </p>
        </div>

        {calcSuccess && (
          <div
            role="status"
            className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-medium flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{calcSuccess}</span>
          </div>
        )}
        {calcError && (
          <div
            role="alert"
            className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-medium flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{calcError}</span>
          </div>
        )}

        <form onSubmit={handleSaveCalcMethod} className="space-y-4">
          <div className="space-y-2">
            {CALCULATION_METHODS.map((method) => {
              const isSelected = calculationMethod === method.id;
              return (
                <label
                  key={method.id}
                  className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'border-emerald-600 bg-emerald-50/60 dark:bg-emerald-950/30'
                      : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {method.name}
                    </span>
                    {isSelected && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-600 text-white">
                        {t.profile.activeBadge || 'Active'}
                      </span>
                    )}
                  </div>
                  <input
                    type="radio"
                    name="calcMethod"
                    value={method.id}
                    checked={isSelected}
                    onChange={(e) => setCalculationMethod(e.target.value)}
                    className="w-4 h-4 text-emerald-600 focus:ring-emerald-500"
                  />
                </label>
              );
            })}
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={calcSaving}
              className="min-h-[44px] py-2.5 px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {calcSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{t.common.loading}</span>
                </>
              ) : (
                <span>{t.profile.saveProfile}</span>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Section 3: Integrated Security Settings (Password Change & Security Notice) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 shadow-2xs space-y-5">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>{t.profile.changePassword}</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t.account.argonSecurityNote}
          </p>
        </div>

        {passwordSuccess && (
          <div
            role="status"
            className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-medium flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{passwordSuccess}</span>
          </div>
        )}
        {passwordError && (
          <div
            role="alert"
            className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-medium flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{passwordError}</span>
          </div>
        )}

        <form onSubmit={handleChangePassword} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="currPass"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              {t.profile.currentPassword}
            </label>
            <input
              id="currPass"
              type={showPasswords ? 'text' : 'password'}
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="newPass"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                {t.profile.newPassword}
              </label>
              <input
                id="newPass"
                type={showPasswords ? 'text' : 'password'}
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="confirmNewPass"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                {t.profile.confirmNewPassword}
              </label>
              <input
                id="confirmNewPass"
                type={showPasswords ? 'text' : 'password'}
                required
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => setShowPasswords(!showPasswords)}
              className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
            >
              {showPasswords ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              <span>{showPasswords ? t.account.hidePassword : t.account.showPassword}</span>
            </button>

            <button
              type="submit"
              disabled={passwordSaving}
              className="min-h-[44px] py-2.5 px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {passwordSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{t.profile.updatingPassword}</span>
                </>
              ) : (
                <span>{t.profile.updatePassword}</span>
              )}
            </button>
          </div>
        </form>

        {/* Embedded Secure Session Notice */}
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800 flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                {t.account.secureSessionTitle}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {t.account.secureSessionDesc}
              </p>
            </div>
          </div>
        </div>
      </div>

      <ContactCreator className="pt-2" />
    </div>
  );
}

function GuestSettingsView() {
  const { t, lang } = useLanguage();
  const [calcMethod, setCalcMethod] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('salahtrack_calc_method') || 'MWL';
    }
    return 'MWL';
  });
  const [locationData, setLocationData] = useState(() => {
    let city = 'Tashkent';
    let lat = 41.2995;
    let lng = 69.2401;
    let tz = 'Asia/Tashkent';
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('salahtrack_location') : null;
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.city) city = parsed.city;
        if (typeof parsed.lat === 'number') lat = parsed.lat;
        if (typeof parsed.lng === 'number') lng = parsed.lng;
        if (parsed.timezone) tz = parsed.timezone;
      }
    } catch {
      // ignore
    }
    return { city, lat, lng, timezone: tz };
  });

  const [isCityModalOpen, setIsCityModalOpen] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const handleSelectCityPreset = (cityPreset: CityPreset) => {
    const localizedName = cityPreset.nativeNames[lang] || cityPreset.name;
    const nextLoc = {
      city: localizedName,
      lat: cityPreset.coordinates.lat,
      lng: cityPreset.coordinates.lng,
      timezone: cityPreset.timezone || 'Asia/Tashkent',
    };
    setLocationData(nextLoc);
    localStorage.setItem('salahtrack_location', JSON.stringify(nextLoc));
    window.dispatchEvent(new CustomEvent('salahtrack_location_update'));
    window.dispatchEvent(new Event('local-storage-update'));
    window.dispatchEvent(new Event('storage'));
    setIsCityModalOpen(false);
    setSavedNotice(t.profile.locationSaved || 'Location saved');
    setTimeout(() => setSavedNotice(null), 3000);
  };

  const handleSelectCustomCoords = (lat: number, lng: number, label: string) => {
    const preset = findCityByCoordinates(lat, lng, 35);
    const localizedName = preset ? (preset.nativeNames[lang] || preset.name) : label;
    const nextLoc = {
      city: localizedName,
      lat,
      lng,
      timezone: preset?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tashkent',
    };
    setLocationData(nextLoc);
    localStorage.setItem('salahtrack_location', JSON.stringify(nextLoc));
    window.dispatchEvent(new CustomEvent('salahtrack_location_update'));
    window.dispatchEvent(new Event('local-storage-update'));
    window.dispatchEvent(new Event('storage'));
    setIsCityModalOpen(false);
    setSavedNotice(t.profile.locationSaved || 'Location saved');
    setTimeout(() => setSavedNotice(null), 3000);
  };

  const handleSaveMethod = (m: string) => {
    setCalcMethod(m);
    localStorage.setItem('salahtrack_calc_method', m);
    window.dispatchEvent(new CustomEvent('salahtrack_location_update'));
    window.dispatchEvent(new Event('local-storage-update'));
    window.dispatchEvent(new Event('storage'));
    setSavedNotice(t.profile.profileUpdated);
    setTimeout(() => setSavedNotice(null), 3000);
  };

  return (
    <div className="space-y-6">
      {savedNotice && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-medium flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{savedNotice}</span>
        </div>
      )}

      {/* Guest Location Settings */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 shadow-2xs space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>{t.profile.cityLocation || 'City & Location'}</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t.profile.cityLocationDesc || 'Select your city to get authentic prayer times.'}
          </p>
        </div>

        <div className="p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {t.profile.currentLocation || 'Current Location'}
              </span>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-600 text-white">
                {t.profile.activeBadge || 'Active'}
              </span>
            </div>
            <p className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-emerald-600" />
              <span>{locationData.city}</span>
            </p>
            <p className="text-xs text-slate-400 font-mono">
              {locationData.lat.toFixed(4)}°N, {locationData.lng.toFixed(4)}°E • {locationData.timezone}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setIsCityModalOpen(true)}
            className="min-h-[44px] px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer self-start sm:self-auto"
          >
            <Compass className="w-4 h-4" />
            <span>{t.profile.changeLocation || t.qibla.selectCity}</span>
          </button>
        </div>

        {isCityModalOpen && (
          <CityPickerModal
            isOpen={isCityModalOpen}
            onClose={() => setIsCityModalOpen(false)}
            onSelectCity={handleSelectCityPreset}
            onSelectCustomCoords={handleSelectCustomCoords}
            onDetectGps={() => {}}
            isLocatingGps={false}
            currentCoords={{ lat: locationData.lat, lng: locationData.lng }}
          />
        )}
      </div>

      {/* Guest Calculation Method Settings */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 shadow-2xs space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Compass className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>{t.profile.calcMethod}</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t.account.sections.preferencesDesc}
          </p>
        </div>

        <div className="space-y-2">
          {CALCULATION_METHODS.map((method) => {
            const isSelected = calcMethod === method.id;
            return (
              <label
                key={method.id}
                onClick={() => handleSaveMethod(method.id)}
                className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? 'border-emerald-600 bg-emerald-50/60 dark:bg-emerald-950/30'
                    : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    {method.name}
                  </span>
                  {isSelected && (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-600 text-white">
                      {t.profile.activeBadge || 'Active'}
                    </span>
                  )}
                </div>
                <input
                  type="radio"
                  name="guestCalcMethod"
                  value={method.id}
                  checked={isSelected}
                  onChange={() => handleSaveMethod(method.id)}
                  className="w-4 h-4 text-emerald-600 focus:ring-emerald-500"
                />
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AccountContent() {
  const { t } = useLanguage();
  const { user, refreshUser, logout } = useAuth();

  if (!user) {
    return (
      <div className="space-y-4 sm:space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
              <UserIcon className="w-5 h-5" />
            </span>
            <span>{t.account.title}</span>
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {t.account.subtitle}
          </p>
        </header>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 md:p-8 dark:border-slate-800 dark:bg-slate-900 shadow-sm text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 mx-auto flex items-center justify-center">
            <UserIcon className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {t.account.signInTitle}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              {t.account.signInSubtitle}
            </p>
          </div>
          <div className="pt-2 flex items-center justify-center gap-3">
            <Link
              href="/login"
              className="py-2.5 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition-colors flex items-center gap-2"
            >
              <LogIn className="w-4 h-4" />
              <span>{t.nav.login}</span>
            </Link>
            <Link
              href="/signup"
              className="py-2.5 px-5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold transition-colors"
            >
              {t.nav.signup}
            </Link>
          </div>
        </div>

        <GuestSettingsView />

        <ContactCreator className="pt-2" />
      </div>
    );
  }

  return (
    <AuthenticatedAccountView
      key={user.id}
      user={user}
      refreshUser={refreshUser}
      logout={logout}
    />
  );
}

export default function AccountPage() {
  return (
    <Suspense
      fallback={
        <div className="py-12 flex justify-center text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
        </div>
      }
    >
      <AccountContent />
    </Suspense>
  );
}
