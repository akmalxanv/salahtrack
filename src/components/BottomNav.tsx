'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Calculator, Calendar, History, Settings } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

export default function BottomNav() {
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
    <div className="md:hidden fixed bottom-0 left-0 right-0 border-t border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-lg px-2 py-1.5 z-50">
      <nav className="flex justify-around items-center">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center py-1 px-3 rounded-xl transition-colors ${
                isActive
                  ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] mt-1">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
