'use client';

import { useLanguage } from '@/context/LanguageContext';

export default function LanguageSelector() {
  const { lang, setLang } = useLanguage();

  return (
    <div className="inline-flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
      <button
        onClick={() => setLang('ru')}
        className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
          lang === 'ru'
            ? 'bg-emerald-600 text-white shadow-xs'
            : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
        }`}
      >
        РУС
      </button>
      <button
        onClick={() => setLang('en')}
        className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
          lang === 'en'
            ? 'bg-emerald-600 text-white shadow-xs'
            : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
        }`}
      >
        ENG
      </button>
      <button
        onClick={() => setLang('uz')}
        className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
          lang === 'uz'
            ? 'bg-emerald-600 text-white shadow-xs'
            : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
        }`}
      >
        UZB
      </button>
    </div>
  );
}
