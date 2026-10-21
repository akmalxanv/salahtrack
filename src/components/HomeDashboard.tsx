'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  Flame,
  Clock,
  Calendar as CalendarIcon,
  ChevronDown,
  Timer,
  Check,
  MapPin,
  Bell,
  BellOff,
  AlertTriangle,
  Loader2,
  Moon,
  HeartHandshake,
  UserCheck,
  LogIn,
  UserPlus,
} from 'lucide-react';
import Link from 'next/link';
import { useLocalStorage, useIsMounted } from '@/hooks/useLocalStorage';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import LanguageSelector from '@/components/LanguageSelector';
import PayQazaModal from '@/components/qaza/PayQazaModal';
import { PrayerItem, PrayerStatus, PrayerId, StreakData, DEFAULT_STREAK } from '@/types/prayer';
import { calculateAccountabilityLedger } from '@/lib/accountability';
import { calculateStreakTransition, evaluateRolloverStreak } from '@/lib/streak';
import { validateCoordinates } from '@/lib/qibla';
import { formatLocalizedDate, formatLocalizedHijriDate, formatCurrency } from '@/lib/formatters';
import {
  getLiturgicalDate,
  resolvePrayerCycle,
  DEFAULT_FAJR_TIME,
  DEFAULT_ISHA_TIME,
} from '@/lib/prayer-cycle';
import {
  saveDailyPrayersSync,
  loadPrayersForLiturgicalDate,
  archiveLiturgicalDay,
  catchupMultiDayGap,
  mirrorDailyPrayersToHistory,
  getStoredHistoryRecords,
  dispatchStorageUpdate,
} from '@/lib/storage-sync';

export const DEFAULT_PRAYERS: PrayerItem[] = [
  { id: 'fajr', name: 'Fajr', time: '04:47', endTime: '06:19', status: 'PENDING' },
  { id: 'dhuhr', name: 'Dhuhr', time: '12:13', endTime: '16:20', status: 'PENDING' },
  { id: 'asr', name: 'Asr', time: '16:20', endTime: '18:05', status: 'PENDING' },
  { id: 'maghrib', name: 'Maghrib', time: '18:05', endTime: '19:32', status: 'PENDING' },
  { id: 'isha', name: 'Isha', time: '19:32', endTime: '23:59', status: 'PENDING' },
];

const STATUS_CONFIG: Record<
  PrayerStatus,
  {
    badgeClass: string;
    borderClass: string;
    bgClass: string;
    iconClass: string;
  }
> = {
  PENDING: {
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    borderClass: 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700',
    bgClass: 'bg-white dark:bg-slate-900',
    iconClass: 'text-slate-300 dark:text-slate-600',
  },
  PRAYED: {
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-800',
    borderClass: 'border-emerald-200 dark:border-emerald-800',
    bgClass: 'bg-emerald-50/40 dark:bg-emerald-950/20',
    iconClass: 'text-emerald-600 dark:text-emerald-400 fill-emerald-100 dark:fill-emerald-950',
  },
  PRAYED_ON_TIME: {
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-800',
    borderClass: 'border-emerald-200 dark:border-emerald-800',
    bgClass: 'bg-emerald-50/40 dark:bg-emerald-950/20',
    iconClass: 'text-emerald-600 dark:text-emerald-400 fill-emerald-100 dark:fill-emerald-950',
  },
  PRAYED_LATE: {
    // Legacy documents normalized to Prayed badge
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-800',
    borderClass: 'border-emerald-200 dark:border-emerald-800',
    bgClass: 'bg-emerald-50/40 dark:bg-emerald-950/20',
    iconClass: 'text-emerald-600 dark:text-emerald-400 fill-emerald-100 dark:fill-emerald-950',
  },
  MISSED: {
    badgeClass: 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/80 dark:text-rose-300 dark:border-rose-800',
    borderClass: 'border-rose-200 dark:border-rose-800',
    bgClass: 'bg-rose-50/30 dark:bg-rose-950/20',
    iconClass: 'text-rose-600 dark:text-rose-400 fill-rose-100 dark:fill-rose-950',
  },
  MADE_UP: {
    badgeClass: 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/80 dark:text-sky-300 dark:border-sky-800',
    borderClass: 'border-sky-200 dark:border-sky-800',
    bgClass: 'bg-sky-50/30 dark:bg-sky-950/20',
    iconClass: 'text-sky-600 dark:text-sky-400 fill-sky-100 dark:fill-sky-950',
  },
};

interface NextPrayerInfo {
  prayerId: PrayerId;
  prayerName: string;
  prayerTime: string;
  hours: number;
  mins: number;
  secs: number;
  isTomorrow: boolean;
  totalSecondsRemaining: number;
}

function parseTimeToDate(timeStr: string, baseDate: Date, addDays = 0): Date {
  const [h, m] = timeStr.split(':').map(Number);
  const d = new Date(baseDate);
  d.setDate(d.getDate() + addDays);
  d.setHours(h, m, 0, 0);
  return d;
}

function calculateNextPrayerCountdown(prayers: PrayerItem[], now: Date): NextPrayerInfo {
  if (!prayers || prayers.length === 0) {
    return {
      prayerId: 'fajr',
      prayerName: 'Fajr',
      prayerTime: '04:47',
      hours: 0,
      mins: 0,
      secs: 0,
      isTomorrow: false,
      totalSecondsRemaining: 0,
    };
  }

  // Check each prayer today
  for (const p of prayers) {
    const pDate = parseTimeToDate(p.time, now, 0);
    const diffMs = pDate.getTime() - now.getTime();
    if (diffMs > 0) {
      const totalSecs = Math.floor(diffMs / 1000);
      const hours = Math.floor(totalSecs / 3600);
      const mins = Math.floor((totalSecs % 3600) / 60);
      const secs = totalSecs % 60;
      return {
        prayerId: p.id,
        prayerName: p.name,
        prayerTime: p.time,
        hours,
        mins,
        secs,
        isTomorrow: false,
        totalSecondsRemaining: totalSecs,
      };
    }
  }

  // All 5 passed for today -> Next is tomorrow's Fajr
  const tomorrowFajrDate = parseTimeToDate(prayers[0].time, now, 1);
  const diffMs = tomorrowFajrDate.getTime() - now.getTime();
  const totalSecs = Math.max(0, Math.floor(diffMs / 1000));
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  return {
    prayerId: prayers[0].id,
    prayerName: prayers[0].name,
    prayerTime: prayers[0].time,
    hours,
    mins,
    secs,
    isTomorrow: true,
    totalSecondsRemaining: totalSecs,
  };
}

interface HomeDashboardProps {
  initialQazaCount: number | null;
  initialPrayers: PrayerItem[] | null;
  initialStreak?: StreakData | null;
}

export default function HomeDashboard({
  initialQazaCount,
  initialPrayers,
  initialStreak,
}: HomeDashboardProps) {
  const isMounted = useIsMounted();
  const { t, lang } = useLanguage();
  const { user } = useAuth();

  const [prayers, setPrayers] = useLocalStorage<PrayerItem[]>(
    'salahtrack_daily_prayers',
    initialPrayers || DEFAULT_PRAYERS
  );

  const [lastSavedDate, setLastSavedDate] = useLocalStorage<string>(
    'salahtrack_last_active_date',
    getLiturgicalDate(new Date())
  );

  const [, setQazaCount] = useLocalStorage<number>(
    'salahtrack_qaza_count',
    initialQazaCount ?? 0
  );

  const [streak, setStreak] = useLocalStorage<StreakData>(
    'salahtrack_streak',
    initialStreak || DEFAULT_STREAK
  );

  const [activeMenuPrayerId, setActiveMenuPrayerId] = useState<string | null>(null);
  const [isPayModalOpen, setIsPayModalOpen] = useState(false);
  const [serverAccountability, setServerAccountability] = useState<{
    totalAmount: number;
    pendingQazaCount: number;
  } | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);

  useEffect(() => {
    const handleStorageUpdate = () => {
      setHistoryVersion((v) => v + 1);
    };
    window.addEventListener('local-storage-update', handleStorageUpdate);
    return () => window.removeEventListener('local-storage-update', handleStorageUpdate);
  }, []);
  
  // Real-time ticking clock for live countdown and auto-advance
  const [now, setNow] = useState<Date>(() => new Date());

  // Location and Prayer API states
  const [locationName, setLocationName] = useState<string>('Tashkent');
  const [apiStatus, setApiStatus] = useState<'loading' | 'live' | 'fallback' | 'error'>('loading');

  // Saving states per prayer item
  const [savingStatus, setSavingStatus] = useState<Record<PrayerId, 'idle' | 'saving' | 'saved' | 'error'>>({
    fajr: 'idle',
    dhuhr: 'idle',
    asr: 'idle',
    maghrib: 'idle',
    isha: 'idle',
  });

  // Browser Notification state
  const [notificationPermission, setNotificationPermission] = useState<'default' | 'granted' | 'denied' | 'unsupported'>('default');

  // 1-second live ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Check Notification API support
  useEffect(() => {
    queueMicrotask(() => {
      if (typeof window !== 'undefined' && 'Notification' in window) {
        setNotificationPermission(Notification.permission as 'default' | 'granted' | 'denied');
      } else {
        setNotificationPermission('unsupported');
      }
    });
  }, []);

  const handleRequestNotification = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const permission = await Notification.requestPermission();
        setNotificationPermission(permission as 'default' | 'granted' | 'denied');
        if (permission === 'granted') {
          new Notification(t.appTitle, {
            body: t.dashboard.notificationsEnabled,
            icon: '/favicon.ico',
          });
        }
      } catch (err) {
        console.warn('Notification permission error:', err);
      }
    }
  };

  // Derive liturgical prayer cycle state dynamically
  const fajrTime = prayers.find((p) => p.id === 'fajr')?.time || DEFAULT_FAJR_TIME;
  const ishaTime = prayers.find((p) => p.id === 'isha')?.time || DEFAULT_ISHA_TIME;

  const prayerTimings = useMemo(() => {
    const map: Record<string, { time: string; endTime?: string }> = {};
    for (const p of prayers) {
      map[p.id] = { time: p.time, endTime: p.endTime };
    }
    return map;
  }, [prayers]);

  const cycle = useMemo(() => {
    return resolvePrayerCycle({
      now,
      fajrTimeStr: fajrTime,
      ishaTimeStr: ishaTime,
      timings: prayerTimings,
    });
  }, [now, fajrTime, ishaTime, prayerTimings]);

  const activeLiturgicalDate = cycle.liturgicalDate;
  const isPostMidnight = cycle.isPostMidnight;

  // Seed history on initial mount so /progress and /calendar reflect the current liturgical state
  useEffect(() => {
    if (!isMounted) return;
    mirrorDailyPrayersToHistory(activeLiturgicalDate, prayers);
  }, [isMounted, activeLiturgicalDate, prayers]);

  // Day rollover logic: triggers strictly when active liturgical date advances at Fajr adhan
  useEffect(() => {
    if (!isMounted) return;

    if (lastSavedDate && lastSavedDate !== activeLiturgicalDate) {
      // 1. Archive the completed liturgical day into salahtrack_history_records
      const { uncompletedCount } = archiveLiturgicalDay(lastSavedDate, prayers);

      // 2. If gap > 1 day, catch up intermediate missing dates
      const gapMissed = catchupMultiDayGap(lastSavedDate, activeLiturgicalDate);

      // 3. Increment Qaza count by total missed prayers
      const totalMissed = uncompletedCount + gapMissed;
      if (totalMissed > 0) {
        setQazaCount((prev) => prev + totalMissed);
      }

      // 4. Update consistency streak based on rollover evaluation
      setStreak((prevStreak) => evaluateRolloverStreak(prevStreak, activeLiturgicalDate));

      // 5. Load fresh prayers for activeLiturgicalDate (or default 5 PENDING)
      const freshPrayers = loadPrayersForLiturgicalDate(activeLiturgicalDate, DEFAULT_PRAYERS);

      // 6. Update state and save daily prayers sync
      setPrayers(freshPrayers);
      setLastSavedDate(activeLiturgicalDate);
      saveDailyPrayersSync(activeLiturgicalDate, freshPrayers);

      // 7. If user is authenticated, call POST /api/prayers/rollover in background
      if (user) {
        fetch('/api/prayers/rollover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromDate: lastSavedDate,
            toDate: activeLiturgicalDate,
          }),
        }).catch((err) => {
          console.warn('Background rollover sync error:', err);
        });
      }

      // 8. Trigger dispatchStorageUpdate so all tabs update
      dispatchStorageUpdate();
    }
  }, [
    isMounted,
    user,
    lastSavedDate,
    activeLiturgicalDate,
    prayers,
    setPrayers,
    setLastSavedDate,
    setQazaCount,
    setStreak,
  ]);

  // Initial cloud synchronization from MongoDB Atlas if authenticated
  useEffect(() => {
    if (!user || !isMounted) return;
    // Prevent race condition: wait until rollover completes if dates differ
    if (lastSavedDate !== activeLiturgicalDate) return;

    let isCancelled = false;

    async function syncCloudData() {
      try {
        const res = await fetch(`/api/prayers?date=${activeLiturgicalDate}`);
        if (!res.ok) return;
        const json = await res.json();
        if (isCancelled) return;

        if (json?.success && json?.data?.prayers && !json.data.isNewRecord) {
          setPrayers((prev) => {
            const updated = prev.map((item) => {
              const serverPrayer = json.data.prayers[item.id];
              if (serverPrayer && serverPrayer.status) {
                return { ...item, status: serverPrayer.status };
              }
              return item;
            });
            saveDailyPrayersSync(activeLiturgicalDate, updated);
            return updated;
          });
        }
      } catch (err) {
        console.warn('Could not sync initial prayers from cloud:', err);
      }

      try {
        const statsRes = await fetch(`/api/stats?today=${activeLiturgicalDate}`);
        if (!statsRes.ok) return;
        const statsJson = await statsRes.json();
        if (!isCancelled && statsJson?.success) {
          if (statsJson.data?.streaks) {
            setStreak(statsJson.data.streaks);
          }
          if (statsJson.data?.accountability) {
            setServerAccountability({
              totalAmount:
                statsJson.data.accountability.totalFinancialDebt ??
                statsJson.data.accountability.totalAmount ??
                0,
              pendingQazaCount:
                statsJson.data.accountability.pendingQazaCount ??
                statsJson.data.accountability.totalMissed ??
                0,
            });
          }
        }
      } catch (err) {
        console.warn('Could not sync initial streak stats:', err);
      }
    }

    syncCloudData();

    return () => {
      isCancelled = true;
    };
  }, [user, isMounted, lastSavedDate, activeLiturgicalDate, setPrayers, setStreak]);

  // Gregorian & Hijri date displays (reflecting the active liturgical date)
  const gregorianDate = useMemo(() => formatLocalizedDate(activeLiturgicalDate, lang), [activeLiturgicalDate, lang]);
  const hijriDate = useMemo(() => formatLocalizedHijriDate(activeLiturgicalDate, lang), [activeLiturgicalDate, lang]);

  // Sync authentic prayer times (location-aware & user calculation method)
  useEffect(() => {
    if (!isMounted) return;

    let isCancelled = false;

    async function syncPrayerTimes() {
      try {
        setApiStatus('loading');
        let lat: number | null = null;
        let lng: number | null = null;

        // Check if user previously stored a location in localStorage
        try {
          const cached = localStorage.getItem('salahtrack_location');
          if (cached) {
            const parsed = JSON.parse(cached);
            const validation = validateCoordinates(parsed?.lat, parsed?.lng);
            if (validation.valid && validation.lat !== undefined && validation.lng !== undefined) {
              lat = validation.lat;
              lng = validation.lng;
            }
          }
        } catch {
          // ignore
        }

        const queryParams = new URLSearchParams();
        if (lat !== null && lng !== null) {
          queryParams.set('latitude', lat.toString());
          queryParams.set('longitude', lng.toString());
        }
        const method = user?.preferences?.calculationMethod || 'MWL';
        queryParams.set('method', method);

        const url = `/api/prayer-times?${queryParams.toString()}`;
        const res = await fetch(url);
        if (!res.ok) {
          if (!isCancelled) setApiStatus('fallback');
          return;
        }

        const data = await res.json();
        if (isCancelled || !data?.timings) {
          if (!isCancelled) setApiStatus('fallback');
          return;
        }

        if (data.city) {
          setLocationName(data.city);
        }
        setApiStatus(data.source === 'live' ? 'live' : 'fallback');

        setPrayers((prev) => {
          let hasChanges = false;
          const updated = prev.map((item) => {
            const apiTime = data.timings[item.id];
            if (apiTime && (item.time !== apiTime.time || item.endTime !== apiTime.endTime)) {
              hasChanges = true;
              return { ...item, time: apiTime.time, endTime: apiTime.endTime };
            }
            return item;
          });
          return hasChanges ? updated : prev;
        });
      } catch (err) {
        console.warn('Could not sync live prayer times:', err);
        if (!isCancelled) setApiStatus('error');
      }
    }

    syncPrayerTimes();

    return () => {
      isCancelled = true;
    };
  }, [isMounted, setPrayers, user?.preferences?.calculationMethod]);

  // Live Next Prayer Countdown (calculated dynamically from current ticking time)
  const nextPrayer = useMemo(() => calculateNextPrayerCountdown(prayers, now), [prayers, now]);

  // Status Change Handler with visual save state and backend sync
  const handleSetStatus = useCallback(
    async (id: PrayerId, status: PrayerStatus) => {
      const normalizedStatus: PrayerStatus = status === 'PRAYED' ? 'PRAYED_ON_TIME' : status;
      const targetDate = activeLiturgicalDate;

      // Precise optimistic delta calculations:
      // Qaza count (pending spiritual make-up):
      // PENDING -> MISSED: +1 Qaza
      // MISSED -> MADE_UP: -1 Qaza
      // MADE_UP -> PRAYED_ON_TIME / PENDING: 0 Qaza change
      // MISSED -> PRAYED_ON_TIME / PENDING: -1 Qaza
      const getQazaValue = (st: PrayerStatus) => (st === 'MISSED' ? 1 : 0);
      const oldItem = prayers.find((p) => p.id === id);
      const oldStatus = oldItem ? (oldItem.status === 'PRAYED' ? 'PRAYED_ON_TIME' : oldItem.status) : 'PENDING';
      const qazaDiff = getQazaValue(normalizedStatus) - getQazaValue(oldStatus);

      // Financial debt:
      // PENDING -> MISSED: +15,000 UZS debt
      // MISSED -> MADE_UP: debt remains 15,000 UZS (capped at base, no overdue penalty) (fineDiff = 0)
      // MADE_UP -> PRAYED_ON_TIME / PENDING: -15,000 UZS debt
      // MISSED -> PRAYED_ON_TIME / PENDING: -15,000 UZS debt
      const getFineValue = (st: PrayerStatus) => (st === 'MISSED' || st === 'MADE_UP' ? 15000 : 0);
      const fineDiff = getFineValue(normalizedStatus) - getFineValue(oldStatus);

      // 1. Instant 0ms optimistic UI update
      const updatedPrayers = prayers.map((item) =>
        item.id === id ? { ...item, status: normalizedStatus, updatedAt: new Date().toISOString() } : item
      );
      setPrayers(updatedPrayers);
      setActiveMenuPrayerId(null);

      // 2. Synchronize to localStorage, cookie, and mirror to salahtrack_history_records[targetDate]
      // mirrorDailyPrayersToHistory inside saveDailyPrayersSync immediately updates record.finesAccrued
      saveDailyPrayersSync(targetDate, updatedPrayers);

      // 3. Optimistic streak transition calculation (strictly 5/5 completed prayers)
      const isDayCompleted = updatedPrayers.filter(
        (p) => p.status === 'PRAYED' || p.status === 'PRAYED_ON_TIME' || p.status === 'PRAYED_LATE'
      ).length === 5;
      setStreak((prevStreak) => calculateStreakTransition(prevStreak, targetDate, isDayCompleted));

      // 4. Optimistically adjust server accountability (if active)
      if (serverAccountability !== null && (fineDiff !== 0 || qazaDiff !== 0)) {
        setServerAccountability((prev) =>
          prev
            ? {
                totalAmount: Math.max(0, prev.totalAmount + fineDiff),
                pendingQazaCount: Math.max(0, prev.pendingQazaCount + qazaDiff),
              }
            : null
        );
      }
      if (qazaDiff !== 0) {
        setQazaCount((prev) => Math.max(0, prev + qazaDiff));
      }

      // 5. Set saving status feedback
      setSavingStatus((prev) => ({ ...prev, [id]: 'saving' }));

      // 6. Background sync to MongoDB Atlas if authenticated
      if (user) {
        try {
          const res = await fetch('/api/prayers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              date: targetDate,
              prayerId: id,
              status: normalizedStatus,
            }),
          });

          if (res.ok) {
            setSavingStatus((prev) => ({ ...prev, [id]: 'saved' }));
            setTimeout(() => {
              setSavingStatus((prev) => ({ ...prev, [id]: 'idle' }));
            }, 2000);

            // Background sync stats to reconcile streak & accountability with MongoDB Atlas
            try {
              const statsRes = await fetch(`/api/stats?today=${targetDate}`);
              if (statsRes.ok) {
                const statsJson = await statsRes.json();
                if (statsJson?.success) {
                  if (statsJson.data?.streaks) {
                    setStreak(statsJson.data.streaks);
                  }
                  if (statsJson.data?.accountability) {
                    setServerAccountability({
                      totalAmount:
                        statsJson.data.accountability.totalFinancialDebt ??
                        statsJson.data.accountability.totalAmount ??
                        0,
                      pendingQazaCount:
                        statsJson.data.accountability.pendingQazaCount ??
                        statsJson.data.accountability.totalMissed ??
                        0,
                    });
                  }
                }
              }
            } catch (statsErr) {
              console.warn('Background stats sync error:', statsErr);
            }
          } else {
            setSavingStatus((prev) => ({ ...prev, [id]: 'error' }));
            setTimeout(() => {
              setSavingStatus((prev) => ({ ...prev, [id]: 'idle' }));
            }, 3000);
          }
        } catch (err) {
          console.warn('Background prayer sync error:', err);
          setSavingStatus((prev) => ({ ...prev, [id]: 'error' }));
          setTimeout(() => {
            setSavingStatus((prev) => ({ ...prev, [id]: 'idle' }));
          }, 3000);
        }
      } else {
        // Guest mode local save
        setSavingStatus((prev) => ({ ...prev, [id]: 'saved' }));
        setTimeout(() => {
          setSavingStatus((prev) => ({ ...prev, [id]: 'idle' }));
        }, 1500);
      }
    },
    [user, activeLiturgicalDate, prayers, setPrayers, setStreak, serverAccountability, setQazaCount]
  );

  // Quick toggle (done / pending)
  const handleQuickToggle = (id: PrayerId) => {
    const current = prayers.find((p) => p.id === id);
    const isCompleted =
      current?.status === 'PRAYED' ||
      current?.status === 'PRAYED_ON_TIME' ||
      current?.status === 'PRAYED_LATE';
    const nextStatus: PrayerStatus = isCompleted ? 'PENDING' : 'PRAYED_ON_TIME';
    handleSetStatus(id, nextStatus);
  };

  // Local accountability ledger calculated from historical prayer records using single source of truth
  const localAccountability = useMemo(() => {
    if (!isMounted) return { totalAmount: 0, pendingQazaCount: 0 };
    // Track reactive store changes
    if (historyVersion < 0 || prayers.length < 0) return { totalAmount: 0, pendingQazaCount: 0 };

    const history = getStoredHistoryRecords();
    const ledger = calculateAccountabilityLedger(history, now.getTime());
    return {
      totalAmount: ledger.totalAmount,
      pendingQazaCount: ledger.pendingQazaCount ?? ledger.missedCount,
    };
  }, [isMounted, prayers, historyVersion, now]);

  const unpaidQazaCount =
    serverAccountability !== null
      ? serverAccountability.pendingQazaCount
      : localAccountability.pendingQazaCount;

  const totalSadaqahOwed =
    serverAccountability !== null
      ? serverAccountability.totalAmount
      : localAccountability.totalAmount;

  const handlePaymentSuccess = useCallback(async () => {
    if (user) {
      try {
        const statsRes = await fetch(`/api/stats?today=${activeLiturgicalDate}`);
        if (statsRes.ok) {
          const statsJson = await statsRes.json();
          if (statsJson?.success) {
            if (statsJson.data?.streaks) {
              setStreak(statsJson.data.streaks);
            }
            if (statsJson.data?.accountability) {
              setServerAccountability({
                totalAmount:
                  statsJson.data.accountability.totalFinancialDebt ??
                  statsJson.data.accountability.totalAmount ??
                  0,
                pendingQazaCount:
                  statsJson.data.accountability.pendingQazaCount ??
                  statsJson.data.accountability.totalMissed ??
                  0,
              });
            }
          }
        }
      } catch (err) {
        console.warn('Failed to refresh stats after payment:', err);
      }
    }
  }, [user, activeLiturgicalDate, setStreak]);

  // Daily Obligatory Prayer Performance metrics:
  // Strictly counts original-day performance: on-time or late.
  // Made-up prayers do NOT count as completing the original prayer on its original date.
  const completedCount = useMemo(() => {
    return prayers.filter(
      (p) => p.status === 'PRAYED' || p.status === 'PRAYED_ON_TIME' || p.status === 'PRAYED_LATE'
    ).length;
  }, [prayers]);

  const missedCount = useMemo(() => {
    return prayers.filter((p) => p.status === 'MISSED').length;
  }, [prayers]);

  const madeUpCount = useMemo(() => {
    return prayers.filter((p) => p.status === 'MADE_UP').length;
  }, [prayers]);

  const pendingCount = useMemo(() => {
    return prayers.filter((p) => p.status === 'PENDING').length;
  }, [prayers]);

  const completionPercentage = Math.round((completedCount / 5) * 100);

  // SVG Progress Ring calculations: larger, prominent, and vibrant (radius = 46, circumference = ~289.03)
  const ringRadius = 46;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference - (completedCount / 5) * ringCircumference;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Prominent Guest Mode Banner */}
      {!user && (
        <div className="relative overflow-hidden rounded-2xl border border-amber-300/80 dark:border-amber-700/60 bg-gradient-to-r from-amber-50 via-amber-50/80 to-amber-100/50 dark:from-amber-950/40 dark:via-amber-950/30 dark:to-amber-900/20 p-4 sm:p-5 shadow-xs">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3.5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 dark:bg-amber-500/20 border border-amber-500/30 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                <UserCheck className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider bg-amber-200/80 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700">
                    {t.guest.bannerBadge}
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-amber-900/90 dark:text-amber-200/90 leading-relaxed font-medium">
                  {t.guest.bannerDesc}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start md:self-auto shrink-0 pl-13 md:pl-0">
              <Link
                href="/login"
                className="py-2 px-3.5 rounded-xl bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white text-xs font-semibold shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>{t.guest.loginButton}</span>
              </Link>
              <Link
                href="/signup"
                className="py-2 px-3.5 rounded-xl border border-amber-300 dark:border-amber-700 bg-white/80 dark:bg-slate-900/80 hover:bg-white dark:hover:bg-slate-900 text-amber-900 dark:text-amber-200 text-xs font-semibold shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>{t.guest.signupButton}</span>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Top Header Bar: Unified, Attractive, and Visually Consistent */}
      <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800/90 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          {/* Left: Date & Location Info */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 shrink-0">
                  <CalendarIcon className="w-4 h-4" />
                </span>
                <span suppressHydrationWarning className="text-slate-900 dark:text-slate-100 font-bold text-base sm:text-lg">
                  {gregorianDate}
                </span>
              </div>

              {isPostMidnight && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/80 shadow-2xs">
                  <Moon className="w-3 h-3 text-indigo-600 dark:text-indigo-400 shrink-0" />
                  <span>{t.dashboard.overnightIshaBadge}</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2.5 text-xs flex-wrap">
              {hijriDate && (
                <span suppressHydrationWarning className="font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/40 px-2 py-0.5 rounded-md border border-emerald-200/60 dark:border-emerald-900/40">
                  {hijriDate}
                </span>
              )}
              <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">•</span>
              <div className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400 font-medium bg-slate-100/70 dark:bg-slate-800/70 px-2 py-0.5 rounded-md border border-slate-200/60 dark:border-slate-700/60">
                <MapPin className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>{locationName}</span>
              </div>
            </div>
          </div>

          {/* Right: Consistency Streak & Controls */}
          <div className="flex items-center gap-2.5 self-start sm:self-auto flex-wrap">
            {/* Consistency Streak */}
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-semibold text-xs border shadow-2xs transition-all ${
                streak.current > 0
                  ? 'bg-amber-50/80 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-900/60'
                  : 'bg-slate-100/80 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-slate-200/80 dark:border-slate-700/80'
              }`}
              title={`${streak.current} ${t.dashboard.streakDays}`}
            >
              <Flame
                className={`w-4 h-4 ${
                  streak.current > 0
                    ? 'fill-amber-500 stroke-amber-500 text-amber-500'
                    : 'text-slate-400 dark:text-slate-500'
                }`}
              />
              <span suppressHydrationWarning>
                {streak.current} {t.dashboard.streakDays}
              </span>
            </div>

            <div className="md:hidden">
              <LanguageSelector />
            </div>
          </div>
        </div>
      </div>

      {/* Calm, Subtle Trilingual Overnight Isha Period Banner */}
      {isPostMidnight && (
        <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-indigo-50/90 via-indigo-50/50 to-slate-50/50 dark:from-indigo-950/40 dark:via-indigo-950/20 dark:to-slate-900/40 border border-indigo-200/70 dark:border-indigo-800/60 flex items-center gap-3 text-xs text-indigo-900 dark:text-indigo-200 shadow-xs">
          <div className="p-2 rounded-xl bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 shrink-0">
            <Moon className="w-4 h-4" />
          </div>
          <div>
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              {t.dashboard.overnightIshaBadge}
            </p>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
              {t.dashboard.overnightIshaActive}
            </p>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2-Column Responsive Header: Next Prayer Card & Daily Completion Progress */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card A: Next Prayer Card */}
        <div className="rounded-2xl bg-gradient-to-br from-slate-900 via-slate-850 to-slate-800 text-white p-5 shadow-sm border border-slate-700/80 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
                  <Timer className="w-4 h-4" />
                </div>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                  {t.dashboard.nextPrayer}
                </span>
              </div>

              {/* Status pill: Live / Fallback / Error */}
              {apiStatus === 'loading' ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>{t.common.loading}</span>
                </span>
              ) : apiStatus === 'fallback' ? (
                <span
                  title={t.dashboard.apiError}
                  className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-950/80 text-amber-300 border border-amber-800"
                >
                  <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
                  <span>{t.dashboard.location}</span>
                </span>
              ) : apiStatus === 'error' ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-rose-950/80 text-rose-300 border border-rose-800">
                  <AlertTriangle className="w-2.5 h-2.5 text-rose-400" />
                  <span>{t.dashboard.apiError}</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>{locationName}</span>
                </span>
              )}
            </div>

            <div className="flex items-baseline justify-between mt-2">
              <div>
                <p className="text-2xl font-black tracking-tight text-white">
                  {t.prayers[nextPrayer.prayerId]}
                </p>
                <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{nextPrayer.prayerTime}</span>
                  {nextPrayer.isTomorrow && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-white/10 text-slate-300 font-medium">
                      {t.dashboard.tomorrowPrayer}
                    </span>
                  )}
                </div>
              </div>

              {/* Live Ticking Countdown */}
              <div className="text-right">
                <span className="text-[11px] font-medium text-slate-400 block mb-0.5">
                  {t.dashboard.in}
                </span>
                <p
                  suppressHydrationWarning
                  className="text-xl sm:text-2xl font-black text-emerald-400 font-mono tracking-tight"
                >
                  {String(nextPrayer.hours).padStart(2, '0')}:
                  {String(nextPrayer.mins).padStart(2, '0')}:
                  {String(nextPrayer.secs).padStart(2, '0')}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-700/60 flex items-center justify-end text-xs text-slate-400">
            {notificationPermission === 'granted' ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                <Bell className="w-3.5 h-3.5 text-emerald-400" />
                <span>{t.dashboard.notificationsEnabled}</span>
              </span>
            ) : notificationPermission === 'denied' ? (
              <span
                title={t.dashboard.notificationsBlocked}
                className="inline-flex items-center gap-1 text-[11px] text-slate-500 font-medium"
              >
                <BellOff className="w-3.5 h-3.5" />
                <span>{t.dashboard.notificationsBlocked}</span>
              </span>
            ) : notificationPermission === 'default' ? (
              <button
                type="button"
                onClick={handleRequestNotification}
                className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-semibold cursor-pointer underline"
              >
                <Bell className="w-3.5 h-3.5" />
                <span>{t.dashboard.enableNotifications}</span>
              </button>
            ) : null}
          </div>
        </div>

        {/* Card B: Daily Prayer Progress Card (with Visual Progress Ring) */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-xs border border-slate-200 dark:border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t.dashboard.dailyProgressTitle}
            </span>
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
              {completedCount === 5 ? t.calendar.legend.perfect : `${completionPercentage}%`}
            </span>
          </div>

          <div className="my-3 flex items-center gap-4 sm:gap-6">
            {/* Visual Prominent SVG Progress Ring */}
            <div className="relative w-28 h-28 sm:w-32 sm:h-32 shrink-0 flex items-center justify-center">
              <svg className="w-28 h-28 sm:w-32 sm:h-32 -rotate-90 transform" viewBox="0 0 108 108">
                <defs>
                  <linearGradient id="emeraldProgressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#34d399" />
                    <stop offset="100%" stopColor="#059669" />
                  </linearGradient>
                </defs>
                {/* Background Track Ring */}
                <circle
                  cx="54"
                  cy="54"
                  r={ringRadius}
                  stroke="currentColor"
                  strokeWidth="8.5"
                  className="text-slate-100 dark:text-slate-800/80"
                  fill="transparent"
                />
                {/* Foreground Active Ring */}
                <circle
                  cx="54"
                  cy="54"
                  r={ringRadius}
                  stroke={completedCount > 0 ? "url(#emeraldProgressGradient)" : "currentColor"}
                  strokeWidth="8.5"
                  strokeDasharray={ringCircumference}
                  strokeDashoffset={ringOffset}
                  strokeLinecap="round"
                  className={`transition-all duration-700 ease-out ${
                    completedCount > 0
                      ? 'drop-shadow-[0_2px_10px_rgba(16,185,129,0.45)]'
                      : 'text-transparent'
                  }`}
                  fill="transparent"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center text-center select-none pointer-events-none">
                <span className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-slate-100 leading-none tracking-tight">
                  {completedCount}
                  <span className="text-sm sm:text-base text-slate-400 dark:text-slate-500 font-bold ml-0.5">/5</span>
                </span>
              </div>
            </div>

            {/* Structured Visible Status Table */}
            <div className="flex-1 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 overflow-hidden divide-y divide-slate-200/80 dark:divide-slate-800/80 shadow-2xs">
              {/* Row 1: Prayed & Pending */}
              <div className="grid grid-cols-2 divide-x divide-slate-200/80 dark:divide-slate-800/80">
                {/* Prayed Cell */}
                <div className="p-2 sm:p-2.5 bg-emerald-50/40 dark:bg-emerald-950/20 flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 shadow-2xs" />
                    <span className="text-[11px] sm:text-xs font-semibold text-slate-700 dark:text-slate-300 truncate">
                      {t.statuses.PRAYED}
                    </span>
                  </div>
                  <span className="text-sm sm:text-base font-extrabold text-emerald-700 dark:text-emerald-400 shrink-0">
                    {completedCount}
                  </span>
                </div>

                {/* Pending Cell */}
                <div className="p-2 sm:p-2.5 flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0" />
                    <span className="text-[11px] sm:text-xs font-semibold text-slate-700 dark:text-slate-300 truncate">
                      {t.statuses.PENDING}
                    </span>
                  </div>
                  <span className="text-sm sm:text-base font-extrabold text-slate-800 dark:text-slate-200 shrink-0">
                    {pendingCount}
                  </span>
                </div>
              </div>

              {/* Row 2: Missed & Made Up */}
              <div className="grid grid-cols-2 divide-x divide-slate-200/80 dark:divide-slate-800/80">
                {/* Missed Cell */}
                <div className="p-2 sm:p-2.5 bg-rose-50/40 dark:bg-rose-950/20 flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0 shadow-2xs" />
                    <span className="text-[11px] sm:text-xs font-semibold text-slate-700 dark:text-slate-300 truncate">
                      {t.statuses.MISSED}
                    </span>
                  </div>
                  <span className="text-sm sm:text-base font-extrabold text-rose-700 dark:text-rose-400 shrink-0">
                    {missedCount}
                  </span>
                </div>

                {/* Made-Up Cell */}
                <div className="p-2 sm:p-2.5 bg-sky-50/40 dark:bg-sky-950/20 flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-sky-500 shrink-0 shadow-2xs" />
                    <span className="text-[11px] sm:text-xs font-semibold text-slate-700 dark:text-slate-300 truncate">
                      {t.statuses.MADE_UP}
                    </span>
                  </div>
                  <span className="text-sm sm:text-base font-extrabold text-sky-700 dark:text-sky-400 shrink-0">
                    {madeUpCount}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">
            * {t.dashboard.madeUpDistinctNote}
          </p>
        </div>
      </div>

      {/* Accountability & Qaza Ledger Card */}
      <div className="rounded-2xl bg-gradient-to-br from-emerald-700 to-emerald-800 text-white p-5 sm:p-6 shadow-sm border border-emerald-600/50">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-emerald-200">
            {t.accountability.title}
          </span>
          <button
            type="button"
            onClick={() => setIsPayModalOpen(true)}
            disabled={totalSadaqahOwed === 0}
            className="self-start sm:self-auto min-h-[44px] flex items-center gap-2 px-4 py-2 rounded-xl bg-white hover:bg-emerald-50 text-emerald-900 text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
            title={t.accountability.payQaza}
          >
            <HeartHandshake className="w-4 h-4 text-emerald-700" />
            <span>{t.accountability.payQaza}</span>
          </button>
        </div>

        <div className="mt-4 flex items-baseline justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-3xl font-black tracking-tight">
                {unpaidQazaCount}
              </span>
            </div>
            <p className="text-xs text-emerald-100 font-medium mt-0.5">
              {t.accountability.spiritualPendingCount}
            </p>
          </div>
          <div className="text-right">
            <span className="text-2xl font-black tracking-tight">
              {formatCurrency(totalSadaqahOwed, lang)}
            </span>
            <p className="text-xs text-emerald-100 font-medium mt-0.5">
              {t.accountability.totalFinancialDebt}
            </p>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* Today's Prayers List (Chronological with instant feedback & status menu)  */}
      {/* ========================================================================= */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                {t.dashboard.todayPrayers}
              </h2>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800/70">
                <MapPin className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                <span>{locationName}</span>
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t.dashboard.completedRatio}: {completedCount} / 5
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {prayers.map((prayer) => {
            const config = STATUS_CONFIG[prayer.status];
            const isMenuOpen = activeMenuPrayerId === prayer.id;
            const prayerLabel = t.prayers[prayer.id] || prayer.name;
            const statusLabel = prayer.status === 'PRAYED_LATE' ? t.statuses.PRAYED : t.statuses[prayer.status];
            const itemSaveStatus = savingStatus[prayer.id];

            return (
              <div
                key={prayer.id}
                className={`relative rounded-2xl border p-4 transition-all shadow-xs ${config.bgClass} ${config.borderClass}`}
              >
                <div className="flex items-center justify-between">
                  {/* Left: Quick toggle button & prayer name */}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleQuickToggle(prayer.id)}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center -ml-2 cursor-pointer focus:outline-hidden"
                      aria-label={`${t.dashboard.markPrayed}: ${prayerLabel}`}
                    >
                      <CheckCircle2 className={`w-6 h-6 transition-transform active:scale-90 ${config.iconClass}`} />
                    </button>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                          {prayerLabel}
                        </span>
                        {itemSaveStatus === 'saving' && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            <span>{t.dashboard.saving}</span>
                          </span>
                        )}
                        {itemSaveStatus === 'saved' && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600 font-medium">
                            <Check className="w-3 h-3" />
                            <span>{t.dashboard.saved}</span>
                          </span>
                        )}
                        {itemSaveStatus === 'error' && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-rose-500 font-medium">
                            <AlertTriangle className="w-3 h-3" />
                            <span>{t.dashboard.saveFailed}</span>
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5">
                        <Clock className="w-3 h-3" />
                        <span>{prayer.time} – {prayer.endTime}</span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Status badge & dropdown trigger */}
                  <div className="flex items-center gap-1 sm:gap-2">
                    <span
                      className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${config.badgeClass}`}
                    >
                      {statusLabel}
                    </span>

                    <button
                      type="button"
                      onClick={() => setActiveMenuPrayerId(isMenuOpen ? null : prayer.id)}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center -mr-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer transition-colors"
                      title={t.dashboard.changeStatus}
                      aria-label={t.dashboard.changeStatus}
                    >
                      <ChevronDown className={`w-4 h-4 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                </div>

                {/* 3 Canonical Status Action Buttons: Prayed, Made Up, Qaza (+ Reset if active) */}
                {isMenuOpen && (
                  <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      {/* 1. Prayed */}
                      <button
                        type="button"
                        onClick={() => handleSetStatus(prayer.id, 'PRAYED_ON_TIME')}
                        className={`min-h-[44px] px-1.5 sm:px-2 py-2 sm:py-2.5 rounded-xl text-[11px] sm:text-xs md:text-sm font-semibold leading-tight text-center transition-colors duration-150 flex items-center justify-center cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 focus-visible:outline-none ${
                          prayer.status === 'PRAYED_ON_TIME' || prayer.status === 'PRAYED' || prayer.status === 'PRAYED_LATE'
                            ? 'bg-emerald-600 text-white font-bold shadow-xs border border-emerald-600 dark:bg-emerald-500 dark:border-emerald-500'
                            : 'bg-emerald-50 hover:bg-emerald-100/90 text-emerald-800 border border-emerald-200/80 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/60 dark:text-emerald-300 dark:border-emerald-800/60'
                        }`}
                      >
                        {t.dashboard.markPrayed}
                      </button>

                      {/* 2. Made Up */}
                      <button
                        type="button"
                        onClick={() => handleSetStatus(prayer.id, 'MADE_UP')}
                        className={`min-h-[44px] px-1.5 sm:px-2 py-2 sm:py-2.5 rounded-xl text-[11px] sm:text-xs md:text-sm font-semibold leading-tight text-center transition-colors duration-150 flex items-center justify-center cursor-pointer focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 focus-visible:outline-none ${
                          prayer.status === 'MADE_UP'
                            ? 'bg-sky-600 text-white font-bold shadow-xs border border-sky-600 dark:bg-sky-500 dark:border-sky-500'
                            : 'bg-sky-50 hover:bg-sky-100/90 text-sky-800 border border-sky-200/80 dark:bg-sky-950/40 dark:hover:bg-sky-900/60 dark:text-sky-300 dark:border-sky-800/60'
                        }`}
                      >
                        {t.dashboard.markMadeUp}
                      </button>

                      {/* 3. Qaza */}
                      <button
                        type="button"
                        onClick={() => handleSetStatus(prayer.id, 'MISSED')}
                        className={`min-h-[44px] px-1.5 sm:px-2 py-2 sm:py-2.5 rounded-xl text-[11px] sm:text-xs md:text-sm font-semibold leading-tight text-center transition-colors duration-150 flex items-center justify-center cursor-pointer focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 focus-visible:outline-none ${
                          prayer.status === 'MISSED'
                            ? 'bg-rose-600 text-white font-bold shadow-xs border border-rose-600 dark:bg-rose-500 dark:border-rose-500'
                            : 'bg-rose-50 hover:bg-rose-100/90 text-rose-800 border border-rose-200/80 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 dark:text-rose-300 dark:border-rose-800/60'
                        }`}
                      >
                        {t.dashboard.markMissed}
                      </button>
                    </div>

                    {/* Reset / Clear to Pending */}
                    {prayer.status !== 'PENDING' && (
                      <div className="flex justify-end pt-1">
                        <button
                          type="button"
                          onClick={() => handleSetStatus(prayer.id, 'PENDING')}
                          className="min-h-[44px] px-3 py-1 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 underline cursor-pointer flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 focus-visible:outline-none rounded-lg font-medium"
                        >
                          {t.dashboard.resetToPending}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Pay Qaza Modal */}
      <PayQazaModal
        isOpen={isPayModalOpen}
        onClose={() => setIsPayModalOpen(false)}
        onSuccess={handlePaymentSuccess}
      />
    </div>
  );
}
