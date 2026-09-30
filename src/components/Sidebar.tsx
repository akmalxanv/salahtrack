'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Moon, Home, Calculator, Calendar, History, Settings } from 'lucide-react';
import LanguageSelector from './LanguageSelector';
import { useLanguage } from '@/context/LanguageContext';

export default function Sidebar() {
  const pathname = usePathname();
  const { t } = useLanguage();

  const navItems = [
    { label: t.nav.home, href: '/', icon: Home },
    { label: t.nav.calculator, href: '/calculator', icon: Calculator },
    { label: t.nav.calendar, href: '/calendar', icon: Calendar },
    { label: t.nav.history, href: '/history', icon: History },
    { label: t.nav.settings, href: '/settings', icon: Settings },
  ];

  return (
    <aside className="hidden md:flex flex-col w-64 h-screen sticky top-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shrink-0">
      <div className="flex items-center gap-3 mb-8">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white font-bold">
          <Moon className="h-6 w-6" />
        </div>
        <div>
          <h1 className="font-bold text-slate-900 dark:text-slate-100 text-base leading-tight">
            {t.appTitle}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t.appSubtitle}</p>
        </div>
      </div>

      <nav className="space-y-1.5 flex-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400 font-semibold'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
        <LanguageSelector />
      </div>
    </aside>
  );
}
