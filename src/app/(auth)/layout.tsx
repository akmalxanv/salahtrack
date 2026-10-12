'use client';

import React from 'react';
import Link from 'next/link';
import BrandLogo from '@/components/BrandLogo';
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
          aria-label="Namozlarim Home"
        >
          <BrandLogo size={40} priority />
          <div className="flex flex-col">
            <span className="font-bold text-lg leading-tight tracking-tight text-slate-900 dark:text-slate-100">
              Namozlarim
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
        <p>© {new Date().getFullYear()} Namozlarim.uz. Built for mindful worshippers and personal accountability.</p>
      </footer>
    </div>
  );
}
