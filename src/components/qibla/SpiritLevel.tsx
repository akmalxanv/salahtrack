'use client';

import React from 'react';
import { CheckCircle2, AlertTriangle, Smartphone } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import type { TiltStatus } from '@/types/qibla';

export interface SpiritLevelProps {
  tiltMagnitude: number;
  tiltStatus: TiltStatus;
  bubbleX: number; // Normalized [-1, 1]
  bubbleY: number; // Normalized [-1, 1]
  className?: string;
}

export function SpiritLevel({
  tiltMagnitude,
  tiltStatus,
  bubbleX,
  bubbleY,
  className = '',
}: SpiritLevelProps) {
  const { t } = useLanguage();

  // Clamp bubble offsets within circular boundary
  const distance = Math.sqrt(bubbleX * bubbleX + bubbleY * bubbleY);
  const clampedDistance = Math.min(1, distance);
  const angle = Math.atan2(bubbleY, bubbleX);

  // Maximum bubble displacement radius in pixels from center
  const MAX_RADIUS_PX = 18;
  const offsetX = Math.cos(angle) * (clampedDistance * MAX_RADIUS_PX);
  const offsetY = Math.sin(angle) * (clampedDistance * MAX_RADIUS_PX);

  // Status configuration
  const statusConfig = {
    LEVEL: {
      label: t.qibla.levelOptimal,
      badgeClass:
        'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
      vialBorder: 'border-emerald-500/70 dark:border-emerald-400/70',
      vialGlow: 'shadow-[0_0_12px_rgba(16,185,129,0.25)]',
      bubbleBg: 'bg-emerald-400 dark:bg-emerald-300',
      Icon: CheckCircle2,
    },
    SLIGHT_TILT: {
      label: t.qibla.slightTilt,
      badgeClass:
        'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
      vialBorder: 'border-amber-500/70 dark:border-amber-400/70',
      vialGlow: 'shadow-[0_0_12px_rgba(245,158,11,0.25)]',
      bubbleBg: 'bg-amber-400 dark:bg-amber-300',
      Icon: AlertTriangle,
    },
    EXCESSIVE_TILT: {
      label: t.qibla.excessiveTilt,
      badgeClass:
        'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800',
      vialBorder: 'border-rose-500/70 dark:border-rose-400/70',
      vialGlow: 'shadow-[0_0_12px_rgba(244,63,94,0.3)]',
      bubbleBg: 'bg-rose-500 dark:bg-rose-400',
      Icon: AlertTriangle,
    },
  }[tiltStatus];

  const StatusIcon = statusConfig.Icon;

  return (
    <div
      className={`p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs flex items-center justify-between gap-3 ${className}`}
    >
      {/* Left: Metadata and status badge */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 shrink-0">
          <Smartphone className="w-5 h-5" />
        </div>
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              {tiltMagnitude}°
            </span>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${statusConfig.badgeClass}`}
            >
              <StatusIcon className="w-3 h-3" />
              <span>{statusConfig.label}</span>
            </span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {tiltStatus === 'LEVEL'
              ? t.qibla.accuracyOptimal
              : t.qibla.accuracyWarning}
          </p>
        </div>
      </div>

      {/* Right: Circular Brass-Trimmed Spirit Bubble Vial */}
      <div
        className={`relative w-14 h-14 rounded-full border-2 p-1 flex items-center justify-center transition-all ${statusConfig.vialBorder} ${statusConfig.vialGlow}`}
        style={{
          background:
            'radial-gradient(circle, rgba(16,185,129,0.08) 0%, rgba(15,23,42,0.1) 100%)',
        }}
      >
        {/* Reticle Concentric Bullseye Rings */}
        <div className="absolute inset-1.5 rounded-full border border-slate-300 dark:border-slate-700 pointer-events-none" />
        <div className="absolute inset-3.5 rounded-full border border-dashed border-slate-300/80 dark:border-slate-600/80 pointer-events-none" />

        {/* Reticle Crosshairs */}
        <div className="absolute w-full h-[1px] bg-slate-300/60 dark:bg-slate-700/60 pointer-events-none" />
        <div className="absolute h-full w-[1px] bg-slate-300/60 dark:bg-slate-700/60 pointer-events-none" />

        {/* Floating Spirit Bubble */}
        <div
          className={`absolute w-3.5 h-3.5 rounded-full shadow-sm transition-transform duration-100 ease-out flex items-center justify-center ${statusConfig.bubbleBg}`}
          style={{
            transform: `translate(${offsetX}px, ${offsetY}px)`,
          }}
        >
          {/* Internal specular highlight reflection */}
          <div className="w-1 h-1 rounded-full bg-white/80 self-start ml-0.5 mt-0.5" />
        </div>
      </div>
    </div>
  );
}
