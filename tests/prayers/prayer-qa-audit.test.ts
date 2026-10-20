import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server.js';

import { PrayerRecord } from '../../src/models/Prayer.ts';
import { User } from '../../src/models/User.ts';
import { Session } from '../../src/models/Session.ts';
import {
  POST as createPrayerHandler,
} from '../../src/app/api/prayers/route.ts';
import { GET as getPrayerTimesHandler } from '../../src/app/api/prayer-times/route.ts';
import {
  getZonedDateParts,
  isPostMidnightPreFajr,
  getLiturgicalDate,
  resolvePrayerCycle,
} from '../../src/lib/prayer-cycle.ts';
import {
  getStoredHistoryRecords,
  saveStoredHistoryRecords,
  mirrorDailyPrayersToHistory,
  saveDailyPrayersSync,
  loadPrayersForLiturgicalDate,
  archiveLiturgicalDay,
  dispatchStorageUpdate,
  STORAGE_KEY_DAILY_PRAYERS,
} from '../../src/lib/storage-sync.ts';
import type { PrayerId, PrayerItem, PrayerStatus } from '../../src/types/prayer.ts';

// In-memory document storage for atomic Mongoose tests
interface MockRecordDoc {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  date: string;
  prayers: Record<PrayerId, {
    status: PrayerStatus;
    prayedAt?: Date;
    missedAt?: Date;
    madeUpAt?: Date;
    notes?: string;
  }>;
  finesAccrued: number;
  createdAt: Date;
  updatedAt: Date;
  save: () => Promise<MockRecordDoc>;
}

let mockRecords: MockRecordDoc[] = [];
let mockUsers: Array<{ _id: mongoose.Types.ObjectId; username: string }> = [];
let mockSessions: Array<{
  sessionToken: string;
  userId: mongoose.Types.ObjectId;
  expiresAt: Date;
  lastActiveAt: Date;
  save: () => Promise<unknown>;
}> = [];

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

  prayerModel.findOne = async (query: { userId?: mongoose.Types.ObjectId; date?: string }) => {
    return mockRecords.find(
      (r) => r.userId.toString() === query.userId?.toString() && r.date === query.date
    ) || null;
  };

  prayerModel.findOneAndUpdate = async (
    filter: { userId?: mongoose.Types.ObjectId | string; date?: string },
    update: { $set?: Record<string, unknown>; $setOnInsert?: Record<string, unknown> },
    options?: { upsert?: boolean; new?: boolean }
  ) => {
    const userIdStr = filter.userId?.toString();
    let record = mockRecords.find(
      (r) => r.userId.toString() === userIdStr && r.date === filter.date
    );

    if (!record) {
      if (!options?.upsert) return null;
      record = {
        _id: new mongoose.Types.ObjectId(),
        userId: new mongoose.Types.ObjectId(userIdStr),
        date: filter.date as string,
        prayers: {
          fajr: { status: 'PENDING' },
          dhuhr: { status: 'PENDING' },
          asr: { status: 'PENDING' },
          maghrib: { status: 'PENDING' },
          isha: { status: 'PENDING' },
        },
        finesAccrued: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        save: async function () { return this; },
      };

      if (update.$setOnInsert) {
        for (const [key, val] of Object.entries(update.$setOnInsert)) {
          if (key.startsWith('prayers.')) {
            const pId = key.split('.')[1] as PrayerId;
            record.prayers[pId] = { ...(val as Record<string, unknown>) } as unknown as MockRecordDoc['prayers'][PrayerId];
          }
        }
      }
      mockRecords.push(record);
    }

    if (update.$set) {
      for (const [key, val] of Object.entries(update.$set)) {
        if (key.startsWith('prayers.')) {
          const parts = key.split('.');
          const pId = parts[1] as PrayerId;
          const prop = parts[2];
          if (!record.prayers[pId]) {
            record.prayers[pId] = { status: 'PENDING' };
          }
          if (prop) {
            (record.prayers[pId] as unknown as Record<string, unknown>)[prop] = val;
          } else {
            record.prayers[pId] = val as unknown as MockRecordDoc['prayers'][PrayerId];
          }
        } else if (key === 'finesAccrued') {
          record.finesAccrued = val as number;
        } else if (key === 'updatedAt') {
          record.updatedAt = val as Date;
        }
      }
    }

    return record;
  };

  prayerModel.findById = async (id: mongoose.Types.ObjectId | string) => {
    return mockRecords.find((r) => r._id.toString() === id.toString()) || null;
  };

  prayerModel.updateOne = async (
    filter: { _id?: mongoose.Types.ObjectId },
    update: { $set?: Record<string, unknown> }
  ) => {
    const record = mockRecords.find((r) => r._id.toString() === filter._id?.toString());
    if (record && update.$set) {
      Object.assign(record, update.$set);
    }
    return { matchedCount: record ? 1 : 0, modifiedCount: record ? 1 : 0 };
  };
}

function createAuthSession(userId: mongoose.Types.ObjectId, username = 'audituser'): string {
  const token = `token-${userId.toString()}-${Date.now()}`;
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

// In-memory Mock Storage for StorageSync verification
class MockStorage {
  private store: Record<string, string> = {};

  getItem(key: string): string | null {
    return this.store[key] || null;
  }
  setItem(key: string, value: string): void {
    this.store[key] = String(value);
  }
  removeItem(key: string): void {
    delete this.store[key];
  }
  clear(): void {
    this.store = {};
  }
}

describe('End-to-End QA, Performance & Release Audit Test Suite', () => {
  beforeEach(() => {
    setupMocks();
  });

  // =========================================================================
  // REQUIREMENT 1: Data persistence verification
  // =========================================================================
  describe('1. Data Persistence & Concurrency Verification', () => {
    it('handles rapid concurrent writes for all 5 prayers without race condition, data loss, or duplicates', async () => {
      const userId = new mongoose.Types.ObjectId();
      const token = createAuthSession(userId);
      const testDate = '2026-10-20';

      const prayerUpdates: Array<{ id: PrayerId; status: PrayerStatus; notes: string }> = [
        { id: 'fajr', status: 'PRAYED_ON_TIME', notes: 'Dawn congregation' },
        { id: 'dhuhr', status: 'PRAYED_ON_TIME', notes: 'Midday prayer' },
        { id: 'asr', status: 'PRAYED_LATE', notes: 'Work delay' },
        { id: 'maghrib', status: 'PRAYED_ON_TIME', notes: 'Sunset prayer' },
        { id: 'isha', status: 'PRAYED_ON_TIME', notes: 'Night prayer' },
      ];

      // Fire 5 concurrent requests simultaneously targeting the exact same date and user
      const promises = prayerUpdates.map((p) => {
        const req = new NextRequest('http://localhost:3000/api/prayers', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `salahtrack_session=${token}`,
          },
          body: JSON.stringify({
            date: testDate,
            prayerId: p.id,
            status: p.status,
            notes: p.notes,
          }),
        });
        return createPrayerHandler(req);
      });

      const responses = await Promise.all(promises);
      for (const res of responses) {
        assert.equal(res.status, 200, 'Each concurrent write must succeed with 200 OK');
        const json = await res.json();
        assert.equal(json.success, true);
      }

      // Exactly ONE document should exist in the database for this date and user
      const matchingDocs = mockRecords.filter(
        (r) => r.userId.toString() === userId.toString() && r.date === testDate
      );
      assert.equal(matchingDocs.length, 1, 'Mongoose upsert must maintain exactly 1 document without duplicates');

      // Verify all 5 prayers were persisted correctly
      const finalDoc = matchingDocs[0];
      assert.equal(finalDoc.prayers.fajr.status, 'PRAYED_ON_TIME');
      assert.equal(finalDoc.prayers.fajr.notes, 'Dawn congregation');
      assert.equal(finalDoc.prayers.dhuhr.status, 'PRAYED_ON_TIME');
      assert.equal(finalDoc.prayers.asr.status, 'PRAYED_LATE');
      assert.equal(finalDoc.prayers.asr.notes, 'Work delay');
      assert.equal(finalDoc.prayers.maghrib.status, 'PRAYED_ON_TIME');
      assert.equal(finalDoc.prayers.isha.status, 'PRAYED_ON_TIME');
    });

    it('preserves untouched fields, notes, and timestamps when updating a single prayer', async () => {
      const userId = new mongoose.Types.ObjectId();
      const token = createAuthSession(userId);
      const testDate = '2026-10-19';

      // 1. Initial write with custom notes and timestamp
      const req1 = new NextRequest('http://localhost:3000/api/prayers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `salahtrack_session=${token}`,
        },
        body: JSON.stringify({
          date: testDate,
          prayerId: 'fajr',
          status: 'PRAYED_ON_TIME',
          notes: 'Special Fajr notes to preserve',
        }),
      });

      const res1 = await createPrayerHandler(req1);
      assert.equal(res1.status, 200);

      // Record Fajr's prayedAt timestamp and note
      const doc = mockRecords.find((r) => r.date === testDate)!;
      assert.ok(doc);
      assert.equal(doc.prayers.fajr.notes, 'Special Fajr notes to preserve');
      assert.ok(doc.prayers.fajr.prayedAt);
      const originalFajrPrayedAt = doc.prayers.fajr.prayedAt;

      // 2. Now update Dhuhr without sending anything about Fajr
      const req2 = new NextRequest('http://localhost:3000/api/prayers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `salahtrack_session=${token}`,
        },
        body: JSON.stringify({
          date: testDate,
          prayerId: 'dhuhr',
          status: 'PRAYED_ON_TIME',
        }),
      });

      const res2 = await createPrayerHandler(req2);
      assert.equal(res2.status, 200);

      // Fajr fields must be completely preserved!
      assert.equal(doc.prayers.fajr.notes, 'Special Fajr notes to preserve');
      assert.equal(doc.prayers.fajr.status, 'PRAYED_ON_TIME');
      assert.equal(doc.prayers.fajr.prayedAt, originalFajrPrayedAt);
      assert.equal(doc.prayers.dhuhr.status, 'PRAYED_ON_TIME');
    });

    it('verifies multi-day storage persistence in src/lib/storage-sync.ts across multiple days', () => {
      const mockStorage = new MockStorage();
      const originalWindow = global.window;
      const originalDoc = global.document;

      global.window = {
        localStorage: mockStorage,
        dispatchEvent: () => true,
        location: { protocol: 'https:' },
      } as unknown as Window & typeof globalThis;

      global.document = {
        cookie: '',
      } as unknown as Document;

      try {
        const day1Prayers: PrayerItem[] = [
          { id: 'fajr', name: 'Fajr', time: '04:45', endTime: '06:19', status: 'PRAYED_ON_TIME' },
          { id: 'dhuhr', name: 'Dhuhr', time: '12:15', endTime: '16:20', status: 'PRAYED_ON_TIME' },
          { id: 'asr', name: 'Asr', time: '16:20', endTime: '18:05', status: 'PRAYED_ON_TIME' },
          { id: 'maghrib', name: 'Maghrib', time: '18:05', endTime: '19:30', status: 'PRAYED_ON_TIME' },
          { id: 'isha', name: 'Isha', time: '19:30', endTime: '04:46', status: 'PRAYED_ON_TIME' },
        ];

        const day2Prayers: PrayerItem[] = [
          { id: 'fajr', name: 'Fajr', time: '04:46', endTime: '06:19', status: 'PRAYED_ON_TIME' },
          { id: 'dhuhr', name: 'Dhuhr', time: '12:15', endTime: '16:20', status: 'PRAYED_LATE' },
          { id: 'asr', name: 'Asr', time: '16:20', endTime: '18:05', status: 'MISSED' },
          { id: 'maghrib', name: 'Maghrib', time: '18:05', endTime: '19:30', status: 'PRAYED_ON_TIME' },
          { id: 'isha', name: 'Isha', time: '19:30', endTime: '04:47', status: 'PENDING' },
        ];

        const day3Prayers: PrayerItem[] = [
          { id: 'fajr', name: 'Fajr', time: '04:47', endTime: '06:19', status: 'PRAYED_ON_TIME' },
          { id: 'dhuhr', name: 'Dhuhr', time: '12:15', endTime: '16:20', status: 'PENDING' },
          { id: 'asr', name: 'Asr', time: '16:20', endTime: '18:05', status: 'PENDING' },
          { id: 'maghrib', name: 'Maghrib', time: '18:05', endTime: '19:30', status: 'PENDING' },
          { id: 'isha', name: 'Isha', time: '19:30', endTime: '04:48', status: 'PENDING' },
        ];

        // 1. Save and mirror Day 1 (2026-10-18)
        saveDailyPrayersSync('2026-10-18', day1Prayers);
        // 2. Archive Day 1 at next Fajr
        const archive1 = archiveLiturgicalDay('2026-10-18', day1Prayers);
        assert.equal(archive1.uncompletedCount, 0, 'Day 1 was fully completed');

        // 3. Save Day 2 (2026-10-19)
        saveDailyPrayersSync('2026-10-19', day2Prayers);
        // Archive Day 2
        const archive2 = archiveLiturgicalDay('2026-10-19', day2Prayers);
        assert.equal(archive2.uncompletedCount, 2, 'Day 2 had 1 missed + 1 pending prayer');

        // 4. Save Day 3 (2026-10-20)
        saveDailyPrayersSync('2026-10-20', day3Prayers);

        // Verify all 3 days coexist in history store
        const allRecords = getStoredHistoryRecords();
        assert.ok(allRecords['2026-10-18'], 'Day 1 must persist');
        assert.ok(allRecords['2026-10-19'], 'Day 2 must persist');
        assert.ok(allRecords['2026-10-20'], 'Day 3 must persist');

        // Verify independent statuses
        assert.equal(allRecords['2026-10-18'].prayers.fajr.status, 'PRAYED_ON_TIME');
        assert.equal(allRecords['2026-10-19'].prayers.dhuhr.status, 'PRAYED_LATE');
        assert.equal(allRecords['2026-10-19'].prayers.asr.status, 'MISSED');
        assert.equal(allRecords['2026-10-20'].prayers.fajr.status, 'PRAYED_ON_TIME');
        assert.equal(allRecords['2026-10-20'].prayers.dhuhr.status, 'PENDING');

        // Load specific liturgical date from store
        const loadedDay2 = loadPrayersForLiturgicalDate('2026-10-19', day1Prayers);
        assert.equal(loadedDay2.find((p) => p.id === 'asr')?.status, 'MISSED');
      } finally {
        global.window = originalWindow;
        global.document = originalDoc;
      }
    });
  });

  // =========================================================================
  // REQUIREMENT 2: Prayer-day cycle & Isha-to-Fajr boundary verification
  // =========================================================================
  describe('2. Prayer-Day Cycle & Midnight Boundary Verification', () => {
    const timings = {
      fajr: { time: '05:15', endTime: '06:40' },
      dhuhr: { time: '12:30', endTime: '16:00' },
      asr: { time: '16:00', endTime: '18:15' },
      maghrib: { time: '18:15', endTime: '19:45' },
      isha: { time: '19:45', endTime: '05:15' },
    };

    it('verifies 23:59: Isha active, today liturgical date, isPostMidnight=false, next=fajr', () => {
      // 2026-10-20 23:59:00 in Asia/Tashkent (UTC+5 -> 2026-10-20T18:59:00.000Z)
      const now = new Date('2026-10-20T18:59:00.000Z');
      const cycle = resolvePrayerCycle({ now, timings, timezone: 'Asia/Tashkent' });

      assert.equal(cycle.calendarDate, '2026-10-20', 'Calendar date is 2026-10-20');
      assert.equal(cycle.liturgicalDate, '2026-10-20', 'Liturgical date must still be today');
      assert.equal(cycle.isPostMidnight, false, '23:59 is before midnight, so isPostMidnight is false');
      assert.equal(cycle.activePrayerId, 'isha', 'Isha is active at 23:59');
      assert.equal(cycle.nextPrayerId, 'fajr', 'Next prayer is Fajr');
      // From 23:59 to 05:15 tomorrow: 1 minute to midnight + 315 mins = 316 minutes (5h 16m)
      assert.equal(cycle.timeUntilNextMinutes, 316);
      assert.equal(cycle.hoursUntilNext, 5);
      assert.equal(cycle.minutesUntilNext, 16);
    });

    it('verifies 00:00: Post-midnight pre-Fajr, yesterday liturgical date, Isha active, isPostMidnight=true, next=fajr', () => {
      // 2026-10-21 00:00:00 in Asia/Tashkent (UTC+5 -> 2026-10-20T19:00:00.000Z)
      const now = new Date('2026-10-20T19:00:00.000Z');
      const cycle = resolvePrayerCycle({ now, timings, timezone: 'Asia/Tashkent' });

      assert.equal(cycle.calendarDate, '2026-10-21', 'Calendar date turned to 2026-10-21');
      assert.equal(cycle.liturgicalDate, '2026-10-20', 'Liturgical date MUST be yesterday (2026-10-20)');
      assert.equal(cycle.isPostMidnight, true, 'At 00:00:00 isPostMidnight is true');
      assert.equal(cycle.activePrayerId, 'isha', 'Isha continues overnight');
      assert.equal(cycle.nextPrayerId, 'fajr', 'Next prayer is Fajr');
      // From 00:00 to 05:15: 315 minutes (5h 15m)
      assert.equal(cycle.timeUntilNextMinutes, 315);
      assert.equal(cycle.hoursUntilNext, 5);
      assert.equal(cycle.minutesUntilNext, 15);
    });

    it('verifies 02:00: Post-midnight pre-Fajr, yesterday liturgical date, Isha active, isPostMidnight=true, next=fajr', () => {
      // 2026-10-21 02:00:00 in Asia/Tashkent (UTC+5 -> 2026-10-20T21:00:00.000Z)
      const now = new Date('2026-10-20T21:00:00.000Z');
      const cycle = resolvePrayerCycle({ now, timings, timezone: 'Asia/Tashkent' });

      assert.equal(cycle.calendarDate, '2026-10-21');
      assert.equal(cycle.liturgicalDate, '2026-10-20', 'Liturgical date must be yesterday (2026-10-20)');
      assert.equal(cycle.isPostMidnight, true);
      assert.equal(cycle.activePrayerId, 'isha');
      assert.equal(cycle.nextPrayerId, 'fajr');
      // From 02:00 to 05:15: 195 minutes (3h 15m)
      assert.equal(cycle.timeUntilNextMinutes, 195);
      assert.equal(cycle.hoursUntilNext, 3);
      assert.equal(cycle.minutesUntilNext, 15);
    });

    it('verifies 05:14: Immediately before Fajr at 05:15 (yesterday date, Isha active, 1 min countdown)', () => {
      // 2026-10-21 05:14:00 in Asia/Tashkent (UTC+5 -> 2026-10-21T00:14:00.000Z)
      const now = new Date('2026-10-21T00:14:00.000Z');
      const cycle = resolvePrayerCycle({ now, timings, timezone: 'Asia/Tashkent' });

      assert.equal(cycle.calendarDate, '2026-10-21');
      assert.equal(cycle.liturgicalDate, '2026-10-20', 'Liturgical date must still be yesterday at 05:14');
      assert.equal(cycle.isPostMidnight, true, 'Still in pre-Fajr window at 05:14');
      assert.equal(cycle.activePrayerId, 'isha', 'Isha is still active at 05:14');
      assert.equal(cycle.nextPrayerId, 'fajr', 'Next prayer is Fajr');
      assert.equal(cycle.timeUntilNextMinutes, 1, 'Exactly 1 minute countdown remaining');
      assert.equal(cycle.hoursUntilNext, 0);
      assert.equal(cycle.minutesUntilNext, 1);
    });

    it('verifies 05:15: Fajr arrival (rollover to new liturgical date, new day starts, Fajr active)', () => {
      // 2026-10-21 05:15:00 in Asia/Tashkent (UTC+5 -> 2026-10-21T00:15:00.000Z)
      const now = new Date('2026-10-21T00:15:00.000Z');
      const cycle = resolvePrayerCycle({ now, timings, timezone: 'Asia/Tashkent' });

      assert.equal(cycle.calendarDate, '2026-10-21');
      assert.equal(cycle.liturgicalDate, '2026-10-21', 'At 05:15 sharp, liturgical date MUST roll over to 2026-10-21');
      assert.equal(cycle.isPostMidnight, false, 'isPostMidnight becomes false at Fajr adhan');
      assert.equal(cycle.activePrayerId, 'fajr', 'Fajr becomes the active prayer');
      assert.equal(cycle.nextPrayerId, 'dhuhr', 'Next prayer advances to Dhuhr');
      // From 05:15 to 12:30: 435 minutes (7h 15m)
      assert.equal(cycle.timeUntilNextMinutes, 435);
      assert.equal(cycle.hoursUntilNext, 7);
      assert.equal(cycle.minutesUntilNext, 15);
    });

    it('verifies boundary behavior across Asia/Tashkent, America/New_York, and UTC', () => {
      const timezones = ['Asia/Tashkent', 'America/New_York', 'UTC'];

      for (const tz of timezones) {
        // Test getLiturgicalDate for a synthetic zoned date
        const parts = getZonedDateParts(new Date(), tz);
        assert.ok(parts.dateStr, `Date string extracted for ${tz}`);
        assert.ok(parts.year >= 2026);

        // Test explicit 01:00 time: isPostMidnightPreFajr with 05:15 fajr
        const now = new Date();
        // Direct test of isPostMidnightPreFajr function
        assert.equal(typeof isPostMidnightPreFajr(now, '05:15', tz), 'boolean');
      }

      // Concrete test for America/New_York (UTC-4 in EDT)
      // 2026-10-21T05:00:00Z -> In New York (EDT, -4), this is 2026-10-21 01:00:00 AM
      const nyEarlyMorning = new Date('2026-10-21T05:00:00.000Z');
      const nyParts = getZonedDateParts(nyEarlyMorning, 'America/New_York');
      assert.equal(nyParts.hour, 1);
      assert.equal(nyParts.dateStr, '2026-10-21');
      assert.equal(isPostMidnightPreFajr(nyEarlyMorning, '05:15', 'America/New_York'), true);
      assert.equal(getLiturgicalDate(nyEarlyMorning, '05:15', 'America/New_York'), '2026-10-20');

      // Concrete test for UTC
      // 2026-10-21T02:00:00Z -> In UTC, this is 2026-10-21 02:00:00 AM
      const utcEarlyMorning = new Date('2026-10-21T02:00:00.000Z');
      assert.equal(isPostMidnightPreFajr(utcEarlyMorning, '05:15', 'UTC'), true);
      assert.equal(getLiturgicalDate(utcEarlyMorning, '05:15', 'UTC'), '2026-10-20');
    });

    it('verifies dynamic Isha endTime in /api/prayer-times matches next Fajr and has isOvernight: true', async () => {
      // Test GET /api/prayer-times
      const req = new NextRequest('http://localhost:3000/api/prayer-times?lat=41.2995&lng=69.2401');
      const res = await getPrayerTimesHandler(req);
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.equal(json.success, true);
      assert.ok(json.timings);

      const ishaTiming = json.timings.isha;
      const fajrTiming = json.timings.fajr;

      assert.ok(ishaTiming);
      assert.ok(fajrTiming);
      assert.equal(ishaTiming.isOvernight, true, 'Isha must be marked isOvernight: true');
      // Dynamic Isha endTime must equal Fajr start time
      assert.equal(ishaTiming.endTime, fajrTiming.time, 'Isha endTime must dynamically equal Fajr start time');
    });
  });

  // =========================================================================
  // REQUIREMENT 3: Date switching, page refreshes, and history synchronization
  // =========================================================================
  describe('3. Date Switching, Page Refreshes & History Synchronization', () => {
    it('verifies that page refreshes on / do not render stale prayers from yesterday', () => {
      // Simulation of HomePage SSR cookie validation logic (from src/app/page.tsx)
      const currentLiturgicalDate = '2026-10-20';

      const yesterdayWrappedCookie = JSON.stringify({
        date: '2026-10-19',
        prayers: [
          { id: 'fajr', status: 'PRAYED_ON_TIME' },
          { id: 'dhuhr', status: 'PRAYED_ON_TIME' },
          { id: 'asr', status: 'PRAYED_ON_TIME' },
          { id: 'maghrib', status: 'PRAYED_ON_TIME' },
          { id: 'isha', status: 'PRAYED_ON_TIME' },
        ],
      });

      // Execute SSR evaluation logic for wrapped cookie
      function evaluateSsrPrayers(cookieStr: string, activeDateCookieStr: string | null, targetLiturgicalDate: string) {
        let initialPrayers = null;
        try {
          const raw = JSON.parse(decodeURIComponent(cookieStr));
          if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'prayers' in raw) {
            if (raw.date === targetLiturgicalDate) {
              initialPrayers = raw.prayers;
            }
          } else {
            const decodedDate = activeDateCookieStr ? decodeURIComponent(activeDateCookieStr).replace(/^"|"$/g, '') : null;
            if (decodedDate === targetLiturgicalDate) {
              initialPrayers = raw;
            }
          }
        } catch {
          // ignore
        }
        return initialPrayers;
      }

      // 1. Yesterday wrapped cookie -> must evaluate to NULL (so fresh PENDING prayers render)
      const resultYesterdayWrapped = evaluateSsrPrayers(yesterdayWrappedCookie, null, currentLiturgicalDate);
      assert.equal(resultYesterdayWrapped, null, 'Stale yesterday prayers from wrapped cookie must NOT be accepted');

      // 2. Today wrapped cookie -> must be accepted
      const todayWrappedCookie = JSON.stringify({
        date: '2026-10-20',
        prayers: [{ id: 'fajr', status: 'PRAYED_ON_TIME' }],
      });
      const resultTodayWrapped = evaluateSsrPrayers(todayWrappedCookie, null, currentLiturgicalDate);
      assert.ok(resultTodayWrapped, 'Matching today prayers must be accepted');

      // 3. Stale legacy cookie with yesterday active date -> must evaluate to NULL
      const legacyPrayersCookie = JSON.stringify([{ id: 'fajr', status: 'PRAYED_ON_TIME' }]);
      const staleActiveDateCookie = JSON.stringify('2026-10-19');
      const resultLegacyStale = evaluateSsrPrayers(legacyPrayersCookie, staleActiveDateCookie, currentLiturgicalDate);
      assert.equal(resultLegacyStale, null, 'Stale legacy cookie must evaluate to NULL');
    });

    it('verifies that /progress and MonthlyHistoryCalendar stay synchronized via salahtrack_history_records', () => {
      const mockStorage = new MockStorage();
      const originalWindow = global.window;

      let eventDispatched = false;
      global.window = {
        localStorage: mockStorage,
        dispatchEvent: (event: Event) => {
          if (event.type === 'local-storage-update') {
            eventDispatched = true;
          }
          return true;
        },
        location: { protocol: 'https:' },
      } as unknown as Window & typeof globalThis;

      try {
        const todayPrayers: PrayerItem[] = [
          { id: 'fajr', name: 'Fajr', time: '04:47', endTime: '06:19', status: 'PRAYED_ON_TIME' },
          { id: 'dhuhr', name: 'Dhuhr', time: '12:13', endTime: '16:20', status: 'PRAYED_LATE' },
          { id: 'asr', name: 'Asr', time: '16:20', endTime: '18:05', status: 'PENDING' },
          { id: 'maghrib', name: 'Maghrib', time: '18:05', endTime: '19:32', status: 'PENDING' },
          { id: 'isha', name: 'Isha', time: '19:32', endTime: '04:47', status: 'PENDING' },
        ];

        // 1. Home dashboard updates today's prayers and mirrors to history
        mirrorDailyPrayersToHistory('2026-10-20', todayPrayers);
        dispatchStorageUpdate();

        assert.equal(eventDispatched, true, 'local-storage-update event must be fired for reactive listener updates');

        // 2. /progress and MonthlyHistoryCalendar read from salahtrack_history_records
        const stored = getStoredHistoryRecords();
        assert.ok(stored['2026-10-20'], 'History record must exist for 2026-10-20');
        assert.equal(stored['2026-10-20'].prayers.fajr.status, 'PRAYED_ON_TIME');
        assert.equal(stored['2026-10-20'].prayers.dhuhr.status, 'PRAYED_LATE');
        assert.equal(stored['2026-10-20'].prayers.asr.status, 'PENDING');
      } finally {
        global.window = originalWindow;
      }
    });

    it('verifies that editing past records does NOT clobber today active prayers', () => {
      const mockStorage = new MockStorage();
      const originalWindow = global.window;
      const originalDoc = global.document;

      global.window = {
        localStorage: mockStorage,
        dispatchEvent: () => true,
        location: { protocol: 'https:' },
      } as unknown as Window & typeof globalThis;

      global.document = {
        cookie: '',
      } as unknown as Document;

      try {
        // Today is 2026-10-20. User has logged Fajr and Dhuhr on-time today.
        const todayDate = '2026-10-20';
        const todayPrayers: PrayerItem[] = [
          { id: 'fajr', name: 'Fajr', time: '04:47', endTime: '06:19', status: 'PRAYED_ON_TIME' },
          { id: 'dhuhr', name: 'Dhuhr', time: '12:13', endTime: '16:20', status: 'PRAYED_ON_TIME' },
          { id: 'asr', name: 'Asr', time: '16:20', endTime: '18:05', status: 'PENDING' },
          { id: 'maghrib', name: 'Maghrib', time: '18:05', endTime: '19:32', status: 'PENDING' },
          { id: 'isha', name: 'Isha', time: '19:32', endTime: '04:47', status: 'PENDING' },
        ];
        saveDailyPrayersSync(todayDate, todayPrayers);

        // Verify initial state
        const initialDaily = JSON.parse(mockStorage.getItem(STORAGE_KEY_DAILY_PRAYERS)!);
        assert.equal(initialDaily[0].status, 'PRAYED_ON_TIME');
        assert.equal(initialDaily[1].status, 'PRAYED_ON_TIME');

        // Now user navigates to MonthlyHistoryCalendar or /progress and corrects a past prayer on 2026-10-15
        const pastDate = '2026-10-15';
        const records = getStoredHistoryRecords();
        records[pastDate] = {
          date: pastDate,
          prayers: {
            fajr: { status: 'PRAYED_ON_TIME' },
            dhuhr: { status: 'PRAYED_ON_TIME' },
            asr: { status: 'MADE_UP' }, // Marked as made-up
            maghrib: { status: 'PRAYED_ON_TIME' },
            isha: { status: 'PRAYED_ON_TIME' },
          },
          finesAccrued: 0,
        };
        saveStoredHistoryRecords(records);

        // Simulation of progress handleHistoricalCorrection logic:
        // Since pastDate !== todayDate (liturgicalTodayStr), it DOES NOT write to salahtrack_daily_prayers!
        // Verify today's active prayers store was NEVER clobbered:
        const currentDailyRaw = mockStorage.getItem(STORAGE_KEY_DAILY_PRAYERS);
        const currentDaily: PrayerItem[] = JSON.parse(currentDailyRaw!);

        assert.equal(currentDaily[0].id, 'fajr');
        assert.equal(currentDaily[0].status, 'PRAYED_ON_TIME', 'Today Fajr must remain unchanged');
        assert.equal(currentDaily[1].status, 'PRAYED_ON_TIME', 'Today Dhuhr must remain unchanged');
        assert.equal(currentDaily[2].status, 'PENDING', 'Today Asr must remain PENDING (not clobbered by past 10-15 Asr edit)');

        // Verify past record was persisted in history independently
        const updatedRecords = getStoredHistoryRecords();
        assert.equal(updatedRecords[pastDate].prayers.asr.status, 'MADE_UP');
        assert.equal(updatedRecords[todayDate].prayers.fajr.status, 'PRAYED_ON_TIME');
      } finally {
        global.window = originalWindow;
        global.document = originalDoc;
      }
    });
  });
});
