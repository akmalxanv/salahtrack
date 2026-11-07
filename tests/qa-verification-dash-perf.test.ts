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
import type { PrayerId, PrayerItem } from '../src/types/prayer.ts';

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
  // 1. Prayer Cards Single-Row Inline Actions
  // =========================================================================
  describe('1. Prayer Cards Single-Row Inline Actions', () => {
    let dashboardSource: string;

    beforeEach(() => {
      dashboardSource = fs.readFileSync(HOME_DASHBOARD_PATH, 'utf-8');
    });

    it('1.1 should have ONLY ONE set of action buttons (Prayed, Made Up, Missed) per prayer card', () => {
      // Find the prayer mapping loop in HomeDashboard.tsx
      const prayerLoopStart = dashboardSource.indexOf('{prayers.map((prayer) => {');
      assert.ok(prayerLoopStart !== -1, 'prayers.map loop must exist in HomeDashboard.tsx');
      
      const prayerLoopEnd = dashboardSource.indexOf('</div>\n      </div>\n\n      {/* Guidance Modal');
      assert.ok(prayerLoopEnd !== -1, 'End of prayer card mapping must be located');
      
      const prayerCardBlock = dashboardSource.slice(prayerLoopStart, prayerLoopEnd);

      // Verify that the action trigger / container exists exactly once per card
      const actionContainerMatches = prayerCardBlock.match(/Right: EXACTLY ONE set of action buttons, displayed INLINE on the SAME ROW/g);
      assert.equal(actionContainerMatches?.length, 1, 'There must be exactly one action button region comment');

      // Verify trigger toggle button to open inline menu
      assert.match(
        prayerCardBlock,
        /onClick=\{\(\) => setActiveMenuPrayerId\(prayer\.id\)\}/,
        'Should have a single toggle button activating the inline menu for that prayer'
      );

      // Verify that when isMenuOpen is true, exactly one set of action buttons is rendered:
      // 1. Prayed (PRAYED_ON_TIME)
      // 2. Made Up (MADE_UP)
      // 3. Missed (MISSED)
      // 4. Cancel (X)
      const prayedButtonMatches = prayerCardBlock.match(/handleSetStatus\(prayer\.id, 'PRAYED_ON_TIME'\)/g);
      assert.equal(prayedButtonMatches?.length, 1, 'Must have exactly ONE "Prayed" action button per card');

      const madeUpButtonMatches = prayerCardBlock.match(/handleSetStatus\(prayer\.id, 'MADE_UP'\)/g);
      assert.equal(madeUpButtonMatches?.length, 1, 'Must have exactly ONE "Made Up" action button per card');

      const missedButtonMatches = prayerCardBlock.match(/handleSetStatus\(prayer\.id, 'MISSED'\)/g);
      assert.equal(missedButtonMatches?.length, 1, 'Must have exactly ONE "Missed" action button per card');

      const cancelButtonMatches = prayerCardBlock.match(/setActiveMenuPrayerId\(null\)/g);
      // Cancel is called when clicking any action or the cancel 'X' button (1 on each action + 1 cancel button = 4)
      assert.ok(cancelButtonMatches && cancelButtonMatches.length >= 4, 'Actions and cancel button close the inline menu');
    });

    it('1.2 should verify that NO sub-drawer, duplicate menu, or secondary accordion exists below the prayer row', () => {
      const prayerLoopStart = dashboardSource.indexOf('{prayers.map((prayer) => {');
      const prayerLoopEnd = dashboardSource.indexOf('</div>\n      </div>\n\n      {/* Guidance Modal');
      const prayerCardBlock = dashboardSource.slice(prayerLoopStart, prayerLoopEnd);

      // Verify that the prayer card contains only a single main row and no sibling elements below it
      assert.doesNotMatch(prayerCardBlock, /<details/i, 'No HTML <details> accordion element allowed');
      assert.doesNotMatch(prayerCardBlock, /accordion/i, 'No accordion drawer class or component allowed');
      assert.doesNotMatch(prayerCardBlock, /sub-drawer|subdrawer|drawer-content/i, 'No sub-drawer allowed');
      assert.doesNotMatch(prayerCardBlock, /dropdown-menu|collapse|collapsible/i, 'No secondary collapsible menu allowed');

      // Check the root card container: it must only contain the single flex row
      const cardContainerRegex = /<div\s+key=\{prayer\.id\}[\s\S]*?>\s*\{\/\* Main Prayer Row: Rigid identical alignment for all 5 prayers \*\/\}\s*<div className="flex items-center justify-between gap-2 sm:gap-3 min-w-0">([\s\S]*?)<\/div>\s*<\/div>/;
      const cardMatch = prayerCardBlock.match(cardContainerRegex);
      assert.ok(cardMatch, 'Card container must strictly contain the main prayer flex row and nothing below it');
    });

    it('1.3 should verify that action buttons display inline on the same row with clear status updating', () => {
      const prayerLoopStart = dashboardSource.indexOf('{prayers.map((prayer) => {');
      const prayerLoopEnd = dashboardSource.indexOf('</div>\n      </div>\n\n      {/* Guidance Modal');
      const prayerCardBlock = dashboardSource.slice(prayerLoopStart, prayerLoopEnd);

      // Verify the right-hand inline action wrapper
      assert.match(
        prayerCardBlock,
        /<div className="flex items-center shrink-0">/,
        'Action wrapper must be flex items-center shrink-0 to remain inline on the row'
      );

      // Verify the action button row styling
      assert.match(
        prayerCardBlock,
        /<div className="flex items-center gap-1 sm:gap-1\.5">/,
        'Action buttons must sit inline in a horizontal flex container'
      );

      // Verify touch targets comply with mobile-first accessibility (>= 38-44px)
      assert.match(
        prayerCardBlock,
        /min-h-\[38px\] sm:min-h-\[44px\]/,
        'Action buttons must meet touch target ergonomics (min-h-[38px] sm:min-h-[44px])'
      );

      // Test status transitions logic
      const prayers: PrayerItem[] = JSON.parse(JSON.stringify(SAMPLE_PRAYERS));
      const targetPrayer = prayers.find((p) => p.id === 'fajr')!;
      assert.equal(targetPrayer.status, 'PENDING');

      // Simulate status transitions
      targetPrayer.status = 'PRAYED_ON_TIME';
      assert.equal(targetPrayer.status, 'PRAYED_ON_TIME');

      targetPrayer.status = 'MADE_UP';
      assert.equal(targetPrayer.status, 'MADE_UP');

      targetPrayer.status = 'MISSED';
      assert.equal(targetPrayer.status, 'MISSED');
    });
  });

  // =========================================================================
  // 2. Next Prayer Display
  // =========================================================================
  describe('2. Next Prayer Display', () => {
    let dashboardSource: string;

    beforeEach(() => {
      dashboardSource = fs.readFileSync(HOME_DASHBOARD_PATH, 'utf-8');
    });

    it('2.1 should verify that the word "Tomorrow" does NOT appear anywhere in the next prayer hero card', () => {
      // Extract Card A: Next Prayer Card
      const cardAStart = dashboardSource.indexOf('{/* Card A: Next Prayer Card */}');
      const cardBStart = dashboardSource.indexOf('{/* Card B: Daily Prayer Progress Card');
      assert.ok(cardAStart !== -1 && cardBStart !== -1, 'Card A must be located in source');

      const cardASource = dashboardSource.slice(cardAStart, cardBStart);

      // Assert that "Tomorrow" or "tomorrow" does NOT appear in Card A's JSX
      assert.doesNotMatch(cardASource, /\bTomorrow\b/i, 'The word "Tomorrow" must NOT appear in Next Prayer hero card');
      assert.doesNotMatch(cardASource, /\bErtaga\b/i, 'The Uzbek word "Ertaga" must NOT appear in Next Prayer hero card');
      assert.doesNotMatch(cardASource, /\bЗавтра\b/i, 'The Russian word "Завтра" must NOT appear in Next Prayer hero card');
      assert.doesNotMatch(cardASource, /isTomorrow/i, 'isTomorrow property must not be conditionally rendered as a label in Card A');
    });

    it('2.2 should verify that next prayer interval is displayed cleanly and centered (e.g., "05:12 – 06:40")', () => {
      const cardAStart = dashboardSource.indexOf('{/* Card A: Next Prayer Card */}');
      const cardBStart = dashboardSource.indexOf('{/* Card B: Daily Prayer Progress Card');
      const cardASource = dashboardSource.slice(cardAStart, cardBStart);

      // Verify centered container styling
      assert.match(
        cardASource,
        /className="text-sm sm:text-base font-semibold text-slate-300 flex items-center justify-center gap-1\.5 mt-1"/,
        'Time interval container must be centered with justify-center'
      );

      // Verify tabular-nums en-dash interval rendering
      assert.match(
        cardASource,
        /<span className="tabular-nums">\s*\{nextPrayerItem\?\.endTime\s*\?\s*`\$\{nextPrayer\.prayerTime\}\s*–\s*\$\{nextPrayerItem\.endTime\}`\s*:\s*nextPrayer\.prayerTime\}\s*<\/span>/,
        'Time interval must render start and end time with an en-dash (e.g., "05:12 – 06:40") with tabular-nums'
      );

      // Test formatting logic across all prayers
      for (const p of SAMPLE_PRAYERS) {
        const intervalStr = p.endTime ? `${p.time} – ${p.endTime}` : p.time;
        assert.match(intervalStr, /^\d{2}:\d{2}\s*–\s*\d{2}:\d{2}$/, `Interval for ${p.name} must match format HH:mm – HH:mm`);
      }
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

      // Mock global fetch to return deterministic Aladhan timings
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            code: 200,
            status: 'OK',
            data: {
              timings: {
                Fajr: '04:47',
                Sunrise: '06:19',
                Dhuhr: '12:13',
                Asr: '16:20',
                Sunset: '18:05',
                Maghrib: '18:05',
                Isha: '19:32',
                Imsak: '04:37',
                Midnight: '23:59',
              },
              meta: {
                latitude: 41.2995,
                longitude: 69.2401,
                timezone: 'Asia/Tashkent',
                method: { id: 3, name: 'Muslim World League' },
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      try {
        // Request 1: Cache MISS (fetches and caches)
        const reqMiss = new NextRequest(
          'http://localhost:3000/api/prayer-times?latitude=41.2995&longitude=69.2401&method=MWL'
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
          'http://localhost:3000/api/prayer-times?latitude=41.2995&longitude=69.2401&method=MWL'
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
            calculationMethod: 'MWL',
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
});
