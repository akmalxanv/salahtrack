'use client';

import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  TrendingUp,
  History as HistoryIcon,
  BarChart3,
  Scale,
  CheckCircle2,
  AlertCircle,
  Flame,
  Plus,
  Minus,
  Loader2,
  LogIn,
  ChevronRight,
  Award,
  Check,
  Info,
  RotateCcw,
  HeartHandshake,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import type {
  PrayerId,
  PrayerStatus,
  AccountabilityBreakdownItem,
  PrayerHistoryRecord,
  PrayerItem,
  QazaPaymentReceipt,
} from '@/types/prayer';
import PayQazaModal from '@/components/qaza/PayQazaModal';
import MonthlyHistoryCalendar from '@/components/calendar/MonthlyHistoryCalendar';
import { calculateAccountabilityLedger } from '@/lib/accountability';
import { formatCurrency } from '@/lib/formatters';
import { getCalendarDate, getLiturgicalDate } from '@/lib/prayer-cycle';
import {
  getStoredHistoryRecords,
  saveStoredHistoryRecords,
  mirrorDailyPrayersToHistory,
  saveDailyPrayersSync,
} from '@/lib/storage-sync';

const PRAYER_IDS: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

// Frozen constant object to prevent React hook reference churn & infinite re-render loops
const DEFAULT_QAZA_BY_PRAYER: Readonly<Record<PrayerId, number>> = Object.freeze({
  fajr: 0,
  dhuhr: 0,
  asr: 0,
  maghrib: 0,
  isha: 0,
});

interface StatsData {
  today: {
    completed: number;
    totalPossible: number;
    percentage: number;
    onTime: number;
    late: number;
    missed: number;
    madeUp: number;
  };
  weekly: {
    completed: number;
    totalPossible: number;
    percentage: number;
  };
  monthly: {
    completed: number;
    totalPossible: number;
    percentage: number;
  };
  counts30d: {
    onTime: number;
    late: number;
    missed: number;
    madeUp: number;
  };
  streaks: {
    current: number;
    best: number;
    lastActiveDate?: string;
  };
  accountability: {
    totalAmount: number;
    totalPaidAmount?: number;
    totalMissed?: number;
    totalOverdue?: number;
    currency: string;
    baseRatePerPrayer?: number;
    overdueRatePerPrayer?: number;
    gracePeriodDays?: number;
    breakdown?: AccountabilityBreakdownItem[];
  };
}

type TabType = 'overview' | 'history' | 'qaza';

function ProgressContent() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();

  const calendarTodayStr = useMemo(() => getCalendarDate(), []);
  const liturgicalTodayStr = useMemo(() => getLiturgicalDate(), []);
  const todayDate = useMemo(() => new Date(), []);

  // Single Source of Truth for Tab Navigation (derived from searchParams to eliminate state update depth loops)
  const tabParam = searchParams.get('tab');
  const activeTab: TabType =
    tabParam === 'history' ? 'history' : tabParam === 'qaza' ? 'qaza' : 'overview';

  const handleTabChange = useCallback(
    (tab: TabType) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', tab);
      router.replace(`/progress?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  // Smoothly scroll to the analytics section of overview if tab=analytics is requested
  useEffect(() => {
    if (tabParam === 'analytics') {
      const el = document.getElementById('analytics-section');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [tabParam]);

  // Calendar View State
  const [viewYear, setViewYear] = useState(() => todayDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => todayDate.getMonth());
  const [selectedDate, setSelectedDate] = useState(() => getLiturgicalDate());

  // Historical updating indicators
  const [updatingPrayerKey, setUpdatingPrayerKey] = useState<string | null>(null);

  // Data states
  const [stats, setStats] = useState<StatsData | null>(null);
  const [recordsByDate, setRecordsByDate] = useState<Record<string, PrayerHistoryRecord>>({});
  const [loadingStats, setLoadingStats] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Local fallback Qaza state & settled donations with stable defaults
  const [localQaza, setLocalQaza] = useLocalStorage<number>('salahtrack_qaza_count', 0);
  const [settledDonations] = useLocalStorage<number>('salahtrack_settled_donations', 0);
  const [paymentHistory, setPaymentHistory] = useState<QazaPaymentReceipt[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [isPayModalOpen, setIsPayModalOpen] = useState(false);

  const [qazaByPrayer, setQazaByPrayer] = useLocalStorage<Record<PrayerId, number>>(
    'salahtrack_qaza_prayers',
    DEFAULT_QAZA_BY_PRAYER
  );

  const userId = user?.id;

  // 1. Fetch Stats from API (re-runs only when userId changes)
  const fetchStats = useCallback(async () => {
    if (!userId) return;
    setLoadingStats(true);
    try {
      const res = await fetch('/api/stats');
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setStats(json.data);
        }
      }
    } catch (err) {
      console.error('Failed to fetch progress stats:', err);
    } finally {
      setLoadingStats(false);
    }
  }, [userId]);

  const fetchPaymentHistory = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch('/api/prayers/qaza-payment');
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setPaymentHistory(json.data);
        }
      }
    } catch (err) {
      console.error('Failed to fetch payment history:', err);
    } finally {
      setLoadingPayments(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const abortController = new AbortController();

    async function loadPayments() {
      await Promise.resolve();
      setLoadingPayments(true);
      try {
        const res = await fetch('/api/prayers/qaza-payment', { signal: abortController.signal });
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.data)) {
            setPaymentHistory(json.data);
          }
        }
      } catch (err: unknown) {
        if ((err as Error)?.name !== 'AbortError') {
          console.error('Failed to fetch payment history:', err);
        }
      } finally {
        setLoadingPayments(false);
      }
    }

    loadPayments();
    return () => {
      abortController.abort();
    };
  }, [userId]);

  const handlePaymentModalSuccess = useCallback(async () => {
    await Promise.all([fetchStats(), fetchPaymentHistory()]);
  }, [fetchStats, fetchPaymentHistory]);

  useEffect(() => {
    if (!userId) return;
    const abortController = new AbortController();

    async function loadStats() {
      try {
        const res = await fetch('/api/stats', { signal: abortController.signal });
        if (res.ok) {
          const json = await res.json();
          if (json.success) {
            setStats(json.data);
          }
        }
      } catch (err: unknown) {
        if ((err as Error)?.name !== 'AbortError') {
          console.error('Failed to fetch stats:', err);
        }
      } finally {
        setLoadingStats(false);
      }
    }

    loadStats();
    return () => {
      abortController.abort();
    };
  }, [userId]);

  // 2. Fetch Monthly History (Dual-Tier: LocalStorage offline/guest fallback + MongoDB Atlas when authenticated)
  useEffect(() => {
    const abortController = new AbortController();

    async function loadMonthHistory() {
      // Step A: Load cached records from localStorage first (0ms instantaneous offline UI)
      try {
        const storedHistory = getStoredHistoryRecords();
        if (storedHistory && Object.keys(storedHistory).length > 0) {
          setRecordsByDate((prev) => ({ ...prev, ...storedHistory }));
        }

        // Also check if daily store has prayers for active liturgical date and mirror if missing
        const rawDaily = window.localStorage.getItem('salahtrack_daily_prayers');
        if (rawDaily) {
          const dailyPrayers: PrayerItem[] = JSON.parse(rawDaily);
          if (Array.isArray(dailyPrayers) && dailyPrayers.length > 0) {
            mirrorDailyPrayersToHistory(liturgicalTodayStr, dailyPrayers);
            const updated = getStoredHistoryRecords();
            setRecordsByDate((prev) => ({ ...prev, ...updated }));
          }
        }
      } catch {
        // ignore parse errors
      }

      // Step B: If authenticated, fetch server truth for the selected month
      if (!userId) return;

      setLoadingHistory(true);
      try {
        const monthStr = String(viewMonth + 1).padStart(2, '0');
        const startOfMonthStr = `${viewYear}-${monthStr}-01`;
        const lastDay = new Date(viewYear, viewMonth + 1, 0).getDate();
        const endOfMonthStr = `${viewYear}-${monthStr}-${String(lastDay).padStart(2, '0')}`;

        const res = await fetch(
          `/api/prayers/history?startDate=${startOfMonthStr}&endDate=${endOfMonthStr}`,
          { signal: abortController.signal }
        );

        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.data?.records)) {
            const mappedRecords: Record<string, PrayerHistoryRecord> = {};
            for (const rec of json.data.records) {
              if (rec.date) {
                mappedRecords[rec.date] = rec;
              }
            }

            setRecordsByDate((prev) => {
              const updated = { ...prev, ...mappedRecords };
              saveStoredHistoryRecords(updated);
              return updated;
            });
          }
        }
      } catch (err: unknown) {
        if ((err as Error)?.name !== 'AbortError') {
          console.error('Failed to fetch monthly history:', err);
        }
      } finally {
        setLoadingHistory(false);
      }
    }

    loadMonthHistory();

    return () => {
      abortController.abort();
    };
  }, [userId, viewYear, viewMonth, liturgicalTodayStr]);

  // Reactive synchronization with HomeDashboard and other tabs via local-storage-update
  useEffect(() => {
    function handleStorageUpdate() {
      try {
        const stored = getStoredHistoryRecords();
        if (stored && Object.keys(stored).length > 0) {
          setRecordsByDate((prev) => ({ ...prev, ...stored }));
        }
      } catch {
        // ignore
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('local-storage-update', handleStorageUpdate);
      return () => window.removeEventListener('local-storage-update', handleStorageUpdate);
    }
  }, []);

  // Handle month view change from calendar controls
  const handleChangeMonth = useCallback((year: number, month: number) => {
    setViewYear(year);
    setViewMonth(month);
  }, []);

  // Handle date selection with future date check
  const handleSelectDate = useCallback((date: string) => {
    setSelectedDate(date);
  }, []);

  // Historical Prayer Correction mutation (Dual-Tier optimistic update + API sync)
  const handleHistoricalCorrection = useCallback(
    async (recordDate: string, prayerId: PrayerId, newStatus: PrayerStatus) => {
      if (recordDate > calendarTodayStr) {
        alert(t.progress.futureDateError);
        return;
      }

      const key = `${recordDate}-${prayerId}`;
      setUpdatingPrayerKey(key);

      const normalizedStatus: PrayerStatus = newStatus === 'PRAYED' ? 'PRAYED_ON_TIME' : newStatus;

      // 1. Optimistic update in recordsByDate state
      setRecordsByDate((prev) => {
        const existing = prev[recordDate] || {
          date: recordDate,
          prayers: {
            fajr: { status: 'PENDING' },
            dhuhr: { status: 'PENDING' },
            asr: { status: 'PENDING' },
            maghrib: { status: 'PENDING' },
            isha: { status: 'PENDING' },
          },
          finesAccrued: 0,
        };

        const updated: Record<string, PrayerHistoryRecord> = {
          ...prev,
          [recordDate]: {
            ...existing,
            prayers: {
              ...existing.prayers,
              [prayerId]: {
                ...existing.prayers?.[prayerId],
                status: normalizedStatus,
                prayedAt:
                  normalizedStatus === 'PRAYED_ON_TIME' || normalizedStatus === 'PRAYED_LATE'
                    ? new Date().toISOString()
                    : undefined,
              },
            },
          },
        };

        // Cache update to LocalStorage
        saveStoredHistoryRecords(updated);

        return updated;
      });

      // 2. If editing today's active liturgical date, synchronize with HomeDashboard's salahtrack_daily_prayers
      if (recordDate === liturgicalTodayStr) {
        try {
          const rawDaily = window.localStorage.getItem('salahtrack_daily_prayers');
          if (rawDaily) {
            const parsedDaily: PrayerItem[] = JSON.parse(rawDaily);
            if (Array.isArray(parsedDaily)) {
              const updatedDaily = parsedDaily.map((item) =>
                item.id === prayerId ? { ...item, status: normalizedStatus } : item
              );
              saveDailyPrayersSync(recordDate, updatedDaily);
            }
          }
        } catch (err) {
          console.error('Failed to sync today prayers with daily store:', err);
        }
      }

      // 3. Persist to MongoDB Atlas if authenticated
      if (user) {
        try {
          const res = await fetch('/api/prayers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              date: recordDate,
              prayerId,
              status: normalizedStatus,
            }),
          });

          if (res.ok) {
            await fetchStats();
          } else {
            console.warn('Historical edit persistence warning: server did not confirm 200');
          }
        } catch (err) {
          console.error('Error updating historical record to server:', err);
        } finally {
          setUpdatingPrayerKey(null);
        }
      } else {
        setUpdatingPrayerKey(null);
      }
    },
    [calendarTodayStr, liturgicalTodayStr, t.progress.futureDateError, user, fetchStats]
  );

  // Qaza adjustment helpers
  const adjustQaza = (prayer: PrayerId, delta: number) => {
    setQazaByPrayer((prev) => {
      const current = prev?.[prayer] || 0;
      const updated = Math.max(0, current + delta);
      return {
        ...prev,
        [prayer]: updated,
      };
    });
    setLocalQaza((prev) => Math.max(0, (prev || 0) + delta));
  };


  // Sorted list of historical records (descending date)
  const sortedHistoryRecords = useMemo(() => {
    return Object.values(recordsByDate).sort((a, b) => b.date.localeCompare(a.date));
  }, [recordsByDate]);

  // Analytical stats breakdown computed across historical records
  const prayerBreakdown = useMemo(() => {
    const counts: Record<PrayerId, { onTime: number; missed: number; total: number }> = {
      fajr: { onTime: 0, missed: 0, total: 0 },
      dhuhr: { onTime: 0, missed: 0, total: 0 },
      asr: { onTime: 0, missed: 0, total: 0 },
      maghrib: { onTime: 0, missed: 0, total: 0 },
      isha: { onTime: 0, missed: 0, total: 0 },
    };

    for (const record of sortedHistoryRecords) {
      if (!record.prayers) continue;
      for (const p of PRAYER_IDS) {
        const item = record.prayers[p];
        if (!item) continue;
        counts[p].total += 1;
        if (item.status === 'PRAYED_ON_TIME' || item.status === 'PRAYED' || item.status === 'PRAYED_LATE') {
          counts[p].onTime += 1;
        } else if (item.status === 'MISSED') {
          counts[p].missed += 1;
        }
      }
    }
    return counts;
  }, [sortedHistoryRecords]);

  // Total Qaza count
  const totalQazaCount = useMemo(() => {
    return Object.values(qazaByPrayer || {}).reduce((acc, val) => acc + (val || 0), 0) || localQaza || 0;
  }, [qazaByPrayer, localQaza]);

  // Accountability calculations: single source of truth calculation for instant 0ms offline/pre-fetch UI,
  // reconciled with server stats once fetched. Prevents arbitrary default multiplication bug.
  const localLedger = useMemo(() => {
    return calculateAccountabilityLedger(recordsByDate);
  }, [recordsByDate]);

  const accountabilityTotal = stats?.accountability?.totalAmount ?? localLedger.totalAmount;
  const accountabilityMissed = stats?.accountability?.totalMissed ?? localLedger.missedCount;
  const accountabilityOverdue =
    stats?.accountability?.totalOverdue ?? localLedger.items.filter((it) => it.isOverdue).length;
  const fineItems = stats?.accountability?.breakdown || localLedger.items;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="w-5 h-5" />
            </span>
            <span>{t.progress.title}</span>
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {t.progress.subtitle}
          </p>
        </div>

        {!user && (
          <Link
            href="/login"
            className="self-start sm:self-auto py-2 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-2 shadow-xs transition-colors cursor-pointer"
          >
            <LogIn className="w-4 h-4" />
            <span>{t.nav.login}</span>
          </Link>
        )}
      </header>

      {/* Guest Mode Notice */}
      {!user && (
        <div className="p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-900/40 text-amber-800 dark:text-amber-300 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>{t.progress.signInPrompt}</span>
          </div>
          <Link
            href="/signup"
            className="font-bold underline shrink-0 hover:text-amber-900 dark:hover:text-amber-200"
          >
            {t.nav.signup}
          </Link>
        </div>
      )}

      {/* Segmented Navigation Tabs */}
      <div className="border-b border-slate-200 dark:border-slate-800">
        <nav
          className="flex space-x-2 sm:space-x-4 overflow-x-auto no-scrollbar"
          aria-label={t.progress.title}
          role="tablist"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'overview'}
            onClick={() => handleTabChange('overview')}
            className={`min-h-[44px] py-2.5 px-3.5 border-b-2 text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors flex items-center gap-2 cursor-pointer ${
              activeTab === 'overview'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            <span>{t.progress.tabs.overview}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'history'}
            onClick={() => handleTabChange('history')}
            className={`min-h-[44px] py-2.5 px-3.5 border-b-2 text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors flex items-center gap-2 cursor-pointer ${
              activeTab === 'history'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <HistoryIcon className="w-4 h-4" />
            <span>{t.progress.tabs.history}</span>
          </button>


          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'qaza'}
            onClick={() => handleTabChange('qaza')}
            className={`min-h-[44px] py-2.5 px-3.5 border-b-2 text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors flex items-center gap-2 cursor-pointer ${
              activeTab === 'qaza'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Scale className="w-4 h-4" />
            <span>{t.progress.tabs.qaza}</span>
            {accountabilityTotal > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-rose-100 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300 font-bold">
                {formatCurrency(accountabilityTotal, lang)}
              </span>
            )}
          </button>
        </nav>
      </div>

      {/* ==================== TAB 1: OVERVIEW ==================== */}
      {activeTab === 'overview' && (
        loadingStats && !stats ? (
          <div className="py-12 flex justify-center text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
          </div>
        ) : (
          <div className="space-y-4 sm:space-y-6">
            {/* Executive KPI Stats Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
              {/* Completion */}
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                  {t.progress.summary.completionRate}
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                    {stats ? `${stats.weekly.percentage}%` : '0%'}
                  </span>
                  <span className="text-[11px] text-slate-400">{t.progress.periods.d7}</span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full mt-2.5 overflow-hidden">
                  <div
                    className="bg-emerald-600 h-full rounded-full transition-all duration-500"
                    style={{ width: `${stats ? stats.weekly.percentage : 0}%` }}
                  />
                </div>
              </div>

              {/* Streak */}
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                  {t.progress.summary.currentStreak}
                </span>
                <div className="flex items-center gap-1.5">
                  <Flame className="w-5 h-5 text-amber-500 fill-amber-500" />
                  <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                    {stats?.streaks.current || 0}
                  </span>
                  <span className="text-xs text-slate-400 font-medium">{t.dashboard.streakDays}</span>
                </div>
                <span className="text-[10px] text-slate-400 mt-2 block">
                  {t.progress.summary.bestStreak}: {stats?.streaks.best || 0}
                </span>
              </div>

              {/* On-Time Rate */}
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                  {t.progress.summary.onTimeRate}
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                    {(stats?.counts30d.onTime || 0) + (stats?.counts30d.late || 0)}
                  </span>
                  <span className="text-xs text-slate-400 font-medium">/ 150</span>
                </div>
                <span className="text-[10px] text-slate-400 mt-2 block">{t.progress.indicator30d}</span>
              </div>

              {/* Accountability Outstanding Balance */}
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                  {t.accountability.title}
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xl font-bold text-rose-600 dark:text-rose-400">
                    {accountabilityTotal.toLocaleString()}
                  </span>
                  <span className="text-[10px] text-slate-400">{t.common.currency}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleTabChange('qaza')}
                  className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 mt-2 flex items-center gap-1 cursor-pointer"
                >
                  <span>{t.progress.detailedBreakdown}</span>
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Consolidated Analytics Section */}
            <div id="analytics-section" className="space-y-4 sm:space-y-6 pt-2 scroll-mt-6">
              {/* Consistency by Prayer */}
              <div className="rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs space-y-5">
                <div className="flex items-center gap-2.5">
                  <BarChart3 className="w-5 h-5 text-emerald-600" />
                  <div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                      {t.progress.consistencyTitle}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {t.progress.consistencySubtitle}
                    </p>
                  </div>
                </div>

                <div className="space-y-4 pt-2">
                  {PRAYER_IDS.map((p) => {
                    const item = prayerBreakdown[p];
                    const pct = item.total > 0 ? Math.round((item.onTime / item.total) * 100) : 0;
                    return (
                      <div key={p} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-700 dark:text-slate-300 capitalize">
                            {t.prayers[p]}
                          </span>
                          <span className="font-bold text-slate-900 dark:text-slate-100">
                            {pct}% ({item.onTime}/{item.total})
                          </span>
                        </div>
                        <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                          <div
                            className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 30-Day Metric Breakdown Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40">
                  <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 block mb-1">
                    {t.statuses.PRAYED}
                  </span>
                  <span className="text-2xl font-bold text-emerald-800 dark:text-emerald-200">
                    {(stats?.counts30d.onTime || 0) + (stats?.counts30d.late || 0)}
                  </span>
                </div>
                <div className="p-4 rounded-2xl bg-sky-50/50 dark:bg-sky-950/20 border border-sky-100 dark:border-sky-900/40">
                  <span className="text-xs font-semibold text-sky-700 dark:text-sky-400 block mb-1">
                    {t.statuses.MADE_UP}
                  </span>
                  <span className="text-2xl font-bold text-sky-800 dark:text-sky-200">
                    {stats?.counts30d.madeUp || 0}
                  </span>
                </div>
                <div className="p-4 rounded-2xl bg-rose-50/50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/40">
                  <span className="text-xs font-semibold text-rose-700 dark:text-rose-400 block mb-1">
                    {t.statuses.MISSED}
                  </span>
                  <span className="text-2xl font-bold text-rose-800 dark:text-rose-200">
                    {stats?.counts30d.missed || 0}
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Insights Banner */}
            <div className="p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-r from-emerald-500/10 via-teal-500/5 to-transparent flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
                  <Award className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {t.progress.insights.title}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {t.progress.insights.streakEncouragement}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleTabChange('history')}
                className="min-h-[44px] py-2 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shrink-0 cursor-pointer"
              >
                {t.progress.tabs.history}
              </button>
            </div>

            {/* Recent History Preview */}
            <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 shadow-xs p-3.5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <HistoryIcon className="w-5 h-5 text-emerald-600" />
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {t.progress.recentHistoryTitle}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => handleTabChange('history')}
                  className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 flex items-center gap-1 cursor-pointer"
                >
                  <span>{t.progress.viewAll}</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {sortedHistoryRecords.length === 0 ? (
                <p className="text-xs text-slate-400 py-4 text-center">
                  {t.history.noRecords}
                </p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {sortedHistoryRecords.slice(0, 5).map((record) => (
                    <div key={record.date} className="py-3 flex items-center justify-between gap-4">
                      <div>
                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {record.date}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {Object.values(record.prayers || {}).filter(
                            (p) => p.status === 'PRAYED' || p.status === 'PRAYED_ON_TIME'
                          ).length} / 5 {t.progress.prayersCompletedRecord}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {PRAYER_IDS.map((p) => {
                          const status = record.prayers?.[p]?.status || 'PENDING';
                          return (
                            <div
                              key={p}
                              title={`${p}: ${status}`}
                              className={`w-2.5 h-2.5 rounded-full ${
                                status === 'PRAYED_ON_TIME' || status === 'PRAYED' || status === 'PRAYED_LATE'
                                  ? 'bg-emerald-500'
                                  : status === 'MADE_UP'
                                  ? 'bg-sky-500'
                                  : status === 'MISSED'
                                  ? 'bg-rose-500'
                                  : 'bg-slate-300 dark:bg-slate-700'
                              }`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      )}

      {/* ==================== TAB 2: INTERACTIVE HISTORY & MONTHLY CALENDAR ==================== */}
      {activeTab === 'history' && (
        <div className="space-y-6">
          {/* Historical notice */}
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{t.progress.historicalEditNotice}</span>
            </div>
          </div>

          {/* Interactive Monthly Calendar & Selected Day Inspector */}
          <MonthlyHistoryCalendar
            selectedDate={selectedDate}
            onSelectDate={handleSelectDate}
            records={recordsByDate}
            onUpdatePrayerStatus={handleHistoricalCorrection}
            updatingPrayerKey={updatingPrayerKey}
            viewYear={viewYear}
            viewMonth={viewMonth}
            onChangeMonth={handleChangeMonth}
            isLoading={loadingHistory}
          />
        </div>
      )}


      {/* ==================== TAB 4: ACCOUNTABILITY & FINES ==================== */}
      {activeTab === 'qaza' && (
        <div className="space-y-4 sm:space-y-6">
          {/* Executive Accountability Card */}
          <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 text-white p-3.5 sm:p-6 shadow-sm border border-slate-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                {t.accountability.title}
              </span>
              <p className="text-3xl font-black text-white mt-1">
                {formatCurrency(accountabilityTotal, lang)}
              </p>
              <div className="flex items-center gap-4 text-xs text-slate-300 mt-2">
                <span>{t.progress.missedPrayersCount.replace('{count}', String(accountabilityMissed))}</span>
                <span>•</span>
                <span className="text-amber-400">{t.progress.overduePrayersCount.replace('{count}', String(accountabilityOverdue))}</span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-white/10 text-xs text-slate-300 max-w-md">
              <span className="font-bold text-white block mb-1">
                {t.accountability.disclaimer}
              </span>
              <p className="text-[11px] leading-relaxed text-slate-300">
                {t.progress.recordPaymentDesc} {t.progress.finesPolicyNotice}
              </p>
            </div>
          </div>

          {/* Settled / Sadaqah Tracking Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                {t.progress.settledAmount}
              </span>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                {formatCurrency(
                  stats?.accountability?.totalPaidAmount ?? (settledDonations || 0),
                  lang
                )}
              </p>
            </div>

            <div>
              <button
                type="button"
                onClick={() => setIsPayModalOpen(true)}
                disabled={fineItems.length === 0}
                className="min-h-[44px] px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-bold flex items-center gap-2 cursor-pointer shadow-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <HeartHandshake className="w-4 h-4" />
                <span>{t.accountability.payQaza}</span>
              </button>
            </div>
          </div>

          {/* Detailed Fine Breakdown Table / Cards */}
          <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 shadow-xs p-3.5 sm:p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <span>{t.progress.accountabilityBreakdown}</span>
            </h3>

            {fineItems.length === 0 ? (
              <div className="p-8 text-center rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 text-emerald-800 dark:text-emerald-300 text-xs">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 mx-auto mb-2" />
                <p className="font-semibold">{t.progress.noFines}</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {fineItems.map((item, idx) => {
                  const isMadeUp = item.status === 'MADE_UP';
                  return (
                    <div
                      key={`${item.date}-${item.prayerId}-${idx}`}
                      className="py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                    >
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                            {item.date}
                          </span>
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 capitalize">
                            {t.prayers[item.prayerId]}
                          </span>
                          {isMadeUp ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-sky-50 dark:bg-sky-950/80 text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                              {t.statuses.MADE_UP}
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-rose-50 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                              {t.statuses.MISSED}
                            </span>
                          )}
                          {!isMadeUp && item.isOverdue && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300">
                              {t.progress.overdueBadge.replace('{days}', String(item.daysPassed))}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1">
                          {formatCurrency(item.baseAmount, lang)} {t.progress.baseFineLabel}
                          {item.overdueAmount > 0 && ` + ${formatCurrency(item.overdueAmount, lang)} ${t.progress.overdueFineLabel}`}
                        </p>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                        <span className={`text-sm font-black ${isMadeUp ? 'text-sky-600 dark:text-sky-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {formatCurrency(item.totalAmount, lang)}
                        </span>
                        {!isMadeUp ? (
                          <button
                            type="button"
                            onClick={() => handleHistoricalCorrection(item.date, item.prayerId, 'MADE_UP')}
                            className="min-h-[44px] px-3 py-2 rounded-xl bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900 text-sky-800 dark:text-sky-300 border border-sky-200/80 dark:border-sky-800/60 text-xs font-semibold cursor-pointer transition-colors duration-150 flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 focus-visible:outline-none shadow-xs"
                          >
                            <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                            <span>{t.dashboard.markMadeUp}</span>
                          </button>
                        ) : (
                          <span className="min-h-[44px] px-3 py-2 rounded-xl bg-sky-50/50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 text-xs font-semibold flex items-center gap-1.5 border border-sky-200/50 dark:border-sky-800/50">
                            <Check className="w-3.5 h-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
                            <span>{t.statuses.MADE_UP}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Prayer-by-Prayer Counter Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            {PRAYER_IDS.map((p) => {
              const count = qazaByPrayer?.[p] || 0;
              return (
                <div
                  key={p}
                  className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 shadow-xs text-center space-y-3"
                >
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 capitalize block">
                    {t.prayers[p]}
                  </span>
                  <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                    {count}
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => adjustQaza(p, -1)}
                      disabled={count === 0}
                      className="min-h-[44px] min-w-[44px] rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                      title={t.accountability.fulfillOne}
                      aria-label={`${t.accountability.fulfillOne}: ${t.prayers[p]}`}
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustQaza(p, 1)}
                      className="min-h-[44px] min-w-[44px] rounded-xl bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900 text-emerald-700 dark:text-emerald-300 flex items-center justify-center cursor-pointer transition-colors"
                      title={t.accountability.addMissed}
                      aria-label={`${t.accountability.addMissed}: ${t.prayers[p]}`}
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Payoff Projection Calculator */}
          <div className="rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {t.progress.calculatorTitle}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
                <span className="text-xs text-slate-400 block mb-1">
                  {t.progress.dailyOneExtra}
                </span>
                <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                  {Math.ceil(totalQazaCount / 1)} {t.progress.daysToComplete}
                </p>
              </div>
              <div className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
                <span className="text-xs text-slate-400 block mb-1">
                  {t.progress.dailyFiveExtra}
                </span>
                <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                  {Math.ceil(totalQazaCount / 5)} {t.progress.daysToComplete}
                </p>
              </div>
            </div>
          </div>

          {/* Payment History Section */}
          <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 shadow-xs p-3.5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <span>{t.accountability.paymentHistory}</span>
              </h3>
              {paymentHistory.length > 0 && (
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/60">
                  {paymentHistory.length}
                </span>
              )}
            </div>

            {loadingPayments ? (
              <div className="py-8 flex justify-center text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
              </div>
            ) : paymentHistory.length === 0 ? (
              <div className="p-8 text-center rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-xs">
                <p>{t.accountability.noPaymentsYet}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {paymentHistory.map((receipt) => {
                  const receiptDate = new Date(receipt.createdAt);
                  const formattedDate = !isNaN(receiptDate.getTime())
                    ? receiptDate.toLocaleDateString(
                        lang === 'uz' ? 'uz-UZ' : lang === 'ru' ? 'ru-RU' : 'en-US',
                        {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        }
                      )
                    : receipt.createdAt;

                  return (
                    <div
                      key={receipt.id}
                      className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-850/60 space-y-3"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 border-b border-slate-200/60 dark:border-slate-700/60 pb-2.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                            {t.accountability.receiptId}: #{receipt.id.slice(-6).toUpperCase()}
                          </span>
                          <span className="text-[11px] text-slate-400 dark:text-slate-500">
                            • {formattedDate}
                          </span>
                        </div>
                        <span className="text-sm font-black text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(receipt.totalAmount, lang)}
                        </span>
                      </div>

                      {/* Items in this payment */}
                      <div className="space-y-1.5">
                        {receipt.items.map((it, idx) => (
                          <div
                            key={`${receipt.id}-${it.date}-${it.prayerId}-${idx}`}
                            className="flex items-center justify-between text-xs py-1 px-2 rounded-lg bg-white/70 dark:bg-slate-900/70 border border-slate-100/80 dark:border-slate-800/80"
                          >
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-slate-700 dark:text-slate-300">
                                {it.date}
                              </span>
                              <span className="font-semibold text-slate-900 dark:text-slate-100 capitalize">
                                {t.prayers[it.prayerId]}
                              </span>
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                                  it.status === 'MADE_UP'
                                    ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300'
                                    : 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                                }`}
                              >
                                {t.statuses[it.status] || it.status}
                              </span>
                              {it.isOverdue && (
                                <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300">
                                  Overdue
                                </span>
                              )}
                            </div>
                            <span className="font-bold text-slate-800 dark:text-slate-200">
                              {formatCurrency(it.amount, lang)}
                            </span>
                          </div>
                        ))}
                      </div>

                      {receipt.note && (
                        <p className="text-[11px] italic text-slate-500 dark:text-slate-400">
                          {receipt.note}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pay Qaza Settlement Modal */}
      <PayQazaModal
        isOpen={isPayModalOpen}
        onClose={() => setIsPayModalOpen(false)}
        onSuccess={handlePaymentModalSuccess}
        initialItems={fineItems}
      />
    </div>
  );
}

export default function ProgressPage() {
  return (
    <Suspense
      fallback={
        <div className="py-12 flex justify-center text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
        </div>
      }
    >
      <ProgressContent />
    </Suspense>
  );
}
