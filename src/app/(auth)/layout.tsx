'use client';

import React from 'react';
import Link from 'next/link';
import { Compass } from 'lucide-react';
import LanguageSelector from '@/components/LanguageSelector';
import { useLanguage } from '@/context/LanguageContext';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-between selection:bg-emerald-500 selection:text-white">
      {/* Auth Navigation Header */}
      <header className="w-full max-w-5xl mx-auto px-4 py-6 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2.5 group transition-transform active:scale-95"
          aria-label="SalahTrack Home"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-md shadow-emerald-500/20 group-hover:shadow-emerald-500/30 transition-shadow">
            <Compass className="w-5 h-5 text-white" />
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-lg leading-tight tracking-tight text-slate-900 dark:text-slate-100">
              SalahTrack
            </span>
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {t.appSubtitle}
            </span>
          </div>
        </Link>

        <div className="flex items-center gap-2">
          <LanguageSelector />
        </div>
      </header>

      {/* Main Centered Form Container */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 md:p-8">
        <div className="w-full max-w-md">
          {children}
        </div>
      </main>

      {/* Calm Footer */}
      <footer className="w-full max-w-5xl mx-auto px-4 py-6 text-center text-xs text-slate-400 dark:text-slate-600">
        <p>© {new Date().getFullYear()} SalahTrack. Built for mindful worshippers and personal accountability.</p>
      </footer>
    </div>
  );
}
