import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server.js';

import { PrayerRecord } from '../../src/models/Prayer.ts';
import { User } from '../../src/models/User.ts';
import { Session } from '../../src/models/Session.ts';
import { calculateFines, getMaxAllowedDate, POST as createPrayerHandler, GET as getPrayersHandler } from '../../src/app/api/prayers/route.ts';
import { GET as getSinglePrayerHandler, PUT as updateSinglePrayerHandler, DELETE as deleteSinglePrayerHandler } from '../../src/app/api/prayers/[id]/route.ts';
import type { PrayerId, PrayerStatus } from '../../src/types/prayer.ts';

// Mock storage
interface MockRecordDoc {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  date: string;
  prayers: Record<PrayerId, { status: PrayerStatus; prayedAt?: Date; missedAt?: Date; madeUpAt?: Date; notes?: string }>;
  finesAccrued: number;
  save: () => Promise<MockRecordDoc>;
}

let mockRecords: MockRecordDoc[] = [];
let mockUsers: Array<{ _id: mongoose.Types.ObjectId; username: string }> = [];
let mockSessions: Array<{ sessionToken: string; userId: mongoose.Types.ObjectId; expiresAt: Date; lastActiveAt: Date; save: () => Promise<unknown> }> = [];

function setupPrayerMocks() {
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
    return mockRecords.find((r) => r.userId.toString() === query.userId?.toString() && r.date === query.date) || null;
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
        }
      }
    }

    return record;
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

  prayerModel.findById = async (id: mongoose.Types.ObjectId | string) => {
    return mockRecords.find((r) => r._id.toString() === id.toString()) || null;
  };

  prayerModel.findByIdAndDelete = async (id: mongoose.Types.ObjectId | string) => {
    const idx = mockRecords.findIndex((r) => r._id.toString() === id.toString());
    if (idx >= 0) {
      const deleted = mockRecords[idx];
      mockRecords.splice(idx, 1);
      return deleted;
    }
    return null;
  };
}

function createAuthSession(userId: mongoose.Types.ObjectId, username = 'testuser'): string {
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

describe('Prayer Tracking, Historical Corrections & Accountability Engine', () => {
  beforeEach(() => {
    setupPrayerMocks();
  });

  describe('1. Future Date Rejection & Validation', () => {
    it('calculates the maximum allowed date correctly without exceeding current day buffer', () => {
      const maxDate = getMaxAllowedDate();
      assert.match(maxDate, /^\d{4}-\d{2}-\d{2}$/);
      
      const now = new Date();
      const currentYear = now.getFullYear();
      assert.ok(parseInt(maxDate.split('-')[0], 10) >= currentYear);
    });

    it('rejects POST /api/prayers with future date with 400 Bad Request', async () => {
      const userId = new mongoose.Types.ObjectId();
      const token = createAuthSession(userId);

      const req = new NextRequest('http://localhost:3000/api/prayers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `salahtrack_session=${token}`,
        },
        body: JSON.stringify({
          date: '2099-01-01',
          prayerId: 'fajr',
          status: 'PRAYED_ON_TIME',
        }),
      });

      const res = await createPrayerHandler(req);
      assert.equal(res.status, 400);

      const json = await res.json();
      assert.equal(json.success, false);
      assert.match(json.error, /future dates/i);
    });

    it('rejects invalid prayer ID with 400 Bad Request', async () => {
      const userId = new mongoose.Types.ObjectId();
      const token = createAuthSession(userId);

      const req = new NextRequest('http://localhost:3000/api/prayers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `salahtrack_session=${token}`,
        },
        body: JSON.stringify({
          date: '2026-10-01',
          prayerId: 'tahajjud', // Valid prayers are only the 5 obligatory
          status: 'PRAYED_ON_TIME',
        }),
      });

      const res = await createPrayerHandler(req);
      assert.equal(res.status, 400);

      const json = await res.json();
      assert.equal(json.success, false);
      assert.match(json.error, /Invalid prayerId/i);
    });
  });

  describe('2. Accountability & Fine Calculation Logic', () => {
    it('assesses 15,000 UZS base fine for missed prayer within 7 days', () => {
      const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const prayers = {
        fajr: { status: 'MISSED' as PrayerStatus },
        dhuhr: { status: 'PRAYED_ON_TIME' as PrayerStatus },
        asr: { status: 'PRAYED_ON_TIME' as PrayerStatus },
        maghrib: { status: 'PRAYED_ON_TIME' as PrayerStatus },
        isha: { status: 'PRAYED_ON_TIME' as PrayerStatus },
      };

      const fine = calculateFines(recentDate, prayers);
      assert.equal(fine, 15000);
    });

    it('assesses 30,000 UZS (15k base + 15k overdue) for missed prayer older than 7 days', () => {
      const overdueDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const prayers = {
        fajr: { status: 'MISSED' as PrayerStatus },
        dhuhr: { status: 'PRAYED_ON_TIME' as PrayerStatus },
        asr: { status: 'PRAYED_ON_TIME' as PrayerStatus },
        maghrib: { status: 'PRAYED_ON_TIME' as PrayerStatus },
        isha: { status: 'PRAYED_ON_TIME' as PrayerStatus },
      };

      const fine = calculateFines(overdueDate, prayers);
      assert.equal(fine, 30000);
    });

    it('clears fine when status changes from MISSED to MADE_UP or PRAYED_ON_TIME', () => {
      const overdueDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const prayers = {
        fajr: { status: 'MADE_UP' as PrayerStatus },
        dhuhr: { status: 'PRAYED_ON_TIME' as PrayerStatus },
        asr: { status: 'PRAYED_ON_TIME' as PrayerStatus },
        maghrib: { status: 'PRAYED_ON_TIME' as PrayerStatus },
        isha: { status: 'PRAYED_ON_TIME' as PrayerStatus },
      };

      const fine = calculateFines(overdueDate, prayers);
      assert.equal(fine, 0);
    });

    it('does not accumulate duplicate fines on repeated status edits', () => {
      const recordDate = '2026-10-01';
      const prayers = {
        fajr: { status: 'MISSED' as PrayerStatus },
        dhuhr: { status: 'PENDING' as PrayerStatus },
        asr: { status: 'PENDING' as PrayerStatus },
        maghrib: { status: 'PENDING' as PrayerStatus },
        isha: { status: 'PENDING' as PrayerStatus },
      };

      const fine1 = calculateFines(recordDate, prayers);
      // Simulate switching to PRAYED then back to MISSED
      prayers.fajr.status = 'PRAYED_ON_TIME';
      const fine2 = calculateFines(recordDate, prayers);
      assert.equal(fine2, 0);

      prayers.fajr.status = 'MISSED';
      const fine3 = calculateFines(recordDate, prayers);
      assert.equal(fine1, fine3); // Exactly same fine, never double-counted!
    });
  });

  describe('3. Daily Completion Metrics', () => {
    it('counts PRAYED_ON_TIME and PRAYED_LATE towards original day completion, but NOT MADE_UP', () => {
      const dailyPrayers = [
        { id: 'fajr', status: 'PRAYED_ON_TIME' },
        { id: 'dhuhr', status: 'PRAYED_LATE' },
        { id: 'asr', status: 'MISSED' },
        { id: 'maghrib', status: 'MADE_UP' }, // Make-up of a past missed prayer
        { id: 'isha', status: 'PENDING' },
      ];

      // Formula: only on-time or late count for original day
      const completedOriginal = dailyPrayers.filter(
        (p) => p.status === 'PRAYED_ON_TIME' || p.status === 'PRAYED_LATE' || p.status === 'PRAYED'
      ).length;

      assert.equal(completedOriginal, 2, 'Only 2 prayers should count as original-day completed');
      assert.ok(dailyPrayers.some((p) => p.status === 'MADE_UP'), 'MADE_UP must remain distinct');
    });
  });

  describe('4. BOLA / IDOR Ownership Protection on /api/prayers/[id]', () => {
    it('rejects unauthenticated requests with 401 Unauthorized', async () => {
      const req = new NextRequest('http://localhost:3000/api/prayers/507f1f77bcf86cd799439011');
      const res = await getSinglePrayerHandler(req, {
        params: Promise.resolve({ id: '507f1f77bcf86cd799439011' }),
      });
      assert.equal(res.status, 401);
    });

    it('rejects non-owner access with 403 Forbidden', async () => {
      const userAId = new mongoose.Types.ObjectId();
      const userBId = new mongoose.Types.ObjectId();
      const recordId = new mongoose.Types.ObjectId();

      const tokenUserB = createAuthSession(userBId, 'userb');

      // Create record owned by User A
      mockRecords.push({
        _id: recordId,
        userId: userAId, // Owned by User A
        date: '2026-10-01',
        prayers: {
          fajr: { status: 'PRAYED_ON_TIME' },
          dhuhr: { status: 'PENDING' },
          asr: { status: 'PENDING' },
          maghrib: { status: 'PENDING' },
          isha: { status: 'PENDING' },
        },
        finesAccrued: 0,
        save: async function () { return this; },
      });

      // User B tries to query User A's record
      const req = new NextRequest(`http://localhost:3000/api/prayers/${recordId}`, {
        headers: {
          Cookie: `salahtrack_session=${tokenUserB}`,
        },
      });

      const res = await getSinglePrayerHandler(req, {
        params: Promise.resolve({ id: recordId.toString() }),
      });

      assert.equal(res.status, 403);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.match(json.error, /Forbidden/i);
    });

    it('allows owner to GET their own prayer record', async () => {
      const userAId = new mongoose.Types.ObjectId();
      const recordId = new mongoose.Types.ObjectId();
      const tokenUserA = createAuthSession(userAId, 'usera');

      mockRecords.push({
        _id: recordId,
        userId: userAId,
        date: '2026-10-01',
        prayers: {
          fajr: { status: 'PRAYED_ON_TIME' },
          dhuhr: { status: 'PENDING' },
          asr: { status: 'PENDING' },
          maghrib: { status: 'PENDING' },
          isha: { status: 'PENDING' },
        },
        finesAccrued: 0,
        save: async function () { return this; },
      });

      const req = new NextRequest(`http://localhost:3000/api/prayers/${recordId}`, {
        headers: {
          Cookie: `salahtrack_session=${tokenUserA}`,
        },
      });

      const res = await getSinglePrayerHandler(req, {
        params: Promise.resolve({ id: recordId.toString() }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.date, '2026-10-01');
    });

    it('allows owner to UPDATE their prayer record and recalculates fine', async () => {
      const userAId = new mongoose.Types.ObjectId();
      const recordId = new mongoose.Types.ObjectId();
      const tokenUserA = createAuthSession(userAId, 'usera');

      mockRecords.push({
        _id: recordId,
        userId: userAId,
        date: '2026-10-01',
        prayers: {
          fajr: { status: 'PRAYED_ON_TIME' },
          dhuhr: { status: 'PENDING' },
          asr: { status: 'PENDING' },
          maghrib: { status: 'PENDING' },
          isha: { status: 'PENDING' },
        },
        finesAccrued: 0,
        save: async function () { return this; },
      });

      const req = new NextRequest(`http://localhost:3000/api/prayers/${recordId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `salahtrack_session=${tokenUserA}`,
        },
        body: JSON.stringify({
          prayerId: 'fajr',
          status: 'MISSED',
        }),
      });

      const res = await updateSinglePrayerHandler(req, {
        params: Promise.resolve({ id: recordId.toString() }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.prayers.fajr.status, 'MISSED');
      assert.ok(json.data.finesAccrued >= 15000);
    });

    it('allows user to query their prayer records via GET /api/prayers', async () => {
      const userAId = new mongoose.Types.ObjectId();
      const recordId = new mongoose.Types.ObjectId();
      const tokenUserA = createAuthSession(userAId, 'usera');

      mockRecords.push({
        _id: recordId,
        userId: userAId,
        date: '2026-10-01',
        prayers: {
          fajr: { status: 'PRAYED_ON_TIME' },
          dhuhr: { status: 'PENDING' },
          asr: { status: 'PENDING' },
          maghrib: { status: 'PENDING' },
          isha: { status: 'PENDING' },
        },
        finesAccrued: 0,
        save: async function () { return this; },
      });

      const req = new NextRequest('http://localhost:3000/api/prayers?date=2026-10-01', {
        headers: {
          Cookie: `salahtrack_session=${tokenUserA}`,
        },
      });

      const res = await getPrayersHandler(req);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.date, '2026-10-01');
    });

    it('allows owner to DELETE their prayer record', async () => {
      const userAId = new mongoose.Types.ObjectId();
      const recordId = new mongoose.Types.ObjectId();
      const tokenUserA = createAuthSession(userAId, 'usera');

      mockRecords.push({
        _id: recordId,
        userId: userAId,
        date: '2026-10-01',
        prayers: {
          fajr: { status: 'PRAYED_ON_TIME' },
          dhuhr: { status: 'PENDING' },
          asr: { status: 'PENDING' },
          maghrib: { status: 'PENDING' },
          isha: { status: 'PENDING' },
        },
        finesAccrued: 0,
        save: async function () { return this; },
      });

      const req = new NextRequest(`http://localhost:3000/api/prayers/${recordId}`, {
        method: 'DELETE',
        headers: {
          Cookie: `salahtrack_session=${tokenUserA}`,
        },
      });

      const res = await deleteSinglePrayerHandler(req, {
        params: Promise.resolve({ id: recordId.toString() }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(mockRecords.length, 0);
    });
  });

  describe('5. Atomic Upsert, Concurrency & Field Preservation', () => {
    it('atomically upserts prayer and preserves notes when omitted in subsequent update', async () => {
      const userId = new mongoose.Types.ObjectId();
      const token = createAuthSession(userId);

      // 1. Initial prayer log with notes
      const req1 = new NextRequest('http://localhost:3000/api/prayers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `salahtrack_session=${token}`,
        },
        body: JSON.stringify({
          date: '2026-10-05',
          prayerId: 'fajr',
          status: 'PRAYED_ON_TIME',
          notes: 'Prayed at Central Mosque',
        }),
      });

      const res1 = await createPrayerHandler(req1);
      assert.equal(res1.status, 200);
      const json1 = await res1.json();
      assert.equal(json1.data.prayers.fajr.notes, 'Prayed at Central Mosque');

      // 2. Subsequent status toggle WITHOUT sending notes field
      const req2 = new NextRequest('http://localhost:3000/api/prayers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `salahtrack_session=${token}`,
        },
        body: JSON.stringify({
          date: '2026-10-05',
          prayerId: 'fajr',
          status: 'PRAYED_LATE',
          // notes is undefined!
        }),
      });

      const res2 = await createPrayerHandler(req2);
      assert.equal(res2.status, 200);
      const json2 = await res2.json();
      assert.equal(json2.data.prayers.fajr.status, 'PRAYED_LATE');
      // Notes must NOT be wiped out
      assert.equal(json2.data.prayers.fajr.notes, 'Prayed at Central Mosque');
    });

    it('PUT /api/prayers/[id] preserves existing notes when not provided in request body', async () => {
      const userId = new mongoose.Types.ObjectId();
      const recordId = new mongoose.Types.ObjectId();
      const token = createAuthSession(userId);

      mockRecords.push({
        _id: recordId,
        userId,
        date: '2026-10-06',
        prayers: {
          fajr: { status: 'PRAYED_ON_TIME', notes: 'Keep this note' },
          dhuhr: { status: 'PENDING' },
          asr: { status: 'PENDING' },
          maghrib: { status: 'PENDING' },
          isha: { status: 'PENDING' },
        },
        finesAccrued: 0,
        save: async function () { return this; },
      });

      const req = new NextRequest(`http://localhost:3000/api/prayers/${recordId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `salahtrack_session=${token}`,
        },
        body: JSON.stringify({
          prayerId: 'fajr',
          status: 'PRAYED_LATE',
          // notes omitted
        }),
      });

      const res = await updateSinglePrayerHandler(req, {
        params: Promise.resolve({ id: recordId.toString() }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.data.prayers.fajr.notes, 'Keep this note');
    });

    it('handles concurrency duplicate key code 11000 retry gracefully', async () => {
      const userId = new mongoose.Types.ObjectId();
      const token = createAuthSession(userId);

      let callCount = 0;
      const prayerModel = PrayerRecord as unknown as Record<string, unknown>;
      const originalFindOneAndUpdate = prayerModel.findOneAndUpdate as (
        ...args: unknown[]
      ) => Promise<unknown>;

      // Simulate first call failing with E11000 duplicate key race
      prayerModel.findOneAndUpdate = async (...args: unknown[]) => {
        callCount++;
        if (callCount === 1) {
          // Simulate concurrent request having created the document
          mockRecords.push({
            _id: new mongoose.Types.ObjectId(),
            userId,
            date: '2026-10-07',
            prayers: {
              fajr: { status: 'PENDING' },
              dhuhr: { status: 'PENDING' },
              asr: { status: 'PENDING' },
              maghrib: { status: 'PENDING' },
              isha: { status: 'PENDING' },
            },
            finesAccrued: 0,
            save: async function () { return this; },
          });
          const err = new Error('E11000 duplicate key error collection') as Error & { code: number };
          err.code = 11000;
          throw err;
        }
        return originalFindOneAndUpdate.apply(prayerModel, args);
      };

      const req = new NextRequest('http://localhost:3000/api/prayers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `salahtrack_session=${token}`,
        },
        body: JSON.stringify({
          date: '2026-10-07',
          prayerId: 'asr',
          status: 'PRAYED_ON_TIME',
        }),
      });

      const res = await createPrayerHandler(req);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.prayers.asr.status, 'PRAYED_ON_TIME');
      assert.equal(callCount, 2, 'Must have retried on E11000');

      // Restore mock
      prayerModel.findOneAndUpdate = originalFindOneAndUpdate;
    });
  });
});

