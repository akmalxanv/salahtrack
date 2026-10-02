'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Calendar as CalendarIcon,
  CheckCircle2,
  Clock,
  AlertCircle,
  RotateCcw,
  Loader2,
  LogIn,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import type { PrayerId, PrayerStatus } from '@/types/prayer';

const PRAYER_IDS: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

interface PrayerHistoryRecord {
  _id: string;
  date: string;
  prayers: Record<PrayerId, { status: PrayerStatus; prayedAt?: string }>;
  finesAccrued: number;
}

export default function HistoryPage() {
  const { t } = useLanguage();
  const { user } = useAuth();

  const [viewMode, setViewMode] = useState<'7d' | '30d' | 'custom'>('7d');
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [records, setRecords] = useState<PrayerHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Status Badge Helper
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

  const fetchHistory = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const now = new Date(selectedDate);
      let startDateStr = selectedDate;
      const endDateStr = selectedDate;

      if (viewMode === '7d') {
        const past = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
        startDateStr = past.toISOString().split('T')[0];
      } else if (viewMode === '30d') {
        const past = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
        startDateStr = past.toISOString().split('T')[0];
      }

      const res = await fetch(`/api/prayers/history?startDate=${startDateStr}&endDate=${endDateStr}`);
      const json = await res.json();
      if (res.ok && json.success) {
        setRecords(json.data.records || []);
      }
    } catch (err) {
      console.error('Failed to load prayer history:', err);
    } finally {
      setLoading(false);
    }
  }, [user, viewMode, selectedDate]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  if (!user) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {t.history.title}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t.history.subtitle}
          </p>
        </header>

        <div className="rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900 shadow-sm text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 mx-auto flex items-center justify-center">
            <CalendarIcon className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Sign In to View Your Private Prayer History
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Your prayer ledger is securely isolated and private to your account. Sign in to browse your daily, weekly, and monthly logs.
            </p>
          </div>
          <div className="pt-2">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 py-2.5 px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm rounded-xl shadow-md shadow-emerald-600/20 transition-all"
            >
              <LogIn className="w-4 h-4" />
              <span>{t.nav.login}</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {t.history.title}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t.history.subtitle}
          </p>
        </div>

        {/* View Mode Buttons */}
        <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl shrink-0">
          <button
            type="button"
            onClick={() => setViewMode('7d')}
            className={`py-1.5 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              viewMode === '7d'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {t.history.weeklyView}
          </button>
          <button
            type="button"
            onClick={() => setViewMode('30d')}
            className={`py-1.5 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              viewMode === '30d'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {t.history.monthlyView}
          </button>
          <button
            type="button"
            onClick={() => setViewMode('custom')}
            className={`py-1.5 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              viewMode === 'custom'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {t.history.dailyView}
          </button>
        </div>
      </header>

      {/* Date Filter Controls */}
      <div className="flex items-center justify-between p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-4 h-4 text-emerald-600" />
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            {t.history.selectDate}:
          </span>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="py-1 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
          />
        </div>

        <button
          type="button"
          onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])}
          className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
        >
          {t.stats.todayCompletion}
        </button>
      </div>

      {/* Records List */}
      {loading ? (
        <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
          <p className="text-sm font-medium">{t.common.loading}</p>
        </div>
      ) : records.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 p-12 text-center space-y-2">
          <CalendarIcon className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            {t.history.noRecords}
          </p>
          <p className="text-xs text-slate-400">
            Prayers logged on the Dashboard will automatically archive here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {records.map((rec) => {
            const completedCount = PRAYER_IDS.filter(
              (p) =>
                rec.prayers[p]?.status === 'PRAYED_ON_TIME' ||
                rec.prayers[p]?.status === 'PRAYED' ||
                rec.prayers[p]?.status === 'PRAYED_LATE'
            ).length;

            return (
              <div
                key={rec._id || rec.date}
                className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 shadow-xs space-y-3.5"
              >
                {/* Date & Completion Header */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-xs">
                      {new Date(rec.date).getDate()}
                    </div>
                    <div>
                      <p className="font-bold text-sm text-slate-900 dark:text-slate-100">
                        {new Date(rec.date).toLocaleDateString(undefined, {
                          weekday: 'short',
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {completedCount} / 5 {t.history.prayersCompleted}
                      </p>
                    </div>
                  </div>

                  {rec.finesAccrued > 0 && (
                    <span className="text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900/60 px-2.5 py-1 rounded-full">
                      +{rec.finesAccrued.toLocaleString()} {t.common.currency}
                    </span>
                  )}
                </div>

                {/* 5 Prayers Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  {PRAYER_IDS.map((pid) => {
                    const status = rec.prayers[pid]?.status || 'PENDING';
                    const prayerName = t.prayers[pid];

                    return (
                      <div
                        key={pid}
                        className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 flex flex-col items-center text-center gap-1.5"
                      >
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                          {prayerName}
                        </span>
                        {getStatusBadge(status)}
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
  );
}
