'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Moon,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { getCalendarDate, getLiturgicalDate } from '@/lib/prayer-cycle';
import {
  getHijriParts,
  getHijriMonthDays,
  toArabicNumerals,
  formatShortGregorianDate,
  HIJRI_MONTHS,
} from '@/lib/hijri';
import type { PrayerId, PrayerHistoryRecord } from '@/types/prayer';

const PRAYER_IDS: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

export interface CompactHijriCalendarProps {
  selectedDate: string;
  onSelectDate: (dateStr: string) => void;
  records: Record<string, PrayerHistoryRecord>;
  className?: string;
  readOnly?: boolean;
}

export default function CompactHijriCalendar({
  selectedDate,
  onSelectDate,
  records,
  className = '',
  readOnly = false,
}: CompactHijriCalendarProps) {
  const { t, lang } = useLanguage();
  const calendarDate = useMemo(() => getCalendarDate(), []);
  const liturgicalDate = useMemo(() => getLiturgicalDate(), []);

  // Sighting offset state (-1, 0, +1 day) initialized deterministically for SSR
  const [adjustment, setAdjustment] = useState<number>(0);

  // Sync sighting adjustment on mount and listen for external updates
  useEffect(() => {
    const handleStorageUpdate = () => {
      try {
        const stored = localStorage.getItem('salahtrack_hijri_adjustment');
        if (stored !== null) {
          const parsed = parseInt(stored, 10);
          if (!isNaN(parsed) && parsed >= -1 && parsed <= 1) {
            setAdjustment(parsed);
          }
        }
      } catch {
        // Storage access blocked or unavailable
      }
    };

    handleStorageUpdate();
    window.addEventListener('salahtrack_hijri_update', handleStorageUpdate);
    return () => {
      window.removeEventListener('salahtrack_hijri_update', handleStorageUpdate);
    };
  }, []);

  const handleSetAdjustment = useCallback((newAdj: number) => {
    setAdjustment(newAdj);
    try {
      localStorage.setItem('salahtrack_hijri_adjustment', String(newAdj));
      window.dispatchEvent(new Event('salahtrack_hijri_update'));
    } catch {
      // Ignore storage errors
    }
  }, []);

  // Determine current active Hijri year & month based on liturgical date
  const currentHijri = useMemo(() => {
    return getHijriParts(liturgicalDate, adjustment);
  }, [liturgicalDate, adjustment]);

  // Hijri month navigation offset relative to currentHijri
  const [navOffset, setNavOffset] = useState<number>(0);

  // Derive active viewing year & month purely without effect cascading
  const { viewYear, viewMonth } = useMemo(() => {
    let m = currentHijri.month + navOffset;
    let y = currentHijri.year;
    while (m > 12) {
      m -= 12;
      y += 1;
    }
    while (m < 1) {
      m += 12;
      y -= 1;
    }
    return { viewYear: y, viewMonth: m };
  }, [currentHijri.year, currentHijri.month, navOffset]);

  // Hijri Month Navigation Handlers
  const handlePrevMonth = () => {
    setNavOffset((prev) => prev - 1);
  };

  const handleNextMonth = () => {
    setNavOffset((prev) => prev + 1);
  };

  const handleJumpToCurrentMonth = () => {
    setNavOffset(0);
    onSelectDate(liturgicalDate);
  };

  // Compute all days for this Hijri month
  const monthDays = useMemo(() => {
    return getHijriMonthDays(viewYear, viewMonth, adjustment);
  }, [viewYear, viewMonth, adjustment]);

  // Start day offset for Monday-first column grid
  const startDayOfWeek = useMemo(() => {
    if (!monthDays || monthDays.length === 0) return 0;
    return monthDays[0].dayOfWeek; // 0 = Mon, ..., 6 = Sun
  }, [monthDays]);

  // Localized and Arabic month headers
  const monthIdx = viewMonth - 1;
  const arabicMonthName = HIJRI_MONTHS.ar[monthIdx] || '';
  const localizedMonthName =
    t.calendar.hijri?.months?.[monthIdx] ||
    (lang === 'uz'
      ? HIJRI_MONTHS.uz[monthIdx]
      : lang === 'ru'
      ? HIJRI_MONTHS.ru[monthIdx]
      : HIJRI_MONTHS.en[monthIdx]);

  const arabicYearStr = toArabicNumerals(viewYear);
  const eraStr = t.calendar.hijri?.era || '';
  const arabicEraStr = t.calendar.hijri?.arabicEra || 'هـ';

  // Whether user is viewing current Hijri month
  const isViewingCurrentMonth = viewYear === currentHijri.year && viewMonth === currentHijri.month;

  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs space-y-4 ${className}`}
      aria-label={t.calendar.hijri?.title || 'Hijri Calendar'}
      aria-readonly={readOnly}
    >
      {/* ==================== CALENDAR HEADER ==================== */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
        {/* Left: Arabic Script & Localized Month/Year Title */}
        <div className="flex items-center gap-3">
          <span className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 shrink-0">
            <Moon className="w-5 h-5" />
          </span>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span
                dir="rtl"
                className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 font-arabic tracking-wide"
              >
                {arabicMonthName} {arabicYearStr} {arabicEraStr}
              </span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300">
                {t.calendar.hijri?.title || 'Hijri'}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {localizedMonthName} {viewYear} {eraStr}
            </p>
          </div>
        </div>

        {/* Right: Sighting Adjustment & Navigation Controls */}
        <div className="flex items-center gap-2 flex-wrap self-end sm:self-auto">
          {/* Moon Sighting Adjustment Indicator / Toggle (-1, 0, +1 day) */}
          <div
            className="flex items-center rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 p-0.5"
            title={t.calendar.hijri?.adjustmentTooltip}
            aria-label={t.calendar.hijri?.sightingAdjustment}
          >
            {[-1, 0, 1].map((offset) => {
              const isActive = adjustment === offset;
              const label =
                offset === 0
                  ? '0'
                  : offset > 0
                  ? `+${offset}`
                  : `${offset}`;

              return (
                <button
                  key={offset}
                  type="button"
                  onClick={() => handleSetAdjustment(offset)}
                  aria-pressed={isActive}
                  className={`min-h-[36px] px-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-emerald-600 text-white shadow-xs dark:bg-emerald-500'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                  title={`${t.calendar.hijri?.sightingAdjustment}: ${label}`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Month Navigation Buttons */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handlePrevMonth}
              aria-label={t.calendar.prevMonth}
              className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center cursor-pointer transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {!isViewingCurrentMonth && (
              <button
                type="button"
                onClick={handleJumpToCurrentMonth}
                className="px-3 min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-center cursor-pointer transition-colors"
              >
                {t.calendar.hijri?.today || t.calendar.today}
              </button>
            )}

            <button
              type="button"
              onClick={handleNextMonth}
              aria-label={t.calendar.nextMonth}
              className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center cursor-pointer transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ==================== WEEKDAYS HEADER (Monday - Sunday) ==================== */}
      <div className="grid grid-cols-7 gap-1 sm:gap-2 text-center" role="row">
        {t.calendar.weekdaysShort.map((dayLabel, idx) => (
          <div
            key={idx}
            className={`text-[11px] sm:text-xs font-semibold py-1.5 ${
              idx === 4
                ? 'text-emerald-700 dark:text-emerald-400 font-bold' // Blessed Jumu'ah (Friday)
                : idx >= 5
                ? 'text-slate-600 dark:text-slate-400'
                : 'text-slate-500 dark:text-slate-400'
            }`}
            role="columnheader"
          >
            {dayLabel}
          </div>
        ))}
      </div>

      {/* ==================== HIJRI DAYS MATRIX (Days 1 to 29/30) ==================== */}
      <div
        className="grid grid-cols-7 gap-1 sm:gap-2"
        role="grid"
        aria-label={`${arabicMonthName} ${viewYear}`}
      >
        {/* Padding cells before day 1 */}
        {Array.from({ length: startDayOfWeek }).map((_, padIdx) => (
          <div
            key={`hpad-${padIdx}`}
            className="aspect-square min-h-[48px] rounded-xl bg-transparent"
            aria-hidden="true"
          />
        ))}

        {/* Hijri Day Cells */}
        {monthDays.map((cell) => {
          const isSelected = cell.gregorianDateStr === selectedDate;
          const isToday =
            cell.gregorianDateStr === liturgicalDate || cell.gregorianDateStr === calendarDate;
          const isFuture = cell.isFuture;
          const record = records[cell.gregorianDateStr];
          const prayers = record?.prayers;

          const gregorianShort = formatShortGregorianDate(cell.gregorianDateStr, lang);

          return (
            <button
              key={cell.gregorianDateStr}
              type="button"
              role="gridcell"
              disabled={isFuture}
              aria-disabled={isFuture}
              aria-selected={isSelected}
              onClick={() => onSelectDate(cell.gregorianDateStr)}
              className={`relative aspect-square min-h-[48px] sm:min-h-[52px] rounded-xl p-1 sm:p-1.5 flex flex-col items-center justify-between transition-all select-none ${
                isFuture
                  ? 'opacity-30 bg-slate-50/50 dark:bg-slate-900/30 text-slate-400 cursor-not-allowed pointer-events-none'
                  : isSelected
                  ? 'ring-2 ring-emerald-600 dark:ring-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 shadow-xs text-slate-900 dark:text-slate-100 font-bold z-10 cursor-pointer'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 cursor-pointer'
              } ${
                isToday && !isSelected
                  ? 'border border-emerald-500/70 dark:border-emerald-500/60 font-bold'
                  : 'border border-slate-100 dark:border-slate-800/80'
              }`}
            >
              {/* Top: Hijri Day Number & Today Dot */}
              <div className="w-full flex items-center justify-between">
                <span
                  className={`text-xs sm:text-sm font-semibold leading-none ${
                    isToday
                      ? 'text-emerald-700 dark:text-emerald-400 font-black'
                      : ''
                  }`}
                >
                  {cell.hijriDay}
                </span>

                {isToday && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400 shrink-0"
                    title={t.calendar.today}
                  />
                )}
              </div>

              {/* Middle: Small Gregorian Date Subtext */}
              <span className="text-[9px] sm:text-[10px] text-slate-400 dark:text-slate-500 font-medium leading-none truncate max-w-full">
                {gregorianShort}
              </span>

              {/* Bottom: 5 Prayer Status Dots (Fajr, Dhuhr, Asr, Maghrib, Isha) */}
              {!isFuture && (
                <div className="w-full flex items-center justify-center gap-0.5 sm:gap-1 mt-auto pb-0.5">
                  {PRAYER_IDS.map((p) => {
                    const status = prayers?.[p]?.status;
                    let dotBg = 'bg-slate-200 dark:bg-slate-700';

                    if (
                      status === 'PRAYED_ON_TIME' ||
                      status === 'PRAYED' ||
                      status === 'PRAYED_LATE'
                    ) {
                      dotBg = 'bg-emerald-500';
                    } else if (status === 'MISSED') {
                      dotBg = 'bg-rose-500';
                    } else if (status === 'MADE_UP') {
                      dotBg = 'bg-sky-500';
                    }

                    return (
                      <span
                        key={p}
                        className={`w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full transition-colors ${dotBg}`}
                      />
                    );
                  })}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* ==================== FOOTER NOTE & SIGHTING EXPLANATION ==================== */}
      <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{t.calendar.hijri?.adjustmentTooltip}</span>
        </div>

        <div className="flex items-center gap-1 text-[11px] text-slate-400">
          <span>{t.calendar.hijri?.sightingAdjustment}:</span>
          <span className="font-semibold text-slate-600 dark:text-slate-300">
            {adjustment === 0
              ? t.calendar.hijri?.standard || '0'
              : adjustment > 0
              ? `+${adjustment}`
              : `${adjustment}`}
          </span>
        </div>
      </div>
    </div>
  );
}
