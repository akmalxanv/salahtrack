'use client';

import React from 'react';
import { useLanguage } from '@/context/LanguageContext';

export interface ContactCreatorProps {
  className?: string;
}

export default function ContactCreator({ className = '' }: ContactCreatorProps) {
  const { t } = useLanguage();

  return (
    <div
      className={`text-center text-sm sm:text-base text-slate-600 dark:text-slate-400 ${className}`.trim()}
    >
      <p>
        {t.account.contactPrompt}{' '}
        <a
          href="https://akmalxanv.ru"
          target="_blank"
          rel="noopener noreferrer"
          className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 font-medium underline underline-offset-2 transition-colors"
        >
          {t.account.contactLink}
        </a>
        .
      </p>
    </div>
  );
}
