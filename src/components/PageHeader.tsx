import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface PageHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export default function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
}: PageHeaderProps) {
  return (
    <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-200/80 dark:border-slate-800/80">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
          <span className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 shrink-0">
            <Icon className="w-5 h-5" />
          </span>
          <span className="truncate">{title}</span>
        </h1>
        {subtitle && (
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            {subtitle}
          </p>
        )}
      </div>

      {actions && (
        <div className="flex items-center gap-2 flex-wrap self-start sm:self-auto shrink-0">
          {actions}
        </div>
      )}
    </header>
  );
}
