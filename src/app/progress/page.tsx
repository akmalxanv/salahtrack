'use client';

import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  TrendingUp,
  History as HistoryIcon,
  BarChart3,
  Scale,
  Calendar as CalendarIcon,
  CheckCircle2,
  Clock,
  AlertCircle,
  RotateCcw,
  Flame,
  Plus,
  Minus,
  Loader2,
  LogIn,
  ChevronRight,
  Award,
  Pencil,
  Check,
  X,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useLocalStorage, getTodayString } from '@/hooks/useLocalStorage';
import type { PrayerId, PrayerStatus, AccountabilityBreakdownItem } from '@/types/prayer';

const PRAYER_IDS: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

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
  };
  accountability: {
    totalAmount: number;
    totalMissed?: number;
    totalOverdue?: number;
    currency: string;
    baseRatePerPrayer?: number;
    overdueRatePerPrayer?: number;
    gracePeriodDays?: number;
    breakdown?: AccountabilityBreakdownItem[];
  };
}

interface PrayerHistoryRecord {
  _id?: string;
  date: string;
  prayers: Record<PrayerId, { status: PrayerStatus; prayedAt?: string }>;
  finesAccrued: number;
}

type TabType = 'overview' | 'history' | 'analytics' | 'qaza';

function ProgressContent() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();

  const todayStr = useMemo(() => getTodayString(), []);

  // Tab State with URL query sync
  const initialTab = (searchParams.get('tab') as TabType) || 'overview';
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);

  // Period state for overview/history
  const [period, setPeriod] = useState<'7d' | '30d' | 'custom'>('7d');
  const [selectedDate, setSelectedDate] = useState(() => getTodayString());
  const [futureDateError, setFutureDateError] = useState<string | null>(null);

  // Historical editing state
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [updatingPrayerKey, setUpdatingPrayerKey] = useState<string | null>(null);

  // Data states
  const [stats, setStats] = useState<StatsData | null>(null);
  const [historyRecords, setHistoryRecords] = useState<PrayerHistoryRecord[]>([]);
  const [loadingStats, setLoadingStats] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Local fallback Qaza state & settled donations
  const [localQaza, setLocalQaza] = useLocalStorage<number>('salahtrack_qaza_count', 0);
  const [settledDonations, setSettledDonations] = useLocalStorage<number>('salahtrack_settled_donations', 0);
  const [isAddingSettlement, setIsAddingSettlement] = useState(false);
  const [settlementInput, setSettlementInput] = useState('');

  const [qazaByPrayer, setQazaByPrayer] = useLocalStorage<Record<PrayerId, number>>('salahtrack_qaza_prayers', {
    fajr: 0,
    dhuhr: 0,
    asr: 0,
    maghrib: 0,
    isha: 0,
  });

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    const params = new URLSearchParams(window.location.search);
    params.set('tab', tab);
    router.replace(`/progress?${params.toString()}`);
  };

  // Fetch Stats from API
  const fetchStats = useCallback(async () => {
    if (!user) return;
    setLoadingStats(true);
    try {
      const res = await fetch('/api/stats');
      const json = await res.json();
      if (res.ok && json.success) {
        setStats(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch progress stats:', err);
    } finally {
      setLoadingStats(false);
    }
  }, [user]);

  // Fetch History from API
  const fetchHistory = useCallback(async () => {
    if (!user) return;
    setLoadingHistory(true);
    try {
      const now = new Date(selectedDate);
      let startDateStr = selectedDate;
      const endDateStr = selectedDate > todayStr ? todayStr : selectedDate;

      if (period === '7d') {
        const past = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
        startDateStr = past.toISOString().split('T')[0];
      } else if (period === '30d') {
        const past = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
        startDateStr = past.toISOString().split('T')[0];
      }

      const res = await fetch(`/api/prayers/history?startDate=${startDateStr}&endDate=${endDateStr}`);
      const json = await res.json();
      if (res.ok && json.success) {
        setHistoryRecords(json.data.records || []);
      }
    } catch (err) {
      console.error('Failed to fetch history:', err);
    } finally {
      setLoadingHistory(false);
    }
  }, [user, selectedDate, period, todayStr]);

  useEffect(() => {
    let ignore = false;
    async function load() {
      if (!ignore) {
        await fetchStats();
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [fetchStats]);

  useEffect(() => {
    let ignore = false;
    async function load() {
      if (!ignore) {
        await fetchHistory();
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [fetchHistory]);

  // Handle Date Filter Change with strict Future Date Rejection
  const handleDateChange = (newDate: string) => {
    if (newDate > todayStr) {
      setFutureDateError(t.progress.futureDateError);
      return;
    }
    setFutureDateError(null);
    setSelectedDate(newDate);
  };

  // Historical Prayer Correction mutation
  const handleHistoricalCorrection = async (
    recordDate: string,
    prayerId: PrayerId,
    newStatus: PrayerStatus
  ) => {
    if (recordDate > todayStr) {
      alert(t.progress.futureDateError);
      return;
    }

    const key = `${recordDate}-${prayerId}`;
    setUpdatingPrayerKey(key);

    const normalizedStatus: PrayerStatus = newStatus === 'PRAYED' ? 'PRAYED_ON_TIME' : newStatus;

    // 1. Optimistic update in historyRecords state
    setHistoryRecords((prev) =>
      prev.map((rec) => {
        if (rec.date === recordDate) {
          return {
            ...rec,
            prayers: {
              ...rec.prayers,
              [prayerId]: { status: normalizedStatus },
            },
          };
        }
        return rec;
      })
    );

    // 2. Persist to API
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
        // Refresh stats, streaks, and fines
        await fetchStats();
      } else {
        const data = await res.json().catch(() => null);
        console.warn('Historical edit failed:', data?.error);
        await fetchHistory(); // Rollback to server truth
      }
    } catch (err) {
      console.error('Error updating historical record:', err);
      await fetchHistory(); // Rollback
    } finally {
      setUpdatingPrayerKey(null);
    }
  };

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

  // Record a settled donation payment
  const handleSaveSettlement = () => {
    const val = parseInt(settlementInput, 10);
    if (!isNaN(val) && val > 0) {
      setSettledDonations((prev) => (prev || 0) + val);
    }
    setSettlementInput('');
    setIsAddingSettlement(false);
  };

  // Status Badge Component
  const getStatusBadge = (status: PrayerStatus) => {
    switch (status) {
      case 'PRAYED_ON_TIME':
      case 'PRAYED':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            <span>{t.statuses.PRAYED_ON_TIME}</span>
          </span>
        );
      case 'PRAYED_LATE':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            <Clock className="w-3 h-3 text-amber-600" />
            <span>{t.statuses.PRAYED_LATE}</span>
          </span>
        );
      case 'MISSED':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
            <AlertCircle className="w-3 h-3 text-rose-600" />
            <span>{t.statuses.MISSED}</span>
          </span>
        );
      case 'MADE_UP':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-sky-50 dark:bg-sky-950/70 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
            <RotateCcw className="w-3 h-3 text-sky-600" />
            <span>{t.statuses.MADE_UP}</span>
          </span>
        );
      case 'PENDING':
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
            <span>{t.statuses.PENDING}</span>
          </span>
        );
    }
  };

  // Analytical stats breakdown
  const prayerBreakdown = useMemo(() => {
    const counts: Record<PrayerId, { onTime: number; late: number; missed: number; total: number }> = {
      fajr: { onTime: 0, late: 0, missed: 0, total: 0 },
      dhuhr: { onTime: 0, late: 0, missed: 0, total: 0 },
      asr: { onTime: 0, late: 0, missed: 0, total: 0 },
      maghrib: { onTime: 0, late: 0, missed: 0, total: 0 },
      isha: { onTime: 0, late: 0, missed: 0, total: 0 },
    };

    for (const record of historyRecords) {
      if (!record.prayers) continue;
      for (const p of PRAYER_IDS) {
        const item = record.prayers[p];
        if (!item) continue;
        counts[p].total += 1;
        if (item.status === 'PRAYED_ON_TIME' || item.status === 'PRAYED') counts[p].onTime += 1;
        else if (item.status === 'PRAYED_LATE') counts[p].late += 1;
        else if (item.status === 'MISSED') counts[p].missed += 1;
      }
    }
    return counts;
  }, [historyRecords]);

  // Total Qaza count
  const totalQazaCount = useMemo(() => {
    return Object.values(qazaByPrayer || {}).reduce((acc, val) => acc + (val || 0), 0) || localQaza || 0;
  }, [qazaByPrayer, localQaza]);

  // Accountability calculations from stats API
  const accountabilityTotal = stats?.accountability?.totalAmount ?? (totalQazaCount * 15000);
  const accountabilityMissed = stats?.accountability?.totalMissed ?? totalQazaCount;
  const accountabilityOverdue = stats?.accountability?.totalOverdue ?? 0;
  const fineItems = stats?.accountability?.breakdown || [];

  return (
    <div className="space-y-6">
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
            className="self-start sm:self-auto py-2 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-2 shadow-xs transition-colors"
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
          aria-label="Progress Tabs"
          role="tablist"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'overview'}
            onClick={() => handleTabChange('overview')}
            className={`py-3 px-3.5 border-b-2 text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors flex items-center gap-2 cursor-pointer ${
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
            className={`py-3 px-3.5 border-b-2 text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors flex items-center gap-2 cursor-pointer ${
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
            aria-selected={activeTab === 'analytics'}
            onClick={() => handleTabChange('analytics')}
            className={`py-3 px-3.5 border-b-2 text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors flex items-center gap-2 cursor-pointer ${
              activeTab === 'analytics'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>{t.progress.tabs.analytics}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'qaza'}
            onClick={() => handleTabChange('qaza')}
            className={`py-3 px-3.5 border-b-2 text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors flex items-center gap-2 cursor-pointer ${
              activeTab === 'qaza'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Scale className="w-4 h-4" />
            <span>{t.progress.tabs.qaza}</span>
            {accountabilityTotal > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-rose-100 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300 font-bold">
                {accountabilityTotal.toLocaleString()} {t.common.currency}
              </span>
            )}
          </button>
        </nav>
      </div>

      {/* ==================== TAB 1: OVERVIEW ==================== */}
      {activeTab === 'overview' && (
        loadingStats && !stats ? (
          <div className="py-12 flex justify-center text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        ) : (
          <div className="space-y-6">
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
                  <span className="text-[11px] text-slate-400">7d</span>
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
                  <span className="text-xs text-slate-400 font-medium">kun</span>
                </div>
                <span className="text-[10px] text-slate-400 mt-2 block">
                  {t.progress.summary.bestStreak}: {stats?.streaks.best || 0}
                </span>
              </div>

              {/* On-Time vs Late */}
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                  {t.progress.summary.onTimeRate}
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                    {stats?.counts30d.onTime || 0}
                  </span>
                  <span className="text-xs text-amber-500 font-medium">
                    +{stats?.counts30d.late || 0} late
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 mt-2 block">30 kunlik ko‘rsatkich</span>
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
                  <span>Batafsil hisob</span>
                  <ChevronRight className="w-3 h-3" />
                </button>
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
                className="py-2 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-750 transition-colors shrink-0 cursor-pointer"
              >
                {t.progress.tabs.history}
              </button>
            </div>

            {/* Recent History Preview */}
            <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 shadow-xs p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <HistoryIcon className="w-5 h-5 text-emerald-600" />
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    So‘nggi kunlar jurnali
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => handleTabChange('history')}
                  className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 flex items-center gap-1 cursor-pointer"
                >
                  <span>Hammasini ko‘rish</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {loadingHistory ? (
                <div className="py-8 flex justify-center text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : historyRecords.length === 0 ? (
                <p className="text-xs text-slate-400 py-4 text-center">
                  {t.history.noRecords}
                </p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {historyRecords.slice(0, 5).map((record) => (
                    <div key={record._id || record.date} className="py-3 flex items-center justify-between gap-4">
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
                                status === 'PRAYED_ON_TIME' || status === 'PRAYED'
                                  ? 'bg-emerald-500'
                                  : status === 'PRAYED_LATE'
                                  ? 'bg-amber-500'
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

      {/* ==================== TAB 2: HISTORY & EDITING ==================== */}
      {activeTab === 'history' && (
        <div className="space-y-6">
          {/* Historical notice */}
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{t.progress.historicalEditNotice}</span>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPeriod('7d')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                  period === '7d'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                {t.progress.periods.d7}
              </button>
              <button
                type="button"
                onClick={() => setPeriod('30d')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                  period === '30d'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                {t.progress.periods.d30}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <CalendarIcon className="w-4 h-4 text-slate-400" />
              <input
                type="date"
                max={todayStr}
                value={selectedDate}
                onChange={(e) => handleDateChange(e.target.value)}
                className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
          </div>

          {futureDateError && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{futureDateError}</span>
            </div>
          )}

          {/* Records View */}
          {loadingHistory ? (
            <div className="py-12 flex justify-center text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          ) : historyRecords.length === 0 ? (
            <div className="p-8 text-center rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t.history.noRecords}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {historyRecords.map((record) => {
                const isEditing = editingDate === record.date;
                const completedInRecord = Object.values(record.prayers || {}).filter(
                  (p) => p.status === 'PRAYED' || p.status === 'PRAYED_ON_TIME'
                ).length;

                return (
                  <div
                    key={record._id || record.date}
                    className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 shadow-xs"
                  >
                    <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100 dark:border-slate-800">
                      <div>
                        <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          {record.date} {record.date === todayStr && '(Bugun)'}
                        </span>
                        <span className="text-xs text-slate-400 ml-3">
                          {completedInRecord} / 5 {t.history.prayersCompleted}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => setEditingDate(isEditing ? null : record.date)}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 cursor-pointer transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>{isEditing ? t.progress.doneEditing : t.progress.editRecord}</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                      {PRAYER_IDS.map((p) => {
                        const prayerObj = record.prayers?.[p];
                        const status: PrayerStatus = prayerObj?.status || 'PENDING';
                        const updatingKey = `${record.date}-${p}`;
                        const isUpdating = updatingPrayerKey === updatingKey;

                        return (
                          <div
                            key={p}
                            className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 space-y-2"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 capitalize block">
                                {t.prayers[p]}
                              </span>
                              {isUpdating && <Loader2 className="w-3 h-3 animate-spin text-emerald-600" />}
                            </div>

                            <div>{getStatusBadge(status)}</div>

                            {/* Editing buttons when expanded */}
                            {isEditing && (
                              <div className="pt-2 border-t border-slate-200/60 dark:border-slate-700/60 grid grid-cols-1 gap-1 text-[10px]">
                                <button
                                  type="button"
                                  disabled={isUpdating}
                                  onClick={() => handleHistoricalCorrection(record.date, p, 'PRAYED_ON_TIME')}
                                  className={`p-1 rounded-md text-left font-medium transition-colors cursor-pointer ${
                                    status === 'PRAYED_ON_TIME' || status === 'PRAYED'
                                      ? 'bg-emerald-600 text-white'
                                      : 'hover:bg-emerald-100 dark:hover:bg-emerald-950/50 text-slate-700 dark:text-slate-300'
                                  }`}
                                >
                                  {t.dashboard.markPrayedOnTime}
                                </button>
                                <button
                                  type="button"
                                  disabled={isUpdating}
                                  onClick={() => handleHistoricalCorrection(record.date, p, 'PRAYED_LATE')}
                                  className={`p-1 rounded-md text-left font-medium transition-colors cursor-pointer ${
                                    status === 'PRAYED_LATE'
                                      ? 'bg-amber-600 text-white'
                                      : 'hover:bg-amber-100 dark:hover:bg-amber-950/50 text-slate-700 dark:text-slate-300'
                                  }`}
                                >
                                  {t.dashboard.markPrayedLate}
                                </button>
                                <button
                                  type="button"
                                  disabled={isUpdating}
                                  onClick={() => handleHistoricalCorrection(record.date, p, 'MISSED')}
                                  className={`p-1 rounded-md text-left font-medium transition-colors cursor-pointer ${
                                    status === 'MISSED'
                                      ? 'bg-rose-600 text-white'
                                      : 'hover:bg-rose-100 dark:hover:bg-rose-950/50 text-slate-700 dark:text-slate-300'
                                  }`}
                                >
                                  {t.dashboard.markMissed}
                                </button>
                                <button
                                  type="button"
                                  disabled={isUpdating}
                                  onClick={() => handleHistoricalCorrection(record.date, p, 'MADE_UP')}
                                  className={`p-1 rounded-md text-left font-medium transition-colors cursor-pointer ${
                                    status === 'MADE_UP'
                                      ? 'bg-sky-600 text-white'
                                      : 'hover:bg-sky-100 dark:hover:bg-sky-950/50 text-slate-700 dark:text-slate-300'
                                  }`}
                                >
                                  {t.dashboard.markMadeUp}
                                </button>
                                <button
                                  type="button"
                                  disabled={isUpdating}
                                  onClick={() => handleHistoricalCorrection(record.date, p, 'PENDING')}
                                  className={`p-1 rounded-md text-left font-medium transition-colors cursor-pointer ${
                                    status === 'PENDING'
                                      ? 'bg-slate-700 text-white dark:bg-slate-600'
                                      : 'hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
                                  }`}
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
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ==================== TAB 3: ANALYTICS ==================== */}
      {activeTab === 'analytics' && (
        <div className="space-y-6">
          {/* Consistency by Prayer */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs space-y-5">
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

          {/* 30-Day Metric Breakdown */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40">
              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 block mb-1">
                {t.stats.onTimeCount}
              </span>
              <span className="text-2xl font-bold text-emerald-800 dark:text-emerald-200">
                {stats?.counts30d.onTime || 0}
              </span>
            </div>
            <div className="p-4 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40">
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 block mb-1">
                {t.stats.lateCount}
              </span>
              <span className="text-2xl font-bold text-amber-800 dark:text-amber-200">
                {stats?.counts30d.late || 0}
              </span>
            </div>
            <div className="p-4 rounded-2xl bg-rose-50/50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/40">
              <span className="text-xs font-semibold text-rose-700 dark:text-rose-400 block mb-1">
                {t.stats.missedCount}
              </span>
              <span className="text-2xl font-bold text-rose-800 dark:text-rose-200">
                {stats?.counts30d.missed || 0}
              </span>
            </div>
            <div className="p-4 rounded-2xl bg-sky-50/50 dark:bg-sky-950/20 border border-sky-100 dark:border-sky-900/40">
              <span className="text-xs font-semibold text-sky-700 dark:text-sky-400 block mb-1">
                {t.stats.madeUpCount}
              </span>
              <span className="text-2xl font-bold text-sky-800 dark:text-sky-200">
                {stats?.counts30d.madeUp || 0}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB 4: ACCOUNTABILITY & FINES ==================== */}
      {activeTab === 'qaza' && (
        <div className="space-y-6">
          {/* Executive Accountability Card */}
          <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 text-white p-6 shadow-sm border border-slate-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                {t.accountability.title}
              </span>
              <p className="text-3xl font-black text-white mt-1">
                {accountabilityTotal.toLocaleString()}{' '}
                <span className="text-sm font-normal text-slate-400">
                  {t.common.currency}
                </span>
              </p>
              <div className="flex items-center gap-4 text-xs text-slate-300 mt-2">
                <span>{accountabilityMissed} ta qazo</span>
                <span>•</span>
                <span className="text-amber-400">{accountabilityOverdue} ta 7 kundan oshgan</span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-white/10 text-xs text-slate-300 max-w-md">
              <span className="font-bold text-white block mb-1">
                {t.accountability.disclaimer}
              </span>
              <p className="text-[11px] leading-relaxed text-slate-300">
                {t.progress.recordPaymentDesc} Har bir qazo uchun 15 000 UZS, 7 kundan kechiksa qo‘shimcha 15 000 UZS intizom badali hisoblanadi.
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
                {(settledDonations || 0).toLocaleString()} <span className="text-xs text-slate-400 font-normal">UZS</span>
              </p>
            </div>

            <div className="flex items-center gap-2">
              {isAddingSettlement ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1000"
                    step="5000"
                    placeholder="Masalan: 15000"
                    value={settlementInput}
                    onChange={(e) => setSettlementInput(e.target.value)}
                    className="w-36 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={handleSaveSettlement}
                    className="p-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsAddingSettlement(false)}
                    className="p-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsAddingSettlement(true)}
                  className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t.progress.recordPayment}</span>
                </button>
              )}
            </div>
          </div>

          {/* Detailed Fine Breakdown Table / Cards */}
          <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 shadow-xs p-6 space-y-4">
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
                {fineItems.map((item, idx) => (
                  <div
                    key={`${item.date}-${item.prayerId}-${idx}`}
                    className="py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                          {item.date}
                        </span>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 capitalize">
                          {t.prayers[item.prayerId]}
                        </span>
                        {item.isOverdue && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300">
                            7 kundan oshgan ({item.daysPassed} kun)
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        {item.baseAmount.toLocaleString()} UZS (asosiy)
                        {item.overdueAmount > 0 && ` + ${item.overdueAmount.toLocaleString()} UZS (kechikish)`}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 self-end sm:self-auto">
                      <span className="text-sm font-black text-rose-600 dark:text-rose-400">
                        {item.totalAmount.toLocaleString()} UZS
                      </span>
                      <button
                        type="button"
                        onClick={() => handleHistoricalCorrection(item.date, item.prayerId, 'MADE_UP')}
                        className="px-2.5 py-1.5 rounded-xl bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900 text-sky-700 dark:text-sky-300 text-xs font-semibold cursor-pointer transition-colors"
                      >
                        {t.dashboard.markMadeUp}
                      </button>
                    </div>
                  </div>
                ))}
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
                      className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                      title={t.accountability.fulfillOne}
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustQaza(p, 1)}
                      className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900 text-emerald-700 dark:text-emerald-300 flex items-center justify-center cursor-pointer transition-colors"
                      title={t.accountability.addMissed}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Payoff Projection Calculator */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs space-y-4">
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
        </div>
      )}
    </div>
  );
}

export default function ProgressPage() {
  return (
    <Suspense
      fallback={
        <div className="py-12 flex justify-center text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      }
    >
      <ProgressContent />
    </Suspense>
  );
}
