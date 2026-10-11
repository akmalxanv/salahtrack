'use client';

import React from 'react';
import { useLanguage } from '@/context/LanguageContext';

export interface AstrolabeDialProps {
  qiblaBearing: number;
  dialRef?: React.RefObject<HTMLDivElement | null>;
  needleRef?: React.RefObject<HTMLDivElement | null>;
  dialAngle?: number;
  needleAngle?: number;
  isAligned: boolean;
  className?: string;
}

export function AstrolabeDial({
  qiblaBearing,
  dialRef,
  needleRef,
  dialAngle = 0,
  needleAngle = 0,
  isAligned,
  className = '',
}: AstrolabeDialProps) {
  const { t } = useLanguage();

  // Pre-generate 72 tick marks (every 5 degrees)
  const ticks = React.useMemo(() => {
    return Array.from({ length: 72 }, (_, i) => {
      const deg = i * 5;
      const isMajor = deg % 30 === 0;
      const isSemiMajor = deg % 15 === 0 && !isMajor;
      return { deg, isMajor, isSemiMajor };
    });
  }, []);

  return (
    <div
      className={`relative flex items-center justify-center select-none ${className}`}
      aria-label="Qibla Astrolabe Compass Dial"
    >
      {/* Astrolabe Suspension Crown (Kursi / Halqa) */}
      <div className="absolute -top-7 sm:-top-8 z-20 flex flex-col items-center pointer-events-none">
        {/* Brass suspension ring (Halqa) */}
        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full border-[3px] border-amber-500/80 dark:border-amber-400/80 bg-transparent shadow-xs" />
        {/* Pierced brass bracket (Kursi) */}
        <div className="w-12 h-3.5 -mt-2 bg-gradient-to-b from-amber-600 via-amber-700 to-amber-800 dark:from-amber-500 dark:to-amber-700 rounded-t-lg clip-kursi shadow-sm flex items-center justify-center">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-200/90" />
        </div>
      </div>

      {/* Main Astrolabe Housing & Outer Limbus */}
      <div
        className={`relative w-72 h-72 sm:w-84 sm:h-84 md:w-96 md:h-96 rounded-full p-2.5 sm:p-3 transition-shadow duration-500 flex items-center justify-center ${
          isAligned
            ? 'shadow-[0_0_45px_rgba(16,185,129,0.35)] ring-4 ring-emerald-500/50'
            : 'shadow-2xl shadow-amber-950/20 dark:shadow-black/60'
        }`}
        style={{
          background:
            'radial-gradient(circle, #291e13 0%, #17120d 65%, #0d0a08 100%)',
          border: '4px solid #b48238',
        }}
      >
        {/* Brass engraved outer limbus graduated ring */}
        <div
          className="absolute inset-1 sm:inset-1.5 rounded-full border border-amber-600/40 pointer-events-none"
          style={{
            boxShadow:
              'inset 0 0 15px rgba(0,0,0,0.8), 0 0 10px rgba(180,130,56,0.25)',
          }}
        />

        {/* ROTATING ASTROLABE DIAL PLATE (Controlled by dialRef or dialAngle) */}
        <div
          ref={dialRef}
          className="relative w-full h-full rounded-full transition-transform ease-out will-change-transform"
          style={{
            transform: `rotate(${dialAngle}deg) translateZ(0)`,
          }}
        >
          {/* Subtle concentric astrolabe altitude/azimuth circles */}
          <div className="absolute inset-4 rounded-full border border-amber-500/15 pointer-events-none" />
          <div className="absolute inset-8 rounded-full border border-amber-500/20 pointer-events-none" />
          <div className="absolute inset-14 rounded-full border border-amber-500/15 pointer-events-none" />
          <div className="absolute inset-20 rounded-full border border-amber-500/25 pointer-events-none" />

          {/* Khatam-e-Sulayman (Eight-Pointed Islamic Geometric Star Rosette) */}
          <svg
            className="absolute inset-0 w-full h-full p-16 sm:p-20 text-amber-500/20 dark:text-amber-400/20 pointer-events-none"
            viewBox="0 0 100 100"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.75"
          >
            {/* Center concentric guide circle */}
            <circle cx="50" cy="50" r="32" strokeDasharray="1.5 2" />
            <circle cx="50" cy="50" r="18" strokeOpacity="0.4" />
            <circle cx="50" cy="50" r="6" strokeOpacity="0.6" />

            {/* Square 1 */}
            <rect
              x="26"
              y="26"
              width="48"
              height="48"
              strokeOpacity="0.5"
            />
            {/* Square 2 (Rotated 45 degrees) */}
            <rect
              x="26"
              y="26"
              width="48"
              height="48"
              transform="rotate(45 50 50)"
              strokeOpacity="0.5"
            />

            {/* Interlacing Star Points */}
            <polygon
              points="50,14 59,38 84,38 64,52 71,76 50,62 29,76 36,52 16,38 41,38"
              stroke="currentColor"
              strokeWidth="0.8"
              strokeOpacity="0.4"
            />
          </svg>

          {/* Graduated Degree Marks (Every 5 degrees) */}
          {ticks.map(({ deg, isMajor, isSemiMajor }) => (
            <div
              key={deg}
              className="absolute inset-0 flex justify-center pointer-events-none"
              style={{ transform: `rotate(${deg}deg)` }}
            >
              <div
                className={`transition-colors ${
                  isMajor
                    ? 'w-[2px] h-3 sm:h-3.5 bg-amber-400/90'
                    : isSemiMajor
                      ? 'w-[1.5px] h-2 sm:h-2.5 bg-amber-500/60'
                      : 'w-[1px] h-1.5 bg-amber-600/40'
                }`}
              />
            </div>
          ))}

          {/* 30° Numerical Degree Labels around the rim */}
          {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map(
            (deg) => (
              <div
                key={deg}
                className="absolute inset-0 flex justify-center pointer-events-none"
                style={{ transform: `rotate(${deg}deg)` }}
              >
                <span
                  className="text-[9px] sm:text-[10px] font-mono font-medium text-amber-400/60 pt-3.5 sm:pt-4"
                  style={{ transform: 'rotate(0deg)' }}
                >
                  {deg}
                </span>
              </div>
            )
          )}

          {/* Cardinal Directions */}
          {/* North (Crimson Tip) */}
          <div className="absolute top-7 sm:top-8 left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-none z-10">
            <div className="w-0 h-0 border-x-4 border-x-transparent border-b-[8px] border-b-rose-500 mb-0.5" />
            <span className="text-xs sm:text-sm font-extrabold text-rose-500 tracking-wider">
              {t.qibla.cardinalN}
            </span>
          </div>

          {/* East */}
          <div className="absolute right-7 sm:right-8 top-1/2 -translate-y-1/2 pointer-events-none">
            <span className="text-xs sm:text-sm font-bold text-amber-300/80">
              {t.qibla.cardinalE}
            </span>
          </div>

          {/* South */}
          <div className="absolute bottom-7 sm:bottom-8 left-1/2 -translate-x-1/2 pointer-events-none">
            <span className="text-xs sm:text-sm font-bold text-amber-300/80">
              {t.qibla.cardinalS}
            </span>
          </div>

          {/* West */}
          <div className="absolute left-7 sm:left-8 top-1/2 -translate-y-1/2 pointer-events-none">
            <span className="text-xs sm:text-sm font-bold text-amber-300/80">
              {t.qibla.cardinalW}
            </span>
          </div>

          {/* KAABA BEACON MARKER (Fixed on rim at calculated Qibla forward azimuth) */}
          <div
            className="absolute inset-0 flex justify-center pointer-events-none z-15"
            style={{ transform: `rotate(${qiblaBearing}deg)` }}
          >
            <div className="flex flex-col items-center -mt-1 sm:-mt-1.5">
              {/* Luminous beacon dot */}
              <div
                className={`w-4 h-4 sm:w-5 sm:h-5 rounded-full flex items-center justify-center border-2 border-amber-300 shadow-md transition-all ${
                  isAligned
                    ? 'bg-emerald-500 ring-4 ring-emerald-400/50 scale-125'
                    : 'bg-emerald-600'
                }`}
              >
                <div className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
              </div>
              <div className="w-0.5 h-3 bg-gradient-to-b from-amber-400 to-transparent" />
            </div>
          </div>
        </div>

        {/* ROTATING ALIDADE / KAABA NEEDLE POINTER (Controlled by needleRef or needleAngle) */}
        <div
          ref={needleRef}
          className="absolute inset-0 flex items-center justify-center pointer-events-none z-20 will-change-transform"
          style={{
            transform: `rotate(${needleAngle}deg) translateZ(0)`,
          }}
        >
          {/* Upper Alidade Arm pointing towards Kaaba */}
          <div className="relative w-7 sm:w-8 h-28 sm:h-36 -top-14 sm:-top-18 flex flex-col items-center">
            {/* Kaaba Golden Glyph Finial */}
            <div
              className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center transition-transform duration-300 ${
                isAligned ? 'scale-115' : 'scale-100'
              }`}
              style={{
                background:
                  'linear-gradient(135deg, #1e1e1e 0%, #000000 100%)',
                border: isAligned ? '2px solid #34d399' : '2px solid #fbbf24',
                boxShadow: isAligned
                  ? '0 0 15px rgba(52, 211, 153, 0.8)'
                  : '0 2px 8px rgba(0,0,0,0.5)',
              }}
            >
              {/* Stylized Kaaba Cube Representation with Gold Kiswah Band */}
              <div className="relative w-4 h-4 sm:w-4.5 sm:h-4.5 bg-neutral-900 rounded-xs border border-amber-500/70 overflow-hidden flex flex-col justify-between p-0.5">
                {/* Gold Embroidered Kiswah Ribbon */}
                <div className="w-full h-1 bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-300 rounded-2xs" />
                {/* Golden Kaaba Door Glyph */}
                <div className="w-1.5 h-2 bg-amber-400 rounded-t-xs self-end mr-0.5" />
              </div>
            </div>

            {/* Pierced Brass Alidade Needle Arm */}
            <div
              className={`w-1.5 sm:w-2 flex-1 rounded-full transition-colors mt-0.5 ${
                isAligned
                  ? 'bg-gradient-to-t from-emerald-500 via-emerald-400 to-emerald-300 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                  : 'bg-gradient-to-t from-amber-600 via-amber-500 to-amber-400'
              }`}
            />
          </div>

          {/* Lower Alidade Counterweight Arm */}
          <div className="relative w-1.5 sm:w-2 h-16 sm:h-20 top-8 sm:top-10 flex flex-col items-center">
            <div className="w-full flex-1 bg-gradient-to-b from-amber-700 to-amber-900 rounded-full opacity-80" />
            {/* Ornate tail finial */}
            <div className="w-4 h-4 rounded-full border border-amber-600/80 bg-amber-950/80 flex items-center justify-center -mt-1">
              <div className="w-1 h-1 rounded-full bg-amber-400/60" />
            </div>
          </div>
        </div>

        {/* Center Pivot Pin (Farass / Horse Pivot with Gemstone) */}
        <div className="absolute w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 border-amber-300 dark:border-amber-400 bg-radial from-amber-400 via-amber-600 to-amber-900 shadow-lg flex items-center justify-center z-30 pointer-events-none">
          <div
            className={`w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full transition-colors ${
              isAligned
                ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                : 'bg-emerald-600 shadow-inner'
            }`}
          />
        </div>
      </div>
    </div>
  );
}
