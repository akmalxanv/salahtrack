'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  BarChart3,
  Flame,
  CheckCircle2,
  Clock,
  AlertCircle,
  RotateCcw,
  Scale,
  Loader2,
  LogIn,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';

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

export default function StatsPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(Boolean(user));

  useEffect(() => {
    if (!user) return;

    let ignore = false;
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/stats');
        const json = await res.json();
        if (!ignore && res.ok && json.success) {
          setData(json.data);
        }
      } catch (err) {
        console.error('Failed to fetch personal stats:', err);
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    fetchStats();
    return () => {
      ignore = true;
    };
  }, [user]);

  if (!user) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {t.stats.title}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t.stats.subtitle}
          </p>
        </header>

        <div className="rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900 shadow-sm text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 mx-auto flex items-center justify-center">
            <BarChart3 className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Sign In to View Your Personal Analytics
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Track your prayer punctuality, completion rates, streaks, and discipline balance across all your devices.
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
      <header className="space-y-1">
        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-xs tracking-wider uppercase">
          <BarChart3 className="w-4 h-4" />
          <span>{t.nav.stats}</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          {t.stats.title}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t.stats.subtitle}
        </p>
      </header>

      {loading ? (
        <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
          <p className="text-sm font-medium">{t.common.loading}</p>
        </div>
      ) : data ? (
        <div className="space-y-6">
          {/* Completion Overview Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Today */}
            <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                <span>{t.stats.todayCompletion}</span>
                <span className="text-emerald-600 font-bold">{data.today.percentage}%</span>
              </div>
              <p className="text-2xl font-black text-slate-900 dark:text-slate-100">
                {data.today.completed} <span className="text-sm font-medium text-slate-400">/ {data.today.totalPossible}</span>
              </p>
              <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(data.today.percentage, 100)}%` }}
                />
              </div>
            </div>

            {/* Weekly */}
            <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                <span>{t.stats.weeklyCompletion}</span>
                <span className="text-emerald-600 font-bold">{data.weekly.percentage}%</span>
              </div>
              <p className="text-2xl font-black text-slate-900 dark:text-slate-100">
                {data.weekly.completed} <span className="text-sm font-medium text-slate-400">/ {data.weekly.totalPossible}</span>
              </p>
              <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(data.weekly.percentage, 100)}%` }}
                />
              </div>
            </div>

            {/* Monthly */}
            <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                <span>{t.stats.monthlyCompletion}</span>
                <span className="text-emerald-600 font-bold">{data.monthly.percentage}%</span>
              </div>
              <p className="text-2xl font-black text-slate-900 dark:text-slate-100">
                {data.monthly.completed} <span className="text-sm font-medium text-slate-400">/ {data.monthly.totalPossible}</span>
              </p>
              <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(data.monthly.percentage, 100)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Streaks & Discipline Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Streaks */}
            <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <Flame className="w-5 h-5 fill-amber-500 text-amber-500" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Prayer Consistency Streaks
                  </h2>
                  <p className="text-xs text-slate-400">Consecutive days tracking obligatory prayers</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-1">
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                    {t.stats.currentStreak}
                  </p>
                  <p className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">
                    {data.streaks.current}{' '}
                    <span className="text-xs font-semibold text-slate-400">
                      {t.dashboard.streakDays}
                    </span>
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                    {t.stats.bestStreak}
                  </p>
                  <p className="text-2xl font-black text-slate-900 dark:text-slate-100 mt-1">
                    {data.streaks.best}{' '}
                    <span className="text-xs font-semibold text-slate-400">
                      {t.dashboard.streakDays}
                    </span>
                  </p>
                </div>
              </div>
            </div>

            {/* Accountability Balance */}
            <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center">
                  <Scale className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {t.accountability.title}
                  </h2>
                  <p className="text-xs text-slate-400">Self-discipline pledge tracker</p>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 space-y-1">
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                  {t.stats.accountabilityAmount}
                </p>
                <p className="text-2xl font-black text-slate-900 dark:text-slate-100">
                  {data.accountability.totalAmount.toLocaleString()}{' '}
                  <span className="text-xs font-bold text-slate-400">
                    {data.accountability.currency}
                  </span>
                </p>
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                {t.accountability.disclaimer}
              </p>
            </div>
          </div>

          {/* 30-Day Breakdown */}
          <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              30-Day Prayer Status Breakdown
            </h2>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{t.stats.onTimeCount}</span>
                </div>
                <p className="text-xl font-black text-emerald-700 dark:text-emerald-300 mt-1">
                  {data.counts30d.onTime}
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{t.stats.lateCount}</span>
                </div>
                <p className="text-xl font-black text-amber-700 dark:text-amber-300 mt-1">
                  {data.counts30d.late}
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-rose-50/50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/40">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-700 dark:text-rose-300">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>{t.stats.missedCount}</span>
                </div>
                <p className="text-xl font-black text-rose-700 dark:text-rose-300 mt-1">
                  {data.counts30d.missed}
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-sky-50/50 dark:bg-sky-950/20 border border-sky-100 dark:border-sky-900/40">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-sky-700 dark:text-sky-300">
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{t.stats.madeUpCount}</span>
                </div>
                <p className="text-xl font-black text-sky-700 dark:text-sky-300 mt-1">
                  {data.counts30d.madeUp}
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
