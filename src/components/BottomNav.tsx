'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS } from '@/config/navigation';
import { useLanguage } from '@/context/LanguageContext';

export default function BottomNav() {
  const pathname = usePathname();
  const { t } = useLanguage();

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md px-2 py-1.5 z-50">
      <nav className="flex justify-around items-center" aria-label="Mobile Navigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const label = t.nav[item.key] || item.key;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={label}
              className={`flex flex-col items-center justify-center min-h-[44px] min-w-[48px] py-1 px-1 sm:px-3 rounded-xl transition-colors ${
                isActive
                  ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] mt-0.5 tracking-tight truncate max-w-[62px] text-center">{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
