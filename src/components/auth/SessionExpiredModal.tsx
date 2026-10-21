'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert, LogIn, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';

export default function SessionExpiredModal() {
  const { sessionExpired, dismissSessionExpired } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();

  if (!sessionExpired) return null;

  const handleSignInAgain = () => {
    dismissSessionExpired();
    router.push('/login?expired=true');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-expired-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-6 sm:p-7 space-y-5">
        <button
          type="button"
          onClick={dismissSessionExpired}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          aria-label={t.sessionExpired.dismiss}
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200/80 dark:border-amber-800/80 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h2
              id="session-expired-title"
              className="text-lg font-bold text-slate-900 dark:text-slate-100"
            >
              {t.sessionExpired.title}
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {t.sessionExpired.desc}
            </p>
          </div>
        </div>

        <div className="pt-2 flex flex-col sm:flex-row items-center gap-2.5">
          <button
            type="button"
            onClick={handleSignInAgain}
            className="w-full sm:flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs sm:text-sm font-semibold rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogIn className="w-4 h-4" />
            <span>{t.sessionExpired.signInAgain}</span>
          </button>
          <button
            type="button"
            onClick={dismissSessionExpired}
            className="w-full sm:w-auto py-2.5 px-4 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs sm:text-sm font-semibold rounded-xl transition-colors cursor-pointer"
          >
            <span>{t.sessionExpired.dismiss}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
