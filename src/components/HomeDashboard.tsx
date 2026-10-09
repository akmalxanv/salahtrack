'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  Flame,
  Plus,
  Clock,
  Calendar as CalendarIcon,
  ChevronDown,
  Timer,
  Pencil,
  Check,
  X,
  MapPin,
  Bell,
  BellOff,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { useLocalStorage, getTodayString, useIsMounted } from '@/hooks/useLocalStorage';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import LanguageSelector from '@/components/LanguageSelector';
import { PrayerItem, PrayerStatus, PrayerId } from '@/types/prayer';

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
    badgeClass: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700',
    borderClass: 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700',
    bgClass: 'bg-white dark:bg-slate-900',
    iconClass: 'text-slate-300 dark:text-slate-600',
  },
  PRAYED: {
    badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
    borderClass: 'border-emerald-300 dark:border-emerald-800/80',
    bgClass: 'bg-emerald-50/40 dark:bg-emerald-950/20',
    iconClass: 'text-emerald-600 dark:text-emerald-400 fill-emerald-100 dark:fill-emerald-950',
  },
  PRAYED_ON_TIME: {
    badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
    borderClass: 'border-emerald-300 dark:border-emerald-800/80',
    bgClass: 'bg-emerald-50/40 dark:bg-emerald-950/20',
    iconClass: 'text-emerald-600 dark:text-emerald-400 fill-emerald-100 dark:fill-emerald-950',
  },
  PRAYED_LATE: {
    badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border-amber-300 dark:border-amber-800',
    borderClass: 'border-amber-300 dark:border-amber-800/80',
    bgClass: 'bg-amber-50/40 dark:bg-amber-950/20',
    iconClass: 'text-amber-600 dark:text-amber-400 fill-amber-100 dark:fill-amber-950',
  },
  MISSED: {
    badgeClass: 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 border-rose-300 dark:border-rose-800',
    borderClass: 'border-rose-300 dark:border-rose-800/80',
    bgClass: 'bg-rose-50/30 dark:bg-rose-950/20',
    iconClass: 'text-rose-600 dark:text-rose-400 fill-rose-100 dark:fill-rose-950',
  },
  MADE_UP: {
    badgeClass: 'bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300 border-sky-300 dark:border-sky-800',
    borderClass: 'border-sky-300 dark:border-sky-800/80',
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
}

export default function HomeDashboard({ initialQazaCount, initialPrayers }: HomeDashboardProps) {
  const isMounted = useIsMounted();
  const { t, lang } = useLanguage();
  const { user } = useAuth();

  const [prayers, setPrayers] = useLocalStorage<PrayerItem[]>(
    'salahtrack_daily_prayers',
    initialPrayers || DEFAULT_PRAYERS
  );

  const [lastSavedDate, setLastSavedDate] = useLocalStorage<string>(
    'salahtrack_last_active_date',
    getTodayString()
  );

  const [qazaCount, setQazaCount] = useLocalStorage<number>(
    'salahtrack_qaza_count',
    initialQazaCount ?? 0
  );

  const [activeMenuPrayerId, setActiveMenuPrayerId] = useState<string | null>(null);
  const [isEditingQaza, setIsEditingQaza] = useState(false);
  const [customQazaInput, setCustomQazaInput] = useState<string>('');
  
  // Real-time ticking clock for live countdown and auto-advance
  const [now, setNow] = useState<Date>(() => new Date());

  // Location and Prayer API states
  const [locationName, setLocationName] = useState<string>('Tashkent');
  const [apiStatus, setApiStatus] = useState<'loading' | 'live' | 'fallback' | 'error'>('loading');
  const [calcMethodName, setCalcMethodName] = useState<string>('MWL');

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
          new Notification('SalahTrack', {
            body: t.dashboard.notificationsEnabled,
            icon: '/favicon.ico',
          });
        }
      } catch (err) {
        console.warn('Notification permission error:', err);
      }
    }
  };

  // Initial cloud synchronization from MongoDB Atlas if authenticated
  useEffect(() => {
    if (!user) return;
    const todayStr = getTodayString();
    fetch(`/api/prayers?date=${todayStr}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.success && json?.data?.prayers && !json.data.isNewRecord) {
          setPrayers((prev) =>
            prev.map((item) => {
              const serverPrayer = json.data.prayers[item.id];
              if (serverPrayer && serverPrayer.status) {
                return { ...item, status: serverPrayer.status };
              }
              return item;
            })
          );
        }
      })
      .catch((err) => console.warn('Could not sync initial prayers:', err));
  }, [user, setPrayers]);

  // Day rollover logic
  useEffect(() => {
    if (!isMounted) return;
    const today = getTodayString();

    if (lastSavedDate !== today) {
      const uncompletedCount = prayers.filter(
        (p) => p.status === 'PENDING' || p.status === 'MISSED'
      ).length;

      if (uncompletedCount > 0) {
        setQazaCount((prev) => prev + uncompletedCount);
      }

      const resetPrayers = DEFAULT_PRAYERS.map((p) => ({
        ...p,
        status: 'PENDING' as PrayerStatus,
      }));

      setPrayers(resetPrayers);
      setLastSavedDate(today);
    }
  }, [isMounted, lastSavedDate, prayers, setPrayers, setLastSavedDate, setQazaCount]);

  // Gregorian date display
  const gregorianDate = useMemo(() => {
    if (lang === 'uz') {
      const uzMonths = [
        'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
        'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'
      ];
      const day = now.getDate();
      const month = uzMonths[now.getMonth()];
      const year = now.getFullYear();
      return `${day}-${month}, ${year}-yil`;
    }
    const localeMap: Record<string, string> = { ru: 'ru-RU', en: 'en-US' };
    return new Intl.DateTimeFormat(localeMap[lang] || 'en-US', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(now);
  }, [lang, now]);

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
            if (typeof parsed.lat === 'number' && typeof parsed.lng === 'number') {
              lat = parsed.lat;
              lng = parsed.lng;
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
        setCalcMethodName(method);

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

  // Hijri Islamic calendar date
  const hijriDate = useMemo(() => {
    try {
      const localeMap: Record<string, string> = {
        ru: 'ru-RU-u-ca-islamic-civil',
        en: 'en-US-u-ca-islamic-civil',
        uz: 'uz-UZ-u-ca-islamic-civil',
      };
      const formatted = new Intl.DateTimeFormat(localeMap[lang] || 'en-US-u-ca-islamic-civil', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(now);

      let cleaned = formatted.trim();
      if (lang === 'ru') {
        cleaned = cleaned.replace(/\s*г\.\s*AH\b/i, ' г. хиджры').replace(/\s*AH\b/i, ' г. хиджры');
      } else if (lang === 'uz') {
        cleaned = cleaned.replace(/\s*AH\b/i, ' hijriy');
      } else {
        cleaned = cleaned.replace(/\s*AH\b/i, ' Hijri');
      }
      return cleaned;
    } catch {
      if (lang === 'en') return '18 Rabi al-Thani 1448 Hijri';
      if (lang === 'uz') return '18-Rabiʼus soniy 1448 hijriy';
      return '18 Раби аль-ахир 1448 г. хиджры';
    }
  }, [lang, now]);

  // Live Next Prayer Countdown (calculated dynamically from current ticking time)
  const nextPrayer = useMemo(() => calculateNextPrayerCountdown(prayers, now), [prayers, now]);

  // Status Change Handler with visual save state and backend sync
  const handleSetStatus = useCallback(
    async (id: PrayerId, status: PrayerStatus) => {
      const normalizedStatus: PrayerStatus = status === 'PRAYED' ? 'PRAYED_ON_TIME' : status;

      // 1. Instant 0ms optimistic UI update
      setPrayers((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, status: normalizedStatus, updatedAt: new Date().toISOString() } : item
        )
      );
      setActiveMenuPrayerId(null);

      // 2. Set saving status feedback
      setSavingStatus((prev) => ({ ...prev, [id]: 'saving' }));

      // 3. Background sync to MongoDB Atlas if authenticated
      if (user) {
        try {
          const todayStr = getTodayString();
          const res = await fetch('/api/prayers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              date: todayStr,
              prayerId: id,
              status: normalizedStatus,
            }),
          });

          if (res.ok) {
            setSavingStatus((prev) => ({ ...prev, [id]: 'saved' }));
            setTimeout(() => {
              setSavingStatus((prev) => ({ ...prev, [id]: 'idle' }));
            }, 2000);
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
    [user, setPrayers]
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

  // Qaza count helpers
  const handleFulfillQaza = () => {
    if (qazaCount > 0) setQazaCount((prev) => prev - 1);
  };

  const handleAddMissed = () => {
    setQazaCount((prev) => prev + 1);
  };

  const handleStartEditing = () => {
    setCustomQazaInput(String(qazaCount));
    setIsEditingQaza(true);
  };

  const handleSaveCustomQaza = () => {
    const parsed = parseInt(customQazaInput, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      setQazaCount(parsed);
    }
    setIsEditingQaza(false);
  };

  const handleCancelEditing = () => {
    setIsEditingQaza(false);
  };

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

  // SVG Progress Ring calculations (radius = 34, perimeter = ~213.6)
  const ringRadius = 34;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference - (completedCount / 5) * ringCircumference;

  // Accountability fine calculation: 15,000 UZS base pledge per unfulfilled Qaza
  const totalFineUZS = qazaCount * 15000;

  return (
    <div className="space-y-6">
      {/* Top Header Bar: Date & Streak & Mobile Language Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-slate-200/80 dark:border-slate-800/80">
        <div>
          <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100 font-bold text-lg">
            <CalendarIcon className="w-5 h-5 text-emerald-600 shrink-0" />
            <span suppressHydrationWarning>{gregorianDate}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 ml-7 flex-wrap">
            {hijriDate && (
              <p suppressHydrationWarning className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                {hijriDate}
              </p>
            )}
            <span className="text-slate-300 dark:text-slate-700 text-xs hidden sm:inline">•</span>
            <div className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 font-medium">
              <MapPin className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{locationName}</span>
            </div>
            <span className="text-slate-300 dark:text-slate-700 text-xs hidden sm:inline">•</span>
            <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
              {calcMethodName}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 self-end sm:self-auto">
          {/* Consistency Streak */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 font-semibold text-xs border border-amber-200/60 dark:border-amber-900/60 shadow-xs">
            <Flame className="w-4 h-4 fill-amber-500 stroke-amber-500" />
            <span>7 {t.dashboard.streakDays}</span>
          </div>

          <div className="md:hidden">
            <LanguageSelector />
          </div>
        </div>
      </div>

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
                      Ertangi
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

          <div className="mt-4 pt-3 border-t border-slate-700/60 flex items-center justify-between text-xs text-slate-400">
            <span className="text-[11px]">{calcMethodName} usuli bo‘yicha</span>
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
              {completionPercentage}%
            </span>
          </div>

          <div className="my-3 flex items-center gap-4 sm:gap-6">
            {/* Visual SVG Progress Ring */}
            <div className="relative w-20 h-20 shrink-0 flex items-center justify-center">
              <svg className="w-20 h-20 -rotate-90 transform" viewBox="0 0 80 80">
                {/* Background Ring */}
                <circle
                  cx="40"
                  cy="40"
                  r={ringRadius}
                  stroke="currentColor"
                  strokeWidth="7"
                  className="text-slate-100 dark:text-slate-800"
                  fill="transparent"
                />
                {/* Foreground Active Ring */}
                <circle
                  cx="40"
                  cy="40"
                  r={ringRadius}
                  stroke="currentColor"
                  strokeWidth="7"
                  strokeDasharray={ringCircumference}
                  strokeDashoffset={ringOffset}
                  strokeLinecap="round"
                  className="text-emerald-600 dark:text-emerald-500 transition-all duration-700 ease-out"
                  fill="transparent"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-base font-black text-slate-900 dark:text-slate-100 leading-none">
                  {completedCount}
                  <span className="text-xs text-slate-400 font-semibold">/5</span>
                </span>
              </div>
            </div>

            {/* Concise Status Breakdown Pills */}
            <div className="flex-1 grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/50">
                <span className="text-[10px] font-semibold text-emerald-800 dark:text-emerald-300 block">
                  {t.statuses.PRAYED_ON_TIME}
                </span>
                <span className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                  {completedCount}
                </span>
              </div>
              <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 block">
                  {t.statuses.PENDING}
                </span>
                <span className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  {pendingCount}
                </span>
              </div>
              <div className="p-2 rounded-xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900/50">
                <span className="text-[10px] font-semibold text-rose-800 dark:text-rose-300 block">
                  {t.statuses.MISSED}
                </span>
                <span className="text-sm font-bold text-rose-900 dark:text-rose-200">
                  {missedCount}
                </span>
              </div>
              <div className="p-2 rounded-xl bg-sky-50/70 dark:bg-sky-950/30 border border-sky-100 dark:border-sky-900/50">
                <span className="text-[10px] font-semibold text-sky-800 dark:text-sky-300 block">
                  {t.statuses.MADE_UP}
                </span>
                <span className="text-sm font-bold text-sky-900 dark:text-sky-200">
                  {madeUpCount}
                </span>
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
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleAddMissed}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/20 hover:bg-white/30 text-white text-xs font-semibold backdrop-blur-xs transition-transform active:scale-95 cursor-pointer shadow-xs"
              title={t.accountability.addMissed}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t.accountability.addMissed}</span>
            </button>
            <button
              type="button"
              onClick={handleFulfillQaza}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/20 hover:bg-white/30 text-white text-xs font-semibold backdrop-blur-xs transition-transform active:scale-95 cursor-pointer shadow-xs"
              title={t.accountability.fulfillOne}
            >
              <Check className="w-3.5 h-3.5" />
              <span>{t.accountability.fulfillOne}</span>
            </button>
          </div>
        </div>

        <div className="mt-4 flex items-baseline justify-between">
          <div>
            {isEditingQaza ? (
              <div className="flex items-center gap-2 my-1">
                <input
                  type="number"
                  min="0"
                  autoFocus
                  value={customQazaInput}
                  onChange={(e) => setCustomQazaInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveCustomQaza();
                    if (e.key === 'Escape') handleCancelEditing();
                  }}
                  className="w-24 px-2.5 py-0.5 rounded-lg bg-emerald-950/70 text-white font-black text-2xl border border-white/50 focus:outline-hidden focus:ring-2 focus:ring-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  type="button"
                  onClick={handleSaveCustomQaza}
                  title={t.accountability.save}
                  className="p-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white cursor-pointer transition-colors shadow-xs"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleCancelEditing}
                  title={t.accountability.cancel}
                  className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-emerald-100 cursor-pointer transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {isMounted || initialQazaCount !== null ? (
                  <span className="text-3xl font-black tracking-tight">
                    {qazaCount}
                  </span>
                ) : (
                  <span className="inline-block w-12 h-9 bg-white/20 animate-pulse rounded-md" />
                )}
                <button
                  type="button"
                  onClick={handleStartEditing}
                  title={t.accountability.editCount}
                  className="p-1 rounded-md text-emerald-200 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <p className="text-xs text-emerald-100 font-medium mt-0.5">
              {t.accountability.qazaBalance}
            </p>
          </div>
          <div className="text-right">
            {isMounted || initialQazaCount !== null ? (
              <span className="text-2xl font-black tracking-tight">
                {totalFineUZS.toLocaleString()} <span className="text-xs font-normal">{t.common.currency}</span>
              </span>
            ) : (
              <span className="inline-block w-28 h-8 bg-white/20 animate-pulse rounded-md" />
            )}
            <p className="text-xs text-emerald-100 font-medium mt-0.5">
              {t.accountability.pledgeAmount}
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
            const statusLabel = t.statuses[prayer.status];
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
                      className="cursor-pointer focus:outline-hidden"
                      aria-label={`Mark ${prayerLabel}`}
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
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${config.badgeClass}`}
                    >
                      {statusLabel}
                    </span>

                    <button
                      type="button"
                      onClick={() => setActiveMenuPrayerId(isMenuOpen ? null : prayer.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer"
                      title={t.dashboard.changeStatus}
                    >
                      <ChevronDown className={`w-4 h-4 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                </div>

                {/* 5 Status Action Buttons: On-Time, Late, Missed, Made-Up, Pending */}
                {isMenuOpen && (
                  <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-xs">
                    <button
                      type="button"
                      onClick={() => handleSetStatus(prayer.id, 'PRAYED_ON_TIME')}
                      className={`p-2 rounded-xl font-medium cursor-pointer text-center transition-colors ${
                        prayer.status === 'PRAYED_ON_TIME' || prayer.status === 'PRAYED'
                          ? 'bg-emerald-600 text-white font-bold'
                          : 'bg-slate-100 dark:bg-slate-800 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {t.dashboard.markPrayedOnTime}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSetStatus(prayer.id, 'PRAYED_LATE')}
                      className={`p-2 rounded-xl font-medium cursor-pointer text-center transition-colors ${
                        prayer.status === 'PRAYED_LATE'
                          ? 'bg-amber-600 text-white font-bold'
                          : 'bg-slate-100 dark:bg-slate-800 hover:bg-amber-100 dark:hover:bg-amber-950/60 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {t.dashboard.markPrayedLate}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSetStatus(prayer.id, 'MISSED')}
                      className={`p-2 rounded-xl font-medium cursor-pointer text-center transition-colors ${
                        prayer.status === 'MISSED'
                          ? 'bg-rose-600 text-white font-bold'
                          : 'bg-slate-100 dark:bg-slate-800 hover:bg-rose-100 dark:hover:bg-rose-950/60 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {t.dashboard.markMissed}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSetStatus(prayer.id, 'MADE_UP')}
                      className={`p-2 rounded-xl font-medium cursor-pointer text-center transition-colors ${
                        prayer.status === 'MADE_UP'
                          ? 'bg-sky-600 text-white font-bold'
                          : 'bg-slate-100 dark:bg-slate-800 hover:bg-sky-100 dark:hover:bg-sky-950/60 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {t.dashboard.markMadeUp}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSetStatus(prayer.id, 'PENDING')}
                      className={`p-2 rounded-xl font-medium cursor-pointer text-center transition-colors ${
                        prayer.status === 'PENDING'
                          ? 'bg-slate-700 text-white font-bold dark:bg-slate-600'
                          : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
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
    </div>
  );
}
