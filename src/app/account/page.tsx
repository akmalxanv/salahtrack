'use client';

import React, { useState, useMemo, Suspense } from 'react';
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
  ChevronDown,
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

  // Personal Information State
  const [name, setName] = useState(user.name || '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Calculation Method State
  const [calculationMethod, setCalculationMethod] = useState(user.preferences?.calculationMethod || 'MWL');
  const [calcSaving, setCalcSaving] = useState(false);
  const [calcSuccess, setCalcSuccess] = useState<string | null>(null);

  // Password Change State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Live Password Strength Indicator
  const passwordStrength = useMemo(() => {
    if (!newPassword) return { score: 0, label: '', colorClass: '' };
    let score = 0;
    if (newPassword.length >= 8) score++;
    if (/[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword)) score++;
    if (/[0-9]/.test(newPassword)) score++;
    if (/[^A-Za-z0-9]/.test(newPassword)) score++;

    if (score <= 1) return { score: 1, label: t.account.passwordWeak, colorClass: 'bg-rose-500 text-rose-600 dark:text-rose-400' };
    if (score <= 3) return { score: 2, label: t.account.passwordMedium, colorClass: 'bg-amber-500 text-amber-600 dark:text-amber-400' };
    return { score: 3, label: t.account.passwordStrong, colorClass: 'bg-emerald-500 text-emerald-600 dark:text-emerald-400' };
  }, [newPassword, t]);

  // Location State
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
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationSuccess, setLocationSuccess] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [gpsDetecting, setGpsDetecting] = useState(false);

  // Instant location persistence
  const persistLocation = async (nextLoc: typeof locationData) => {
    setLocationSaving(true);
    setLocationSuccess(null);
    setLocationError(null);
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          preferences: {
            city: nextLoc.cityName,
            latitude: nextLoc.latitude,
            longitude: nextLoc.longitude,
            timezone: nextLoc.timezone,
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
          city: nextLoc.cityName,
          lat: nextLoc.latitude,
          lng: nextLoc.longitude,
          timezone: nextLoc.timezone,
        })
      );

      window.dispatchEvent(new CustomEvent('salahtrack_location_update'));
      window.dispatchEvent(new Event('local-storage-update'));
      window.dispatchEvent(new Event('storage'));

      setLocationSuccess(t.profile.locationSaved || 'Location saved');
      await refreshUser();
      setTimeout(() => setLocationSuccess(null), 3000);
    } catch {
      setLocationError(t.common.error);
    } finally {
      setLocationSaving(false);
    }
  };

  const handleSelectCityPreset = (city: CityPreset) => {
    const localizedName = city.nativeNames[lang] || city.name;
    const nextLoc = {
      cityName: localizedName,
      country: city.country,
      latitude: city.coordinates.lat,
      longitude: city.coordinates.lng,
      timezone: city.timezone || 'Asia/Tashkent',
    };
    setLocationData(nextLoc);
    setIsCityModalOpen(false);
    persistLocation(nextLoc);
  };

  const handleSelectCustomCoords = (lat: number, lng: number, label: string) => {
    const preset = findCityByCoordinates(lat, lng, 35);
    const nextLoc = {
      cityName: preset ? (preset.nativeNames[lang] || preset.name) : label,
      country: preset ? preset.country : '',
      latitude: lat,
      longitude: lng,
      timezone: preset?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tashkent',
    };
    setLocationData(nextLoc);
    setIsCityModalOpen(false);
    persistLocation(nextLoc);
  };

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
        const nextLoc = {
          cityName: preset ? (preset.nativeNames[lang] || preset.name) : `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`,
          country: preset ? preset.country : '',
          latitude: lat,
          longitude: lng,
          timezone: preset?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tashkent',
        };
        setLocationData(nextLoc);
        setGpsDetecting(false);
        persistLocation(nextLoc);
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

  // Instant calculation method selection & auto-save
  const handleSelectCalcMethod = async (methodId: string) => {
    setCalculationMethod(methodId);
    setCalcSaving(true);
    setCalcSuccess(null);

    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          preferences: {
            calculationMethod: methodId,
          },
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        localStorage.setItem('salahtrack_calc_method', methodId);
        window.dispatchEvent(new CustomEvent('salahtrack_location_update'));
        window.dispatchEvent(new Event('local-storage-update'));
        window.dispatchEvent(new Event('storage'));
        setCalcSuccess(t.profile.profileUpdated);
        await refreshUser();
        setTimeout(() => setCalcSuccess(null), 3000);
      }
    } catch {
      // ignore
    } finally {
      setCalcSaving(false);
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

      {/* ========================================================================= */}
      {/* CARD 1: Profile & Identity                                                */}
      {/* ========================================================================= */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 shadow-2xs space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <UserIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>{t.account.sections.personalInfo}</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t.account.sections.personalInfoDesc}
            </p>
          </div>
        </div>

        {/* User Identity Chip */}
        <div className="p-4 rounded-xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800 flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-bold text-lg flex items-center justify-center shadow-md shadow-emerald-600/20 shrink-0 select-none">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 truncate">
              {user.name}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              @{user.username} • {user.email}
            </p>
          </div>
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
          {/* Editable Full Name */}
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

          {/* Save Profile Button */}
          <div className="flex justify-end pt-1">
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

      {/* ========================================================================= */}
      {/* CARD 2: Prayer Times & Location (City & Instant Auto-Save Calculation)   */}
      {/* ========================================================================= */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 shadow-2xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
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
            disabled={gpsDetecting || locationSaving}
            className="self-start sm:self-auto min-h-[44px] px-3.5 py-2 rounded-xl border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/60 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100/80 dark:hover:bg-emerald-900/60 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-60"
            title={t.profile.detectGps}
          >
            {gpsDetecting || locationSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Crosshair className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            )}
            <span>
              {gpsDetecting
                ? t.profile.detectingGps
                : locationSaving
                  ? t.dashboard.saving
                  : t.profile.detectGps}
            </span>
          </button>
        </div>

        {/* Location Alerts */}
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
        {calcSuccess && (
          <div
            role="status"
            className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-medium flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{calcSuccess}</span>
          </div>
        )}

        {/* Current City Display Card */}
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

        {/* Calculation Method Sleek Selector (Instant Auto-Save) */}
        <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <label
              htmlFor="calcMethodSelect"
              className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-1.5"
            >
              <Compass className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>{t.profile.calcMethod}</span>
              {calcSaving && <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600 ml-1" />}
            </label>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {t.account.sections.preferencesDesc}
            </span>
          </div>

          <div className="relative">
            <select
              id="calcMethodSelect"
              value={calculationMethod}
              onChange={(e) => handleSelectCalcMethod(e.target.value)}
              className="w-full min-h-[44px] appearance-none px-3.5 py-2.5 pr-10 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 cursor-pointer transition-colors"
            >
              {CALCULATION_METHODS.map((method) => (
                <option key={method.id} value={method.id} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">
                  {method.name}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400">
              <ChevronDown className="w-4 h-4" />
            </div>
          </div>
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

      {/* ========================================================================= */}
      {/* CARD 3: Security & Credentials (Password Update with Live Strength Meter) */}
      {/* ========================================================================= */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 shadow-2xs space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>{t.profile.changePassword}</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t.account.sections.securityDesc}
            </p>
          </div>
        </div>

        {/* Feedback Messages */}
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
          {/* Current Password */}
          <div className="space-y-1.5">
            <label
              htmlFor="currPass"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              {t.profile.currentPassword}
            </label>
            <div className="relative">
              <input
                id="currPass"
                type={showPasswords ? 'text' : 'password'}
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 pr-10 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={() => setShowPasswords(!showPasswords)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer p-1"
                aria-label={showPasswords ? t.account.hidePassword : t.account.showPassword}
              >
                {showPasswords ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* New Password & Confirm Password */}
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

          {/* Live Password Strength Meter */}
          {newPassword && (
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500 dark:text-slate-400 font-medium">
                  {t.account.passwordStrength}:
                </span>
                <span className={`font-bold ${passwordStrength.colorClass}`}>
                  {passwordStrength.label}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 h-1.5">
                <div className={`rounded-full ${passwordStrength.score >= 1 ? 'bg-rose-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
                <div className={`rounded-full ${passwordStrength.score >= 2 ? 'bg-amber-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
                <div className={`rounded-full ${passwordStrength.score >= 3 ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
              </div>
            </div>
          )}

          {/* Action Row */}
          <div className="flex items-center justify-between pt-2">
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
              disabled={passwordSaving || !newPassword || newPassword.length < 8}
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

        {/* Embedded Argon2id Security & Session Badge */}
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800 flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <span>{t.account.secureSessionTitle}</span>
                <span className="px-1.5 py-0.2 rounded-sm text-[9px] font-mono bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 font-bold">
                  Argon2id
                </span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {t.account.argonSecurityNote}
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

      {/* Guest Location & Calculation Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 shadow-2xs space-y-5">
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

        {/* Calculation Method Sleek Selector */}
        <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <label
              htmlFor="guestCalcMethodSelect"
              className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-1.5"
            >
              <Compass className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>{t.profile.calcMethod}</span>
            </label>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {t.account.sections.preferencesDesc}
            </span>
          </div>

          <div className="relative">
            <select
              id="guestCalcMethodSelect"
              value={calcMethod}
              onChange={(e) => handleSaveMethod(e.target.value)}
              className="w-full min-h-[44px] appearance-none px-3.5 py-2.5 pr-10 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 cursor-pointer transition-colors"
            >
              {CALCULATION_METHODS.map((method) => (
                <option key={method.id} value={method.id} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">
                  {method.name}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400">
              <ChevronDown className="w-4 h-4" />
            </div>
          </div>
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
