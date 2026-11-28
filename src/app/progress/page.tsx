'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  TrendingUp,
  History as HistoryIcon,
  BarChart3,
  Scale,
  CheckCircle2,
  AlertCircle,
  Flame,
  Loader2,
  LogIn,
  ChevronRight,
  ChevronDown,
  Check,
  Info,
  RotateCcw,
  HeartHandshake,
  Coins,
  Sparkles,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import PageHeader from '@/components/PageHeader';
import type {
  PrayerId,
  PrayerStatus,
  AccountabilityBreakdownItem,
  PrayerHistoryRecord,
  PrayerItem,
  QazaPaymentReceipt,
} from '@/types/prayer';
import { calculateAccountabilityLedger } from '@/lib/accountability';
import { formatCurrency } from '@/lib/formatters';
import {
  getCalendarDate,
  getLiturgicalDate,
  PLATFORM_LAUNCH_DATE,
} from '@/lib/prayer-cycle';
import { getBrowserTimezone } from '@/lib/location';
import {
  getStoredHistoryRecords,
  saveStoredHistoryRecords,
  mirrorDailyPrayersToHistory,
  saveDailyPrayersSync,
  resetDateInStoredHistory,
  syncDerivedMetricsToStorage,
  getOrInitGuestStartDate,
  enqueuePendingPrayerMutation,
  removePendingPrayerMutation,
  flushPendingPrayerMutations,
  STORAGE_KEY_DAILY_PRAYERS,
} from '@/lib/storage-sync';
import {
  invalidateAllPrayerCaches,
  subscribePrayerCacheInvalidation,
} from '@/lib/prayer-sync-bus';

const PayQazaModal = dynamic(() => import('@/components/qaza/PayQazaModal'), {
  ssr: false,
});

const MonthlyHistoryCalendar = dynamic(
  () => import('@/components/calendar/MonthlyHistoryCalendar'),
  {
    ssr: false,
    loading: () => (
      <div className="py-12 flex justify-center text-slate-400">
        <Loader2 className="w-7 h-7 animate-spin text-emerald-600" />
      </div>
    ),
  }
);

const PRAYER_IDS: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

interface StatsData {
  platformStartDate?: string;
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
  missedByPrayer?: Record<PrayerId, number>;
  prayerBreakdown?: Record<PrayerId, { onTime: number; missed: number; total: number }>;
  streaks: {
    current: number;
    best: number;
    lastActiveDate?: string;
  };
  accountability: {
    totalAmount: number;
    totalFinancialDebt?: number;
    pendingQazaCount?: number;
    totalBaseAmount?: number;
    totalOverdueAmount?: number;
    totalPaidAmount?: number;
    totalMissed?: number;
    totalOverdue?: number;
    totalMadeUp?: number;
    currency: string;
    baseRatePerPrayer?: number;
    overdueRatePerPrayer?: number;
    gracePeriodDays?: number;
    breakdown?: AccountabilityBreakdownItem[];
  };
}

interface ProgressCache {
  stats: StatsData | null;
  paymentHistory: QazaPaymentReceipt[];
  userId: string | null;
  statsTimestamp: number;
  paymentsTimestamp: number;
}

const progressCache: ProgressCache = {
  stats: null,
  paymentHistory: [],
  userId: null,
  statsTimestamp: 0,
  paymentsTimestamp: 0,
};

function clearProgressCache(): void {
  progressCache.stats = null;
  progressCache.paymentHistory = [];
  progressCache.statsTimestamp = 0;
  progressCache.paymentsTimestamp = 0;
}

type TabType = 'history' | 'overview' | 'qaza';

function ProgressContent() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();

  const userTimezone = useMemo(
    () => user?.preferences?.timezone || getBrowserTimezone(),
    [user?.preferences?.timezone]
  );

  // Live clock tick so calendar/liturgical dates stay accurate across midnight & Fajr rollover
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const calendarTodayStr = useMemo(
    () => getCalendarDate(now, userTimezone),
    [now, userTimezone]
  );
  const liturgicalTodayStr = useMemo(
    () => getLiturgicalDate(now, undefined, userTimezone),
    [now, userTimezone]
  );

  const tabParam = searchParams.get('tab');
  const activeTab: TabType =
    tabParam === 'overview' ? 'overview' : tabParam === 'qaza' ? 'qaza' : 'history';

  const handleTabChange = useCallback(
    (tab: TabType) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', tab);
      router.replace(`/progress?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const [viewYear, setViewYear] = useState(() => Number(calendarTodayStr.slice(0, 4)));
  const [viewMonth, setViewMonth] = useState(() => Number(calendarTodayStr.slice(5, 7)) - 1);
  const [selectedDate, setSelectedDate] = useState(() => liturgicalTodayStr);
  const [updatingPrayerKey, setUpdatingPrayerKey] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [showAllFines, setShowAllFines] = useState(false);

  const userId = user?.id ?? null;

  // Platform start date (enforced client & server, hydration-safe)
  const [guestStartDate, setGuestStartDate] = useState<string>(PLATFORM_LAUNCH_DATE);
  useEffect(() => {
    if (userId) return;
    queueMicrotask(() => {
      setGuestStartDate(getOrInitGuestStartDate(liturgicalTodayStr));
    });
  }, [userId, liturgicalTodayStr]);

  const platformStartDate = user?.platformStartDate || guestStartDate;

  // Clear module cache if user switches or logs out
  useEffect(() => {
    if (progressCache.userId && progressCache.userId !== userId) {
      clearProgressCache();
      progressCache.userId = userId;
    }
  }, [userId]);

  // Listen to cross-route invalidation bus so Home -> Progress is never stale
  useEffect(() => {
    return subscribePrayerCacheInvalidation(() => {
      progressCache.statsTimestamp = 0;
      progressCache.paymentsTimestamp = 0;
    });
  }, []);

  const [stats, setStats] = useState<StatsData | null>(() => {
    if (userId && progressCache.userId === userId && progressCache.stats) {
      return progressCache.stats;
    }
    return null;
  });
  const [recordsByDate, setRecordsByDate] = useState<Record<string, PrayerHistoryRecord>>({});
  const recordsByDateRef = useRef<Record<string, PrayerHistoryRecord>>({});
  useEffect(() => {
    recordsByDateRef.current = recordsByDate;
  }, [recordsByDate]);
  const [loadingStats, setLoadingStats] = useState<boolean>(() => {
    return Boolean(userId && !(progressCache.userId === userId && progressCache.stats));
  });
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [localQaza] = useLocalStorage<number>('salahtrack_qaza_count', 0);
  const [settledDonations] = useLocalStorage<number>('salahtrack_settled_donations', 0);
  const [paymentHistory, setPaymentHistory] = useState<QazaPaymentReceipt[]>(() => {
    if (userId && progressCache.userId === userId && progressCache.paymentHistory.length > 0) {
      return progressCache.paymentHistory;
    }
    return [];
  });
  const [expandedReceiptIds, setExpandedReceiptIds] = useState<Set<string>>(new Set());
  const [loadingPayments, setLoadingPayments] = useState<boolean>(() => {
    return Boolean(userId && !(progressCache.userId === userId && progressCache.paymentHistory.length > 0));
  });
  const [isPayModalOpen, setIsPayModalOpen] = useState(false);

  const mutationAbortRefs = useRef<Map<string, AbortController>>(new Map());
  const mutationSeqRefs = useRef<Map<string, number>>(new Map());
  const lastFocusRefreshRef = useRef<number>(0);

  useEffect(() => {
    const controllers = mutationAbortRefs.current;
    return () => {
      controllers.forEach((c) => c.abort());
      controllers.clear();
    };
  }, []);

  const toggleExpandReceipt = useCallback((receiptId: string) => {
    setExpandedReceiptIds((prev) => {
      const next = new Set(prev);
      if (next.has(receiptId)) next.delete(receiptId);
      else next.add(receiptId);
      return next;
    });
  }, []);

  // Fetch /api/stats (feeds Overview + Qaza tabs in a single lean round-trip)
  const fetchStats = useCallback(
    async (isBackground = false) => {
      if (!userId) {
        setLoadingStats(false);
        return;
      }
      if (!isBackground && !progressCache.stats) {
        setLoadingStats(true);
      }
      try {
        const tzParam = userTimezone ? `&timezone=${encodeURIComponent(userTimezone)}` : '';
        const res = await fetch(`/api/stats?today=${liturgicalTodayStr}${tzParam}`);
        if (res.ok) {
          const json = await res.json();
          if (json.success) {
            setStats(json.data);
            progressCache.stats = json.data;
            progressCache.userId = userId;
            progressCache.statsTimestamp = Date.now();

            if (json.data?.accountability) {
              try {
                localStorage.setItem(
                  'salahtrack_accountability_cache',
                  JSON.stringify({
                    totalAmount:
                      json.data.accountability.totalFinancialDebt ??
                      json.data.accountability.totalAmount ??
                      0,
                    pendingQazaCount:
                      json.data.accountability.pendingQazaCount ??
                      json.data.accountability.totalMissed ??
                      0,
                  })
                );
              } catch {
                // ignore
              }
            }
          }
        }
      } catch (err) {
        console.error('Failed to fetch progress stats:', err);
      } finally {
        setLoadingStats(false);
      }
    },
    [userId, liturgicalTodayStr, userTimezone]
  );

  const fetchPaymentHistory = useCallback(
    async (isBackground = false) => {
      if (!userId) {
        setLoadingPayments(false);
        return;
      }
      if (!isBackground && progressCache.paymentHistory.length === 0) {
        setLoadingPayments(true);
      }
      try {
        const res = await fetch('/api/prayers/qaza-payment');
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.data)) {
            setPaymentHistory(json.data);
            progressCache.paymentHistory = json.data;
            progressCache.userId = userId;
            progressCache.paymentsTimestamp = Date.now();
          }
        }
      } catch (err) {
        console.error('Failed to fetch payment history:', err);
      } finally {
        setLoadingPayments(false);
      }
    },
    [userId]
  );

  // Fetch Monthly History ONLY when needed (History tab or guest mode local records)
  const fetchMonthHistory = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const storedHistory = getStoredHistoryRecords();
        if (storedHistory && Object.keys(storedHistory).length > 0) {
          setRecordsByDate(storedHistory);
        }

        const rawDaily = window.localStorage.getItem(STORAGE_KEY_DAILY_PRAYERS);
        const rawLastDate = window.localStorage.getItem('salahtrack_last_active_date');
        const lastDate = rawLastDate ? JSON.parse(rawLastDate) : null;
        if (rawDaily && lastDate === liturgicalTodayStr) {
          const dailyPrayers: PrayerItem[] = JSON.parse(rawDaily);
          if (Array.isArray(dailyPrayers) && dailyPrayers.length > 0) {
            const updated = mirrorDailyPrayersToHistory(liturgicalTodayStr, dailyPrayers);
            setRecordsByDate(updated);
          }
        }
      } catch {
        // ignore parse errors
      }

      if (!userId || activeTab !== 'history') return;

      setLoadingHistory(true);
      try {
        const monthStr = String(viewMonth + 1).padStart(2, '0');
        const startOfMonthStr = `${viewYear}-${monthStr}-01`;
        const lastDay = new Date(viewYear, viewMonth + 1, 0).getDate();
        const endOfMonthStr = `${viewYear}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
        const tzParam = userTimezone ? `&timezone=${encodeURIComponent(userTimezone)}` : '';

        const res = await fetch(
          `/api/prayers/history?startDate=${startOfMonthStr}&endDate=${endOfMonthStr}${tzParam}`,
          signal ? { signal } : undefined
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
              // Remove stale local records within the fetched month that no longer exist on server,
              // while preserving records from other months.
              const cleaned: Record<string, PrayerHistoryRecord> = {};
              for (const [dKey, rec] of Object.entries(prev)) {
                if (dKey < startOfMonthStr || dKey > endOfMonthStr) {
                  cleaned[dKey] = rec;
                }
              }
              const updated = { ...cleaned, ...mappedRecords };
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
    },
    [userId, activeTab, viewYear, viewMonth, liturgicalTodayStr, userTimezone]
  );

  // Trigger stats fetch on mount / invalidation
  useEffect(() => {
    let ignore = false;
    queueMicrotask(() => {
      if (ignore) return;
      if (!userId) {
        setLoadingStats(false);
        return;
      }
      const hasCachedStats = Boolean(progressCache.userId === userId && progressCache.stats);
      const isStatsFresh =
        hasCachedStats && Date.now() - progressCache.statsTimestamp < 30000;

      if (!isStatsFresh) {
        void fetchStats(hasCachedStats);
      }
    });
    return () => {
      ignore = true;
    };
  }, [userId, fetchStats]);

  // Lazy-load payment history ONLY when user opens Qaza tab
  useEffect(() => {
    if (!userId || activeTab !== 'qaza') return;
    let ignore = false;
    queueMicrotask(() => {
      if (ignore) return;
      const hasCachedPayments =
        progressCache.userId === userId && progressCache.paymentHistory.length > 0;
      const isPaymentsFresh =
        hasCachedPayments && Date.now() - progressCache.paymentsTimestamp < 30000;

      if (!isPaymentsFresh) {
        void fetchPaymentHistory(hasCachedPayments);
      }
    });
    return () => {
      ignore = true;
    };
  }, [userId, activeTab, fetchPaymentHistory]);

  // Fetch month history on History tab or month navigation
  useEffect(() => {
    const abortController = new AbortController();
    let ignore = false;
    queueMicrotask(() => {
      if (!ignore) {
        void fetchMonthHistory(abortController.signal);
      }
    });
    return () => {
      ignore = true;
      abortController.abort();
    };
  }, [fetchMonthHistory]);

  // Single unified throttled tab focus / visibility revalidation
  useEffect(() => {
    const handleRevalidate = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
      const nowMs = Date.now();
      if (nowMs - lastFocusRefreshRef.current < 15000) return;
      lastFocusRefreshRef.current = nowMs;

      setNow(new Date());
      if (!userId) return;

      if (nowMs - progressCache.statsTimestamp >= 30000) {
        void fetchStats(true);
      }
      if (activeTab === 'history') {
        void fetchMonthHistory();
      }
      if (activeTab === 'qaza' && nowMs - progressCache.paymentsTimestamp >= 30000) {
        void fetchPaymentHistory(true);
      }
    };

    window.addEventListener('focus', handleRevalidate);
    document.addEventListener('visibilitychange', handleRevalidate);
    return () => {
      window.removeEventListener('focus', handleRevalidate);
      document.removeEventListener('visibilitychange', handleRevalidate);
    };
  }, [userId, activeTab, fetchStats, fetchMonthHistory, fetchPaymentHistory]);

  // Reactive synchronization with HomeDashboard & cross-tab storage edits
  useEffect(() => {
    function handleStorageUpdate() {
      try {
        const stored = getStoredHistoryRecords();
        recordsByDateRef.current = stored;
        setRecordsByDate(stored);
      } catch {
        // ignore
      }
    }
    function handleCrossTabStorage(e: StorageEvent) {
      if (
        e.key === null ||
        e.key === 'salahtrack_history_records' ||
        e.key === 'salahtrack_daily_prayers' ||
        e.key === 'salahtrack_qaza_count' ||
        e.key === 'salahtrack_streak' ||
        e.key === 'salahtrack_accountability_cache' ||
        e.key === 'salahtrack_settled_donations'
      ) {
        progressCache.statsTimestamp = 0;
        progressCache.paymentsTimestamp = 0;
        handleStorageUpdate();
        if (userId) {
          void fetchStats(true);
        }
      }
    }
    function handleOnline() {
      if (!userId) return;
      void flushPendingPrayerMutations(userTimezone).then((syncedCount) => {
        if (syncedCount > 0) {
          invalidateAllPrayerCaches();
          void fetchStats(true);
          if (activeTab === 'history') {
            void fetchMonthHistory();
          }
        }
      });
    }
    window.addEventListener('local-storage-update', handleStorageUpdate);
    window.addEventListener('storage', handleCrossTabStorage);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('local-storage-update', handleStorageUpdate);
      window.removeEventListener('storage', handleCrossTabStorage);
      window.removeEventListener('online', handleOnline);
    };
  }, [userId, userTimezone, activeTab, fetchStats, fetchMonthHistory]);

  const handlePaymentModalSuccess = useCallback(async () => {
    invalidateAllPrayerCaches();
    await Promise.all([fetchStats(true), fetchPaymentHistory(true)]);
  }, [fetchStats, fetchPaymentHistory]);

  const handleChangeMonth = useCallback((year: number, month: number) => {
    setViewYear(year);
    setViewMonth(month);
  }, []);

  const handleSelectDate = useCallback((date: string) => {
    setSelectedDate(date);
    setMutationError(null);
  }, []);

  // Historical Prayer Correction mutation with concurrency sequencing, rollback on 4xx, and offline queue fallback
  const handleHistoricalCorrection = useCallback(
    async (recordDate: string, prayerId: PrayerId, newStatus: PrayerStatus) => {
      if (recordDate > calendarTodayStr) {
        setMutationError(t.progress.futureDateError);
        return;
      }

      setMutationError(null);
      const key = `${recordDate}-${prayerId}`;
      const nextSeq = (mutationSeqRefs.current.get(key) || 0) + 1;
      mutationSeqRefs.current.set(key, nextSeq);
      setUpdatingPrayerKey(key);

      const normalizedStatus: PrayerStatus =
        newStatus === 'PRAYED' ? 'PRAYED_ON_TIME' : newStatus;

      const prevRecords = recordsByDateRef.current;
      const previousRecordSnapshot = prevRecords[recordDate];
      const existing = prevRecords[recordDate] || {
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

      const prevEntry = existing.prayers?.[prayerId] || { status: 'PENDING' };
      const nowIso = new Date().toISOString();

      const updatedEntry = {
        ...prevEntry,
        status: normalizedStatus,
        prayedAt:
          normalizedStatus === 'PRAYED_ON_TIME' || normalizedStatus === 'PRAYED_LATE'
            ? nowIso
            : undefined,
        missedAt: normalizedStatus === 'MISSED' ? prevEntry.missedAt || nowIso : undefined,
        madeUpAt: normalizedStatus === 'MADE_UP' ? nowIso : undefined,
      };

      const updatedRecords: Record<string, PrayerHistoryRecord> = {
        ...prevRecords,
        [recordDate]: {
          ...existing,
          prayers: {
            ...existing.prayers,
            [prayerId]: updatedEntry,
          },
        },
      };

      // 1. Optimistic update + sync localStorage derived metrics
      recordsByDateRef.current = updatedRecords;
      setRecordsByDate(updatedRecords);
      saveStoredHistoryRecords(updatedRecords);
      syncDerivedMetricsToStorage(updatedRecords, liturgicalTodayStr);

      // 2. Sync today's daily store if editing active liturgical day
      if (recordDate === liturgicalTodayStr) {
        try {
          const rawDaily = window.localStorage.getItem(STORAGE_KEY_DAILY_PRAYERS);
          const parsedDaily: PrayerItem[] = rawDaily ? JSON.parse(rawDaily) : [];
          if (Array.isArray(parsedDaily) && parsedDaily.length > 0) {
            const updatedDaily = parsedDaily.map((item) =>
              item.id === prayerId ? { ...item, status: normalizedStatus } : item
            );
            saveDailyPrayersSync(recordDate, updatedDaily);
          }
        } catch {
          // ignore
        }
      }

      if (!user) {
        invalidateAllPrayerCaches();
        setUpdatingPrayerKey(null);
        return;
      }

      const prevController = mutationAbortRefs.current.get(key);
      if (prevController) prevController.abort();
      const controller = new AbortController();
      mutationAbortRefs.current.set(key, controller);

      try {
        const res = await fetch('/api/prayers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: recordDate,
            prayerId,
            status: normalizedStatus,
            timezone: userTimezone,
          }),
          signal: controller.signal,
        });

        if (mutationSeqRefs.current.get(key) !== nextSeq) return;

        if (res.ok) {
          removePendingPrayerMutation(recordDate, prayerId);
          invalidateAllPrayerCaches();
          const json = await res.json().catch(() => null);
          if (json?.data?.prayers) {
            const serverSynced = { ...recordsByDateRef.current, [recordDate]: json.data };
            recordsByDateRef.current = serverSynced;
            setRecordsByDate(serverSynced);
            saveStoredHistoryRecords(serverSynced);
            syncDerivedMetricsToStorage(serverSynced, liturgicalTodayStr);
          }
          await fetchStats(true);
        } else {
          const errJson = await res.json().catch(() => null);
          if (res.status >= 400 && res.status < 500 && res.status !== 429) {
            // Revert optimistic update on explicit server rejection (e.g. PAID_PRAYER_LOCKED)
            setMutationError(errJson?.error || t.common.error);
            const reverted = { ...recordsByDateRef.current };
            if (previousRecordSnapshot) reverted[recordDate] = previousRecordSnapshot;
            else delete reverted[recordDate];
            recordsByDateRef.current = reverted;
            setRecordsByDate(reverted);
            saveStoredHistoryRecords(reverted);
            syncDerivedMetricsToStorage(reverted, liturgicalTodayStr);
            invalidateAllPrayerCaches();
          } else {
            enqueuePendingPrayerMutation({
              date: recordDate,
              prayerId,
              status: normalizedStatus,
              timezone: userTimezone,
            });
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        enqueuePendingPrayerMutation({
          date: recordDate,
          prayerId,
          status: normalizedStatus,
          timezone: userTimezone,
        });
      } finally {
        if (mutationSeqRefs.current.get(key) === nextSeq) {
          mutationAbortRefs.current.delete(key);
          setUpdatingPrayerKey(null);
        }
      }
    },
    [calendarTodayStr, liturgicalTodayStr, t.progress.futureDateError, t.common.error, user, userTimezone, fetchStats]
  );

  // One-click Day Reset for historical dates (resets all non-paid prayers on date to PENDING)
  const handleResetDay = useCallback(
    async (recordDate: string) => {
      if (recordDate > calendarTodayStr) return;
      setMutationError(null);
      const lockKey = `${recordDate}-ALL`;
      setUpdatingPrayerKey(lockKey);

      const previousRecordsSnapshot = { ...recordsByDateRef.current };
      const existing = previousRecordsSnapshot[recordDate];
      const batchPayload: Partial<Record<PrayerId, PrayerStatus>> = {};
      for (const p of PRAYER_IDS) {
        if (!existing?.prayers?.[p]?.isPaid) {
          batchPayload[p] = 'PENDING';
        }
      }

      const updatedLocal = resetDateInStoredHistory(recordDate, platformStartDate);
      recordsByDateRef.current = updatedLocal;
      setRecordsByDate(updatedLocal);
      syncDerivedMetricsToStorage(updatedLocal, liturgicalTodayStr);

      if (recordDate === liturgicalTodayStr) {
        try {
          const rawDaily = window.localStorage.getItem(STORAGE_KEY_DAILY_PRAYERS);
          const parsedDaily: PrayerItem[] = rawDaily ? JSON.parse(rawDaily) : [];
          if (Array.isArray(parsedDaily) && parsedDaily.length > 0) {
            const updatedDaily = parsedDaily.map((item) =>
              batchPayload[item.id] ? { ...item, status: 'PENDING' as PrayerStatus } : item
            );
            saveDailyPrayersSync(recordDate, updatedDaily);
          }
        } catch {
          // ignore
        }
      }

      if (!user) {
        invalidateAllPrayerCaches();
        setUpdatingPrayerKey(null);
        return;
      }

      if (Object.keys(batchPayload).length > 0) {
        try {
          const res = await fetch('/api/prayers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              date: recordDate,
              prayers: batchPayload,
              timezone: userTimezone,
            }),
          });
          if (res.ok) {
            removePendingPrayerMutation(recordDate);
            for (const pId of Object.keys(batchPayload) as PrayerId[]) {
              removePendingPrayerMutation(recordDate, pId);
            }
            invalidateAllPrayerCaches();
            await fetchStats(true);
          } else {
            const errJson = await res.json().catch(() => null);
            if (res.status >= 400 && res.status < 500 && res.status !== 429) {
              setMutationError(errJson?.error || t.common.error);
              recordsByDateRef.current = previousRecordsSnapshot;
              setRecordsByDate(previousRecordsSnapshot);
              saveStoredHistoryRecords(previousRecordsSnapshot);
              syncDerivedMetricsToStorage(previousRecordsSnapshot, liturgicalTodayStr);
              invalidateAllPrayerCaches();
            } else {
              enqueuePendingPrayerMutation({
                date: recordDate,
                prayers: batchPayload,
                timezone: userTimezone,
              });
            }
          }
        } catch {
          enqueuePendingPrayerMutation({
            date: recordDate,
            prayers: batchPayload,
            timezone: userTimezone,
          });
        }
      }

      setUpdatingPrayerKey(null);
    },
    [calendarTodayStr, liturgicalTodayStr, platformStartDate, user, userTimezone, fetchStats, t.common.error]
  );

  // Local fallback ledger & calculations (0ms instant display for guests and pre-hydration)
  const localLedger = useMemo(() => {
    return calculateAccountabilityLedger(recordsByDate, liturgicalTodayStr);
  }, [recordsByDate, liturgicalTodayStr]);

  const localOverviewStats = useMemo(() => {
    const breakdown: Record<PrayerId, { onTime: number; missed: number; total: number }> = {
      fajr: { onTime: 0, missed: 0, total: 0 },
      dhuhr: { onTime: 0, missed: 0, total: 0 },
      asr: { onTime: 0, missed: 0, total: 0 },
      maghrib: { onTime: 0, missed: 0, total: 0 },
      isha: { onTime: 0, missed: 0, total: 0 },
    };
    const missedByPrayer: Record<PrayerId, number> = {
      fajr: 0,
      dhuhr: 0,
      asr: 0,
      maghrib: 0,
      isha: 0,
    };
    let onTime30 = 0;
    let madeUp30 = 0;
    let missed30 = 0;
    let weeklyCompleted = 0;

    const [y, m, d] = liturgicalTodayStr.split('-').map(Number);
    const todayUtc = Date.UTC(y, m - 1, d);
    const sevenDaysAgo = new Date(todayUtc - 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(todayUtc - 29 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    for (const rec of Object.values(recordsByDate)) {
      if (!rec.prayers) continue;
      const in30 = rec.date >= thirtyDaysAgo && rec.date <= liturgicalTodayStr;
      const in7 = rec.date >= sevenDaysAgo && rec.date <= liturgicalTodayStr;
      for (const p of PRAYER_IDS) {
        const st = rec.prayers[p]?.status;
        if (st === 'MISSED') {
          missedByPrayer[p] += 1;
        }
        if (in30) {
          if (st === 'PRAYED_ON_TIME' || st === 'PRAYED' || st === 'PRAYED_LATE') {
            breakdown[p].onTime += 1;
            breakdown[p].total += 1;
            onTime30 += 1;
            if (in7) weeklyCompleted += 1;
          } else if (st === 'MISSED') {
            breakdown[p].missed += 1;
            breakdown[p].total += 1;
            missed30 += 1;
          } else if (st === 'MADE_UP') {
            breakdown[p].total += 1;
            madeUp30 += 1;
          }
        }
      }
    }
    return {
      breakdown,
      missedByPrayer,
      onTime30,
      madeUp30,
      missed30,
      weeklyPct: Math.round((weeklyCompleted / 35) * 100),
    };
  }, [recordsByDate, liturgicalTodayStr]);

  const effectiveBreakdown = stats?.prayerBreakdown || localOverviewStats.breakdown;
  const effectiveMissedByPrayer = stats?.missedByPrayer || localOverviewStats.missedByPrayer;

  const isStatsLoading = Boolean(user && loadingStats && !stats);

  const fineItems = useMemo(() => {
    if (stats?.accountability?.breakdown) return stats.accountability.breakdown;
    return localLedger.items;
  }, [stats?.accountability?.breakdown, localLedger.items]);

  const accountabilityTotal =
    stats?.accountability?.totalFinancialDebt ??
    stats?.accountability?.totalAmount ??
    localLedger.totalAmount;

  const pendingQazaCount =
    stats?.accountability?.pendingQazaCount ??
    stats?.accountability?.totalMissed ??
    (localLedger.pendingQazaCount ?? localLedger.missedCount);

  const accountabilityOverdue =
    stats?.accountability?.totalOverdue ??
    fineItems.filter((it) => it.isOverdue && it.status === 'MISSED').length;

  const totalBaseFines = useMemo(() => {
    return fineItems.reduce((sum, it) => sum + (it.baseAmount ?? 15000), 0);
  }, [fineItems]);

  const totalOverduePenalties = useMemo(() => {
    return fineItems.reduce((sum, it) => sum + (it.overdueAmount || 0), 0);
  }, [fineItems]);

  const totalQazaCount = pendingQazaCount || localQaza || 0;
  const displayedFineItems = showAllFines ? fineItems : fineItems.slice(0, 10);

  return (
    <div className="space-y-4 sm:space-y-6 pb-8">
      <PageHeader
        icon={TrendingUp}
        title={t.progress.title}
        subtitle={t.progress.subtitle}
        actions={
          !user ? (
            <Link
              href="/login"
              className="min-h-[40px] py-2 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-2 shadow-xs transition-colors cursor-pointer"
            >
              <LogIn className="w-4 h-4" />
              <span>{t.nav.login}</span>
            </Link>
          ) : undefined
        }
      />

      {!user && (
        <div className="p-3.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-900/40 text-amber-800 dark:text-amber-300 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
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

      {/* Segmented Navigation Tabs: History (default) -> Overview -> Qaza */}
      <div className="border-b border-slate-200 dark:border-slate-800">
        <nav
          className="grid grid-cols-3 sm:flex sm:space-x-3"
          aria-label={t.progress.title}
          role="tablist"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'history'}
            onClick={() => handleTabChange('history')}
            className={`min-h-[44px] py-2 px-1 sm:px-3 border-b-2 text-[11px] sm:text-sm font-semibold leading-tight text-center transition-colors flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1 sm:gap-1.5 cursor-pointer ${
              activeTab === 'history'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <HistoryIcon className="w-4 h-4 shrink-0" />
            <span className="sm:whitespace-nowrap">{t.progress.tabs.history}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'overview'}
            onClick={() => handleTabChange('overview')}
            className={`min-h-[44px] py-2 px-1 sm:px-3 border-b-2 text-[11px] sm:text-sm font-semibold leading-tight text-center transition-colors flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1 sm:gap-1.5 cursor-pointer ${
              activeTab === 'overview'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <TrendingUp className="w-4 h-4 shrink-0" />
            <span className="sm:whitespace-nowrap">{t.progress.tabs.overview}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'qaza'}
            onClick={() => handleTabChange('qaza')}
            className={`min-h-[44px] py-2 px-1 sm:px-3 border-b-2 text-[11px] sm:text-sm font-semibold leading-tight text-center transition-colors flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1 sm:gap-1.5 cursor-pointer ${
              activeTab === 'qaza'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Scale className="w-4 h-4 shrink-0" />
            <span className="sm:whitespace-nowrap">{t.progress.tabs.qaza}</span>
          </button>
        </nav>
      </div>

      {/* ==================== TAB 1: OVERVIEW (Streamlined, Mobile-First) ==================== */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Compact 2x2 KPI Stats Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 xs:gap-2.5 sm:gap-3.5">
            {/* Completion */}
            <div className="p-3 sm:p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block">
                {t.progress.summary.completionRate}
              </span>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {stats ? `${stats.weekly.percentage}%` : `${localOverviewStats.weeklyPct}%`}
                </span>
                <span className="text-[10px] text-slate-400">{t.progress.periods.d7}</span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
                <div
                  className="bg-emerald-600 h-full rounded-full transition-all duration-500"
                  style={{ width: `${stats ? stats.weekly.percentage : localOverviewStats.weeklyPct}%` }}
                />
              </div>
            </div>

            {/* Streak */}
            <div className="p-3 sm:p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block">
                {t.progress.summary.currentStreak}
              </span>
              <div className="flex items-center gap-1.5 mt-1">
                <Flame className="w-4 h-4 text-amber-500 fill-amber-500 shrink-0" />
                <span className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {stats?.streaks.current || 0}
                </span>
                <span className="text-[11px] text-slate-400 font-medium truncate">
                  {t.dashboard.streakDays}
                </span>
              </div>
              <span className="text-[10px] text-slate-400 mt-1.5 block">
                {t.progress.summary.bestStreak}: {stats?.streaks.best || 0}
              </span>
            </div>

            {/* 30-Day On-Time */}
            <div className="p-3 sm:p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block">
                {t.progress.summary.onTimeRate}
              </span>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-xl sm:text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  {stats
                    ? (stats.counts30d.onTime || 0) + (stats.counts30d.late || 0)
                    : localOverviewStats.onTime30}
                </span>
                <span className="text-[11px] text-slate-400 font-medium">/ 150</span>
              </div>
              <span className="text-[10px] text-slate-400 mt-1.5 block">{t.progress.indicator30d}</span>
            </div>

            {/* Accountability Balance */}
            <div className="p-3 sm:p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs flex flex-col justify-between">
              <div>
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block leading-tight">
                  {t.accountability.title}
                </span>
                <div className="flex items-baseline gap-1 mt-1">
                  {isStatsLoading ? (
                    <div className="h-6 w-16 bg-slate-200 dark:bg-slate-700 animate-pulse rounded" />
                  ) : (
                    <>
                      <span className="text-base xs:text-lg sm:text-xl font-bold text-rose-600 dark:text-rose-400 tabular-nums break-words">
                        {accountabilityTotal.toLocaleString()}
                      </span>
                      <span className="text-[10px] text-slate-400">{t.common.currency}</span>
                    </>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleTabChange('qaza')}
                className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 mt-1.5 flex items-center gap-0.5 cursor-pointer"
              >
                <span className="truncate">{t.progress.detailedBreakdown}</span>
                <ChevronRight className="w-3 h-3 shrink-0" />
              </button>
            </div>
          </div>

          {/* Compact 30-Day Status Pill Strip */}
          <div className="grid grid-cols-3 gap-1.5 xs:gap-2 sm:gap-3">
            <div className="p-2 xs:p-2.5 sm:p-3.5 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 min-w-0">
              <span className="text-[10px] xs:text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 block truncate">
                {t.statuses.PRAYED}
              </span>
              <span className="text-base xs:text-lg sm:text-xl font-bold text-emerald-800 dark:text-emerald-200">
                {stats
                  ? (stats.counts30d.onTime || 0) + (stats.counts30d.late || 0)
                  : localOverviewStats.onTime30}
              </span>
            </div>
            <div className="p-2 xs:p-2.5 sm:p-3.5 rounded-2xl bg-sky-50/60 dark:bg-sky-950/20 border border-sky-100 dark:border-sky-900/40 min-w-0">
              <span className="text-[10px] xs:text-[11px] font-semibold text-sky-700 dark:text-sky-400 block truncate">
                {t.statuses.MADE_UP}
              </span>
              <span className="text-base xs:text-lg sm:text-xl font-bold text-sky-800 dark:text-sky-200">
                {stats ? stats.counts30d.madeUp || 0 : localOverviewStats.madeUp30}
              </span>
            </div>
            <div className="p-2 xs:p-2.5 sm:p-3.5 rounded-2xl bg-rose-50/60 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/40 min-w-0">
              <span className="text-[10px] xs:text-[11px] font-semibold text-rose-700 dark:text-rose-400 block truncate">
                {t.statuses.MISSED}
              </span>
              <span className="text-base xs:text-lg sm:text-xl font-bold text-rose-800 dark:text-rose-200">
                {stats ? stats.counts30d.missed || 0 : localOverviewStats.missed30}
              </span>
            </div>
          </div>

          {/* Consistency by Prayer */}
          <div className="rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-5 dark:border-slate-800 dark:bg-slate-900 shadow-2xs space-y-3.5">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-600 shrink-0" />
              <div>
                <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
                  {t.progress.consistencyTitle}
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {t.progress.consistencySubtitle}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {PRAYER_IDS.map((p) => {
                const item = effectiveBreakdown[p];
                const pct = item.total > 0 ? Math.round((item.onTime / item.total) * 100) : 0;
                return (
                  <div key={p} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-700 dark:text-slate-300 capitalize">
                        {t.prayers[p]}
                      </span>
                      <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                        {pct}% <span className="text-slate-400 font-normal">({item.onTime}/{item.total})</span>
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
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
        </div>
      )}

      {/* ==================== TAB 2: INTERACTIVE HISTORY & MONTHLY CALENDAR ==================== */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{t.progress.historicalEditNotice}</span>
            </div>
          </div>

          {mutationError && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{mutationError}</span>
            </div>
          )}

          <MonthlyHistoryCalendar
            selectedDate={selectedDate}
            onSelectDate={handleSelectDate}
            records={recordsByDate}
            onUpdatePrayerStatus={handleHistoricalCorrection}
            onResetDay={handleResetDay}
            updatingPrayerKey={updatingPrayerKey}
            viewYear={viewYear}
            viewMonth={viewMonth}
            onChangeMonth={handleChangeMonth}
            isLoading={loadingHistory}
            platformStartDate={platformStartDate}
            timezone={userTimezone}
            calendarTodayOverride={calendarTodayStr}
            liturgicalTodayOverride={liturgicalTodayStr}
          />
        </div>
      )}

      {/* ==================== TAB 3: QAZA & ACCOUNTABILITY (Compact Mobile-First) ==================== */}
      {activeTab === 'qaza' && (
        <div className="space-y-5">
          {/* SECTION A: SPIRITUAL QAZA SUMMARY */}
          <section className="space-y-3" aria-labelledby="spiritual-section-title">
            <div className="flex items-center gap-2.5">
              <span className="p-1.5 rounded-xl bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400">
                <RotateCcw className="w-4 h-4" />
              </span>
              <div>
                <h2 id="spiritual-section-title" className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {t.accountability.spiritualTitle}
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {t.accountability.spiritualDesc}
                </p>
              </div>
            </div>

            {/* Unified Compact Qaza Hero + Payoff Projection Card */}
            <div className="rounded-2xl bg-gradient-to-br from-sky-950 via-slate-900 to-indigo-950 text-white p-4 sm:p-5 shadow-sm border border-sky-900/40 space-y-3">
              <div className="flex flex-col xs:flex-row xs:items-center justify-between gap-2 xs:gap-3">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-300">
                    {t.accountability.spiritualPendingCount}
                  </span>
                  <div className="flex items-baseline gap-2 mt-0.5">
                    {isStatsLoading ? (
                      <div className="h-8 w-20 bg-white/20 rounded animate-pulse" />
                    ) : (
                      <>
                        <span className="text-3xl font-black text-white tabular-nums">
                          {pendingQazaCount}
                        </span>
                        <span className="text-xs text-sky-200">{t.accountability.prayersCount}</span>
                      </>
                    )}
                  </div>
                </div>

                {pendingQazaCount > 0 && (
                  <div className="xs:text-right text-[11px] text-slate-300 space-y-0.5">
                    <div className="flex items-center xs:justify-end gap-1 text-sky-300 font-semibold">
                      <Sparkles className="w-3.5 h-3.5 shrink-0" />
                      <span>{t.progress.calculatorTitle}</span>
                    </div>
                    <p>
                      {t.progress.onePerDayShort}:{' '}
                      <span className="font-bold text-white">
                        {totalQazaCount} {t.progress.daysShort}
                      </span>{' '}
                      • {t.progress.fivePerDayShort}:{' '}
                      <span className="font-bold text-white">
                        {Math.ceil(totalQazaCount / 5)} {t.progress.daysShort}
                      </span>
                    </p>
                  </div>
                )}
              </div>

              {/* Compact 5-Prayer Qaza Grid (2-col on mobile, 5-col on sm+) */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 border-t border-white/10">
                {PRAYER_IDS.map((p) => {
                  const count = effectiveMissedByPrayer[p] || 0;
                  const isClear = count === 0;
                  return (
                    <div
                      key={p}
                      className={`rounded-xl px-2.5 py-2 flex sm:flex-col items-center justify-between sm:justify-center gap-1 text-center border ${
                        isClear
                          ? 'bg-emerald-500/10 border-emerald-400/25 text-emerald-200'
                          : 'bg-rose-500/15 border-rose-400/30 text-rose-100'
                      }`}
                    >
                      <span className="text-[11px] font-semibold capitalize truncate">
                        {t.prayers[p]}
                      </span>
                      <span
                        className={`text-sm sm:text-base font-black tabular-nums ${
                          isClear ? 'text-emerald-300' : 'text-rose-300'
                        }`}
                      >
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* SECTION B: FINANCIAL ACCOUNTABILITY */}
          <section className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800" aria-labelledby="financial-section-title">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
              <div className="flex items-start gap-2.5 min-w-0">
                <span className="p-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5">
                  <Coins className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <h2 id="financial-section-title" className="text-base font-bold text-slate-900 dark:text-slate-100 leading-snug">
                    {t.accountability.financialTitle}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-snug mt-0.5">
                    {t.accountability.sadaqahNotice}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsPayModalOpen(true)}
                disabled={fineItems.length === 0 || accountabilityTotal === 0}
                className="min-h-[40px] px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed shrink-0 self-start sm:self-auto"
              >
                <HeartHandshake className="w-4 h-4" />
                <span>{t.accountability.donateSadaqah}</span>
              </button>
            </div>

            {/* Unified Compact Financial Summary Card */}
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs overflow-hidden">
              <div className="p-4 sm:p-5 bg-gradient-to-br from-slate-900 to-slate-800 text-white flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
                    {t.accountability.totalFinancialDebt}
                  </span>
                  {isStatsLoading ? (
                    <div className="h-7 w-28 bg-white/20 animate-pulse rounded mt-1" />
                  ) : (
                    <p className="text-2xl font-black text-white mt-0.5 tabular-nums">
                      {formatCurrency(accountabilityTotal, lang)}
                    </p>
                  )}
                </div>
                <div className="text-right text-[11px] text-slate-300">
                  <p>{fineItems.length} {t.accountability.prayersCount}</p>
                  {accountabilityOverdue > 0 && (
                    <p className="text-amber-400 font-semibold">
                      {t.progress.overduePrayersCount.replace('{count}', String(accountabilityOverdue))}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 xs:grid-cols-3 divide-y xs:divide-y-0 xs:divide-x divide-slate-100 dark:divide-slate-800 xs:text-center">
                <div className="p-2.5 sm:p-3 flex xs:block items-center justify-between gap-2 min-w-0">
                  <span className="text-[10px] text-slate-400 block truncate">
                    {t.accountability.baseFinesSubtotal}
                  </span>
                  <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums shrink-0">
                    {formatCurrency(totalBaseFines, lang)}
                  </span>
                </div>
                <div className="p-2.5 sm:p-3 flex xs:block items-center justify-between gap-2 min-w-0">
                  <span className="text-[10px] text-amber-500 block truncate">
                    {t.accountability.overduePenaltiesSubtotal}
                  </span>
                  <span className="text-xs sm:text-sm font-bold text-amber-600 dark:text-amber-400 tabular-nums shrink-0">
                    {formatCurrency(totalOverduePenalties, lang)}
                  </span>
                </div>
                <div className="p-2.5 sm:p-3 flex xs:block items-center justify-between gap-2 min-w-0">
                  <span className="text-[10px] text-emerald-500 block truncate">
                    {t.progress.settledAmount}
                  </span>
                  <span className="text-xs sm:text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums shrink-0">
                    {formatCurrency(stats?.accountability?.totalPaidAmount ?? (settledDonations || 0), lang)}
                  </span>
                </div>
              </div>
            </div>

            {/* Compact Disclaimer */}
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug px-1">
              {t.progress.finesPolicyNotice} {t.accountability.disclaimer}
            </p>

            {/* Compact Detailed Fine Breakdown */}
            <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 shadow-2xs p-3.5 sm:p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {t.progress.accountabilityBreakdown}
              </h3>

              {fineItems.length === 0 ? (
                <div className="p-6 text-center rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 text-emerald-800 dark:text-emerald-300 text-xs">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 mx-auto mb-1.5" />
                  <p className="font-semibold">{t.progress.noFines}</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {displayedFineItems.map((item, idx) => {
                    const isMadeUp = item.status === 'MADE_UP';
                    return (
                      <div
                        key={`${item.date}-${item.prayerId}-${idx}`}
                        className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                              {item.date}
                            </span>
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 capitalize">
                              {t.prayers[item.prayerId]}
                            </span>
                            {isMadeUp ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-sky-50 dark:bg-sky-950/80 text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800 inline-flex items-center gap-1">
                                <Check className="w-3 h-3" />
                                <span>{t.accountability.statusMadeUpSpiritualDone}</span>
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-rose-50 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                                {t.accountability.statusMissedNeedsMakeup}
                              </span>
                            )}
                            {!isMadeUp && item.isOverdue && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300">
                                {t.progress.overdueBadge.replace('{days}', String(item.daysPassed))}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {formatCurrency(item.baseAmount, lang)}
                            {item.overdueAmount > 0 && (
                              <span className="text-amber-600 dark:text-amber-400 font-semibold">
                                {' '}+ {formatCurrency(item.overdueAmount, lang)}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2.5 shrink-0">
                          <span
                            className={`text-sm font-black tabular-nums ${
                              isMadeUp ? 'text-sky-600 dark:text-sky-400' : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {formatCurrency(item.totalAmount, lang)}
                          </span>

                          {!isMadeUp && (
                            <button
                              type="button"
                              onClick={() => handleHistoricalCorrection(item.date, item.prayerId, 'MADE_UP')}
                              className="min-h-[44px] px-3 py-2 rounded-xl bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900 text-sky-800 dark:text-sky-300 border border-sky-200/80 dark:border-sky-800/60 text-xs font-semibold cursor-pointer transition-colors flex items-center gap-1.5"
                            >
                              <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                              <span>{t.accountability.markAsMadeUp}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {fineItems.length > 10 && (
                    <div className="pt-3 flex justify-center">
                      <button
                        type="button"
                        onClick={() => setShowAllFines((prev) => !prev)}
                        className="min-h-[38px] px-4 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        {showAllFines
                          ? t.progress.showLess
                          : t.progress.showAllCount.replace('{count}', String(fineItems.length))}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Payment History Section */}
            <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 shadow-2xs p-3.5 sm:p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {t.accountability.paymentHistory}
                </h3>
                {paymentHistory.length > 0 && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/60">
                    {paymentHistory.length}
                  </span>
                )}
              </div>

              {loadingPayments ? (
                <div className="py-6 flex justify-center text-slate-400">
                  <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
                </div>
              ) : paymentHistory.length === 0 ? (
                <div className="p-5 text-center rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-xs">
                  <p>{t.accountability.noPaymentsYet}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {paymentHistory.map((receipt) => {
                    const isExpanded = expandedReceiptIds.has(receipt.id);
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
                        className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() => toggleExpandReceipt(receipt.id)}
                          className="w-full p-3 flex items-center justify-between text-left cursor-pointer hover:bg-slate-100/60 dark:hover:bg-slate-800/50 transition-colors"
                          aria-expanded={isExpanded}
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 shrink-0">
                              <Coins className="w-3.5 h-3.5" />
                            </span>
                            <div>
                              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 block">
                                {formattedDate}
                              </span>
                              <span className="text-[11px] text-slate-400">
                                {receipt.items.length} {t.accountability.prayersCount}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2.5">
                            <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
                              {formatCurrency(receipt.totalAmount, lang)}
                            </span>
                            <ChevronDown
                              className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${
                                isExpanded ? 'rotate-180 text-emerald-600' : ''
                              }`}
                            />
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="p-3 border-t border-slate-200/70 dark:border-slate-800 space-y-2 bg-white/60 dark:bg-slate-900/40">
                            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pb-1 border-b border-slate-100 dark:border-slate-800">
                              <span>{t.accountability.receiptId}: #{receipt.id.slice(-6).toUpperCase()}</span>
                              <span>{t.dashboard.receiptDetails}</span>
                            </div>

                            <div className="space-y-1.5">
                              {receipt.items.map((it, idx) => (
                                <div
                                  key={`${receipt.id}-${it.date}-${it.prayerId}-${idx}`}
                                  className="flex items-center justify-between text-xs py-1.5 px-2.5 rounded-lg bg-slate-50/80 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800"
                                >
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-medium text-slate-600 dark:text-slate-400">
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
                                  </div>
                                  <span className="font-bold text-slate-800 dark:text-slate-200">
                                    {formatCurrency(it.amount, lang)}
                                  </span>
                                </div>
                              ))}
                            </div>

                            {receipt.note && (
                              <p className="text-[11px] italic text-slate-500 dark:text-slate-400 pt-1">
                                {receipt.note}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {isPayModalOpen && (
        <PayQazaModal
          isOpen={isPayModalOpen}
          onClose={() => setIsPayModalOpen(false)}
          onSuccess={handlePaymentModalSuccess}
          initialItems={fineItems}
        />
      )}
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
