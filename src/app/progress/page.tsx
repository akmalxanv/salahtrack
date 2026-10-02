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
  ShieldCheck,
  Award,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useLocalStorage, getTodayString } from '@/hooks/useLocalStorage';
import type { PrayerId, PrayerStatus } from '@/types/prayer';

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
    currency: string;
  };
}

interface PrayerHistoryRecord {
  _id: string;
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

  // Tab State with URL query sync
  const initialTab = (searchParams.get('tab') as TabType) || 'overview';
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);

  // Period state for overview/history
  const [period, setPeriod] = useState<'7d' | '30d' | 'custom'>('7d');
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Data states
  const [stats, setStats] = useState<StatsData | null>(null);
  const [historyRecords, setHistoryRecords] = useState<PrayerHistoryRecord[]>([]);
  const [loadingStats, setLoadingStats] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Local fallback Qaza state
  const [localQaza, setLocalQaza] = useLocalStorage<number>('salahtrack_qaza_count', 0);
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
      const endDateStr = selectedDate;

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
  }, [user, selectedDate, period]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

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
            <span>Sign in to unlock multi-device cloud history, long-term analytics, and automated streaks.</span>
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
            {totalQazaCount > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 font-bold">
                {totalQazaCount}
              </span>
            )}
          </button>
        </nav>
      </div>

      {/* ==================== TAB 1: OVERVIEW ==================== */}
      {activeTab === 'overview' && (
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

            {/* Qaza Ledger */}
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                {t.progress.summary.qazaBalance}
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                  {totalQazaCount}
                </span>
                <span className="text-xs text-slate-400">namoz</span>
              </div>
              <button
                type="button"
                onClick={() => handleTabChange('qaza')}
                className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 mt-2 flex items-center gap-1 cursor-pointer"
              >
                <span>Boshqarish</span>
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
                        ).length} / 5 namoz ado etildi
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
      )}

      {/* ==================== TAB 2: HISTORY & CALENDAR ==================== */}
      {activeTab === 'history' && (
        <div className="space-y-6">
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
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
          </div>

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
              {historyRecords.map((record) => (
                <div
                  key={record._id || record.date}
                  className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 shadow-xs"
                >
                  <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      {record.date}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {Object.values(record.prayers || {}).filter(
                        (p) => p.status === 'PRAYED' || p.status === 'PRAYED_ON_TIME'
                      ).length}{' '}
                      / 5 {t.history.prayersCompleted}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    {PRAYER_IDS.map((p) => {
                      const prayerObj = record.prayers?.[p];
                      const status: PrayerStatus = prayerObj?.status || 'PENDING';
                      return (
                        <div
                          key={p}
                          className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 space-y-2"
                        >
                          <span className="text-xs font-bold text-slate-800 dark:text-slate-200 capitalize block">
                            {t.prayers[p]}
                          </span>
                          <div>{getStatusBadge(status)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
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
                  Namozlar kesimida muntazamlik
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Har bir namozning o‘z vaqtida ado etilish ulushi
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

      {/* ==================== TAB 4: QAZA & ACCOUNTABILITY ==================== */}
      {activeTab === 'qaza' && (
        <div className="space-y-6">
          {/* Header Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                {t.accountability.qazaBalance}
              </span>
              <p className="text-3xl font-extrabold text-slate-900 dark:text-slate-100 mt-1">
                {totalQazaCount}{' '}
                <span className="text-sm font-medium text-slate-400">
                  {t.accountability.prayersCount}
                </span>
              </p>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 text-xs text-slate-500 dark:text-slate-400 max-w-sm">
              <span className="font-semibold text-slate-700 dark:text-slate-300 block mb-0.5">
                {t.accountability.disclaimer}
              </span>
              <span>{t.accountability.baseRateNote}</span>
            </div>
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
              Qazolarni to‘lash hisoblagichi
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
                <span className="text-xs text-slate-400 block mb-1">
                  Har kuni 1 ta qo‘shimcha namoz o‘qilsa
                </span>
                <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                  {Math.ceil(totalQazaCount / 1)} kunda to‘liq yopiladi
                </p>
              </div>
              <div className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
                <span className="text-xs text-slate-400 block mb-1">
                  Har kuni 1 kunlik (5 ta) qazo o‘qilsa
                </span>
                <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                  {Math.ceil(totalQazaCount / 5)} kunda to‘liq yopiladi
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
