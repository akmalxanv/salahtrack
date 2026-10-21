import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server.js';

import {
  getYesterdayString,
  getDaysDifference,
  evaluateRolloverStreak,
  calculateStreakTransition,
  calculateStreakFromHistory,
  validateStreakData,
} from '../../src/lib/streak.ts';
import { DEFAULT_STREAK, type StreakData, type PrayerId, type PrayerStatus } from '../../src/types/prayer.ts';
import { GET as getStatsHandler } from '../../src/app/api/stats/route.ts';
import { PrayerRecord } from '../../src/models/Prayer.ts';
import { QazaPayment } from '../../src/models/QazaPayment.ts';
import { User } from '../../src/models/User.ts';
import { Session } from '../../src/models/Session.ts';

describe('Deterministic Prayer Streak Engine', () => {
  describe('1. Date Arithmetic Helpers (UTC Safe)', () => {
    it('calculates the exact previous calendar day', () => {
      assert.equal(getYesterdayString('2026-10-11'), '2026-10-10');
      assert.equal(getYesterdayString('2026-10-01'), '2026-09-30');
      assert.equal(getYesterdayString('2026-03-01'), '2026-02-28');
      assert.equal(getYesterdayString('2026-01-01'), '2025-12-31');
    });

    it('calculates calendar day differences accurately without timezone drift', () => {
      assert.equal(getDaysDifference('2026-10-10', '2026-10-10'), 0);
      assert.equal(getDaysDifference('2026-10-10', '2026-10-11'), 1);
      assert.equal(getDaysDifference('2026-10-09', '2026-10-11'), 2);
      assert.equal(getDaysDifference('2026-10-11', '2026-10-08'), -3);
    });
  });

  describe('2. calculateStreakTransition', () => {
    it('starts a new streak (0 -> 1 on first prayer)', () => {
      const initial: StreakData = { ...DEFAULT_STREAK };
      const actionDate = '2026-10-11';
      const result = calculateStreakTransition(initial, actionDate, true);

      assert.deepEqual(result, {
        current: 1,
        best: 1,
        lastActiveDate: '2026-10-11',
      });
    });

    it('maintains streak on same day (additional prayers do not increment current streak)', () => {
      const existing: StreakData = {
        current: 1,
        best: 1,
        lastActiveDate: '2026-10-11',
      };
      // User logs Dhuhr after already logging Fajr on the same day
      const result = calculateStreakTransition(existing, '2026-10-11', true);

      assert.deepEqual(result, {
        current: 1,
        best: 1,
        lastActiveDate: '2026-10-11',
      });
    });

    it('increments streak on consecutive day (yesterday -> today: 1 -> 2)', () => {
      const existing: StreakData = {
        current: 1,
        best: 1,
        lastActiveDate: '2026-10-10',
      };
      // User logs prayer on consecutive day
      const result = calculateStreakTransition(existing, '2026-10-11', true);

      assert.deepEqual(result, {
        current: 2,
        best: 2,
        lastActiveDate: '2026-10-11',
      });
    });

    it('continues multi-day consecutive streak (N -> N + 1)', () => {
      const existing: StreakData = {
        current: 9,
        best: 15,
        lastActiveDate: '2026-10-10',
      };
      const result = calculateStreakTransition(existing, '2026-10-11', true);

      assert.deepEqual(result, {
        current: 10,
        best: 15,
        lastActiveDate: '2026-10-11',
      });
    });

    it('breaks streak when a full calendar day is skipped (>1 day difference)', () => {
      // Last active date was 2 days ago (2026-10-09), skipping 2026-10-10 entirely
      const existing: StreakData = {
        current: 5,
        best: 12,
        lastActiveDate: '2026-10-09',
      };
      const result = calculateStreakTransition(existing, '2026-10-11', true);

      // Streak resets to 1 for today's new action, best remains 12
      assert.deepEqual(result, {
        current: 1,
        best: 12,
        lastActiveDate: '2026-10-11',
      });
    });

    it('accurately updates best streak when current exceeds previous best', () => {
      const existing: StreakData = {
        current: 5,
        best: 5,
        lastActiveDate: '2026-10-10',
      };
      const result = calculateStreakTransition(existing, '2026-10-11', true);

      assert.deepEqual(result, {
        current: 6,
        best: 6,
        lastActiveDate: '2026-10-11',
      });
    });

    it('handles uncompleting prayer on last active date', () => {
      // When current was 1 and becomes 0
      const singleDay: StreakData = {
        current: 1,
        best: 5,
        lastActiveDate: '2026-10-11',
      };
      const uncompleteSingle = calculateStreakTransition(singleDay, '2026-10-11', false);
      assert.deepEqual(uncompleteSingle, {
        current: 0,
        best: 5,
        lastActiveDate: '',
      });

      // When current was 3 and prayer on today is revoked, reverts to yesterday
      const multiDay: StreakData = {
        current: 3,
        best: 5,
        lastActiveDate: '2026-10-11',
      };
      const uncompleteMulti = calculateStreakTransition(multiDay, '2026-10-11', false);
      assert.deepEqual(uncompleteMulti, {
        current: 2,
        best: 5,
        lastActiveDate: '2026-10-10',
      });
    });
  });

  describe('3. evaluateRolloverStreak', () => {
    it('preserves active streak while today is pending (lastActiveDate is yesterday)', () => {
      const streak: StreakData = {
        current: 4,
        best: 10,
        lastActiveDate: '2026-10-10',
      };
      const todayStr = '2026-10-11';
      const result = evaluateRolloverStreak(streak, todayStr);

      assert.deepEqual(result, {
        current: 4,
        best: 10,
        lastActiveDate: '2026-10-10',
      });
    });

    it('preserves active streak when prayer was already logged today', () => {
      const streak: StreakData = {
        current: 5,
        best: 10,
        lastActiveDate: '2026-10-11',
      };
      const result = evaluateRolloverStreak(streak, '2026-10-11');

      assert.deepEqual(result, {
        current: 5,
        best: 10,
        lastActiveDate: '2026-10-11',
      });
    });

    it('resets current streak to 0 while preserving best when full calendar day skipped', () => {
      // Last active date was 2026-10-09, today is 2026-10-11 (skipped 2026-10-10)
      const streak: StreakData = {
        current: 7,
        best: 14,
        lastActiveDate: '2026-10-09',
      };
      const result = evaluateRolloverStreak(streak, '2026-10-11');

      assert.deepEqual(result, {
        current: 0,
        best: 14,
        lastActiveDate: '2026-10-09',
      });
    });

    it('handles empty or zero streak gracefully', () => {
      const result = evaluateRolloverStreak(DEFAULT_STREAK, '2026-10-11');
      assert.deepEqual(result, {
        current: 0,
        best: 0,
        lastActiveDate: '',
      });
    });
  });

  describe('4. calculateStreakFromHistory', () => {
    it('returns DEFAULT_STREAK for empty history', () => {
      const recordMap = new Map<string, number>();
      const result = calculateStreakFromHistory(recordMap, '2026-10-11');

      assert.deepEqual(result, DEFAULT_STREAK);
    });

    it('calculates single active day streak when today is completed', () => {
      const recordMap = new Map<string, number>([
        ['2026-10-11', 5],
      ]);
      const result = calculateStreakFromHistory(recordMap, '2026-10-11');

      assert.deepEqual(result, {
        current: 1,
        best: 1,
        lastActiveDate: '2026-10-11',
      });
    });

    it('preserves streak when today is pending and yesterday is completed', () => {
      const recordMap = new Map<string, number>([
        ['2026-10-09', 5],
        ['2026-10-10', 5],
        ['2026-10-11', 0], // Today: not completed yet
      ]);
      const result = calculateStreakFromHistory(recordMap, '2026-10-11');

      assert.deepEqual(result, {
        current: 2,
        best: 2,
        lastActiveDate: '2026-10-10',
      });
    });

    it('strictly requires all 5 prayers (count === 5) to qualify for a streak day', () => {
      const recordMap = new Map<string, number>([
        ['2026-10-10', 4], // yesterday had 4/5
        ['2026-10-11', 4], // today has 4/5
      ]);
      const result = calculateStreakFromHistory(recordMap, '2026-10-11');

      assert.deepEqual(result, {
        current: 0,
        best: 0,
        lastActiveDate: '',
      });
    });

    it('resets streak to 0 if yesterday had < 5 prayers even if older days had 5/5', () => {
      const recordMap = new Map<string, number>([
        ['2026-10-08', 5],
        ['2026-10-09', 5],
        ['2026-10-10', 4], // yesterday was incomplete (< 5)
        ['2026-10-11', 2], // today in progress (< 5)
      ]);
      const result = calculateStreakFromHistory(recordMap, '2026-10-11');

      assert.deepEqual(result, {
        current: 0,
        best: 2, // preserved best streak of 2 days (Oct 8-9)
        lastActiveDate: '2026-10-09',
      });
    });

    it('increments streak when today is also completed on consecutive sequence', () => {
      const recordMap = new Map<string, number>([
        ['2026-10-09', 5],
        ['2026-10-10', 5],
        ['2026-10-11', 5],
      ]);
      const result = calculateStreakFromHistory(recordMap, '2026-10-11');

      assert.deepEqual(result, {
        current: 3,
        best: 3,
        lastActiveDate: '2026-10-11',
      });
    });

    it('resets current to 0 when yesterday was missed, preserving best streak', () => {
      // 5-day streak in past, then 2026-10-10 missed, today 2026-10-11 pending
      const recordMap = new Map<string, number>([
        ['2026-10-05', 5],
        ['2026-10-06', 5],
        ['2026-10-07', 5],
        ['2026-10-08', 5],
        ['2026-10-09', 5],
        ['2026-10-10', 0], // missed yesterday
        ['2026-10-11', 0], // today pending
      ]);
      const result = calculateStreakFromHistory(recordMap, '2026-10-11');

      assert.deepEqual(result, {
        current: 0,
        best: 5,
        lastActiveDate: '2026-10-09',
      });
    });

    it('tracks all-time best streak across multiple historical streak cycles', () => {
      // First cycle: 4 days (2026-09-01 to 2026-09-04)
      // Gap: 2026-09-05 to 2026-09-19
      // Second cycle: 2 days (2026-09-20 to 2026-09-21)
      const recordMap = new Map<string, number>([
        ['2026-09-01', 5],
        ['2026-09-02', 5],
        ['2026-09-03', 5],
        ['2026-09-04', 5],
        ['2026-09-20', 5],
        ['2026-09-21', 5],
      ]);
      const result = calculateStreakFromHistory(recordMap, '2026-09-21');

      assert.deepEqual(result, {
        current: 2,
        best: 4,
        lastActiveDate: '2026-09-21',
      });
    });

    it('rejects partial days (1/5, 2/5, 3/5, 4/5) from streak qualification', () => {
      for (const count of [1, 2, 3, 4]) {
        const recordMap = new Map<string, number>([
          ['2026-10-10', count],
          ['2026-10-11', 0],
        ]);
        const result = calculateStreakFromHistory(recordMap, '2026-10-11');
        assert.equal(result.current, 0, `Count ${count}/5 must not count toward streak`);
        assert.equal(result.best, 0);
      }
    });

    it('increments streak across 10 consecutive qualifying 5/5 days', () => {
      const recordMap = new Map<string, number>();
      for (let i = 1; i <= 10; i++) {
        const d = `2026-10-${String(i).padStart(2, '0')}`;
        recordMap.set(d, 5);
      }
      const result = calculateStreakFromHistory(recordMap, '2026-10-10');
      assert.equal(result.current, 10);
      assert.equal(result.best, 10);
      assert.equal(result.lastActiveDate, '2026-10-10');
    });

    it('resets streak to 0 if an intervening finished day completed only 4/5 prayers', () => {
      // Days 1-5: 5/5, Day 6: 4/5 (missed 1), Days 7-8: 5/5
      const recordMap = new Map<string, number>([
        ['2026-10-01', 5],
        ['2026-10-02', 5],
        ['2026-10-03', 5],
        ['2026-10-04', 5],
        ['2026-10-05', 5],
        ['2026-10-06', 4], // Failed to complete 5/5
        ['2026-10-07', 5],
        ['2026-10-08', 5],
      ]);
      const result = calculateStreakFromHistory(recordMap, '2026-10-08');
      assert.equal(result.current, 2, 'Current streak should restart from day 7 (2 days)');
      assert.equal(result.best, 5, 'Best streak should retain the 5-day streak from days 1-5');
      assert.equal(result.lastActiveDate, '2026-10-08');
    });

    it('preserves yesterday streak when today is in progress with partial prayers (e.g. 3/5)', () => {
      const recordMap = new Map<string, number>([
        ['2026-10-08', 5],
        ['2026-10-09', 5],
        ['2026-10-10', 5], // yesterday finished with 5/5
        ['2026-10-11', 3], // today in progress (3/5 so far)
      ]);
      const result = calculateStreakFromHistory(recordMap, '2026-10-11');
      assert.equal(result.current, 3, 'Streak achieved through yesterday (3 days) must be preserved while today is ongoing');
      assert.equal(result.best, 3);
      assert.equal(result.lastActiveDate, '2026-10-10');
    });
  });

  describe('5. GET /api/stats Endpoint Streak Contract & Client ?today= Support', () => {
    interface MockRecordDoc {
      _id: mongoose.Types.ObjectId;
      userId: mongoose.Types.ObjectId;
      date: string;
      prayers: Record<PrayerId, { status: PrayerStatus }>;
    }

    let mockRecords: MockRecordDoc[] = [];
    let mockUsers: Array<{ _id: mongoose.Types.ObjectId; username: string }> = [];
    let mockSessions: Array<{ sessionToken: string; userId: mongoose.Types.ObjectId; expiresAt: Date; lastActiveAt: Date; save: () => Promise<unknown> }> = [];

    const testUserId = new mongoose.Types.ObjectId();
    const validSessionToken = 'test-streak-session-token-12345';

    beforeEach(() => {
      mockRecords = [];
      mockUsers = [{ _id: testUserId, username: 'streakuser' }];
      mockSessions = [{
        sessionToken: validSessionToken,
        userId: testUserId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        lastActiveAt: new Date(),
        save: async () => true,
      }];

      global.mongooseCache = {
        conn: mongoose,
        promise: Promise.resolve(mongoose),
      };

      const userModel = User as unknown as Record<string, unknown>;
      const sessionModel = Session as unknown as Record<string, unknown>;
      const prayerModel = PrayerRecord as unknown as Record<string, unknown>;
      const qazaPaymentModel = QazaPayment as unknown as Record<string, unknown>;

      qazaPaymentModel.find = async () => [];

      userModel.findById = async (id: mongoose.Types.ObjectId | string) => {
        return mockUsers.find((u) => u._id.toString() === id.toString()) || null;
      };

      sessionModel.findOne = async (query: { sessionToken?: string }) => {
        return mockSessions.find((s) => s.sessionToken === query.sessionToken) || null;
      };

      prayerModel.find = (query: { userId?: mongoose.Types.ObjectId; date?: { $gte?: string; $lte?: string } }) => {
        const chain = {
          sort: () => {
            return mockRecords.filter((r) => {
              if (query.userId && r.userId.toString() !== query.userId.toString()) return false;
              if (query.date?.$gte && r.date < query.date.$gte) return false;
              if (query.date?.$lte && r.date > query.date.$lte) return false;
              return true;
            });
          },
        };
        return chain as unknown as Promise<MockRecordDoc[]>;
      };
    });

    it('returns streaks with current, best, and lastActiveDate using client ?today= param', async () => {
      // Setup consecutive prayer records for test user
      const createPrayers = (status: PrayerStatus) => ({
        fajr: { status },
        dhuhr: { status },
        asr: { status },
        maghrib: { status },
        isha: { status },
      });

      mockRecords.push({
        _id: new mongoose.Types.ObjectId(),
        userId: testUserId,
        date: '2026-10-09',
        prayers: createPrayers('PRAYED_ON_TIME'),
      });
      mockRecords.push({
        _id: new mongoose.Types.ObjectId(),
        userId: testUserId,
        date: '2026-10-10',
        prayers: createPrayers('PRAYED_LATE'),
      });

      // Client queries stats on 2026-10-11 (today has 0 prayers yet, yesterday has completed prayers)
      const req = new NextRequest('http://localhost:3000/api/stats?today=2026-10-11', {
        headers: {
          cookie: `salahtrack_session=${validSessionToken}`,
        },
      });

      const res = await getStatsHandler(req);
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.streaks.current, 2);
      assert.equal(json.data.streaks.best, 2);
      assert.equal(json.data.streaks.lastActiveDate, '2026-10-10');
    });

    it('increments streak when client query includes prayer on ?today=', async () => {
      const createPrayers = (status: PrayerStatus) => ({
        fajr: { status },
        dhuhr: { status },
        asr: { status },
        maghrib: { status },
        isha: { status },
      });

      mockRecords.push({
        _id: new mongoose.Types.ObjectId(),
        userId: testUserId,
        date: '2026-10-10',
        prayers: createPrayers('PRAYED_ON_TIME'),
      });
      mockRecords.push({
        _id: new mongoose.Types.ObjectId(),
        userId: testUserId,
        date: '2026-10-11',
        prayers: createPrayers('PRAYED_ON_TIME'),
      });

      const req = new NextRequest('http://localhost:3000/api/stats?today=2026-10-11', {
        headers: {
          cookie: `salahtrack_session=${validSessionToken}`,
        },
      });

      const res = await getStatsHandler(req);
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.streaks.current, 2);
      assert.equal(json.data.streaks.best, 2);
      assert.equal(json.data.streaks.lastActiveDate, '2026-10-11');
    });

    it('rejects unauthenticated requests to GET /api/stats with 401 Unauthorized', async () => {
      const req = new NextRequest('http://localhost:3000/api/stats');
      const res = await getStatsHandler(req);
      assert.equal(res.status, 401);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.match(json.error, /Unauthorized/i);
    });

    it('enforces strict BOLA / IDOR scoping: user only sees their own records in stats and streak', async () => {
      const otherUserId = new mongoose.Types.ObjectId();
      const createPrayers = (status: PrayerStatus) => ({
        fajr: { status },
        dhuhr: { status },
        asr: { status },
        maghrib: { status },
        isha: { status },
      });

      // User A (testUserId) has 1 record
      mockRecords.push({
        _id: new mongoose.Types.ObjectId(),
        userId: testUserId,
        date: '2026-10-11',
        prayers: createPrayers('PRAYED_ON_TIME'),
      });

      // User B (otherUserId) has 10 records
      for (let i = 1; i <= 10; i++) {
        const d = `2026-10-${String(i).padStart(2, '0')}`;
        mockRecords.push({
          _id: new mongoose.Types.ObjectId(),
          userId: otherUserId,
          date: d,
          prayers: createPrayers('PRAYED_ON_TIME'),
        });
      }

      const req = new NextRequest('http://localhost:3000/api/stats?today=2026-10-11', {
        headers: {
          cookie: `salahtrack_session=${validSessionToken}`,
        },
      });

      const res = await getStatsHandler(req);
      assert.equal(res.status, 200);
      const json = await res.json();

      // Test user should ONLY have streak of 1, completely isolated from User B's 10-day streak
      assert.equal(json.data.streaks.current, 1);
      assert.equal(json.data.streaks.best, 1);
      assert.equal(json.data.today.completed, 5);
    });

    it('safely handles malformed and tampering payloads on ?today= query param', async () => {
      const createPrayers = (status: PrayerStatus) => ({
        fajr: { status },
        dhuhr: { status },
        asr: { status },
        maghrib: { status },
        isha: { status },
      });

      mockRecords.push({
        _id: new mongoose.Types.ObjectId(),
        userId: testUserId,
        date: new Date().toISOString().split('T')[0],
        prayers: createPrayers('PRAYED_ON_TIME'),
      });

      // Test cases for malformed or injected ?today=
      const malformedParams = [
        'invalid-date',
        '2026-99-99',
        '2026-02-31',
        '9999-99-99',
        '2099-01-01', // future date beyond timezone boundary
        '{"$gt":""}',
        '2026-10-11;DROP TABLE',
      ];

      for (const badParam of malformedParams) {
        const req = new NextRequest(`http://localhost:3000/api/stats?today=${encodeURIComponent(badParam)}`, {
          headers: {
            cookie: `salahtrack_session=${validSessionToken}`,
          },
        });

        const res = await getStatsHandler(req);
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.success, true);
        // Does not throw 500 and returns valid stats schema
        assert.equal(typeof json.data.streaks.current, 'number');
        assert.equal(typeof json.data.streaks.best, 'number');
      }
    });
  });

  describe('6. Streak Cookie Parsing & Initial SSR State Safe Deserialization', () => {
    it('safely parses URL-encoded JSON streak cookie into StreakData', () => {
      const sampleStreak: StreakData = {
        current: 5,
        best: 14,
        lastActiveDate: '2026-10-10',
      };
      const cookieValue = encodeURIComponent(JSON.stringify(sampleStreak));

      let parsedStreak: StreakData | null = null;
      try {
        parsedStreak = validateStreakData(JSON.parse(decodeURIComponent(cookieValue)));
      } catch {
        parsedStreak = null;
      }

      assert.deepEqual(parsedStreak, sampleStreak);
    });

    it('falls back to null on malformed or corrupted cookie string', () => {
      const corruptCookieValue = 'invalid%20json%7B%7D';
      let parsedStreak: StreakData | null = null;
      try {
        parsedStreak = validateStreakData(JSON.parse(decodeURIComponent(corruptCookieValue)));
      } catch {
        parsedStreak = null;
      }

      assert.equal(parsedStreak, null);
    });

    it('initializes with DEFAULT_STREAK when initialStreak is null or missing', () => {
      const initialStreak: StreakData | null = null;
      const effectiveStreak = initialStreak || DEFAULT_STREAK;

      assert.deepEqual(effectiveStreak, {
        current: 0,
        best: 0,
        lastActiveDate: '',
      });
    });

    it('validateStreakData rejects non-objects, arrays, and primitives', () => {
      assert.equal(validateStreakData(null), null);
      assert.equal(validateStreakData(undefined), null);
      assert.equal(validateStreakData(12345), null);
      assert.equal(validateStreakData('{"current": 5}'), null);
      assert.equal(validateStreakData(true), null);
      assert.equal(validateStreakData([]), null);
      assert.equal(validateStreakData([{ current: 5, best: 5, lastActiveDate: '2026-10-11' }]), null);
    });

    it('validateStreakData rejects negative, NaN, Infinity, and non-numeric values', () => {
      assert.equal(validateStreakData({ current: -1, best: 5, lastActiveDate: '2026-10-11' }), null);
      assert.equal(validateStreakData({ current: NaN, best: 5, lastActiveDate: '2026-10-11' }), null);
      assert.equal(validateStreakData({ current: Infinity, best: 5, lastActiveDate: '2026-10-11' }), null);
      assert.equal(validateStreakData({ current: '5', best: 5, lastActiveDate: '2026-10-11' }), null);
      assert.equal(validateStreakData({ current: 5, best: -5, lastActiveDate: '2026-10-11' }), null);
      assert.equal(validateStreakData({}), null);
    });

    it('validateStreakData validates date format and enforces best >= current', () => {
      // Malformed date strings
      assert.equal(validateStreakData({ current: 1, best: 1, lastActiveDate: 'invalid' }), null);
      assert.equal(validateStreakData({ current: 1, best: 1, lastActiveDate: '<script>' }), null);

      // Valid empty date string
      const emptyDate = validateStreakData({ current: 0, best: 0, lastActiveDate: '' });
      assert.deepEqual(emptyDate, { current: 0, best: 0, lastActiveDate: '' });

      // Enforces best is at least current
      const rectified = validateStreakData({ current: 10, best: 5, lastActiveDate: '2026-10-11' });
      assert.deepEqual(rectified, { current: 10, best: 10, lastActiveDate: '2026-10-11' });
    });
  });
});
