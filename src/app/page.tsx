'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Flame, Plus, Clock, RefreshCw, Calendar as CalendarIcon } from 'lucide-react';
import { useLocalStorage, getTodayString } from '@/hooks/useLocalStorage';
import LanguageSelector from '@/components/LanguageSelector';

interface Prayer {
  id: string;
  name: string;
  time: string;
  completed: boolean;
}

const DEFAULT_PRAYERS: Prayer[] = [
  { id: 'fajr', name: 'Фаджр', time: '05:20', completed: false },
  { id: 'dhuhr', name: 'Зухр', time: '12:30', completed: false },
  { id: 'asr', name: 'Аср', time: '16:15', completed: false },
  { id: 'maghrib', name: 'Магриб', time: '18:45', completed: false },
  { id: 'isha', name: 'Иша', time: '20:15', completed: false },
];

export default function HomePage() {
  const [prayers, setPrayers, isMounted] = useLocalStorage<Prayer[]>(
    'qaza_daily_prayers',
    DEFAULT_PRAYERS
  );

  const [lastSavedDate, setLastSavedDate] = useLocalStorage<string>(
    'qaza_last_active_date',
    getTodayString()
  );

  const [qazaCount, setQazaCount] = useLocalStorage<number>('qaza_total_count', 342);

  const [gregorianDate, setGregorianDate] = useState<string>('');
  const [hijriDate, setHijriDate] = useState<string>('');

  useEffect(() => {
    const today = new Date();

    // Григорианская дата
    const gregFormatted = new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(today);

    // Хиджра (Исламский календарь)
    try {
      const hijriFormatted = new Intl.DateTimeFormat('ru-RU-u-ca-islamic-civil', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(today);
      setHijriDate(hijriFormatted);
    } catch {
      setHijriDate('19 Раби аль-авваль 1448 г.');
    }

    setGregorianDate(gregFormatted);
  }, []);

  useEffect(() => {
    if (!isMounted) return;

    const today = getTodayString();

    if (lastSavedDate !== today) {
      const missedPrayers = prayers.filter((p) => !p.completed).length;

      if (missedPrayers > 0) {
        setQazaCount((prev) => prev + missedPrayers);
      }

      const resetPrayers = DEFAULT_PRAYERS.map((p) => ({ ...p, completed: false }));
      setPrayers(resetPrayers);
      setLastSavedDate(today);
    }
  }, [isMounted, lastSavedDate, prayers, setPrayers, setLastSavedDate, setQazaCount]);

  const togglePrayer = (id: string) => {
    setPrayers((prevPrayers) =>
      prevPrayers.map((prayer) =>
        prayer.id === id ? { ...prayer, completed: !prayer.completed } : prayer
      )
    );
  };

  const handleFulfillQaza = () => {
    if (qazaCount > 0) {
      setQazaCount((prev) => prev - 1);
    }
  };

  const simulateNewDay = () => {
    setLastSavedDate('2020-01-01');
  };

  const completedCount = isMounted ? prayers.filter((p) => p.completed).length : 0;

  return (
    <div className="space-y-6">
      {/* Шапка: Даты + Переключатель языка на Мобильных */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100 font-bold text-lg">
            <CalendarIcon className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{gregorianDate || 'Загрузка даты...'}</span>
          </div>
          {hijriDate && (
            <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5 ml-7">
              {hijriDate}
            </p>
          )}
        </div>

        {/* Переключатель языка на мобильных (сверху) */}
        <div className="md:hidden">
          <LanguageSelector />
        </div>

        {/* Стрики для ПК */}
        <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 font-semibold text-xs border border-amber-200/50 dark:border-amber-900/50">
          <Flame className="w-4 h-4 fill-amber-500 stroke-amber-500" />
          <span>7 дней подряд</span>
        </div>
      </div>

      {/* Карточка остатка Каза */}
      <div className="rounded-2xl bg-emerald-600 text-white p-6 shadow-sm">
        <span className="text-xs font-medium uppercase tracking-wider text-emerald-100">Остаток Каза</span>
        <div className="mt-2 flex items-baseline justify-between">
          <div>
            <span className="text-4xl font-extrabold tracking-tight">
              {isMounted ? qazaCount : 342}
            </span>
            <span className="ml-2 text-sm text-emerald-100">намазов всего</span>
          </div>
          <button
            onClick={handleFulfillQaza}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/20 hover:bg-white/30 text-white text-xs font-semibold backdrop-blur-xs transition-transform active:scale-95 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Восполнить 1</span>
          </button>
        </div>
      </div>

      {/* Список обязательных намазов */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Намазы на сегодня
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Завершено: {completedCount} из 5
            </p>
          </div>
          <button
            onClick={simulateNewDay}
            title="Тест: Симулировать наступление нового дня"
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-emerald-600 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Тест: Новый день</span>
          </button>
        </div>

        <div className="space-y-2.5">
          {(!isMounted ? DEFAULT_PRAYERS : prayers).map((prayer) => (
            <button
              key={prayer.id}
              onClick={() => togglePrayer(prayer.id)}
              className={`w-full text-left flex items-center justify-between p-4 rounded-xl border transition-all cursor-pointer active:scale-[0.99] ${
                prayer.completed
                  ? 'bg-emerald-50/60 border-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-800'
                  : 'bg-white border-slate-200 hover:border-slate-300 dark:bg-slate-900 dark:border-slate-800'
              }`}
            >
              <div className="flex items-center gap-3">
                <CheckCircle2
                  className={`w-5 h-5 transition-colors ${
                    prayer.completed
                      ? 'text-emerald-600 dark:text-emerald-400 fill-emerald-100 dark:fill-emerald-950'
                      : 'text-slate-300 dark:text-slate-700'
                  }`}
                />
                <span
                  className={`font-semibold text-sm transition-colors ${
                    prayer.completed
                      ? 'text-emerald-900 dark:text-emerald-200 line-through opacity-80'
                      : 'text-slate-800 dark:text-slate-200'
                  }`}
                >
                  {prayer.name}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <Clock className="w-3.5 h-3.5" />
                <span>{prayer.time}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
