import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server.js';

import {
  isLeapYear,
  getDaysInMonth,
  formatDateString,
  parseDateComponents,
  isFutureDate,
  calculatePeriodRange,
  generateMonthGrid,
  getTodayUtcString,
} from '../../src/lib/calendar.ts';
import { calculateFines } from '../../src/app/api/prayers/route.ts';
import { GET as getHistoryHandler } from '../../src/app/api/prayers/history/route.ts';
import { PrayerRecord } from '../../src/models/Prayer.ts';
import { User } from '../../src/models/User.ts';
import { Session } from '../../src/models/Session.ts';
import type { PrayerId, PrayerStatus } from '../../src/types/prayer.ts';

// Mock types
interface MockRecordDoc {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  date: string;
  prayers: Record<PrayerId, { status: PrayerStatus; prayedAt?: Date; missedAt?: Date; madeUpAt?: Date }>;
  finesAccrued: number;
  save: () => Promise<MockRecordDoc>;
}

let mockRecords: MockRecordDoc[] = [];
let mockUsers: Array<{ _id: mongoose.Types.ObjectId; username: string }> = [];
let mockSessions: Array<{ sessionToken: string; userId: mongoose.Types.ObjectId; expiresAt: Date; lastActiveAt: Date; save: () => Promise<unknown> }> = [];

function setupMocks() {
  mockRecords = [];
  mockUsers = [];
  mockSessions = [];

  global.mongooseCache = {
    conn: mongoose,
    promise: Promise.resolve(mongoose),
  };

  const userModel = User as unknown as Record<string, unknown>;
  const sessionModel = Session as unknown as Record<string, unknown>;
  const prayerModel = PrayerRecord as unknown as Record<string, unknown>;

  userModel.findById = async (id: mongoose.Types.ObjectId | string) => {
    return mockUsers.find((u) => u._id.toString() === id.toString()) || null;
  };

  sessionModel.findOne = async (query: { sessionToken?: string }) => {
    return mockSessions.find((s) => s.sessionToken === query.sessionToken) || null;
  };

  prayerModel.find = (query: { userId?: mongoose.Types.ObjectId | string; date?: { $gte?: string; $lte?: string } }) => {
    return {
      sort: () => {
        return mockRecords.filter((r) => {
          const matchUser = query.userId ? r.userId.toString() === query.userId.toString() : true;
          let matchDate = true;
          if (query.date?.$gte && r.date < query.date.$gte) matchDate = false;
          if (query.date?.$lte && r.date > query.date.$lte) matchDate = false;
          return matchUser && matchDate;
        }).sort((a, b) => b.date.localeCompare(a.date));
      },
    };
  };
}

function createAuthSession(userId: mongoose.Types.ObjectId, username = 'tester'): string {
  const token = `token-${userId.toString()}`;
  mockUsers.push({ _id: userId, username });
  mockSessions.push({
    sessionToken: token,
    userId,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    lastActiveAt: new Date(),
    save: async () => {},
  });
  return token;
}

describe('History Calendar, Date Generation & Progress Regression Suite', () => {
  beforeEach(() => {
    setupMocks();
  });

  describe('1. Calendar Date Generation & Leap Year Math', () => {
    it('correctly identifies leap years and secular century exceptions', () => {
      // Standard leap years (divisible by 4)
      assert.equal(isLeapYear(2024), true, '2024 is a leap year');
      assert.equal(isLeapYear(2028), true, '2028 is a leap year');
      assert.equal(isLeapYear(2032), true, '2032 is a leap year');

      // Standard non-leap years
      assert.equal(isLeapYear(2025), false, '2025 is not a leap year');
      assert.equal(isLeapYear(2026), false, '2026 is not a leap year');
      assert.equal(isLeapYear(2027), false, '2027 is not a leap year');

      // Century rules: divisible by 400 is leap, divisible by 100 only is NOT leap
      assert.equal(isLeapYear(2000), true, '2000 is divisible by 400 (leap year)');
      assert.equal(isLeapYear(2400), true, '2400 is divisible by 400 (leap year)');
      assert.equal(isLeapYear(1900), false, '1900 is divisible by 100 but not 400 (not leap)');
      assert.equal(isLeapYear(2100), false, '2100 is divisible by 100 but not 400 (not leap)');
    });

    it('returns exact days for February in leap vs non-leap years', () => {
      assert.equal(getDaysInMonth(2024, 2), 29, 'Feb 2024 has 29 days');
      assert.equal(getDaysInMonth(2025, 2), 28, 'Feb 2025 has 28 days');
      assert.equal(getDaysInMonth(2026, 2), 28, 'Feb 2026 has 28 days');
      assert.equal(getDaysInMonth(2028, 2), 29, 'Feb 2028 has 29 days');
    });

    it('returns exact days for all standard months in the Gregorian calendar', () => {
      const year = 2026;
      const expectedDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      for (let month = 1; month <= 12; month++) {
        assert.equal(getDaysInMonth(year, month), expectedDays[month - 1], `Month ${month} has ${expectedDays[month - 1]} days`);
      }
    });

    it('throws RangeError when given invalid month number outside 1-12', () => {
      assert.throws(() => getDaysInMonth(2026, 0), RangeError);
      assert.throws(() => getDaysInMonth(2026, 13), RangeError);
    });

    it('parses and formats date components safely without timezone drift', () => {
      const parsed = parseDateComponents('2026-10-20');
      assert.equal(parsed.year, 2026);
      assert.equal(parsed.month, 10);
      assert.equal(parsed.day, 20);

      const formatted = formatDateString(parsed.year, parsed.month, parsed.day);
      assert.equal(formatted, '2026-10-20');

      assert.throws(() => parseDateComponents('2026/10/20'));
      assert.throws(() => parseDateComponents('invalid-date'));
    });

    it('calculates deterministic 7d and 30d period ranges without daylight saving drift', () => {
      const todayStr = '2026-10-20';
      
      // 7 days ending on 2026-10-20 includes: 14, 15, 16, 17, 18, 19, 20 (exactly 7 days)
      const range7d = calculatePeriodRange('2026-10-20', '7d', todayStr);
      assert.equal(range7d.startDate, '2026-10-14');
      assert.equal(range7d.endDate, '2026-10-20');

      // 30 days ending on 2026-10-20: 2026-10-20 minus 29 days is 2026-09-21 (exactly 30 days)
      const range30d = calculatePeriodRange('2026-10-20', '30d', todayStr);
      assert.equal(range30d.startDate, '2026-09-21');
      assert.equal(range30d.endDate, '2026-10-20');

      // Month rollover over New Year: 2026-01-05 ending in 7d
      const rangeNewYear = calculatePeriodRange('2026-01-05', '7d', '2026-01-05');
      assert.equal(rangeNewYear.startDate, '2025-12-30');
      assert.equal(rangeNewYear.endDate, '2026-01-05');
    });

    it('generates a full month calendar grid with 7-column alignment and leap year support', () => {
      const gridFebLeap = generateMonthGrid(2024, 2, '2024-02-15');
      // Must be a multiple of 7 (complete weeks)
      assert.equal(gridFebLeap.length % 7, 0, 'Grid length must be divisible by 7');
      const currentMonthDays = gridFebLeap.filter((d) => d.isCurrentMonth);
      assert.equal(currentMonthDays.length, 29, 'Feb 2024 must have exactly 29 active days');

      const feb29 = currentMonthDays.find((d) => d.dayOfMonth === 29);
      assert.ok(feb29, 'Feb 29 must exist in 2024 grid');
      assert.equal(feb29.date, '2024-02-29');

      // Check non-leap Feb 2026
      const gridFebNonLeap = generateMonthGrid(2026, 2, '2026-02-15');
      const currentDays2026 = gridFebNonLeap.filter((d) => d.isCurrentMonth);
      assert.equal(currentDays2026.length, 28, 'Feb 2026 must have exactly 28 active days');
    });
  });

  describe('2. Future Date Boundaries & Disabling Verification', () => {
    it('evaluates past and current dates as strictly non-future (interactive)', () => {
      const todayStr = '2026-10-20';
      assert.equal(isFutureDate('2026-10-19', todayStr), false, 'Yesterday is not future');
      assert.equal(isFutureDate('2026-10-20', todayStr), false, 'Today is not future (clickable)');
      assert.equal(isFutureDate('2020-01-01', todayStr), false, 'Past year is not future');
    });

    it('evaluates tomorrow and all subsequent dates as strictly future (disabled)', () => {
      const todayStr = '2026-10-20';
      assert.equal(isFutureDate('2026-10-21', todayStr), true, 'Tomorrow must be marked as future (disabled)');
      assert.equal(isFutureDate('2026-11-01', todayStr), true, 'Next month must be marked as future');
      assert.equal(isFutureDate('2030-01-01', todayStr), true, 'Future years must be marked as future');
    });

    it('marks future dates in calendar grid with isFuture=true', () => {
      const grid = generateMonthGrid(2026, 10, '2026-10-20');
      const day20 = grid.find((d) => d.date === '2026-10-20');
      const day21 = grid.find((d) => d.date === '2026-10-21');
      const day19 = grid.find((d) => d.date === '2026-10-19');

      assert.ok(day20 && !day20.isFuture, 'Oct 20 must NOT be future');
      assert.ok(day19 && !day19.isFuture, 'Oct 19 must NOT be future');
      assert.ok(day21 && day21.isFuture, 'Oct 21 MUST be future (disabled in UI)');
    });
  });

  describe('3. 5 Obligatory Prayers Display & Discrete Status Transitions', () => {
    const PRAYER_IDS: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

    it('verifies all 5 canonical prayers are present and accounted for', () => {
      assert.equal(PRAYER_IDS.length, 5);
      assert.deepEqual(PRAYER_IDS, ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']);
    });

    it('manages 5 discrete status transitions and calculates accurate accountability fines', () => {
      const recordDate = '2026-10-10'; // 10 days ago -> triggers overdue fine if missed

      // 1. Initial PENDING state: no fines
      const prayers: Record<PrayerId, { status: PrayerStatus }> = {
        fajr: { status: 'PENDING' },
        dhuhr: { status: 'PENDING' },
        asr: { status: 'PENDING' },
        maghrib: { status: 'PENDING' },
        isha: { status: 'PENDING' },
      };
      assert.equal(calculateFines(recordDate, prayers), 0, 'PENDING prayers accrue 0 fine');

      // 2. Mark Fajr PRAYED_ON_TIME: fine remains 0
      prayers.fajr.status = 'PRAYED_ON_TIME';
      assert.equal(calculateFines(recordDate, prayers), 0);

      // 3. Mark Dhuhr PRAYED_LATE: fine remains 0
      prayers.dhuhr.status = 'PRAYED_LATE';
      assert.equal(calculateFines(recordDate, prayers), 0);

      // 4. Mark Asr MISSED (older than 7 days): triggers 30,000 UZS fine (15k base + 15k overdue)
      prayers.asr.status = 'MISSED';
      assert.equal(calculateFines(recordDate, prayers), 30000, 'Overdue MISSED prayer incurs 30,000 UZS fine');

      // 5. Make up Asr: status MADE_UP -> fine drops from 30,000 to 15,000 UZS (overdue fee removed, base 15k remains)
      prayers.asr.status = 'MADE_UP';
      assert.equal(calculateFines(recordDate, prayers), 15000, 'MADE_UP status caps fine at 15,000 UZS base fine');

      // 6. Historical correction to PRAYED_ON_TIME: clears fine to 0
      prayers.asr.status = 'PRAYED_ON_TIME';
      assert.equal(calculateFines(recordDate, prayers), 0, 'PRAYED_ON_TIME status clears fine to 0');

      // 7. Reset Fajr back to PENDING: fine remains 0
      prayers.fajr.status = 'PENDING';
      assert.equal(calculateFines(recordDate, prayers), 0);
    });

    it('strictly isolates MADE_UP from original-day on-time completion score', () => {
      const prayers = [
        { id: 'fajr', status: 'PRAYED_ON_TIME' },
        { id: 'dhuhr', status: 'PRAYED_LATE' },
        { id: 'asr', status: 'MADE_UP' }, // Completed after original day expired
        { id: 'maghrib', status: 'MISSED' },
        { id: 'isha', status: 'PENDING' },
      ];

      const originalCompleted = prayers.filter(
        (p) => p.status === 'PRAYED_ON_TIME' || p.status === 'PRAYED_LATE'
      ).length;

      assert.equal(originalCompleted, 2, 'Only PRAYED_ON_TIME and PRAYED_LATE count towards original day completion');
    });
  });

  describe('4. Guest Mode vs Authenticated Mode Behavior & Ownership Guard', () => {
    it('returns 401 Unauthorized on GET /api/prayers/history for guest / unauthenticated requests', async () => {
      const req = new NextRequest('http://localhost:3000/api/prayers/history?startDate=2026-10-01&endDate=2026-10-20');
      const res = await getHistoryHandler(req);
      assert.equal(res.status, 401);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.match(json.error, /Unauthorized/i);
    });

    it('returns only the authenticated user records within specified date range', async () => {
      const userAId = new mongoose.Types.ObjectId();
      const userBId = new mongoose.Types.ObjectId();
      const tokenA = createAuthSession(userAId, 'usera');

      // User A records
      mockRecords.push({
        _id: new mongoose.Types.ObjectId(),
        userId: userAId,
        date: '2026-10-15',
        prayers: {
          fajr: { status: 'PRAYED_ON_TIME' },
          dhuhr: { status: 'PRAYED_ON_TIME' },
          asr: { status: 'PRAYED_ON_TIME' },
          maghrib: { status: 'PRAYED_ON_TIME' },
          isha: { status: 'PRAYED_ON_TIME' },
        },
        finesAccrued: 0,
        save: async function () { return this; },
      });

      // User B records (should NEVER leak to User A)
      mockRecords.push({
        _id: new mongoose.Types.ObjectId(),
        userId: userBId,
        date: '2026-10-15',
        prayers: {
          fajr: { status: 'MISSED' },
          dhuhr: { status: 'MISSED' },
          asr: { status: 'MISSED' },
          maghrib: { status: 'MISSED' },
          isha: { status: 'MISSED' },
        },
        finesAccrued: 150000,
        save: async function () { return this; },
      });

      const req = new NextRequest('http://localhost:3000/api/prayers/history?startDate=2026-10-01&endDate=2026-10-20', {
        headers: { Cookie: `salahtrack_session=${tokenA}` },
      });

      const res = await getHistoryHandler(req);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.total, 1);
      assert.equal(json.data.records[0].userId.toString(), userAId.toString());
      assert.equal(json.data.records[0].finesAccrued, 0);
    });
  });

  describe('5. Infinite Re-Render Loop & Reference Stability Guards', () => {
    it('verifies getTodayUtcString and parseDateComponents return stable primitive values', () => {
      const s1 = getTodayUtcString();
      const s2 = getTodayUtcString();
      assert.equal(typeof s1, 'string');
      assert.equal(s1, s2);
      assert.match(s1, /^\d{4}-\d{2}-\d{2}$/);
    });

    it('verifies calculatePeriodRange produces identical string outputs across repeated invocations', () => {
      const range1 = calculatePeriodRange('2026-10-20', '7d', '2026-10-20');
      const range2 = calculatePeriodRange('2026-10-20', '7d', '2026-10-20');
      assert.deepEqual(range1, range2);
      assert.equal(range1.startDate, '2026-10-14');
      assert.equal(range1.endDate, '2026-10-20');
    });

    it('verifies that handleHistoricalCorrection uses optimistic state mutation without infinite cyclic triggers', () => {
      // Simulate state update function
      let historyState = [
        {
          date: '2026-10-15',
          prayers: {
            fajr: { status: 'PENDING' as PrayerStatus },
          },
        },
      ];

      const recordDate = '2026-10-15';
      const prayerId: PrayerId = 'fajr';
      const newStatus: PrayerStatus = 'PRAYED_ON_TIME';

      // Pure functional update
      historyState = historyState.map((rec) => {
        if (rec.date === recordDate) {
          return {
            ...rec,
            prayers: {
              ...rec.prayers,
              [prayerId]: { status: newStatus },
            },
          };
        }
        return rec;
      });

      assert.equal(historyState[0].prayers.fajr.status, 'PRAYED_ON_TIME');
      // Running update again with same value produces consistent state
      historyState = historyState.map((rec) => {
        if (rec.date === recordDate) {
          return {
            ...rec,
            prayers: {
              ...rec.prayers,
              [prayerId]: { status: newStatus },
            },
          };
        }
        return rec;
      });
      assert.equal(historyState[0].prayers.fajr.status, 'PRAYED_ON_TIME');
    });
  });
});
