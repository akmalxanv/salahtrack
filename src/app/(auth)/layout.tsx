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
      <header className="w-full max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex flex-wrap items-center justify-between gap-2.5">
        <Link
          href="/"
          className="flex items-center gap-2 sm:gap-2.5 min-w-0 group transition-transform active:scale-95"
          aria-label={t.appTitle}
        >
          <BrandLogo size={36} priority />
          <span className="font-bold text-base sm:text-lg leading-tight tracking-tight text-slate-900 dark:text-slate-100 truncate">
            {t.appTitle}
          </span>
        </Link>

        <div className="flex items-center gap-2 shrink-0 max-w-full">
          <LanguageSelector />
        </div>
      </header>

      {/* Main Centered Form Container */}
      <main className="flex-1 flex items-center justify-center px-3 sm:px-6 py-5 sm:py-8">
        <div className="w-full max-w-md min-w-0">
          {children}
        </div>
      </main>

      {/* Calm Footer */}
      <footer className="w-full max-w-5xl mx-auto px-5 py-6 text-center text-xs text-slate-400 dark:text-slate-600">
        <p>© {new Date().getFullYear()} Namozlarim.uz. {t.auth.footerTagline}</p>
      </footer>
    </div>
  );
}
