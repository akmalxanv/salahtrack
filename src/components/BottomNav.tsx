'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS } from '@/config/navigation';
import { useLanguage } from '@/context/LanguageContext';

export default function BottomNav() {
  const pathname = usePathname();
  const { t } = useLanguage();

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md px-1 sm:px-2 pt-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))] z-50">
      <nav className="grid grid-cols-5 items-center gap-0.5" aria-label={t.appTitle}>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const label = t.nav[item.key] || item.key;

          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={true}
              aria-label={label}
              className={`flex flex-col items-center justify-center min-h-[44px] min-w-0 w-full py-1 px-0.5 sm:px-2 rounded-xl transition-colors ${
                isActive
                  ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="text-[9px] xs:text-[10px] leading-[1.15] mt-0.5 tracking-tighter xs:tracking-tight text-center whitespace-nowrap">
                {label}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
