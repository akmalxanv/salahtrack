'use client';

import React from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import type { TurnGuidance } from '@/types/qibla';

export interface TurnGuidanceCardProps {
  guidance: TurnGuidance;
  className?: string;
}

export function TurnGuidanceCard({ guidance, className = '' }: TurnGuidanceCardProps) {
  const { t } = useLanguage();
  const { isAligned, state, remainingTurnDeg } = guidance;

  // Format dynamic localization strings containing %s template placeholders
  const instructionText = React.useMemo(() => {
    if (isAligned) {
      return t.qibla.aligned;
    }
    const rounded = Math.round(remainingTurnDeg);
    if (state === 'TURN_LEFT') {
      return t.qibla.turnLeft.replace('%s', String(rounded));
    }
    return t.qibla.turnRight.replace('%s', String(rounded));
  }, [isAligned, state, remainingTurnDeg, t.qibla]);

  return (
    <div
      className={`p-4 sm:p-5 rounded-2xl transition-all duration-300 border flex items-center justify-between gap-4 ${
        isAligned
          ? 'bg-emerald-50/90 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 shadow-sm ring-2 ring-emerald-500/20'
          : 'bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 shadow-2xs'
      } ${className}`}
    >
      <div className="flex items-center gap-3.5">
        {/* Dynamic Directional Icon Beacon */}
        <div
          className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-transform ${
            isAligned
              ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30 scale-105'
              : 'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400'
          }`}
        >
          {isAligned ? (
            <CheckCircle2 className="w-6 h-6 animate-pulse" />
          ) : state === 'TURN_LEFT' ? (
            <ArrowLeft className="w-6 h-6 animate-pulse" />
          ) : (
            <ArrowRight className="w-6 h-6 animate-pulse" />
          )}
        </div>

        {/* Guidance Instruction & Remaining Angle */}
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <h3
              className={`text-sm sm:text-base font-bold ${
                isAligned
                  ? 'text-emerald-900 dark:text-emerald-100'
                  : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {instructionText}
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {isAligned
              ? t.qibla.headingToKaaba
              : `${Math.round(remainingTurnDeg)}° ${t.qibla.degreesUnit}`}
          </p>
        </div>
      </div>

      {/* Degree Badge Pill */}
      <div
        className={`px-3 py-1.5 rounded-full text-xs font-mono font-bold shrink-0 border ${
          isAligned
            ? 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700'
            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
        }`}
      >
        {isAligned ? '0°' : `${Math.round(remainingTurnDeg)}°`}
      </div>
    </div>
  );
}
