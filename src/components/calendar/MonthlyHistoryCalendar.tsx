'use client';

import React, { useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Check,
  Loader2,
  Sun,
  Sunrise,
  Sunset,
  Moon,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { getCalendarDate, getLiturgicalDate } from '@/lib/prayer-cycle';
import { formatLocalizedDate } from '@/lib/formatters';
import type { PrayerId, PrayerStatus, PrayerHistoryRecord } from '@/types/prayer';

const PRAYER_IDS: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

const PRAYER_ICONS: Record<PrayerId, React.ComponentType<{ className?: string }>> = {
  fajr: Sunrise,
  dhuhr: Sun,
  asr: Sun,
  maghrib: Sunset,
  isha: Moon,
};

export interface MonthlyHistoryCalendarProps {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  records: Record<string, PrayerHistoryRecord>;
  onUpdatePrayerStatus: (date: string, prayerId: PrayerId, status: PrayerStatus) => Promise<void>;
  updatingPrayerKey?: string | null;
  viewYear: number;
  viewMonth: number; // 0-indexed: 0 = Jan, 11 = Dec
  onChangeMonth: (year: number, month: number) => void;
  isLoading?: boolean;
}

export default function MonthlyHistoryCalendar({
  selectedDate,
  onSelectDate,
  records,
  onUpdatePrayerStatus,
  updatingPrayerKey,
  viewYear,
  viewMonth,
  onChangeMonth,
  isLoading = false,
}: MonthlyHistoryCalendarProps) {
  const { t, lang } = useLanguage();
  const calendarDate = useMemo(() => getCalendarDate(), []);
  const liturgicalDate = useMemo(() => getLiturgicalDate(), []);

  // Determine current calendar boundary
  const todayDate = useMemo(() => new Date(), []);
  const currentYear = todayDate.getFullYear();
  const currentMonth = todayDate.getMonth();

  // Whether user is viewing current month or future (disable next button)
  const isCurrentOrFutureMonth =
    viewYear > currentYear || (viewYear === currentYear && viewMonth >= currentMonth);

  // Month navigation handlers
  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      onChangeMonth(viewYear - 1, 11);
    } else {
      onChangeMonth(viewYear, viewMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (isCurrentOrFutureMonth) return;
    if (viewMonth === 11) {
      onChangeMonth(viewYear + 1, 0);
    } else {
      onChangeMonth(viewYear, viewMonth + 1);
    }
  };

  const handleJumpToToday = () => {
    onChangeMonth(currentYear, currentMonth);
    onSelectDate(liturgicalDate);
  };

  // Calendar matrix calculations: Monday-based week (0 = Monday, 6 = Sunday)
  const daysInMonth = useMemo(() => {
    return new Date(viewYear, viewMonth + 1, 0).getDate();
  }, [viewYear, viewMonth]);

  const startDayOfWeek = useMemo(() => {
    // getDay(): 0 = Sun, 1 = Mon, ..., 6 = Sat
    const rawDay = new Date(viewYear, viewMonth, 1).getDay();
    return (rawDay + 6) % 7; // Convert to Mon = 0, Sun = 6
  }, [viewYear, viewMonth]);

  // Construct day cells array
  const dayCells = useMemo(() => {
    const cells: Array<{
      dayNumber: number;
      dateStr: string;
      isFuture: boolean;
      isToday: boolean;
    }> = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const monthStr = String(viewMonth + 1).padStart(2, '0');
      const dayStr = String(day).padStart(2, '0');
      const dateStr = `${viewYear}-${monthStr}-${dayStr}`;
      const isFuture = dateStr > calendarDate;
      const isToday = dateStr === liturgicalDate || dateStr === calendarDate;

      cells.push({
        dayNumber: day,
        dateStr,
        isFuture,
        isToday,
      });
    }

    return cells;
  }, [viewYear, viewMonth, daysInMonth, calendarDate, liturgicalDate]);

  // Selected date record & prayers breakdown
  const selectedRecord = records[selectedDate];
  const selectedPrayers = selectedRecord?.prayers;

  const selectedDayCompletion = useMemo(() => {
    if (!selectedPrayers) return { completed: 0, total: 5, onTime: 0, missed: 0, madeUp: 0 };
    let completed = 0;
    let onTime = 0;
    let missed = 0;
    let madeUp = 0;

    for (const p of PRAYER_IDS) {
      const status = selectedPrayers[p]?.status;
      if (status === 'PRAYED_ON_TIME' || status === 'PRAYED' || status === 'PRAYED_LATE') {
        completed++;
        onTime++;
      } else if (status === 'MADE_UP') {
        completed++;
        madeUp++;
      } else if (status === 'MISSED') {
        missed++;
      }
    }

    return { completed, total: 5, onTime, missed, madeUp };
  }, [selectedPrayers]);

  // Format localized display for selected date
  const formattedSelectedDate = useMemo(() => {
    return formatLocalizedDate(selectedDate, lang);
  }, [selectedDate, lang]);

  // Month & Year title
  const currentMonthTitle = useMemo(() => {
    const monthName = t.calendar.months[viewMonth] || '';
    return `${monthName} ${viewYear}`;
  }, [viewMonth, viewYear, t.calendar.months]);

  // Status badge styling helper
  const getStatusBadge = (status: PrayerStatus) => {
    switch (status) {
      case 'PRAYED_ON_TIME':
      case 'PRAYED':
      case 'PRAYED_LATE':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>{t.statuses.PRAYED}</span>
          </span>
        );
      case 'MISSED':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
            <AlertCircle className="w-3 h-3 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>{t.statuses.MISSED}</span>
          </span>
        );
      case 'MADE_UP':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-sky-50 dark:bg-sky-950/80 text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
            <RotateCcw className="w-3 h-3 text-sky-600 dark:text-sky-400 shrink-0" />
            <span>{t.statuses.MADE_UP}</span>
          </span>
        );
      case 'PENDING':
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
            <span>{t.statuses.PENDING}</span>
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Calendar & Inspector Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* ==================== LEFT COLUMN: INTERACTIVE MONTHLY CALENDAR ==================== */}
        <div className="lg:col-span-7 xl:col-span-8 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs space-y-5">
          {/* Calendar Header with Navigation Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2.5">
              <span className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
                <CalendarIcon className="w-5 h-5" />
              </span>
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
                  {currentMonthTitle}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t.calendar.subtitle}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 self-end sm:self-auto">
              <button
                type="button"
                onClick={handlePrevMonth}
                aria-label={t.calendar.prevMonth}
                className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center cursor-pointer transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={handleJumpToToday}
                className="px-3 min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-center cursor-pointer transition-colors"
              >
                {t.calendar.today}
              </button>

              <button
                type="button"
                onClick={handleNextMonth}
                disabled={isCurrentOrFutureMonth}
                aria-label={t.calendar.nextMonth}
                className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Weekday Column Headers (Mon - Sun) */}
          <div
            className="grid grid-cols-7 gap-1 sm:gap-2 text-center"
            role="row"
          >
            {t.calendar.weekdaysShort.map((dayLabel, idx) => (
              <div
                key={idx}
                className={`text-[11px] sm:text-xs font-semibold py-1.5 ${
                  idx >= 5
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
                role="columnheader"
              >
                {dayLabel}
              </div>
            ))}
          </div>

          {/* Calendar Days Matrix */}
          <div
            className="grid grid-cols-7 gap-1 sm:gap-2"
            role="grid"
            aria-label={currentMonthTitle}
          >
            {/* Empty Offset Padding Cells */}
            {Array.from({ length: startDayOfWeek }).map((_, padIdx) => (
              <div
                key={`pad-${padIdx}`}
                className="aspect-square min-h-[44px] rounded-xl bg-transparent"
                aria-hidden="true"
              />
            ))}

            {/* Day Number Cells */}
            {dayCells.map(({ dayNumber, dateStr, isFuture, isToday }) => {
              const isSelected = dateStr === selectedDate;
              const record = records[dateStr];
              const prayers = record?.prayers;

              // Calculate day prayer statuses
              let onTime = 0;
              let madeUp = 0;

              for (const p of PRAYER_IDS) {
                const status = prayers?.[p]?.status || 'PENDING';
                if (status === 'PRAYED_ON_TIME' || status === 'PRAYED' || status === 'PRAYED_LATE') onTime++;
                else if (status === 'MADE_UP') madeUp++;
              }

              const completed = onTime + madeUp;
              const hasData = record !== undefined;

              return (
                <button
                  key={dateStr}
                  type="button"
                  role="gridcell"
                  disabled={isFuture}
                  aria-disabled={isFuture}
                  aria-selected={isSelected}
                  onClick={() => onSelectDate(dateStr)}
                  className={`relative aspect-square min-h-[44px] rounded-xl p-1 sm:p-1.5 flex flex-col items-center justify-between transition-all select-none ${
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
                  {/* Day Number & Today indicator */}
                  <div className="w-full flex items-center justify-between">
                    <span
                      className={`text-xs sm:text-sm font-semibold leading-none ${
                        isToday
                          ? 'text-emerald-700 dark:text-emerald-400 font-black'
                          : ''
                      }`}
                    >
                      {dayNumber}
                    </span>

                    {isToday && (
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400 shrink-0"
                        title={t.calendar.today}
                      />
                    )}
                  </div>

                  {/* Prayer Dots Array (5 dots for Fajr, Dhuhr, Asr, Maghrib, Isha) */}
                  {!isFuture && (
                    <div className="w-full flex items-center justify-center gap-0.5 sm:gap-1 mt-auto pb-0.5">
                      {PRAYER_IDS.map((p) => {
                        const status = prayers?.[p]?.status;
                        let dotBg = 'bg-slate-200 dark:bg-slate-700';

                        if (status === 'PRAYED_ON_TIME' || status === 'PRAYED' || status === 'PRAYED_LATE') {
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

                  {/* Tablet/Desktop fractional completion badge */}
                  {!isFuture && hasData && completed > 0 && (
                    <span className="hidden sm:inline-block text-[9px] font-bold text-slate-500 dark:text-slate-400 leading-none">
                      {completed}/5
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Calendar Status Legend */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              {t.calendar.legend.title}:
            </span>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="text-[11px]">{t.calendar.legend.perfect}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span className="text-[11px]">{t.calendar.legend.partial}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                <span className="text-[11px]">{t.calendar.legend.missed}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-300 dark:bg-slate-700" />
                <span className="text-[11px]">{t.calendar.legend.pending}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ==================== RIGHT COLUMN: SELECTED DATE DETAIL CARD ==================== */}
        <div className="lg:col-span-5 xl:col-span-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 shadow-xs space-y-5 lg:sticky lg:top-6">
          {/* Card Header */}
          <div className="pb-3 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between gap-3">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                {t.calendar.selectedDateTitle}
              </span>
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                {formattedSelectedDate}
              </h3>
            </div>

            {(selectedDate === liturgicalDate || selectedDate === calendarDate) && (
              <span className="px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 text-xs font-bold shrink-0">
                {t.calendar.today}
              </span>
            )}
          </div>

          {/* Completion summary bar */}
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800/80 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                {t.calendar.dayCompletion
                  .replace('{completed}', String(selectedDayCompletion.completed))
                  .replace('{total}', String(selectedDayCompletion.total))}
              </span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                {Math.round((selectedDayCompletion.completed / 5) * 100)}%
              </span>
            </div>

            <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
              <div
                className="bg-emerald-600 h-full rounded-full transition-all duration-300"
                style={{ width: `${(selectedDayCompletion.completed / 5) * 100}%` }}
              />
            </div>
          </div>

          {/* Prayers List with One-Click Quick Actions */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                {t.calendar.editDayPrayers}
              </h4>
              {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" />}
            </div>

            <div className="space-y-2.5">
              {PRAYER_IDS.map((p) => {
                const prayerStatus: PrayerStatus = selectedPrayers?.[p]?.status || 'PENDING';
                const IconComponent = PRAYER_ICONS[p];
                const prayerKey = `${selectedDate}-${p}`;
                const isRowUpdating = updatingPrayerKey === prayerKey;

                return (
                  <div
                    key={p}
                    className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="p-1 rounded-lg bg-emerald-100/70 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                          <IconComponent className="w-3.5 h-3.5" />
                        </span>
                        <span className="text-xs font-bold text-slate-900 dark:text-slate-100 capitalize">
                          {t.prayers[p]}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {isRowUpdating && <Loader2 className="w-3 h-3 animate-spin text-emerald-600" />}
                        {getStatusBadge(prayerStatus)}
                      </div>
                    </div>

                    {/* 3 Canonical Action Buttons */}
                    <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
                      {/* 1. Prayed */}
                      <button
                        type="button"
                        disabled={isRowUpdating}
                        onClick={() => onUpdatePrayerStatus(selectedDate, p, 'PRAYED_ON_TIME')}
                        title={t.dashboard.markPrayed}
                        className={`min-h-[44px] rounded-xl font-semibold flex items-center justify-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-2 text-[11px] sm:text-xs leading-tight transition-colors duration-150 cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed text-center ${
                          prayerStatus === 'PRAYED_ON_TIME' || prayerStatus === 'PRAYED' || prayerStatus === 'PRAYED_LATE'
                            ? 'bg-emerald-600 text-white font-bold shadow-xs border border-emerald-600 dark:bg-emerald-500 dark:border-emerald-500'
                            : 'bg-emerald-50 hover:bg-emerald-100/90 text-emerald-800 border border-emerald-200/80 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/60 dark:text-emerald-300 dark:border-emerald-800/60'
                        }`}
                      >
                        <Check className="w-3.5 h-3.5 shrink-0 hidden sm:inline" />
                        <span>{t.dashboard.markPrayed}</span>
                      </button>

                      {/* 2. Made Up */}
                      <button
                        type="button"
                        disabled={isRowUpdating}
                        onClick={() => onUpdatePrayerStatus(selectedDate, p, 'MADE_UP')}
                        title={t.dashboard.markMadeUp}
                        className={`min-h-[44px] rounded-xl font-semibold flex items-center justify-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-2 text-[11px] sm:text-xs leading-tight transition-colors duration-150 cursor-pointer focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed text-center ${
                          prayerStatus === 'MADE_UP'
                            ? 'bg-sky-600 text-white font-bold shadow-xs border border-sky-600 dark:bg-sky-500 dark:border-sky-500'
                            : 'bg-sky-50 hover:bg-sky-100/90 text-sky-800 border border-sky-200/80 dark:bg-sky-950/40 dark:hover:bg-sky-900/60 dark:text-sky-300 dark:border-sky-800/60'
                        }`}
                      >
                        <RotateCcw className="w-3.5 h-3.5 shrink-0 hidden sm:inline" />
                        <span>{t.dashboard.markMadeUp}</span>
                      </button>

                      {/* 3. Qaza */}
                      <button
                        type="button"
                        disabled={isRowUpdating}
                        onClick={() => onUpdatePrayerStatus(selectedDate, p, 'MISSED')}
                        title={t.dashboard.markMissed}
                        className={`min-h-[44px] rounded-xl font-semibold flex items-center justify-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-2 text-[11px] sm:text-xs leading-tight transition-colors duration-150 cursor-pointer focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed text-center ${
                          prayerStatus === 'MISSED'
                            ? 'bg-rose-600 text-white font-bold shadow-xs border border-rose-600 dark:bg-rose-500 dark:border-rose-500'
                            : 'bg-rose-50 hover:bg-rose-100/90 text-rose-800 border border-rose-200/80 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 dark:text-rose-300 dark:border-rose-800/60'
                        }`}
                      >
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 hidden sm:inline" />
                        <span>{t.dashboard.markMissed}</span>
                      </button>
                    </div>

                    {/* Reset to Pending (if already marked) */}
                    {prayerStatus !== 'PENDING' && (
                      <div className="flex justify-end pt-0.5">
                        <button
                          type="button"
                          disabled={isRowUpdating}
                          onClick={() => onUpdatePrayerStatus(selectedDate, p, 'PENDING')}
                          className="min-h-[44px] px-2.5 py-1 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 underline cursor-pointer flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 focus-visible:outline-none rounded-lg font-medium disabled:opacity-50"
                        >
                          {t.dashboard.resetToPending}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
