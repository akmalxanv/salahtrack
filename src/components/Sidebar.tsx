'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Moon, LogOut, LogIn } from 'lucide-react';
import LanguageSelector from './LanguageSelector';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { NAV_ITEMS } from '@/config/navigation';

export default function Sidebar() {
  const pathname = usePathname();
  const { t } = useLanguage();
  const { user, logout } = useAuth();

  return (
    <aside className="hidden md:flex flex-col w-64 h-screen sticky top-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shrink-0">
      <div className="flex items-center gap-3 mb-8">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-bold shadow-md shadow-emerald-600/20">
          <Moon className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-bold text-slate-900 dark:text-slate-100 text-base leading-tight">
            {t.appTitle}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t.appSubtitle}</p>
        </div>
      </div>

      <nav className="space-y-1.5 flex-1" aria-label="Desktop Sidebar Navigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const label = t.nav[item.key] || item.key;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400 font-semibold'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* User Section & Language Selector */}
      <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
        {user ? (
          <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
            <Link href="/account" className="flex items-center gap-2.5 min-w-0 flex-1 group">
              <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 font-bold text-xs flex items-center justify-center shrink-0">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div className="truncate">
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate group-hover:text-emerald-600 transition-colors">
                  {user.name}
                </p>
                <p className="text-[10px] text-slate-400 truncate">@{user.username}</p>
              </div>
            </Link>
            <button
              onClick={() => logout()}
              title={t.auth.logout.button}
              className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors shrink-0"
              aria-label={t.auth.logout.button}
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="flex-1 py-2 px-3 text-center rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium transition-colors flex items-center justify-center gap-1.5 shadow-xs"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>{t.nav.login}</span>
            </Link>
            <Link
              href="/signup"
              className="py-2 px-3 text-center rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-medium transition-colors"
            >
              {t.nav.signup}
            </Link>
          </div>
        )}

        <div className="flex items-center justify-between">
          <LanguageSelector />
        </div>
      </div>
    </aside>
  );
}
