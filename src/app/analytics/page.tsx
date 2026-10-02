'use client';

import { useLanguage } from '@/context/LanguageContext';

export default function AnalyticsPage() {
  const { t } = useLanguage();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          {t.analytics.title}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t.analytics.subtitle}
        </p>
      </header>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {t.analytics.desc}
        </p>
      </div>
    </div>
  );
}
