'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Trophy,
  Calendar,
  Clock,
  Loader2,
  Shield,
  LogIn,
  Users,
  Award,
  Flame,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import PageHeader from '@/components/PageHeader';
import GroupsManager from '@/components/GroupsManager';
import { getBrowserTimezone } from '@/lib/location';
import { subscribePrayerCacheInvalidation } from '@/lib/prayer-sync-bus';
import type { LeaderboardEntry } from '@/app/api/leaderboard/route';

type LeaderboardPeriod = 'daily' | 'weekly' | 'monthly';
type LeaderboardTab = 'circles' | 'global';

interface CachedPeriodData {
  data: LeaderboardEntry[];
  totalParticipants: number;
  userOptedIn?: boolean;
  timestamp: number;
}

const CACHE_TTL_MS = 60 * 1000;

function LeaderboardContent() {
  const { t } = useLanguage();
  const { user, refreshUser } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();

  const tabParam = searchParams.get('tab');
  const activeTab: LeaderboardTab = tabParam === 'global' ? 'global' : 'circles';

  const handleTabChange = useCallback(
    (tab: LeaderboardTab) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', tab);
      router.replace(`/leaderboard?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const userTimezone = useMemo(
    () => user?.preferences?.timezone || getBrowserTimezone(),
    [user?.preferences?.timezone]
  );

  const [period, setPeriod] = useState<LeaderboardPeriod>('daily');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [totalParticipants, setTotalParticipants] = useState(0);
  const [isOptedIn, setIsOptedIn] = useState<boolean>(() =>
    Boolean(user?.preferences?.showOnLeaderboard)
  );
  const [prevUserShow, setPrevUserShow] = useState<boolean | undefined>(
    user?.preferences?.showOnLeaderboard
  );
  const [togglingOptIn, setTogglingOptIn] = useState(false);

  if (user?.preferences?.showOnLeaderboard !== prevUserShow) {
    setPrevUserShow(user?.preferences?.showOnLeaderboard);
    setIsOptedIn(Boolean(user?.preferences?.showOnLeaderboard));
  }

  const periodCacheRef = useRef<Map<LeaderboardPeriod, CachedPeriodData>>(new Map());
  const inFlightAbortRef = useRef<AbortController | null>(null);
  const currentPeriodRef = useRef<LeaderboardPeriod>(period);
  const optInSeqRef = useRef(0);

  useEffect(() => {
    currentPeriodRef.current = period;
  }, [period]);

  // Clear local cache whenever prayer statuses or payments mutate elsewhere
  useEffect(() => {
    return subscribePrayerCacheInvalidation(() => {
      periodCacheRef.current.clear();
    });
  }, []);

  const fetchLeaderboard = useCallback(
    async (targetPeriod: LeaderboardPeriod, isBackground = false) => {
      if (inFlightAbortRef.current) {
        inFlightAbortRef.current.abort();
      }
      const controller = new AbortController();
      inFlightAbortRef.current = controller;
      const fetchOptSeq = optInSeqRef.current;

      if (!isBackground) {
        setLoading(true);
      }
      setLeaderboardError(null);

      try {
        const tzQuery = userTimezone ? `&timezone=${encodeURIComponent(userTimezone)}` : '';
        const res = await fetch(`/api/leaderboard?period=${targetPeriod}${tzQuery}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!res.ok) {
          if (currentPeriodRef.current === targetPeriod) {
            setLeaderboardError(t.leaderboard.loadError);
          }
          return;
        }
        const json = await res.json();
        if (json?.success) {
          const freshData: CachedPeriodData = {
            data: json.data.leaderboard || [],
            totalParticipants: json.data.totalParticipants || 0,
            userOptedIn: json.data.userOptedIn,
            timestamp: Date.now(),
          };
          periodCacheRef.current.set(targetPeriod, freshData);

          if (currentPeriodRef.current === targetPeriod) {
            setEntries(freshData.data);
            setTotalParticipants(freshData.totalParticipants);
            if (freshData.userOptedIn !== undefined && optInSeqRef.current === fetchOptSeq) {
              setIsOptedIn(freshData.userOptedIn);
            }
          }
        } else if (currentPeriodRef.current === targetPeriod) {
          setLeaderboardError(t.leaderboard.loadError);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        console.error('Failed to fetch leaderboard:', err);
        if (currentPeriodRef.current === targetPeriod) {
          setLeaderboardError(t.leaderboard.loadError);
        }
      } finally {
        if (inFlightAbortRef.current === controller && currentPeriodRef.current === targetPeriod) {
          setLoading(false);
        }
      }
    },
    [userTimezone, t.leaderboard.loadError]
  );

  const handlePeriodChange = useCallback(
    (newPeriod: LeaderboardPeriod) => {
      if (newPeriod === period) return;
      setPeriod(newPeriod);
      currentPeriodRef.current = newPeriod;

      const cached = periodCacheRef.current.get(newPeriod);
      const isFresh = cached && Date.now() - cached.timestamp < CACHE_TTL_MS;

      if (cached) {
        setEntries(cached.data);
        setTotalParticipants(cached.totalParticipants);
        if (cached.userOptedIn !== undefined) {
          setIsOptedIn(cached.userOptedIn);
        }
        setLoading(false);

        if (!isFresh) {
          void fetchLeaderboard(newPeriod, true);
        } else if (inFlightAbortRef.current) {
          inFlightAbortRef.current.abort();
          inFlightAbortRef.current = null;
        }
      } else {
        setLoading(true);
        void fetchLeaderboard(newPeriod, false);
      }
    },
    [period, fetchLeaderboard]
  );

  // Only fetch Global Leaderboard when that tab is active
  useEffect(() => {
    if (activeTab !== 'global') return;

    let ignore = false;
    queueMicrotask(() => {
      if (ignore) return;
      const cached = periodCacheRef.current.get(currentPeriodRef.current);
      const isFresh = cached && Date.now() - cached.timestamp < CACHE_TTL_MS;
      if (cached) {
        setEntries(cached.data);
        setTotalParticipants(cached.totalParticipants);
        setLoading(false);
        if (!isFresh) {
          void fetchLeaderboard(currentPeriodRef.current, true);
        }
      } else {
        void fetchLeaderboard(currentPeriodRef.current, false);
      }
    });

    return () => {
      ignore = true;
      if (inFlightAbortRef.current) {
        inFlightAbortRef.current.abort();
      }
    };
  }, [activeTab, fetchLeaderboard]);

  // Revalidate stale global leaderboard on tab focus when global tab is open
  useEffect(() => {
    if (activeTab !== 'global') return;
    const handleRevalidate = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        const cached = periodCacheRef.current.get(currentPeriodRef.current);
        const isStale = !cached || Date.now() - cached.timestamp >= CACHE_TTL_MS;
        if (isStale) {
          void fetchLeaderboard(currentPeriodRef.current, true);
        }
      }
    };

    window.addEventListener('focus', handleRevalidate);
    document.addEventListener('visibilitychange', handleRevalidate);

    return () => {
      window.removeEventListener('focus', handleRevalidate);
      document.removeEventListener('visibilitychange', handleRevalidate);
    };
  }, [activeTab, fetchLeaderboard]);

  const handleToggleOptIn = async () => {
    if (!user || togglingOptIn) return;
    setTogglingOptIn(true);
    const seq = ++optInSeqRef.current;
    if (inFlightAbortRef.current) {
      inFlightAbortRef.current.abort();
      inFlightAbortRef.current = null;
    }

    const nextVal = !isOptedIn;
    setIsOptedIn(nextVal);
    setPrevUserShow(nextVal);

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
        const putJson = await res.json().catch(() => null);
        const confirmed =
          typeof putJson?.data?.user?.preferences?.showOnLeaderboard === 'boolean'
            ? putJson.data.user.preferences.showOnLeaderboard
            : nextVal;
        if (optInSeqRef.current === seq) {
          setIsOptedIn(confirmed);
          setPrevUserShow(confirmed);
        }
        periodCacheRef.current.clear();
        await refreshUser();
        await fetchLeaderboard(currentPeriodRef.current, false);
      } else if (optInSeqRef.current === seq) {
        setIsOptedIn(!nextVal);
        setPrevUserShow(!nextVal);
      }
    } catch {
      if (optInSeqRef.current === seq) {
        setIsOptedIn(!nextVal);
        setPrevUserShow(!nextVal);
      }
    } finally {
      setTogglingOptIn(false);
    }
  };

  const getRankBadge = (rank: number) => {
    if (rank === 1) {
      return (
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 via-amber-400 to-yellow-300 text-slate-950 font-black text-xs shadow-sm shadow-amber-500/20 border border-amber-300 shrink-0">
          #1
        </span>
      );
    }
    if (rank === 2) {
      return (
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-tr from-slate-400 via-slate-300 to-slate-200 text-slate-900 font-black text-xs shadow-sm shadow-slate-400/20 border border-slate-300 shrink-0">
          #2
        </span>
      );
    }
    if (rank === 3) {
      return (
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-700 via-amber-600 to-amber-500 text-white font-black text-xs shadow-sm shadow-amber-700/20 border border-amber-600 shrink-0">
          #3
        </span>
      );
    }
    return (
      <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold text-xs border border-slate-200 dark:border-slate-700 shrink-0">
        #{rank}
      </span>
    );
  };

  const topPodiumEntries = useMemo(() => {
    return entries.filter((e) => e.rank <= 3);
  }, [entries]);

  return (
    <div className="space-y-5 sm:space-y-6 pb-8">
      <PageHeader
        icon={Trophy}
        title={t.leaderboard.title}
        subtitle={t.leaderboard.subtitle}
      />

      {/* Primary View Switcher: My Circles FIRST, Overall Leaderboard SECOND */}
      <div
        className="flex items-center gap-1.5 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800/80 w-full sm:w-fit"
        role="tablist"
        aria-label={t.leaderboard.title}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'circles'}
          onClick={() => handleTabChange('circles')}
          className={`flex-1 sm:flex-initial min-h-[42px] flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
            activeTab === 'circles'
              ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-2xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Users className="w-4 h-4 shrink-0" />
          <span>{t.groups.tabGroups}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'global'}
          onClick={() => handleTabChange('global')}
          className={`flex-1 sm:flex-initial min-h-[42px] flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
            activeTab === 'global'
              ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-2xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Trophy className="w-4 h-4 shrink-0" />
          <span>{t.groups.tabGlobal}</span>
        </button>
      </div>

      {activeTab === 'circles' ? (
        <GroupsManager />
      ) : (
        <div className="space-y-5">
          {/* Privacy Toggle Card: Compact, private by default, accessible switch */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 shadow-2xs">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <Shield className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {t.leaderboard.optInPrompt}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                    {t.leaderboard.optInNotice}
                  </p>
                </div>
              </div>

              {user ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={isOptedIn}
                  aria-label={t.leaderboard.optInPrompt}
                  disabled={togglingOptIn}
                  onClick={handleToggleOptIn}
                  className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 cursor-pointer disabled:opacity-60 ${
                    isOptedIn
                      ? 'bg-emerald-600 dark:bg-emerald-500'
                      : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      isOptedIn ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  >
                    {togglingOptIn && (
                      <Loader2 className="w-3 h-3 animate-spin text-emerald-600" />
                    )}
                  </span>
                </button>
              ) : (
                <Link
                  href="/login?redirect=/leaderboard?tab=global"
                  className="min-h-[40px] py-2 px-3.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl transition-colors shrink-0 flex items-center justify-center gap-1.5 shadow-xs"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>{t.nav.login}</span>
                </Link>
              )}
            </div>
          </div>

          {/* Period Selection Tabs & Participant Stats */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200/80 dark:border-slate-800/80 pb-3">
            <div className="grid grid-cols-3 sm:flex items-center gap-1 bg-slate-100 dark:bg-slate-800/70 p-1 rounded-xl w-full sm:w-fit">
              <button
                type="button"
                onClick={() => handlePeriodChange('daily')}
                className={`min-h-[38px] py-1.5 px-2 sm:px-3.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-colors cursor-pointer text-center truncate ${
                  period === 'daily'
                    ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {t.leaderboard.daily} (5)
              </button>
              <button
                type="button"
                onClick={() => handlePeriodChange('weekly')}
                className={`min-h-[38px] py-1.5 px-2 sm:px-3.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-colors cursor-pointer text-center truncate ${
                  period === 'weekly'
                    ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {t.leaderboard.weekly} (35)
              </button>
              <button
                type="button"
                onClick={() => handlePeriodChange('monthly')}
                className={`min-h-[38px] py-1.5 px-2 sm:px-3.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-colors cursor-pointer text-center truncate ${
                  period === 'monthly'
                    ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {t.leaderboard.monthly} (150)
              </button>
            </div>

            <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 self-start sm:self-auto">
              <Calendar className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>
                {totalParticipants} {t.leaderboard.participantsCount}
              </span>
            </div>
          </div>

          {leaderboardError && (
            <div
              role="alert"
              className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex flex-wrap items-center justify-between gap-2.5"
            >
              <div className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="font-medium">{leaderboardError}</span>
              </div>
              <button
                type="button"
                onClick={() => void fetchLeaderboard(period, false)}
                className="min-h-[36px] px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-semibold inline-flex items-center gap-1.5 hover:bg-rose-100/60 dark:hover:bg-rose-900/40 cursor-pointer shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{t.common.retry}</span>
              </button>
            </div>
          )}

          {/* Leaderboard Table / Cards */}
          {loading ? (
            <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
              <p className="text-sm font-medium">{t.common.loading}</p>
            </div>
          ) : entries.length === 0 && !leaderboardError ? (
            <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 p-10 text-center space-y-3">
              <Trophy className="w-10 h-10 text-slate-300 dark:text-slate-700 mx-auto" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                {t.leaderboard.emptyLeaderboard}
              </p>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                {t.leaderboard.emptyLeaderboardDesc}
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Top 3 Podium Showcase */}
              {topPodiumEntries.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 items-end">
                  {topPodiumEntries.map((entry) => {
                    const isFirst = entry.rank === 1;
                    const isSecond = entry.rank === 2;
                    const isThird = entry.rank === 3;

                    return (
                      <div
                        key={entry.username}
                        className={`p-4 rounded-2xl border transition-all flex flex-col justify-between relative overflow-hidden ${
                          isFirst
                            ? 'bg-gradient-to-b from-amber-500/10 via-amber-500/5 to-white dark:to-slate-900 border-amber-300 dark:border-amber-700/80 shadow-md shadow-amber-500/10 md:-translate-y-1'
                            : isSecond
                            ? 'bg-gradient-to-b from-slate-200/40 via-slate-100/20 to-white dark:to-slate-900 border-slate-300 dark:border-slate-700 shadow-xs'
                            : isThird
                            ? 'bg-gradient-to-b from-amber-900/10 via-amber-900/5 to-white dark:to-slate-900 border-amber-700/30 dark:border-amber-800/40 shadow-xs'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                        } ${
                          entry.isCurrentUser
                            ? 'ring-2 ring-emerald-500 dark:ring-emerald-400'
                            : ''
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <div className="flex items-center gap-2">
                            {getRankBadge(entry.rank)}
                            <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                              #{entry.rank}
                            </span>
                          </div>

                          {entry.isCurrentUser && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-600 text-white shrink-0">
                              {t.leaderboard.youBadge}
                            </span>
                          )}
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-bold text-base text-slate-900 dark:text-slate-100 truncate">
                              {entry.name}
                            </h3>
                            {entry.currentStreak !== undefined && entry.currentStreak > 0 && (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200/80 dark:border-amber-900/60 shrink-0"
                                title={`${entry.currentStreak} ${t.dashboard.streakDays}`}
                              >
                                <Flame className="w-3 h-3 text-amber-500 fill-amber-500 shrink-0" />
                                <span>{entry.currentStreak}</span>
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 truncate">@{entry.username}</p>
                        </div>

                        <div className="mt-3.5 pt-3 border-t border-slate-100 dark:border-slate-800/80 space-y-2">
                          <div className="flex items-baseline justify-between">
                            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                              {t.leaderboard.prayersCompleted}
                            </span>
                            <span className="text-base font-black text-slate-900 dark:text-slate-100">
                              {entry.completedCount}{' '}
                              <span className="text-xs font-semibold text-slate-400">
                                / {entry.totalPossible}
                              </span>
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                              <Clock className="w-3.5 h-3.5 text-emerald-600" />
                              <span>{entry.onTimeCount} {t.leaderboard.onTimeCount.toLowerCase()}</span>
                            </div>
                            <span className="font-bold text-emerald-600 dark:text-emerald-400">
                              {entry.consistencyPercentage}%
                            </span>
                          </div>

                          <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                isFirst
                                  ? 'bg-amber-500'
                                  : isSecond
                                  ? 'bg-slate-400'
                                  : isThird
                                  ? 'bg-amber-700'
                                  : 'bg-emerald-500'
                              }`}
                              style={{ width: `${entry.consistencyPercentage}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Complete Standings List */}
              <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 shadow-2xs overflow-hidden">
                <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100 font-bold text-sm">
                    <Award className="w-4 h-4 text-emerald-600" />
                    <span>{t.leaderboard.standings}</span>
                  </div>
                  <span className="text-xs text-slate-400">
                    {entries.length} {t.leaderboard.participantsCount}
                  </span>
                </div>

                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {entries.map((entry) => (
                    <div
                      key={entry.username}
                      className={`flex items-center justify-between p-3.5 sm:p-4 transition-colors ${
                        entry.isCurrentUser
                          ? 'bg-emerald-50/60 dark:bg-emerald-950/30'
                          : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        {getRankBadge(entry.rank)}

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-slate-900 dark:text-slate-100 truncate">
                              {entry.name}
                            </span>
                            {entry.isCurrentUser && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-600 text-white shrink-0">
                                {t.leaderboard.youBadge}
                              </span>
                            )}
                            {entry.currentStreak !== undefined && entry.currentStreak > 0 && (
                              <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200/80 dark:border-amber-900/60 shrink-0"
                                title={`${entry.currentStreak} ${t.dashboard.streakDays}`}
                              >
                                <Flame className="w-3 h-3 text-amber-500 fill-amber-500 shrink-0" />
                                <span>{entry.currentStreak}</span>
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 truncate">@{entry.username}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 sm:gap-4 shrink-0 text-right">
                        {entry.currentStreak !== undefined && entry.currentStreak > 0 && (
                          <div
                            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-amber-50/80 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/70 dark:border-amber-900/50 text-xs font-bold shrink-0"
                            title={`${entry.currentStreak} ${t.dashboard.streakDays}`}
                          >
                            <Flame className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                            <span>{entry.currentStreak} {t.dashboard.streakDays}</span>
                          </div>
                        )}

                        <div className="hidden sm:block text-right">
                          <div className="flex items-center justify-end gap-1 text-xs text-slate-500 dark:text-slate-400">
                            <Clock className="w-3.5 h-3.5 text-emerald-600" />
                            <span>
                              {entry.onTimeCount} {t.leaderboard.onTimeCount.toLowerCase()}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400">
                            {entry.consistencyPercentage}% {t.leaderboard.consistency.toLowerCase()}
                          </p>
                        </div>

                        <div className="flex flex-col items-end">
                          <span className="font-black text-sm sm:text-base text-slate-900 dark:text-slate-100">
                            {entry.completedCount}{' '}
                            <span className="text-xs font-medium text-slate-400">
                              / {entry.totalPossible}
                            </span>
                          </span>
                          <span className="sm:hidden text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                            {entry.consistencyPercentage}%
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function LeaderboardPage() {
  return (
    <Suspense
      fallback={
        <div className="py-12 flex justify-center text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
        </div>
      }
    >
      <LeaderboardContent />
    </Suspense>
  );
}
