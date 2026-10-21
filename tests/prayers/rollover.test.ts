import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server.js';

import { PrayerRecord } from '../../src/models/Prayer.ts';
import { User } from '../../src/models/User.ts';
import { Session } from '../../src/models/Session.ts';
import { POST as rolloverHandler } from '../../src/app/api/prayers/rollover/route.ts';
import type { PrayerId, PrayerStatus } from '../../src/types/prayer.ts';

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
    isPaid?: boolean;
    paidAt?: Date;
    paidAmount?: number;
  }>;
  finesAccrued: number;
  save: () => Promise<MockRecordDoc>;
  markModified: (path: string) => void;
}

let mockRecords: MockRecordDoc[] = [];
let mockUsers: Array<{ _id: mongoose.Types.ObjectId; username: string }> = [];
let mockSessions: Array<{ sessionToken: string; userId: mongoose.Types.ObjectId; expiresAt: Date; lastActiveAt: Date; save: () => Promise<unknown> }> = [];

const testUserId = new mongoose.Types.ObjectId();
const validSessionToken = 'test-rollover-session-token';

function createMockRecord(
  date: string,
  userId = testUserId,
  prayersStatus: Partial<Record<PrayerId, PrayerStatus>> = {}
): MockRecordDoc {
  const pIds: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const prayers: MockRecordDoc['prayers'] = {} as MockRecordDoc['prayers'];

  for (const p of pIds) {
    prayers[p] = {
      status: prayersStatus[p] || 'PENDING',
      isPaid: false,
      paidAmount: 0,
    };
  }

  const doc: MockRecordDoc = {
    _id: new mongoose.Types.ObjectId(),
    userId,
    date,
    prayers,
    finesAccrued: 0,
    markModified: () => {},
    save: async function () {
      const idx = mockRecords.findIndex((r) => r._id.toString() === doc._id.toString());
      if (idx >= 0) {
        mockRecords[idx] = doc;
      } else {
        mockRecords.push(doc);
      }
      return doc;
    },
  };

  return doc;
}

function setupMocks() {
  mockRecords = [];
  mockUsers = [{ _id: testUserId, username: 'testuser' }];
  mockSessions = [
    {
      sessionToken: validSessionToken,
      userId: testUserId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      lastActiveAt: new Date(),
      save: async () => true,
    },
  ];

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

  prayerModel.findOne = async (query: { userId?: mongoose.Types.ObjectId | string; date?: string }) => {
    const uId = query.userId?.toString();
    return mockRecords.find((r) => r.userId.toString() === uId && r.date === query.date) || null;
  };

  prayerModel.find = (query: { userId?: mongoose.Types.ObjectId | string }) => {
    const uId = query.userId?.toString();
    const filterFn = (r: MockRecordDoc) => !uId || r.userId.toString() === uId;

    return {
      sort: () => mockRecords.filter(filterFn),
      then: (resolve: (records: MockRecordDoc[]) => void) => resolve(mockRecords.filter(filterFn)),
    };
  };

  // Mock constructor when instantiated with new PrayerRecord(...)
  PrayerRecord.prototype.save = async function (this: unknown) {
    const doc = this as MockRecordDoc;
    if (!doc._id) {
      doc._id = new mongoose.Types.ObjectId();
    }
    const idx = mockRecords.findIndex(
      (r) => r.userId.toString() === doc.userId.toString() && r.date === doc.date
    );
    if (idx >= 0) {
      mockRecords[idx] = doc;
    } else {
      mockRecords.push(doc);
    }
    return doc;
  };
}

describe('POST /api/prayers/rollover', () => {
  beforeEach(() => {
    setupMocks();
  });

  it('rejects unauthenticated requests with 401 and AUTH_UNAUTHORIZED', async () => {
    const req = new NextRequest('http://localhost:3000/api/prayers/rollover', {
      method: 'POST',
      body: JSON.stringify({ fromDate: '2026-10-18', toDate: '2026-10-19' }),
    });

    const res = await rolloverHandler(req);
    assert.strictEqual(res.status, 401);

    const json = await res.json();
    assert.strictEqual(json.success, false);
    assert.strictEqual(json.error, 'Unauthorized');
    assert.strictEqual(json.code, 'AUTH_UNAUTHORIZED');
  });

  it('rejects malformed or missing body with 400', async () => {
    const req = new NextRequest('http://localhost:3000/api/prayers/rollover', {
      method: 'POST',
      headers: { cookie: `salahtrack_session=${validSessionToken}` },
      body: 'invalid-json',
    });

    const res = await rolloverHandler(req);
    assert.strictEqual(res.status, 400);

    const json = await res.json();
    assert.strictEqual(json.success, false);
    assert.strictEqual(json.code, 'VALIDATION_FAILED');
  });

  it('rejects invalid fromDate format with 400', async () => {
    const req = new NextRequest('http://localhost:3000/api/prayers/rollover', {
      method: 'POST',
      headers: { cookie: `salahtrack_session=${validSessionToken}` },
      body: JSON.stringify({ fromDate: '2026-13-45', toDate: '2026-10-19' }),
    });

    const res = await rolloverHandler(req);
    assert.strictEqual(res.status, 400);

    const json = await res.json();
    assert.strictEqual(json.success, false);
    assert.strictEqual(json.code, 'INVALID_FROM_DATE');
  });

  it('rejects invalid toDate format with 400', async () => {
    const req = new NextRequest('http://localhost:3000/api/prayers/rollover', {
      method: 'POST',
      headers: { cookie: `salahtrack_session=${validSessionToken}` },
      body: JSON.stringify({ fromDate: '2026-10-18', toDate: 'not-a-date' }),
    });

    const res = await rolloverHandler(req);
    assert.strictEqual(res.status, 400);

    const json = await res.json();
    assert.strictEqual(json.success, false);
    assert.strictEqual(json.code, 'INVALID_TO_DATE');
  });

  it('rejects when fromDate >= toDate with 400', async () => {
    const req = new NextRequest('http://localhost:3000/api/prayers/rollover', {
      method: 'POST',
      headers: { cookie: `salahtrack_session=${validSessionToken}` },
      body: JSON.stringify({ fromDate: '2026-10-19', toDate: '2026-10-19' }),
    });

    const res = await rolloverHandler(req);
    assert.strictEqual(res.status, 400);

    const json = await res.json();
    assert.strictEqual(json.success, false);
    assert.strictEqual(json.code, 'INVALID_DATE_RANGE');
  });

  it('rejects date gaps exceeding 365 days with 400', async () => {
    const req = new NextRequest('http://localhost:3000/api/prayers/rollover', {
      method: 'POST',
      headers: { cookie: `salahtrack_session=${validSessionToken}` },
      body: JSON.stringify({ fromDate: '2024-01-01', toDate: '2026-01-02' }),
    });

    const res = await rolloverHandler(req);
    assert.strictEqual(res.status, 400);

    const json = await res.json();
    assert.strictEqual(json.success, false);
    assert.strictEqual(json.code, 'DATE_GAP_EXCEEDED');
  });

  it('successfully rolls over consecutive days (gap = 1)', async () => {
    // Setup fromDate with 2 prayers ON_TIME and 3 PENDING
    const fromRecord = createMockRecord('2026-10-18', testUserId, {
      fajr: 'PRAYED_ON_TIME',
      dhuhr: 'PRAYED_ON_TIME',
      asr: 'PENDING',
      maghrib: 'PENDING',
      isha: 'PENDING',
    });
    mockRecords.push(fromRecord);

    const req = new NextRequest('http://localhost:3000/api/prayers/rollover', {
      method: 'POST',
      headers: { cookie: `salahtrack_session=${validSessionToken}` },
      body: JSON.stringify({ fromDate: '2026-10-18', toDate: '2026-10-19' }),
    });

    const res = await rolloverHandler(req);
    assert.strictEqual(res.status, 200);

    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.fromDate, '2026-10-18');
    assert.strictEqual(json.toDate, '2026-10-19');
    assert.ok(json.streak !== undefined);

    // Verify fromDate has updated PENDING to MISSED
    const updatedFrom = mockRecords.find((r) => r.date === '2026-10-18');
    assert.ok(updatedFrom);
    assert.strictEqual(updatedFrom.prayers.fajr.status, 'PRAYED_ON_TIME');
    assert.strictEqual(updatedFrom.prayers.dhuhr.status, 'PRAYED_ON_TIME');
    assert.strictEqual(updatedFrom.prayers.asr.status, 'MISSED');
    assert.strictEqual(updatedFrom.prayers.maghrib.status, 'MISSED');
    assert.strictEqual(updatedFrom.prayers.isha.status, 'MISSED');
    assert.ok(updatedFrom.prayers.asr.missedAt instanceof Date);
    // 3 missed * 15,000 = 45,000 UZS
    assert.strictEqual(updatedFrom.finesAccrued, 45000);

    // Verify toDate record initialized
    const toRecord = mockRecords.find((r) => r.date === '2026-10-19');
    assert.ok(toRecord);
    assert.strictEqual(toRecord.prayers.fajr.status, 'PENDING');
    assert.strictEqual(toRecord.prayers.dhuhr.status, 'PENDING');
    assert.strictEqual(toRecord.prayers.asr.status, 'PENDING');
    assert.strictEqual(toRecord.prayers.maghrib.status, 'PENDING');
    assert.strictEqual(toRecord.prayers.isha.status, 'PENDING');
    assert.strictEqual(toRecord.finesAccrued, 0);
  });

  it('creates intermediate days with all 5 MISSED prayers and 75,000 UZS fines', async () => {
    // Setup fromDate = '2026-10-15', toDate = '2026-10-18' (gap = 3: intermediate 10-16, 10-17)
    const fromRecord = createMockRecord('2026-10-15', testUserId, {
      fajr: 'PENDING',
      dhuhr: 'PENDING',
      asr: 'PENDING',
      maghrib: 'PENDING',
      isha: 'PENDING',
    });
    mockRecords.push(fromRecord);

    const req = new NextRequest('http://localhost:3000/api/prayers/rollover', {
      method: 'POST',
      headers: { cookie: `salahtrack_session=${validSessionToken}` },
      body: JSON.stringify({ fromDate: '2026-10-15', toDate: '2026-10-18' }),
    });

    const res = await rolloverHandler(req);
    assert.strictEqual(res.status, 200);

    const json = await res.json();
    assert.strictEqual(json.success, true);

    // Intermediate day 2026-10-16
    const inter1 = mockRecords.find((r) => r.date === '2026-10-16');
    assert.ok(inter1, 'Intermediate date 2026-10-16 must be created');
    assert.strictEqual(inter1.finesAccrued, 75000);
    assert.strictEqual(inter1.prayers.fajr.status, 'MISSED');
    assert.strictEqual(inter1.prayers.dhuhr.status, 'MISSED');
    assert.strictEqual(inter1.prayers.asr.status, 'MISSED');
    assert.strictEqual(inter1.prayers.maghrib.status, 'MISSED');
    assert.strictEqual(inter1.prayers.isha.status, 'MISSED');

    // Intermediate day 2026-10-17
    const inter2 = mockRecords.find((r) => r.date === '2026-10-17');
    assert.ok(inter2, 'Intermediate date 2026-10-17 must be created');
    assert.strictEqual(inter2.finesAccrued, 75000);
    assert.strictEqual(inter2.prayers.fajr.status, 'MISSED');
    assert.strictEqual(inter2.prayers.dhuhr.status, 'MISSED');
    assert.strictEqual(inter2.prayers.asr.status, 'MISSED');
    assert.strictEqual(inter2.prayers.maghrib.status, 'MISSED');
    assert.strictEqual(inter2.prayers.isha.status, 'MISSED');

    // toDate 2026-10-18 initialized
    const toRecord = mockRecords.find((r) => r.date === '2026-10-18');
    assert.ok(toRecord, 'toDate 2026-10-18 must be initialized');
    assert.strictEqual(toRecord.finesAccrued, 0);
  });

  it('correctly recalculates streak preserving prior streak when yesterday was completed', async () => {
    // 2 completed days before
    mockRecords.push(
      createMockRecord('2026-10-16', testUserId, {
        fajr: 'PRAYED_ON_TIME',
        dhuhr: 'PRAYED_ON_TIME',
        asr: 'PRAYED_ON_TIME',
        maghrib: 'PRAYED_ON_TIME',
        isha: 'PRAYED_ON_TIME',
      }),
      createMockRecord('2026-10-17', testUserId, {
        fajr: 'PRAYED_ON_TIME',
        dhuhr: 'PRAYED_ON_TIME',
        asr: 'PRAYED_ON_TIME',
        maghrib: 'PRAYED_ON_TIME',
        isha: 'PRAYED_ON_TIME',
      })
    );

    const req = new NextRequest('http://localhost:3000/api/prayers/rollover', {
      method: 'POST',
      headers: { cookie: `salahtrack_session=${validSessionToken}` },
      body: JSON.stringify({ fromDate: '2026-10-17', toDate: '2026-10-18' }),
    });

    const res = await rolloverHandler(req);
    assert.strictEqual(res.status, 200);

    const json = await res.json();
    assert.strictEqual(json.success, true);
    // Since 2026-10-17 had 5/5, and 2026-10-18 is in progress (PENDING), current streak is 2
    assert.strictEqual(json.streak.current, 2);
    assert.strictEqual(json.streak.best, 2);
    assert.strictEqual(json.streak.lastActiveDate, '2026-10-17');
  });
});
