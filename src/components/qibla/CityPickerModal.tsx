'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  X,
  Search,
  MapPin,
  LocateFixed,
  Globe,
  Building,
  Check,
  AlertCircle,
  Navigation,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import {
  UZBEKISTAN_CITIES,
  INTERNATIONAL_CITIES,
  searchCities,
} from '@/lib/cities';
import { validateCoordinates } from '@/lib/qibla';
import type { CityPreset } from '@/types/qibla';

export interface CityPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectCity: (city: CityPreset) => void;
  onSelectCustomCoords: (lat: number, lng: number, label: string) => void;
  onDetectGps: () => void;
  isLocatingGps?: boolean;
  currentCoords: { lat: number; lng: number };
}

type TabType = 'uzbekistan' | 'international' | 'custom';

export function CityPickerModal({
  isOpen,
  onClose,
  onSelectCity,
  onSelectCustomCoords,
  onDetectGps,
  isLocatingGps = false,
  currentCoords,
}: CityPickerModalProps) {
  const { t, lang } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<TabType>('uzbekistan');

  // Custom coordinate input states
  const [customLat, setCustomLat] = useState('');
  const [customLng, setCustomLng] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Focus search input on modal open
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        setSearchQuery('');
        setCustomError(null);
        searchInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Handle Escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Filtered search results
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null;
    return searchCities(searchQuery);
  }, [searchQuery]);

  // Helper to get localized city name safely avoiding prototype lookup
  const getCityDisplayName = (city: CityPreset) => {
    if (
      city.nativeNames &&
      typeof lang === 'string' &&
      Object.prototype.hasOwnProperty.call(city.nativeNames, lang)
    ) {
      return city.nativeNames[lang as keyof typeof city.nativeNames] || city.name;
    }
    return city.name;
  };

  // Submit custom coordinates with strict validation and length bounds
  const handleApplyCustomCoords = (e: React.FormEvent) => {
    e.preventDefault();
    setCustomError(null);

    const trimmedLat = typeof customLat === 'string' ? customLat.trim().slice(0, 30) : '';
    const trimmedLng = typeof customLng === 'string' ? customLng.trim().slice(0, 30) : '';

    const validation = validateCoordinates(trimmedLat, trimmedLng);
    if (!validation.valid || validation.lat === undefined || validation.lng === undefined) {
      setCustomError(t.qibla.invalidCoordinates);
      return;
    }

    const label = `${validation.lat.toFixed(4)}°, ${validation.lng.toFixed(4)}°`;
    onSelectCustomCoords(validation.lat, validation.lng, label);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="city-picker-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      {/* Modal Container */}
      <div className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 pb-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="city-picker-title"
                className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100"
              >
                {t.qibla.selectCity}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label={t.common.cancel}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* GPS Quick Action Button */}
        <div className="px-5 pt-3">
          <button
            type="button"
            onClick={() => {
              onDetectGps();
              onClose();
            }}
            disabled={isLocatingGps}
            className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
          >
            <LocateFixed
              className={`w-4 h-4 ${isLocatingGps ? 'animate-spin' : ''}`}
            />
            <span>{t.qibla.currentLocation}</span>
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-5 pb-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              maxLength={100}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.qibla.searchCityPlaceholder}
              className="w-full pl-10 pr-9 py-2.5 rounded-xl text-sm bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Category Tabs (Hidden during active search query) */}
        {!searchQuery.trim() && (
          <div className="px-5 pb-2 flex gap-1.5 border-b border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setActiveTab('uzbekistan')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                activeTab === 'uzbekistan'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Building className="w-3.5 h-3.5" />
              <span>{t.qibla.uzbekistanRegions}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('international')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                activeTab === 'international'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>{t.qibla.internationalCities}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('custom')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                activeTab === 'custom'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Navigation className="w-3.5 h-3.5" />
              <span>{t.qibla.customCoords}</span>
            </button>
          </div>
        )}

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 pt-3 space-y-2">
          {/* Active Search Results */}
          {searchResults !== null ? (
            searchResults.length > 0 ? (
              <div className="space-y-1.5">
                {searchResults.map((city) => {
                  const isSelected =
                    Math.abs(city.coordinates.lat - currentCoords.lat) < 0.001 &&
                    Math.abs(city.coordinates.lng - currentCoords.lng) < 0.001;

                  return (
                    <button
                      key={city.id}
                      type="button"
                      onClick={() => {
                        onSelectCity(city);
                        onClose();
                      }}
                      className={`w-full p-3 rounded-xl border text-left flex items-center justify-between gap-3 transition-colors ${
                        isSelected
                          ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700'
                          : 'bg-white dark:bg-slate-900/60 border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {getCityDisplayName(city)}
                          </span>
                          <span className="text-[11px] font-mono px-1.5 py-0.5 rounded-xs bg-slate-100 dark:bg-slate-800 text-slate-500">
                            {city.countryCode}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {city.country} • {t.qibla.compassQiblaLabel}: {city.qiblaBearing}° •{' '}
                          {city.distanceKm.toLocaleString()} {t.qibla.kmUnit}
                        </p>
                      </div>
                      {isSelected && (
                        <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-slate-400 text-sm">
                {t.qibla.noCitiesFound}
              </div>
            )
          ) : activeTab === 'uzbekistan' ? (
            /* Uzbekistan List */
            <div className="space-y-1.5">
              {UZBEKISTAN_CITIES.map((city) => {
                const isSelected =
                  Math.abs(city.coordinates.lat - currentCoords.lat) < 0.001 &&
                  Math.abs(city.coordinates.lng - currentCoords.lng) < 0.001;

                return (
                  <button
                    key={city.id}
                    type="button"
                    onClick={() => {
                      onSelectCity(city);
                      onClose();
                    }}
                    className={`w-full p-3 rounded-xl border text-left flex items-center justify-between gap-3 transition-colors ${
                      isSelected
                        ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700'
                        : 'bg-white dark:bg-slate-900/60 border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {getCityDisplayName(city)}
                        </span>
                        {city.region && (
                          <span className="text-[11px] text-slate-400">
                            ({city.region})
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {t.qibla.compassQiblaLabel}: {city.qiblaBearing}° • {city.distanceKm.toLocaleString()}{' '}
                        {t.qibla.kmUnit}
                      </p>
                    </div>
                    {isSelected && (
                      <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          ) : activeTab === 'international' ? (
            /* International List */
            <div className="space-y-1.5">
              {INTERNATIONAL_CITIES.map((city) => {
                const isSelected =
                  Math.abs(city.coordinates.lat - currentCoords.lat) < 0.001 &&
                  Math.abs(city.coordinates.lng - currentCoords.lng) < 0.001;

                return (
                  <button
                    key={city.id}
                    type="button"
                    onClick={() => {
                      onSelectCity(city);
                      onClose();
                    }}
                    className={`w-full p-3 rounded-xl border text-left flex items-center justify-between gap-3 transition-colors ${
                      isSelected
                        ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700'
                        : 'bg-white dark:bg-slate-900/60 border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {getCityDisplayName(city)}
                        </span>
                        <span className="text-xs text-slate-400">
                          • {city.country}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {t.qibla.compassQiblaLabel}: {city.qiblaBearing}° • {city.distanceKm.toLocaleString()}{' '}
                        {t.qibla.kmUnit}
                      </p>
                    </div>
                    {isSelected && (
                      <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            /* Custom Coordinates Form */
            <form onSubmit={handleApplyCustomCoords} className="space-y-4 py-2">
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {t.qibla.latLabel} (-90 ... +90)
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="-90"
                    max="90"
                    maxLength={30}
                    value={customLat}
                    onChange={(e) => setCustomLat(e.target.value.slice(0, 30))}
                    placeholder="e.g. 41.2995"
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {t.qibla.lngLabel} (-180 ... +180)
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="-180"
                    max="180"
                    maxLength={30}
                    value={customLng}
                    onChange={(e) => setCustomLng(e.target.value.slice(0, 30))}
                    placeholder="e.g. 69.2401"
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                  />
                </div>
              </div>

              {customError && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs border border-rose-200 dark:border-rose-900">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{customError}</span>
                </div>
              )}

              <button
                type="submit"
                className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-transform active:scale-98 cursor-pointer"
              >
                {t.qibla.applyCoords}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
