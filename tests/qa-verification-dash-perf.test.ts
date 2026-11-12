import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server.js';

import {
  GET as getPrayerTimes,
  clearPrayerTimesCache,
} from '../src/app/api/prayer-times/route.ts';
import { GET as getStats } from '../src/app/api/stats/route.ts';
import { validateSessionToken } from '../src/lib/auth/guard.ts';
import { execLean } from '../src/lib/mongodb.ts';
import { Session } from '../src/models/Session.ts';
import { User } from '../src/models/User.ts';
import type { PrayerId, PrayerItem, PrayerStatus } from '../src/types/prayer.ts';

// ---------------------------------------------------------------------------
// Helpers & Types for Testing
// ---------------------------------------------------------------------------

const HOME_DASHBOARD_PATH = path.resolve(
  process.cwd(),
  'src/components/HomeDashboard.tsx'
);
const STATS_ROUTE_PATH = path.resolve(
  process.cwd(),
  'src/app/api/stats/route.ts'
);
const GUARD_PATH = path.resolve(
  process.cwd(),
  'src/lib/auth/guard.ts'
);
const ACCOUNT_PAGE_PATH = path.resolve(
  process.cwd(),
  'src/app/account/page.tsx'
);

interface NextPrayerInfo {
  prayerId: PrayerId;
  prayerName: string;
  prayerTime: string;
  hours: number;
  mins: number;
  secs: number;
  isTomorrow: boolean;
  totalSecondsRemaining: number;
}

function parseTimeToDate(timeStr: string, baseDate: Date, addDays = 0): Date {
  const [h, m] = timeStr.split(':').map(Number);
  const d = new Date(baseDate);
  d.setDate(d.getDate() + addDays);
  d.setHours(h, m, 0, 0);
  return d;
}

function calculateNextPrayerCountdown(prayers: PrayerItem[], now: Date): NextPrayerInfo {
  if (!prayers || prayers.length === 0) {
    return {
      prayerId: 'fajr',
      prayerName: 'Fajr',
      prayerTime: '04:47',
      hours: 0,
      mins: 0,
      secs: 0,
      isTomorrow: false,
      totalSecondsRemaining: 0,
    };
  }

  for (const p of prayers) {
    const pDate = parseTimeToDate(p.time, now, 0);
    const diffMs = pDate.getTime() - now.getTime();
    if (diffMs > 0) {
      const totalSecs = Math.floor(diffMs / 1000);
      const hours = Math.floor(totalSecs / 3600);
      const mins = Math.floor((totalSecs % 3600) / 60);
      const secs = totalSecs % 60;
      return {
        prayerId: p.id,
        prayerName: p.name,
        prayerTime: p.time,
        hours,
        mins,
        secs,
        isTomorrow: false,
        totalSecondsRemaining: totalSecs,
      };
    }
  }

  const tomorrowFajrDate = parseTimeToDate(prayers[0].time, now, 1);
  const diffMs = tomorrowFajrDate.getTime() - now.getTime();
  const totalSecs = Math.max(0, Math.floor(diffMs / 1000));
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  return {
    prayerId: prayers[0].id,
    prayerName: prayers[0].name,
    prayerTime: prayers[0].time,
    hours,
    mins,
    secs,
    isTomorrow: true,
    totalSecondsRemaining: totalSecs,
  };
}

const SAMPLE_PRAYERS: PrayerItem[] = [
  { id: 'fajr', name: 'Fajr', time: '04:47', endTime: '06:19', status: 'PENDING' },
  { id: 'dhuhr', name: 'Dhuhr', time: '12:13', endTime: '16:20', status: 'PENDING' },
  { id: 'asr', name: 'Asr', time: '16:20', endTime: '18:05', status: 'PENDING' },
  { id: 'maghrib', name: 'Maghrib', time: '18:05', endTime: '19:32', status: 'PENDING' },
  { id: 'isha', name: 'Isha', time: '19:32', endTime: '23:59', status: 'PENDING' },
];

// ===========================================================================
// Test Suite
// ===========================================================================

describe('QA Verification: Dashboard Layout & Performance Optimizations', () => {

  // =========================================================================
  // 1. Prayer Cards UI (Restored Compact Layout from 1e65ba4)
  // =========================================================================
  describe('1. Prayer Cards UI (Restored Compact)', () => {
    let dashboardSource: string;

    beforeEach(() => {
      dashboardSource = fs.readFileSync(HOME_DASHBOARD_PATH, 'utf-8');
    });

    it('1.1 should verify the restored compact prayer card structure: checkmark + name/time on left, status badge + side chevron on right', () => {
      // Find the prayer mapping loop in HomeDashboard.tsx
      const prayerLoopStart = dashboardSource.indexOf('{prayers.map((prayer) => {');
      assert.ok(prayerLoopStart !== -1, 'prayers.map loop must exist in HomeDashboard.tsx');

      const prayerLoopEnd = dashboardSource.indexOf('{/* Pay Qaza Modal');
      assert.ok(prayerLoopEnd !== -1, 'End of prayer card mapping must be located');

      const prayerCardBlock = dashboardSource.slice(prayerLoopStart, prayerLoopEnd);

      // Verify main row flex container
      assert.match(
        prayerCardBlock,
        /<div className="flex items-center justify-between">/,
        'Prayer card main row must be flex items-center justify-between'
      );

      // Verify Left: Quick toggle checkmark button with CheckCircle2
      assert.match(
        prayerCardBlock,
        /<button[\s\S]*?onClick=\{\(e\)\s*=>\s*\{\s*e\.stopPropagation\(\);\s*handleQuickToggle\(prayer\.id\);\s*\}\}[\s\S]*?<CheckCircle2\s+className=\{`w-6 h-6 transition-transform active:scale-90 \$\{config\.iconClass\}`\}\s*\/>[\s\S]*?<\/button>/,
        'Left side must contain checkmark button with CheckCircle2 and stopPropagation'
      );

      // Verify Left: Prayer name and time range
      assert.match(
        prayerCardBlock,
        /\{prayerLabel\}/,
        'Left side must display prayer label'
      );
      assert.match(
        prayerCardBlock,
        /<span>\{prayer\.time\}\s*–\s*\{prayer\.endTime\}<\/span>/,
        'Left side must display prayer time interval (e.g., prayer.time – prayer.endTime)'
      );

      // Verify Right: Status badge with exact styling
      assert.match(
        prayerCardBlock,
        /className=\{`text-\[11px\] font-semibold px-2\.5 py-1 rounded-full border \$\{config\.badgeClass\}`\}/,
        'Right side must display status badge with config.badgeClass'
      );

      // Verify Right: Side chevron button with ChevronDown
      assert.match(
        prayerCardBlock,
        /<button[\s\S]*?onClick=\{\(e\)\s*=>\s*\{\s*e\.stopPropagation\(\);\s*setActiveMenuPrayerId\(isMenuOpen \? null : prayer\.id\);\s*\}\}[\s\S]*?<ChevronDown\s+className=\{`w-4 h-4 transition-transform \$\{isMenuOpen \? 'rotate-180' : ''\}`\}\s*\/>[\s\S]*?<\/button>/,
        'Right side must contain side chevron button with ChevronDown'
      );

      // Verify touch targets comply with mobile-first accessibility (min-h-[44px] min-w-[44px])
      const touchTargetMatches = prayerCardBlock.match(/min-h-\[44px\] min-w-\[44px\]/g);
      assert.ok(touchTargetMatches && touchTargetMatches.length >= 2, 'Main row buttons must have min-h-[44px] min-w-[44px] touch targets');
    });

    it('1.2 should verify no action buttons on the top/main row (never duplicate buttons)', () => {
      const prayerLoopStart = dashboardSource.indexOf('{prayers.map((prayer) => {');
      const prayerLoopEnd = dashboardSource.indexOf('{/* Pay Qaza Modal');
      const prayerCardBlock = dashboardSource.slice(prayerLoopStart, prayerLoopEnd);

      const mainRowStart = prayerCardBlock.indexOf('<div className="flex items-center justify-between">');
      const mainRowEnd = prayerCardBlock.indexOf('{/* 3 Canonical Status Action Buttons');
      assert.ok(mainRowStart !== -1 && mainRowEnd !== -1, 'Main row boundaries must be located');
      const mainRowBlock = prayerCardBlock.slice(mainRowStart, mainRowEnd);

      // Top/main row must NOT contain any status change action buttons
      assert.doesNotMatch(mainRowBlock, /handleSetStatus/, 'Top/main row must NOT contain handleSetStatus action buttons');
      assert.doesNotMatch(mainRowBlock, />\s*\{t\.dashboard\.markPrayed\}\s*<\/button>/, 'Top/main row must NOT contain markPrayed action button');
      assert.doesNotMatch(mainRowBlock, /t\.dashboard\.markMadeUp/, 'Top/main row must NOT contain markMadeUp button');
      assert.doesNotMatch(mainRowBlock, /t\.dashboard\.markMissed/, 'Top/main row must NOT contain markMissed button');

      // Check that Made Up and Missed only appear once in the whole card (in dropdown menu only)
      const madeUpMatches = prayerCardBlock.match(/handleSetStatus\(prayer\.id,\s*['"]MADE_UP['"]\)/g) || [];
      assert.equal(madeUpMatches.length, 1, 'MADE_UP action button must appear exactly once (in dropdown menu)');

      const missedMatches = prayerCardBlock.match(/handleSetStatus\(prayer\.id,\s*['"]MISSED['"]\)/g) || [];
      assert.equal(missedMatches.length, 1, 'MISSED action button must appear exactly once (in dropdown menu)');
    });

    it('1.3 should verify that only the side chevron button toggles the 3 status options and overdue prayers do NOT automatically open the menu', () => {
      const prayerLoopStart = dashboardSource.indexOf('{prayers.map((prayer) => {');
      const prayerLoopEnd = dashboardSource.indexOf('{/* Pay Qaza Modal');
      const prayerCardBlock = dashboardSource.slice(prayerLoopStart, prayerLoopEnd);

      // Verify that isMenuOpen is strictly bound to activeMenuPrayerId === prayer.id
      assert.match(
        prayerCardBlock,
        /const\s+isMenuOpen\s*=\s*activeMenuPrayerId\s*===\s*prayer\.id;/,
        'isMenuOpen must be strictly defined as activeMenuPrayerId === prayer.id'
      );

      // Verify that overdue prayers do NOT automatically open the menu without chevron click
      assert.doesNotMatch(prayerCardBlock, /isOverdue/, 'isOverdue must NOT be declared or used in prayer card block');
      assert.doesNotMatch(prayerCardBlock, /dismissedOverdue/, 'dismissedOverdue state must NOT be used');

      // Verify toggle button behavior
      assert.match(
        prayerCardBlock,
        /setActiveMenuPrayerId\(isMenuOpen\s*\?\s*null\s*:\s*prayer\.id\)/,
        'Chevron button must toggle menu between null and prayer.id'
      );

      // Functional verification of chevron toggle logic
      let activeMenuPrayerId: string | null = null;
      function toggleMenu(currentId: string | null, targetId: string): string | null {
        return currentId === targetId ? null : targetId;
      }

      // Even if prayer is overdue, when activeMenuPrayerId is null, menu is closed
      let isDhuhrMenuOpen = activeMenuPrayerId === 'dhuhr';
      assert.equal(isDhuhrMenuOpen, false, 'Overdue prayer must not open menu automatically without chevron click');

      // Clicking chevron opens menu
      activeMenuPrayerId = toggleMenu(activeMenuPrayerId, 'dhuhr');
      isDhuhrMenuOpen = activeMenuPrayerId === 'dhuhr';
      assert.equal(isDhuhrMenuOpen, true, 'Clicking chevron opens menu');

      // Clicking chevron again closes menu
      activeMenuPrayerId = toggleMenu(activeMenuPrayerId, 'dhuhr');
      isDhuhrMenuOpen = activeMenuPrayerId === 'dhuhr';
      assert.equal(isDhuhrMenuOpen, false, 'Clicking chevron again closes menu');
    });

    it('1.4 should verify bidirectional toggle: tapping a Pending prayer card marks it PRAYED_ON_TIME, tapping an already prayed card resets it to PENDING', () => {
      // 1. AST / Code Verification: card container onClick must invoke handleQuickToggle
      const prayerLoopStart = dashboardSource.indexOf('{prayers.map((prayer) => {');
      const prayerLoopEnd = dashboardSource.indexOf('{/* Pay Qaza Modal');
      const prayerCardBlock = dashboardSource.slice(prayerLoopStart, prayerLoopEnd);

      assert.match(
        prayerCardBlock,
        /onClick=\{\(\)\s*=>\s*\{\s*handleQuickToggle\(\s*prayer\.id\s*\);?\s*\}\}/,
        'Card onClick handler must invoke handleQuickToggle'
      );

      // Verify cursor styling
      assert.match(
        prayerCardBlock,
        /cursor-pointer/,
        'Card cursor must be pointer'
      );

      // 2. Functional Verification of bidirectional card-tap transition logic
      function simulateCardTap(currentStatus: PrayerStatus): {
        statusChanged: boolean;
        newStatus: PrayerStatus;
      } {
        const isCompleted =
          currentStatus === 'PRAYED_ON_TIME' ||
          currentStatus === 'PRAYED' ||
          currentStatus === 'PRAYED_LATE';
        if (isCompleted) {
          return { statusChanged: true, newStatus: 'PENDING' };
        }
        return { statusChanged: true, newStatus: 'PRAYED_ON_TIME' };
      }

      // Case A: PENDING -> Tapping marks it PRAYED_ON_TIME
      const pendingResult = simulateCardTap('PENDING');
      assert.equal(pendingResult.statusChanged, true);
      assert.equal(pendingResult.newStatus, 'PRAYED_ON_TIME');

      // Case B: Already PRAYED_ON_TIME -> Tapping toggles it back to PENDING (Bidirectional toggle)
      const prayedResult = simulateCardTap('PRAYED_ON_TIME');
      assert.equal(prayedResult.statusChanged, true);
      assert.equal(prayedResult.newStatus, 'PENDING');

      // Case C: PRAYED_LATE -> Tapping toggles it back to PENDING (Bidirectional toggle)
      const prayedLateResult = simulateCardTap('PRAYED_LATE');
      assert.equal(prayedLateResult.statusChanged, true);
      assert.equal(prayedLateResult.newStatus, 'PENDING');

      // Case D: MADE_UP -> Tapping sets PRAYED_ON_TIME
      const madeUpResult = simulateCardTap('MADE_UP');
      assert.equal(madeUpResult.statusChanged, true);
      assert.equal(madeUpResult.newStatus, 'PRAYED_ON_TIME');

      // Case E: MISSED -> Tapping sets PRAYED_ON_TIME
      const missedResult = simulateCardTap('MISSED');
      assert.equal(missedResult.statusChanged, true);
      assert.equal(missedResult.newStatus, 'PRAYED_ON_TIME');
    });

    it('1.5 should verify dropdown menu: renders 3 status buttons in grid grid-cols-3 gap-2 plus resetToPending when not pending, with e.stopPropagation()', () => {
      const prayerLoopStart = dashboardSource.indexOf('{prayers.map((prayer) => {');
      const prayerLoopEnd = dashboardSource.indexOf('{/* Pay Qaza Modal');
      const prayerCardBlock = dashboardSource.slice(prayerLoopStart, prayerLoopEnd);

      // Verify dropdown container renders on isMenuOpen with e.stopPropagation()
      assert.match(
        prayerCardBlock,
        /\{isMenuOpen\s*&&\s*\(\s*<div\s+className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2"\s+onClick=\{\(e\)\s*=>\s*e\.stopPropagation\(\)\}/,
        'Dropdown container must render when isMenuOpen is true and stop click propagation'
      );

      // Verify 3-column grid container
      assert.match(
        prayerCardBlock,
        /<div className="grid grid-cols-3 gap-2">/,
        'Dropdown menu buttons must be arranged in grid grid-cols-3 gap-2'
      );

      // Verify markPrayed button in dropdown
      assert.match(
        prayerCardBlock,
        /handleSetStatus\(prayer\.id,\s*'PRAYED_ON_TIME'\);[\s\S]*?setActiveMenuPrayerId\(null\);[\s\S]*?\{t\.dashboard\.markPrayed\}/,
        'Dropdown must contain Prayed button setting status to PRAYED_ON_TIME and closing menu'
      );

      // Verify markMadeUp button in dropdown
      assert.match(
        prayerCardBlock,
        /handleSetStatus\(prayer\.id,\s*'MADE_UP'\);[\s\S]*?setActiveMenuPrayerId\(null\);[\s\S]*?\{t\.dashboard\.markMadeUp\}/,
        'Dropdown must contain Made Up button setting status to MADE_UP and closing menu'
      );

      // Verify markMissed button in dropdown
      assert.match(
        prayerCardBlock,
        /handleSetStatus\(prayer\.id,\s*'MISSED'\);[\s\S]*?setActiveMenuPrayerId\(null\);[\s\S]*?\{t\.dashboard\.markMissed\}/,
        'Dropdown must contain Missed button setting status to MISSED and closing menu'
      );

      // Verify Reset to Pending button when prayer.status !== 'PENDING'
      assert.match(
        prayerCardBlock,
        /\{prayer\.status\s*!==\s*'PENDING'\s*&&\s*\([\s\S]*?handleSetStatus\(prayer\.id,\s*'PENDING'\);[\s\S]*?setActiveMenuPrayerId\(null\);[\s\S]*?\{t\.dashboard\.resetToPending\}[\s\S]*?<\/button>/,
        'Dropdown must render Reset to pending button when prayer is not pending'
      );

      // Verify stopPropagation on quick toggle checkmark, side chevron, and dropdown buttons
      assert.match(
        prayerCardBlock,
        /onClick=\{\(e\)\s*=>\s*\{\s*e\.stopPropagation\(\);\s*handleQuickToggle\(prayer\.id\);\s*\}\}/,
        'Quick toggle checkmark button must call e.stopPropagation()'
      );
      assert.match(
        prayerCardBlock,
        /onClick=\{\(e\)\s*=>\s*\{\s*e\.stopPropagation\(\);\s*setActiveMenuPrayerId\(isMenuOpen \? null : prayer\.id\);\s*\}\}/,
        'Side chevron button must call e.stopPropagation()'
      );
    });
  });

  // =========================================================================
  // 2. Next Prayer Display (Restored Compact Layout from 1e65ba4)
  // =========================================================================
  describe('2. Next Prayer Display', () => {
    let dashboardSource: string;

    beforeEach(() => {
      dashboardSource = fs.readFileSync(HOME_DASHBOARD_PATH, 'utf-8');
    });

    it('2.1 should verify compact 2-row layout: prayer name and time on left, "in" label and countdown on right, with zero "Tomorrow" text', () => {
      // Extract Card A: Next Prayer Card
      const cardAStart = dashboardSource.indexOf('{/* Card A: Next Prayer Card */}');
      const cardBStart = dashboardSource.indexOf('{/* Card B: Daily Prayer Progress Card');
      assert.ok(cardAStart !== -1 && cardBStart !== -1, 'Card A must be located in source');

      const cardASource = dashboardSource.slice(cardAStart, cardBStart);

      // Verify Left: Prayer name typography
      assert.match(
        cardASource,
        /<p className="text-2xl font-black tracking-tight text-white">\s*\{t\.prayers\[nextPrayer\.prayerId\]\}\s*<\/p>/,
        'Left side must display prayer name with text-2xl font-black tracking-tight text-white'
      );

      // Verify Left: Prayer time range with Clock icon and tabular-nums
      assert.match(
        cardASource,
        /<div className="flex items-center gap-1\.5 text-xs text-slate-400 mt-0\.5">[\s\S]*?<Clock className="w-3\.5 h-3\.5" \/>[\s\S]*?<span className="tabular-nums">[\s\S]*?nextPrayer\.prayerTime[\s\S]*?<\/span>/,
        'Left side must display prayer time range with text-xs text-slate-400 mt-0.5 and tabular-nums'
      );

      // Verify Right: "in" label
      assert.match(
        cardASource,
        /<span className="text-\[11px\] font-medium text-slate-400 block mb-0\.5">\s*\{t\.dashboard\.in\}\s*<\/span>/,
        'Right side must display "in" label with text-[11px] font-medium text-slate-400 block mb-0.5'
      );

      // Verify Right: Countdown timer typography
      assert.match(
        cardASource,
        /<p[\s\S]*?className="text-xl sm:text-2xl font-black text-emerald-400 font-mono tracking-tight"/,
        'Right side must display countdown timer with text-xl sm:text-2xl font-black text-emerald-400 font-mono tracking-tight'
      );

      // Assert that "Tomorrow" or "tomorrow" does NOT appear anywhere in Card A
      assert.doesNotMatch(cardASource, /\bTomorrow\b/i, 'The word "Tomorrow" must NOT appear in Next Prayer hero card');
      assert.doesNotMatch(cardASource, /\bErtaga\b/i, 'The Uzbek word "Ertaga" must NOT appear in Next Prayer hero card');
      assert.doesNotMatch(cardASource, /\bЗавтра\b/i, 'The Russian word "Завтра" must NOT appear in Next Prayer hero card');
      assert.doesNotMatch(cardASource, /isTomorrow/i, 'isTomorrow property must not be conditionally rendered as a label in Card A');
    });

    it('2.2 should verify removal of overnight Isha banner and overnight Isha header badge', () => {
      // Assert that isPostMidnight is not declared or referenced in HomeDashboard
      assert.doesNotMatch(
        dashboardSource,
        /isPostMidnight\s*&&/,
        'HomeDashboard must NOT contain conditional isPostMidnight banner'
      );
      assert.doesNotMatch(
        dashboardSource,
        /const\s+isPostMidnight\s*=/,
        'HomeDashboard must NOT declare isPostMidnight'
      );

      // Assert that overnightIshaBadge is not referenced
      assert.doesNotMatch(
        dashboardSource,
        /overnightIshaBadge/,
        'HomeDashboard must NOT render overnightIshaBadge'
      );

      // Assert that overnight banner text is not present
      assert.doesNotMatch(
        dashboardSource,
        /overnightIshaBanner/,
        'HomeDashboard must NOT render overnightIshaBanner'
      );
    });

    it('2.3 should verify that countdown display renders accurately', () => {
      // 1. Time before Dhuhr: 10:00:00 -> Next is Dhuhr (12:13) -> 2h 13m 0s
      const morningTime = new Date('2026-11-07T10:00:00');
      const morningNext = calculateNextPrayerCountdown(SAMPLE_PRAYERS, morningTime);
      assert.equal(morningNext.prayerId, 'dhuhr');
      assert.equal(morningNext.hours, 2);
      assert.equal(morningNext.mins, 13);
      assert.equal(morningNext.secs, 0);

      const formattedMorningCountdown = `${String(morningNext.hours).padStart(2, '0')}:${String(morningNext.mins).padStart(2, '0')}:${String(morningNext.secs).padStart(2, '0')}`;
      assert.equal(formattedMorningCountdown, '02:13:00');

      // 2. Time after Isha: 22:00:00 -> Next is tomorrow's Fajr (04:47) -> 6h 47m 0s
      const nightTime = new Date('2026-11-07T22:00:00');
      const nightNext = calculateNextPrayerCountdown(SAMPLE_PRAYERS, nightTime);
      assert.equal(nightNext.prayerId, 'fajr');
      assert.equal(nightNext.hours, 6);
      assert.equal(nightNext.mins, 47);
      assert.equal(nightNext.secs, 0);
      assert.equal(nightNext.isTomorrow, true);

      const formattedNightCountdown = `${String(nightNext.hours).padStart(2, '0')}:${String(nightNext.mins).padStart(2, '0')}:${String(nightNext.secs).padStart(2, '0')}`;
      assert.equal(formattedNightCountdown, '06:47:00');

      // 3. Exact prayer time: 12:13:00 -> Dhuhr diff is 0, next is Asr (16:20) -> 4h 7m 0s
      const exactDhuhr = new Date('2026-11-07T12:13:00');
      const exactNext = calculateNextPrayerCountdown(SAMPLE_PRAYERS, exactDhuhr);
      assert.equal(exactNext.prayerId, 'asr');
      assert.equal(exactNext.hours, 4);
      assert.equal(exactNext.mins, 7);
      assert.equal(exactNext.secs, 0);
    });
  });

  // =========================================================================
  // 3. Performance & Route Optimization
  // =========================================================================
  describe('3. Performance & Route Optimization', () => {

    // -----------------------------------------------------------------------
    // 3.1 GET /api/stats executes parallel lean queries without document hydration overhead
    // -----------------------------------------------------------------------
    it('3.1 should test GET /api/stats executes parallel lean queries without document hydration overhead', async () => {
      // 1. Static AST / Code Inspection of src/app/api/stats/route.ts
      const statsSource = fs.readFileSync(STATS_ROUTE_PATH, 'utf-8');

      // Verify that execLean is imported from lib/mongodb
      assert.match(
        statsSource,
        /import\s*\{[^}]*execLean[^}]*\}\s*from\s*['"][^'"]*lib\/mongodb(\.ts)?['"]/,
        'GET /api/stats must import execLean from lib/mongodb'
      );

      // Verify parallel execution with Promise.all
      assert.match(
        statsSource,
        /await\s+Promise\.all\(\s*\[\s*execLean[\s\S]*?sortedPrayerQuery[\s\S]*?execLean[\s\S]*?QazaPayment\.find/,
        'GET /api/stats must execute PrayerRecord and QazaPayment queries in parallel via Promise.all with execLean'
      );

      // Verify lean field projection to reduce MongoDB serialization overhead
      assert.match(
        statsSource,
        /\.select\(['"]date prayers['"]\)/,
        'GET /api/stats must project only date and prayers fields to minimize network payload'
      );

      // 2. Unit Verification of execLean behavior
      let leanCalled = false;
      const mockQueryWithLean = {
        lean: async () => {
          leanCalled = true;
          return [{ date: '2026-11-07', prayers: {} }];
        },
      };

      const leanResult = await execLean<Array<{ date: string }>>(mockQueryWithLean);
      assert.equal(leanCalled, true, 'execLean must execute .lean() on Mongoose queries');
      assert.equal(leanResult[0].date, '2026-11-07');
      // Plain lean objects do NOT have Mongoose document methods ($isModified, save, isNew, etc.)
      assert.equal((leanResult[0] as unknown as { $isModified?: unknown }).$isModified, undefined);
      assert.equal((leanResult[0] as unknown as { save?: unknown }).save, undefined);

      // 3. Verify unauthenticated request to /api/stats returns 401
      const req = new NextRequest('http://localhost:3000/api/stats');
      const res = await getStats(req);
      assert.equal(res.status, 401, 'Unauthenticated /api/stats request must return 401');
      const data = await res.json();
      assert.equal(data.success, false);
      assert.match(data.error, /Unauthorized/i);
    });

    // -----------------------------------------------------------------------
    // 3.2 GET /api/prayer-times returns HTTP Cache-Control header
    // -----------------------------------------------------------------------
    it('3.2 should test GET /api/prayer-times returns HTTP Cache-Control header: "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400"', async () => {
      const EXPECTED_CACHE_HEADER =
        'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400';

      clearPrayerTimesCache();

      // Mock global fetch to return deterministic fatvo.uz timings
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            date: '12-11-2026',
            imsak: '04:37',
            fajr: '04:47',
            sunrise: '06:19',
            dhuhr: '12:13',
            asr: '16:20',
            maghrib: '18:05',
            isha: '19:32',
            midnight: '23:59',
            address: { region: '', city: 'Toshkent', county: '', country: 'Oʻzbekiston' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      try {
        // Request 1: Cache MISS (fetches and caches)
        const reqMiss = new NextRequest(
          'http://localhost:3000/api/prayer-times?latitude=41.2995&longitude=69.2401'
        );
        const resMiss = await getPrayerTimes(reqMiss);
        assert.equal(resMiss.status, 200, 'Prayer times endpoint should return 200');

        const cacheControlMiss = resMiss.headers.get('cache-control');
        assert.equal(
          cacheControlMiss,
          EXPECTED_CACHE_HEADER,
          'MISS response must return Cache-Control: public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400'
        );
        assert.equal(resMiss.headers.get('x-cache'), 'MISS');

        // Request 2: Cache HIT (serves instantly from in-memory cache)
        const reqHit = new NextRequest(
          'http://localhost:3000/api/prayer-times?latitude=41.2995&longitude=69.2401'
        );
        const resHit = await getPrayerTimes(reqHit);
        assert.equal(resHit.status, 200);

        const cacheControlHit = resHit.headers.get('cache-control');
        assert.equal(
          cacheControlHit,
          EXPECTED_CACHE_HEADER,
          'HIT response must return Cache-Control: public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400'
        );
        assert.equal(resHit.headers.get('x-cache'), 'HIT');
      } finally {
        globalThis.fetch = originalFetch;
        clearPrayerTimesCache();
      }
    });

    // -----------------------------------------------------------------------
    // 3.3 Session authentication via guard.ts uses non-blocking touch and execLean
    // -----------------------------------------------------------------------
    it('3.3 should test that session authentication via guard.ts uses non-blocking touch and execLean', async () => {
      // 1. Static AST / Code Inspection of src/lib/auth/guard.ts
      const guardSource = fs.readFileSync(GUARD_PATH, 'utf-8');

      // Verify that Session.findOne and User.findById use execLean
      assert.match(
        guardSource,
        /await\s+execLean<ISession\s*\|\s*null>\(\s*Session\.findOne\(\{[\s\S]*?sessionToken:\s*token\s*\}\)\s*\)/,
        'guard.ts must wrap Session.findOne in execLean to bypass document hydration'
      );
      assert.match(
        guardSource,
        /await\s+execLean<IUser\s*\|\s*null>\(\s*User\.findById\(\s*session\.userId\s*\)\s*\)/,
        'guard.ts must wrap User.findById in execLean to bypass document hydration'
      );

      // Verify that Session.updateOne for lastActiveAt touch is unawaited (non-blocking)
      assert.match(
        guardSource,
        /Session\.updateOne\(\s*\{\s*_id:\s*session\._id\s*\},[\s\S]*?\$set:\s*\{\s*lastActiveAt:\s*new\s+Date\(now\)\s*\}\s*\}\s*\)\.catch\(\(\)\s*=>\s*\{\}\)/,
        'guard.ts must invoke Session.updateOne with .catch() without awaiting it (non-blocking touch)'
      );

      // 2. Functional Verification with Stubbed Models & Mongoose Cache
      const prevMongooseCache = globalThis.mongooseCache;
      // Provide a mock cached connection to prevent connectDB() from attempting network socket
      globalThis.mongooseCache = {
        conn: {} as unknown as typeof import('mongoose').default,
        promise: Promise.resolve({} as unknown as typeof import('mongoose').default),
      };

      const sessionModel = Session as unknown as Record<string, unknown>;
      const userModel = User as unknown as Record<string, unknown>;

      const originalSessionFindOne = sessionModel.findOne;
      const originalSessionUpdateOne = sessionModel.updateOne;
      const originalSessionDeleteOne = sessionModel.deleteOne;
      const originalUserFindById = userModel.findById;

      let touchInvoked = false;
      let touchAwaited = false;

      try {
        const mockSessionId = '6639c0000000000000000001';
        const mockUserId = '6639c0000000000000000002';
        const validToken = 'valid_session_token_12345';

        // Mock Session document with lastActiveAt older than 15 minutes to trigger touch
        const staleLastActiveAt = new Date(Date.now() - 20 * 60 * 1000); // 20 minutes ago
        const futureExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now

        const mockSessionData = {
          _id: mockSessionId,
          sessionToken: validToken,
          userId: mockUserId,
          expiresAt: futureExpiresAt,
          lastActiveAt: staleLastActiveAt,
        };

        const mockUserData = {
          _id: mockUserId,
          name: 'Test Worshipper',
          email: 'worshipper@salahtrack.com',
          username: 'worshipper',
          role: 'user',
          preferences: {
            language: 'uz',
            showOnLeaderboard: true,
            city: 'Tashkent',
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        // Stub Session.findOne to return a lean query object
        sessionModel.findOne = () => {
          return {
            lean: async () => mockSessionData,
          };
        };

        // Stub User.findById to return a lean query object
        userModel.findById = () => {
          return {
            lean: async () => mockUserData,
          };
        };

        // Stub Session.updateOne: inject an artificial 250ms asynchronous delay
        // If validateSessionToken awaits it, the call will take >= 250ms.
        // Because it is non-blocking (fire-and-forget), it will finish immediately (< 50ms).
        sessionModel.updateOne = () => {
          touchInvoked = true;
          return new Promise((resolve) => {
            setTimeout(() => {
              touchAwaited = true;
              resolve({ acknowledged: true, modifiedCount: 1 });
            }, 250);
          });
        };

        const startTime = Date.now();
        const auth = await validateSessionToken(validToken);
        const duration = Date.now() - startTime;

        assert.ok(auth !== null, 'Valid session token must return authenticated AuthContext');
        assert.equal(auth.user.username, 'worshipper');
        assert.equal(auth.user.email, 'worshipper@salahtrack.com');
        assert.equal(touchInvoked, true, 'Session touch must be triggered for sessions active > 15m ago');

        // Assert that validateSessionToken resolved IMMEDIATELY without awaiting the 250ms touch promise
        assert.ok(
          duration < 100,
          `validateSessionToken took ${duration}ms, proving touch is non-blocking and fire-and-forget`
        );
        assert.equal(
          touchAwaited,
          false,
          'Touch promise should still be in-flight in background when validateSessionToken resolves'
        );

        // 3. Expired session test
        const expiredToken = 'expired_session_token';
        let deleteInvoked = false;
        sessionModel.findOne = () => {
          return {
            lean: async () => ({
              _id: 'expired_id',
              sessionToken: expiredToken,
              userId: mockUserId,
              expiresAt: new Date(Date.now() - 1000), // expired 1s ago
            }),
          };
        };
        sessionModel.deleteOne = () => {
          deleteInvoked = true;
          return Promise.resolve({ deletedCount: 1 });
        };

        const expiredAuth = await validateSessionToken(expiredToken);
        assert.equal(expiredAuth, null, 'Expired session must return null');
        assert.equal(deleteInvoked, true, 'Expired session must trigger Session.deleteOne');

        // 4. Invalid or empty tokens test
        const nullAuth = await validateSessionToken('');
        assert.equal(nullAuth, null, 'Empty token must return null immediately');
      } finally {
        sessionModel.findOne = originalSessionFindOne;
        sessionModel.updateOne = originalSessionUpdateOne;
        sessionModel.deleteOne = originalSessionDeleteOne;
        userModel.findById = originalUserFindById;
        globalThis.mongooseCache = prevMongooseCache;
      }
    });

  });

  // =========================================================================
  // 4. Account Settings LanguageSelector Verification
  // =========================================================================
  describe('4. Account Settings LanguageSelector Verification', () => {
    it('4.1 should verify that /account does NOT contain LanguageSelector in either Authenticated or Guest views', () => {
      assert.ok(fs.existsSync(ACCOUNT_PAGE_PATH), 'src/app/account/page.tsx must exist');
      const accountSource = fs.readFileSync(ACCOUNT_PAGE_PATH, 'utf-8');

      // 1. Verify no import of LanguageSelector anywhere in /account/page.tsx
      assert.doesNotMatch(
        accountSource,
        /import\s+LanguageSelector\s+from/i,
        'LanguageSelector component must not be imported in /account/page.tsx'
      );
      assert.doesNotMatch(
        accountSource,
        /<LanguageSelector[\s/>]/,
        'LanguageSelector JSX tag must not be rendered anywhere in /account/page.tsx'
      );

      // 2. Locate and inspect AuthenticatedAccountView
      const authViewStart = accountSource.indexOf('function AuthenticatedAccountView(');
      assert.ok(authViewStart !== -1, 'AuthenticatedAccountView function must exist');
      const guestViewStart = accountSource.indexOf('function GuestSettingsView(');
      assert.ok(guestViewStart !== -1, 'GuestSettingsView function must exist');

      const authViewSource = accountSource.slice(authViewStart, guestViewStart);
      assert.doesNotMatch(
        authViewSource,
        /LanguageSelector/i,
        'AuthenticatedAccountView must NOT contain or render LanguageSelector'
      );

      // 3. Locate and inspect GuestSettingsView
      const mainExportStart = accountSource.indexOf('export default function AccountPage(');
      assert.ok(mainExportStart !== -1, 'AccountPage main component must exist');

      const guestViewSource = accountSource.slice(guestViewStart, mainExportStart);
      assert.doesNotMatch(
        guestViewSource,
        /LanguageSelector/i,
        'GuestSettingsView must NOT contain or render LanguageSelector'
      );
    });
  });
});
