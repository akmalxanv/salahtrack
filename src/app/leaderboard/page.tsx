'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Trophy,
  Calendar,
  Medal,
  Clock,
  Loader2,
  Shield,
  LogIn,
  Users,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import GroupsManager from '@/components/GroupsManager';
import type { LeaderboardEntry } from '@/app/api/leaderboard/route';

type LeaderboardPeriod = 'daily' | 'weekly' | 'monthly';

export default function LeaderboardPage() {
  const { t } = useLanguage();
  const { user, refreshUser } = useAuth();

  const [activeTab, setActiveTab] = useState<'global' | 'circles'>('global');
  const [period, setPeriod] = useState<LeaderboardPeriod>('daily');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalParticipants, setTotalParticipants] = useState(0);
  const [isOptedIn, setIsOptedIn] = useState(false);
  const [togglingOptIn, setTogglingOptIn] = useState(false);

  useEffect(() => {
    if (user?.preferences?.showOnLeaderboard !== undefined) {
      const show = Boolean(user.preferences.showOnLeaderboard);
      queueMicrotask(() => {
        setIsOptedIn(show);
      });
    }
  }, [user]);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch(`/api/leaderboard?period=${period}`);
      const json = await res.json();
      if (res.ok && json.success) {
        setEntries(json.data.leaderboard || []);
        setTotalParticipants(json.data.totalParticipants || 0);
        if (json.data.userOptedIn !== undefined) {
          setIsOptedIn(json.data.userOptedIn);
        }
      }
    } catch (err) {
      console.error('Failed to fetch leaderboard:', err);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  const handleToggleOptIn = async () => {
    if (!user) return;
    setTogglingOptIn(true);
    const nextVal = !isOptedIn;
    setIsOptedIn(nextVal);

    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferences: {
            showOnLeaderboard: nextVal,
          },
        }),
      });

      if (res.ok) {
        await refreshUser();
        await fetchLeaderboard();
      } else {
        setIsOptedIn(!nextVal); // revert
      }
    } catch {
      setIsOptedIn(!nextVal); // revert
    } finally {
      setTogglingOptIn(false);
    }
  };

  const getRankBadge = (rank: number) => {
    if (rank === 1) {
      return (
        <span className="flex items-center justify-center w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 font-bold text-xs border border-amber-300 dark:border-amber-700">
          <Medal className="w-4 h-4 text-amber-500 fill-amber-400" />
        </span>
      );
    }
    if (rank === 2) {
      return (
        <span className="flex items-center justify-center w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs border border-slate-300 dark:border-slate-700">
          <Medal className="w-4 h-4 text-slate-400 fill-slate-300" />
        </span>
      );
    }
    if (rank === 3) {
      return (
        <span className="flex items-center justify-center w-7 h-7 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400 font-bold text-xs border border-amber-200 dark:border-amber-800">
          <Medal className="w-4 h-4 text-amber-700 fill-amber-600" />
        </span>
      );
    }
    return (
      <span className="flex items-center justify-center w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-bold text-xs">
        {rank}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="space-y-1">
        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-xs tracking-wider uppercase">
          <Trophy className="w-4 h-4" />
          <span>{t.nav.leaderboard}</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          {t.leaderboard.title}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t.leaderboard.subtitle}
        </p>
      </header>

      {/* Main View Switcher: Global Leaderboard vs My Circles */}
      <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800/80 w-fit">
        <button
          type="button"
          onClick={() => setActiveTab('global')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
            activeTab === 'global'
              ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-2xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Trophy className="w-4 h-4" />
          <span>{t.groups.tabGlobal}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('circles')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
            activeTab === 'circles'
              ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-2xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>{t.groups.tabGroups}</span>
        </button>
      </div>

      {activeTab === 'circles' ? (
        <GroupsManager />
      ) : (
        <>
          {/* Privacy & Opt-in Banner */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {t.leaderboard.optInPrompt}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t.leaderboard.optInNotice}
              </p>
            </div>
          </div>

          {user ? (
            <button
              onClick={handleToggleOptIn}
              disabled={togglingOptIn}
              className={`py-2 px-4 rounded-xl text-xs font-semibold transition-all shrink-0 flex items-center justify-center gap-2 cursor-pointer ${
                isOptedIn
                  ? 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/20'
              }`}
            >
              {togglingOptIn ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : isOptedIn ? (
                <span>{t.leaderboard.optOutButton}</span>
              ) : (
                <span>{t.leaderboard.optInButton}</span>
              )}
            </button>
          ) : (
            <Link
              href="/login"
              className="py-2 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl transition-colors shrink-0 flex items-center justify-center gap-1.5 shadow-sm"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>{t.nav.login}</span>
            </Link>
          )}
        </div>

        {user && (
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2 text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                isOptedIn ? 'bg-emerald-500' : 'bg-slate-400'
              }`}
            />
            <span className="font-medium text-slate-600 dark:text-slate-400">
              {isOptedIn ? t.leaderboard.optInStatusOn : t.leaderboard.optInStatusOff}
            </span>
          </div>
        )}
      </div>

      {/* Period Selection Tabs */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
        <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800/70 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setPeriod('daily')}
            className={`py-1.5 px-3.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              period === 'daily'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {t.leaderboard.daily} (5)
          </button>
          <button
            type="button"
            onClick={() => setPeriod('weekly')}
            className={`py-1.5 px-3.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              period === 'weekly'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {t.leaderboard.weekly} (35)
          </button>
          <button
            type="button"
            onClick={() => setPeriod('monthly')}
            className={`py-1.5 px-3.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              period === 'monthly'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {t.leaderboard.monthly} (150)
          </button>
        </div>

        <div className="text-xs text-slate-400 flex items-center gap-1">
          <Calendar className="w-3.5 h-3.5" />
          <span>{totalParticipants} {t.accountability.prayersCount}</span>
        </div>
      </div>

      {/* Leaderboard Table / Cards */}
      {loading ? (
        <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
          <p className="text-sm font-medium">{t.common.loading}</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 p-12 text-center space-y-3">
          <Trophy className="w-10 h-10 text-slate-300 dark:text-slate-700 mx-auto" />
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            {t.leaderboard.emptyLeaderboard}
          </p>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Be the first worshipper to opt in and establish consistent prayers for this period.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div
              key={entry.username}
              className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${
                entry.isCurrentUser
                  ? 'bg-emerald-50/60 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 shadow-xs'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
              }`}
            >
              {/* Left: Rank & User Info */}
              <div className="flex items-center gap-3.5 min-w-0">
                {getRankBadge(entry.rank)}

                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-900 dark:text-slate-100 truncate">
                      {entry.name}
                    </span>
                    {entry.isCurrentUser && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-600 text-white shrink-0">
                        {t.leaderboard.youBadge}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 truncate">@{entry.username}</p>
                </div>
              </div>

              {/* Right: Metrics */}
              <div className="flex items-center gap-4 shrink-0 text-right">
                <div className="hidden sm:block text-right">
                  <div className="flex items-center justify-end gap-1 text-xs text-slate-500 dark:text-slate-400">
                    <Clock className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{entry.onTimeCount} on-time</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {entry.consistencyPercentage}% consistency
                  </p>
                </div>

                <div className="flex flex-col items-end">
                  <span className="font-black text-base text-slate-900 dark:text-slate-100">
                    {entry.completedCount} <span className="text-xs font-medium text-slate-400">/ {entry.totalPossible}</span>
                  </span>
                  <span className="sm:hidden text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                    {entry.consistencyPercentage}%
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
        </>
      )}
    </div>
  );
}
