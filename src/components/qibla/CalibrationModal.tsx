'use client';

import React, { useEffect } from 'react';
import { X, Compass, RotateCw } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

export interface CalibrationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CalibrationModal({ isOpen, onClose }: CalibrationModalProps) {
  const { t } = useLanguage();

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="calibration-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-6 sm:p-7 flex flex-col items-center text-center">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          aria-label={t.qibla.calibrateClose}
        >
          <X className="w-5 h-5" />
        </button>

        {/* Icon Header */}
        <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-4">
          <Compass className="w-6 h-6 animate-spin-slow" />
        </div>

        {/* Title & Description */}
        <h2
          id="calibration-modal-title"
          className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 mb-2"
        >
          {t.qibla.calibrateTitle}
        </h2>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mb-6 leading-relaxed max-w-xs">
          {t.qibla.calibrateDesc}
        </p>

        {/* Animated Figure-8 Lemniscate SVG Canvas */}
        <div className="relative w-56 h-32 mb-6 flex items-center justify-center bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-2">
          <svg
            className="w-full h-full overflow-visible"
            viewBox="0 0 200 100"
            fill="none"
          >
            {/* Guide Lemniscate Track */}
            <path
              d="M 100,50 C 130,10 180,10 180,50 C 180,90 130,90 100,50 C 70,10 20,10 20,50 C 20,90 70,90 100,50 Z"
              className="stroke-amber-300 dark:stroke-amber-700/60"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray="6 6"
            />

            {/* Directional motion dots */}
            <circle cx="150" cy="22" r="3" className="fill-amber-500 animate-ping" />
            <circle cx="50" cy="78" r="3" className="fill-amber-500 animate-ping" />

            {/* Glowing Motion Head (Pulsing Amber/Emerald Jewel) */}
            <circle
              cx="100"
              cy="50"
              r="6"
              className="fill-emerald-500 dark:fill-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.8)]"
            />
          </svg>

          {/* Badge indicator */}
          <div className="absolute bottom-2 px-2.5 py-1 rounded-full bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 text-[10px] font-semibold text-slate-600 dark:text-slate-300 shadow-2xs flex items-center gap-1.5">
            <RotateCw className="w-3 h-3 text-amber-500 animate-spin" />
            <span>{t.qibla.calibrateFigure8}</span>
          </div>
        </div>

        {/* Calibration Tips List */}
        <div className="w-full text-left bg-slate-50 dark:bg-slate-800/40 rounded-xl p-3 mb-6 text-xs text-slate-500 dark:text-slate-400 space-y-1.5 border border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
            <span>{t.qibla.accuracyOptimalTip}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
            <span>{t.qibla.accuracyWarning}</span>
          </div>
        </div>

        {/* Close Action Button */}
        <button
          type="button"
          onClick={onClose}
          className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-transform active:scale-98 cursor-pointer"
        >
          {t.qibla.calibrateClose}
        </button>
      </div>
    </div>
  );
}
