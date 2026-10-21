import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server.js';

import { PrayerRecord } from '../../src/models/Prayer.ts';
import { QazaPayment, type IQazaPaymentItem } from '../../src/models/QazaPayment.ts';
import { User } from '../../src/models/User.ts';
import { Session } from '../../src/models/Session.ts';
import { POST as payQazaHandler, GET as getPaymentHistoryHandler } from '../../src/app/api/prayers/qaza-payment/route.ts';
import { POST as updatePrayerHandler, calculateFines } from '../../src/app/api/prayers/route.ts';
import { GET as getStatsHandler } from '../../src/app/api/stats/route.ts';
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

interface MockPaymentDoc {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  items: IQazaPaymentItem[];
  totalAmount: number;
  idempotencyKey?: string;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
  save: () => Promise<MockPaymentDoc>;
}

let mockRecords: MockRecordDoc[] = [];
let mockPayments: MockPaymentDoc[] = [];
let mockUsers: Array<{ _id: mongoose.Types.ObjectId; username: string }> = [];
let mockSessions: Array<{ sessionToken: string; userId: mongoose.Types.ObjectId; expiresAt: Date; lastActiveAt: Date; save: () => Promise<unknown> }> = [];

const testUserId = new mongoose.Types.ObjectId();
const otherUserId = new mongoose.Types.ObjectId();
const validSessionToken = 'test-qaza-payment-session-token';

function setupMocks() {
  mockRecords = [];
  mockPayments = [];
  mockUsers = [
    { _id: testUserId, username: 'testuser' },
    { _id: otherUserId, username: 'otheruser' },
  ];
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
  const paymentModel = QazaPayment as unknown as Record<string, unknown>;

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

  prayerModel.find = (query: { userId?: mongoose.Types.ObjectId | string; date?: unknown }) => {
    const uId = query.userId?.toString();
    const queryDate = query.date as { $in?: string[]; $gte?: string; $lte?: string } | undefined;
    const filterFn = (r: MockRecordDoc) => {
      if (uId && r.userId.toString() !== uId) return false;
      if (queryDate?.$in && !queryDate.$in.includes(r.date)) return false;
      if (queryDate?.$gte && r.date < queryDate.$gte) return false;
      if (queryDate?.$lte && r.date > queryDate.$lte) return false;
      return true;
    };

    return {
      sort: () => mockRecords.filter(filterFn),
      then: (resolve: (records: MockRecordDoc[]) => void) => resolve(mockRecords.filter(filterFn)),
    };
  };

  prayerModel.findOneAndUpdate = async (
    filter: { userId?: mongoose.Types.ObjectId | string; date?: string },
    update: { $set?: Record<string, unknown>; $setOnInsert?: Record<string, unknown> }
  ) => {
    const uId = filter.userId?.toString();
    let rec = mockRecords.find((r) => r.userId.toString() === uId && r.date === filter.date);
    if (!rec) {
      rec = createMockRecord(filter.date || '2026-10-10', new mongoose.Types.ObjectId(uId));
      mockRecords.push(rec);
    }
    if (update.$set) {
      for (const [path, val] of Object.entries(update.$set)) {
        const parts = path.split('.');
        if (parts.length === 3 && parts[0] === 'prayers') {
          const pId = parts[1] as PrayerId;
          const field = parts[2] as 'status' | 'notes' | 'prayedAt' | 'missedAt' | 'madeUpAt';
          if (!rec.prayers[pId]) {
            rec.prayers[pId] = { status: 'PENDING' };
          }
          (rec.prayers[pId] as Record<string, unknown>)[field] = val;
        }
      }
    }
    return rec;
  };

  paymentModel.findOne = async (query: { userId?: mongoose.Types.ObjectId | string; idempotencyKey?: string }) => {
    const uId = query.userId?.toString();
    return mockPayments.find((p) => p.userId.toString() === uId && p.idempotencyKey === query.idempotencyKey) || null;
  };

  paymentModel.find = (query: { userId?: mongoose.Types.ObjectId | string }) => {
    const uId = query.userId?.toString();
    const filterFn = (p: MockPaymentDoc) => !uId || p.userId.toString() === uId;
    return {
      sort: () => mockPayments.filter(filterFn),
      then: (resolve: (payments: MockPaymentDoc[]) => void) => resolve(mockPayments.filter(filterFn)),
    };
  };

  QazaPayment.prototype.save = async function (this: unknown) {
    const doc = this as MockPaymentDoc;
    if (!doc._id) {
      doc._id = new mongoose.Types.ObjectId();
    }
    if (!doc.createdAt) {
      doc.createdAt = new Date();
    }
    if (!doc.updatedAt) {
      doc.updatedAt = new Date();
    }
    mockPayments.push(doc);
    return doc;
  };
}

function createMockRecord(date: string, userId: mongoose.Types.ObjectId = testUserId): MockRecordDoc {
  const doc: MockRecordDoc = {
    _id: new mongoose.Types.ObjectId(),
    userId,
    date,
    prayers: {
      fajr: { status: 'PENDING', isPaid: false, paidAmount: 0 },
      dhuhr: { status: 'PENDING', isPaid: false, paidAmount: 0 },
      asr: { status: 'PENDING', isPaid: false, paidAmount: 0 },
      maghrib: { status: 'PENDING', isPaid: false, paidAmount: 0 },
      isha: { status: 'PENDING', isPaid: false, paidAmount: 0 },
    },
    finesAccrued: 0,
    save: async function () {
      return this;
    },
    markModified: () => {},
  };
  return doc;
}

describe('Qaza Payment & Sadaqah Tracking Engine', () => {
  beforeEach(() => {
    setupMocks();
  });

  describe('1. GET /api/prayers/qaza-payment', () => {
    it('returns 401 when request is unauthenticated', async () => {
      const req = new NextRequest('http://localhost:3000/api/prayers/qaza-payment');
      const res = await getPaymentHistoryHandler(req);
      assert.equal(res.status, 401);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.code, 'AUTH_UNAUTHORIZED');
    });

    it('returns empty array when user has no payment records', async () => {
      const req = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        headers: { cookie: `salahtrack_session=${validSessionToken}` },
      });
      const res = await getPaymentHistoryHandler(req);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.deepEqual(json.data, []);
    });

    it('returns user payments and strictly isolates other users records', async () => {
      // Payment for test user
      mockPayments.push({
        _id: new mongoose.Types.ObjectId(),
        userId: testUserId,
        items: [
          {
            date: '2026-10-01',
            prayerId: 'fajr',
            status: 'MISSED',
            amount: 30000,
            isOverdue: true,
          },
        ],
        totalAmount: 30000,
        createdAt: new Date('2026-10-10T12:00:00Z'),
        updatedAt: new Date('2026-10-10T12:00:00Z'),
        save: async function () { return this; },
      });

      // Payment for other user
      mockPayments.push({
        _id: new mongoose.Types.ObjectId(),
        userId: otherUserId,
        items: [
          {
            date: '2026-10-02',
            prayerId: 'dhuhr',
            status: 'MISSED',
            amount: 15000,
            isOverdue: false,
          },
        ],
        totalAmount: 15000,
        createdAt: new Date('2026-10-11T12:00:00Z'),
        updatedAt: new Date('2026-10-11T12:00:00Z'),
        save: async function () { return this; },
      });

      const req = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        headers: { cookie: `salahtrack_session=${validSessionToken}` },
      });
      const res = await getPaymentHistoryHandler(req);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.length, 1);
      assert.equal(json.data[0].totalAmount, 30000);
      assert.equal(json.data[0].userId, testUserId.toString());
    });
  });

  describe('2. POST /api/prayers/qaza-payment Validation & Error Guards', () => {
    it('returns 401 when request is unauthenticated', async () => {
      const req = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        body: JSON.stringify({ items: [{ date: '2026-10-10', prayerId: 'fajr' }] }),
      });
      const res = await payQazaHandler(req);
      assert.equal(res.status, 401);
    });

    it('rejects empty or malformed body with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${validSessionToken}` },
        body: JSON.stringify({}),
      });
      const res = await payQazaHandler(req);
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.code, 'VALIDATION_FAILED');
    });

    it('rejects invalid calendar dates with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${validSessionToken}` },
        body: JSON.stringify({ items: [{ date: '2026-02-31', prayerId: 'fajr' }] }),
      });
      const res = await payQazaHandler(req);
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.code, 'INVALID_DATE');
    });

    it('rejects invalid prayer IDs with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${validSessionToken}` },
        body: JSON.stringify({ items: [{ date: '2026-10-10', prayerId: 'tahajjud' }] }),
      });
      const res = await payQazaHandler(req);
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.code, 'INVALID_PRAYER_ID');
    });

    it('rejects duplicate prayers in the same request payload with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${validSessionToken}` },
        body: JSON.stringify({
          items: [
            { date: '2026-10-10', prayerId: 'fajr' },
            { date: '2026-10-10', prayerId: 'fajr' },
          ],
        }),
      });
      const res = await payQazaHandler(req);
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.code, 'DUPLICATE_ITEM');
    });

    it('rejects when prayer record for the given date does not exist', async () => {
      const req = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${validSessionToken}` },
        body: JSON.stringify({ items: [{ date: '2026-10-05', prayerId: 'fajr' }] }),
      });
      const res = await payQazaHandler(req);
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.code, 'RECORD_NOT_FOUND');
    });

    it('rejects when prayer status is PRAYED_ON_TIME (only MISSED/MADE_UP accrue fines)', async () => {
      const record = createMockRecord('2026-10-05');
      record.prayers.fajr = { status: 'PRAYED_ON_TIME', isPaid: false };
      mockRecords.push(record);

      const req = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${validSessionToken}` },
        body: JSON.stringify({ items: [{ date: '2026-10-05', prayerId: 'fajr' }] }),
      });
      const res = await payQazaHandler(req);
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.code, 'INVALID_PRAYER_STATUS_FOR_PAYMENT');
    });

    it('rejects with 409 Conflict when prayer is already paid', async () => {
      const record = createMockRecord('2026-10-05');
      record.prayers.fajr = {
        status: 'MISSED',
        isPaid: true,
        paidAt: new Date('2026-10-06T10:00:00Z'),
        paidAmount: 15000,
      };
      mockRecords.push(record);

      const req = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${validSessionToken}` },
        body: JSON.stringify({ items: [{ date: '2026-10-05', prayerId: 'fajr' }] }),
      });
      const res = await payQazaHandler(req);
      assert.equal(res.status, 409);
      const json = await res.json();
      assert.equal(json.code, 'ALREADY_PAID');
    });
  });

  describe('3. POST /api/prayers/qaza-payment Fine Settlement & Ledger Execution', () => {
    it('rejects settling a MISSED prayer when confirmedMadeUp is false or missing', async () => {
      const todayStr = new Date().toISOString().split('T')[0];
      const record = createMockRecord(todayStr);
      record.prayers.dhuhr = { status: 'MISSED', isPaid: false, paidAmount: 0 };
      record.finesAccrued = 15000;
      mockRecords.push(record);

      const req = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${validSessionToken}` },
        body: JSON.stringify({ items: [{ date: todayStr, prayerId: 'dhuhr' }] }),
      });
      const res = await payQazaHandler(req);
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.code, 'CONFIRMATION_REQUIRED');
      assert.equal(
        json.error,
        'You must confirm that the selected missed prayers have been made up before settling sadaqah. Sadaqah does not substitute obligatory prayer.'
      );
    });

    it('settles a recent MISSED prayer (<= 7 days) at 15,000 UZS base fine when confirmedMadeUp is true', async () => {
      const todayStr = new Date().toISOString().split('T')[0];
      const record = createMockRecord(todayStr);
      record.prayers.dhuhr = { status: 'MISSED', isPaid: false, paidAmount: 0 };
      record.finesAccrued = 15000;
      mockRecords.push(record);

      const req = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${validSessionToken}` },
        body: JSON.stringify({
          items: [{ date: todayStr, prayerId: 'dhuhr' }],
          confirmedMadeUp: true,
        }),
      });
      const res = await payQazaHandler(req);
      assert.equal(res.status, 201);
      const json = await res.json();

      assert.equal(json.success, true);
      assert.equal(json.data.totalAmount, 15000);
      assert.equal(json.data.items[0].amount, 15000);
      assert.equal(json.data.items[0].status, 'MADE_UP');
      assert.equal(json.data.items[0].isOverdue, false);

      // Verify the underlying prayer record was updated to MADE_UP and marked paid
      assert.equal(record.prayers.dhuhr.status, 'MADE_UP');
      assert.ok(record.prayers.dhuhr.madeUpAt);
      assert.equal(record.prayers.dhuhr.isPaid, true);
      assert.equal(record.prayers.dhuhr.paidAmount, 15000);
      assert.equal(record.finesAccrued, 0); // Settled prayer has 0 remaining fine
    });

    it('settles an overdue MISSED prayer (> 7 days) at 30,000 UZS when confirmedMadeUp is true', async () => {
      const oldDate = '2026-09-01'; // well over 7 days ago
      const record = createMockRecord(oldDate);
      record.prayers.asr = { status: 'MISSED', isPaid: false, paidAmount: 0 };
      record.finesAccrued = 30000;
      mockRecords.push(record);

      const req = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${validSessionToken}` },
        body: JSON.stringify({
          items: [{ date: oldDate, prayerId: 'asr' }],
          confirmedMadeUp: true,
        }),
      });
      const res = await payQazaHandler(req);
      assert.equal(res.status, 201);
      const json = await res.json();

      assert.equal(json.success, true);
      assert.equal(json.data.totalAmount, 30000);
      assert.equal(json.data.items[0].amount, 30000);
      assert.equal(json.data.items[0].status, 'MADE_UP');
      assert.equal(json.data.items[0].isOverdue, true);

      assert.equal(record.prayers.asr.status, 'MADE_UP');
      assert.ok(record.prayers.asr.madeUpAt);
      assert.equal(record.prayers.asr.isPaid, true);
      assert.equal(record.prayers.asr.paidAmount, 30000);
      assert.equal(record.finesAccrued, 0);
    });

    it('settles a MADE_UP prayer at 15,000 UZS even if older than 7 days (does not require confirmedMadeUp)', async () => {
      const oldDate = '2026-09-01';
      const record = createMockRecord(oldDate);
      record.prayers.maghrib = { status: 'MADE_UP', isPaid: false, paidAmount: 0 };
      record.finesAccrued = 15000;
      mockRecords.push(record);

      const req = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${validSessionToken}` },
        body: JSON.stringify({ items: [{ date: oldDate, prayerId: 'maghrib' }] }),
      });
      const res = await payQazaHandler(req);
      assert.equal(res.status, 201);
      const json = await res.json();

      assert.equal(json.success, true);
      assert.equal(json.data.totalAmount, 15000); // Capped at 15k, no overdue penalty
      assert.equal(json.data.items[0].status, 'MADE_UP');
      assert.equal(record.prayers.maghrib.status, 'MADE_UP');
      assert.equal(record.prayers.maghrib.isPaid, true);
      assert.equal(record.finesAccrued, 0);
    });

    it('supports idempotency keys and returns existing payment receipt on duplicate replay', async () => {
      const todayStr = new Date().toISOString().split('T')[0];
      const record = createMockRecord(todayStr);
      record.prayers.isha = { status: 'MISSED', isPaid: false, paidAmount: 0 };
      mockRecords.push(record);

      const payload = {
        items: [{ date: todayStr, prayerId: 'isha' }],
        confirmedMadeUp: true,
        idempotencyKey: 'idemp-tx-12345',
        note: 'Charity payment for Isha',
      };

      // First request
      const req1 = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${validSessionToken}` },
        body: JSON.stringify(payload),
      });
      const res1 = await payQazaHandler(req1);
      assert.equal(res1.status, 201);
      const json1 = await res1.json();

      // Second replay request with same idempotencyKey
      const req2 = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${validSessionToken}` },
        body: JSON.stringify(payload),
      });
      const res2 = await payQazaHandler(req2);
      assert.equal(res2.status, 200); // 200 OK idempotent response
      const json2 = await res2.json();
      assert.equal(json2.success, true);
      assert.equal(json2.data.id, json1.data.id);
      assert.equal(json2.data.idempotencyKey, 'idemp-tx-12345');
    });
  });

  describe('4. Tamper Defense: Locked Status & Zero Re-fining', () => {
    it('disallows altering a settled/paid prayer to PENDING or PRAYED_ON_TIME in POST /api/prayers', async () => {
      const dateStr = '2026-10-01';
      const record = createMockRecord(dateStr);
      record.prayers.fajr = {
        status: 'MISSED',
        isPaid: true,
        paidAt: new Date(),
        paidAmount: 30000,
      };
      mockRecords.push(record);

      // Attempt to revert to PENDING
      const req = new NextRequest('http://localhost:3000/api/prayers', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${validSessionToken}` },
        body: JSON.stringify({
          date: dateStr,
          prayerId: 'fajr',
          status: 'PENDING',
        }),
      });
      const res = await updatePrayerHandler(req);
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.code, 'PAID_PRAYER_LOCKED');
    });

    it('allows updating a paid MISSED prayer to MADE_UP while strictly preserving isPaid: true', async () => {
      const dateStr = '2026-10-01';
      const record = createMockRecord(dateStr);
      const paidDate = new Date('2026-10-02T10:00:00Z');
      record.prayers.fajr = {
        status: 'MISSED',
        isPaid: true,
        paidAt: paidDate,
        paidAmount: 30000,
      };
      mockRecords.push(record);

      const req = new NextRequest('http://localhost:3000/api/prayers', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${validSessionToken}` },
        body: JSON.stringify({
          date: dateStr,
          prayerId: 'fajr',
          status: 'MADE_UP',
        }),
      });
      const res = await updatePrayerHandler(req);
      assert.equal(res.status, 200);

      // Verify status is updated to MADE_UP but isPaid remains true
      assert.equal(record.prayers.fajr.status, 'MADE_UP');
      assert.equal(record.prayers.fajr.isPaid, true);
      assert.equal(record.prayers.fajr.paidAmount, 30000);
      assert.equal(calculateFines(dateStr, record.prayers), 0);
    });

    it('calculateFines returns 0 for records where all missed prayers are paid', () => {
      const prayers = {
        fajr: { status: 'MISSED' as PrayerStatus, isPaid: true },
        dhuhr: { status: 'MADE_UP' as PrayerStatus, isPaid: true },
        asr: { status: 'PRAYED_ON_TIME' as PrayerStatus },
        maghrib: { status: 'PENDING' as PrayerStatus },
        isha: { status: 'PENDING' as PrayerStatus },
      };
      const fine = calculateFines('2026-09-01', prayers);
      assert.equal(fine, 0);
    });
  });

  describe('5. GET /api/stats Qaza & Accountability Integration', () => {
    it('excludes paid prayers from outstanding balance and includes totalPaidAmount', async () => {
      const todayStr = '2026-10-15';

      // Record 1: unpaid missed prayer (15k)
      const rec1 = createMockRecord('2026-10-14');
      rec1.prayers.fajr = { status: 'MISSED', isPaid: false };
      mockRecords.push(rec1);

      // Record 2: paid missed prayer (should NOT be in outstanding)
      const rec2 = createMockRecord('2026-10-13');
      rec2.prayers.dhuhr = { status: 'MISSED', isPaid: true, paidAmount: 30000 };
      mockRecords.push(rec2);

      // Recorded payment in QazaPayment
      mockPayments.push({
        _id: new mongoose.Types.ObjectId(),
        userId: testUserId,
        items: [{ date: '2026-10-13', prayerId: 'dhuhr', status: 'MISSED', amount: 30000, isOverdue: true }],
        totalAmount: 30000,
        createdAt: new Date(),
        updatedAt: new Date(),
        save: async function () { return this; },
      });

      const req = new NextRequest(`http://localhost:3000/api/stats?today=${todayStr}`, {
        headers: { cookie: `salahtrack_session=${validSessionToken}` },
      });
      const res = await getStatsHandler(req);
      assert.equal(res.status, 200);
      const json = await res.json();

      assert.equal(json.success, true);
      // Only unpaid fajr (15k) is outstanding
      assert.equal(json.data.accountability.totalAmount, 15000);
      assert.equal(json.data.accountability.totalMissed, 1);
      assert.equal(json.data.accountability.totalPaidAmount, 30000);
      assert.equal(json.data.accountability.breakdown.length, 1);
      assert.equal(json.data.accountability.breakdown[0].prayerId, 'fajr');
    });

    it('accurately sums totalPaidAmount across multiple payments and distinguishes unpaid MISSED and MADE_UP', async () => {
      const todayStr = '2026-10-20';

      // Record 1: unpaid MISSED prayer (recent, 15k)
      const rec1 = createMockRecord('2026-10-19');
      rec1.prayers.fajr = { status: 'MISSED', isPaid: false };
      mockRecords.push(rec1);

      // Record 2: unpaid MADE_UP prayer (older than 7 days, 15k, capped, no overdue penalty)
      const rec2 = createMockRecord('2026-10-01');
      rec2.prayers.dhuhr = { status: 'MADE_UP', isPaid: false };
      mockRecords.push(rec2);

      // Record 3: paid prayer (should be skipped from outstanding and breakdown)
      const rec3 = createMockRecord('2026-10-02');
      rec3.prayers.asr = { status: 'MADE_UP', isPaid: true, paidAmount: 15000 };
      mockRecords.push(rec3);

      // Multiple payments in payment collection
      mockPayments.push({
        _id: new mongoose.Types.ObjectId(),
        userId: testUserId,
        items: [{ date: '2026-10-02', prayerId: 'asr', status: 'MADE_UP', amount: 15000, isOverdue: false }],
        totalAmount: 15000,
        createdAt: new Date('2026-10-03T10:00:00Z'),
        updatedAt: new Date('2026-10-03T10:00:00Z'),
        save: async function () { return this; },
      });
      mockPayments.push({
        _id: new mongoose.Types.ObjectId(),
        userId: testUserId,
        items: [{ date: '2026-09-15', prayerId: 'maghrib', status: 'MADE_UP', amount: 30000, isOverdue: true }],
        totalAmount: 30000,
        createdAt: new Date('2026-10-05T10:00:00Z'),
        updatedAt: new Date('2026-10-05T10:00:00Z'),
        save: async function () { return this; },
      });

      const req = new NextRequest(`http://localhost:3000/api/stats?today=${todayStr}`, {
        headers: { cookie: `salahtrack_session=${validSessionToken}` },
      });
      const res = await getStatsHandler(req);
      assert.equal(res.status, 200);
      const json = await res.json();

      assert.equal(json.success, true);
      // Total paid across both payments = 15000 + 30000 = 45000
      assert.equal(json.data.accountability.totalPaidAmount, 45000);
      // Outstanding: 1 MISSED (15k) + 1 MADE_UP (15k) = 30000
      assert.equal(json.data.accountability.totalAmount, 30000);
      assert.equal(json.data.accountability.totalMissed, 1);
      assert.equal(json.data.accountability.totalMadeUp, 1);
      assert.equal(json.data.accountability.totalOverdue, 0); // neither is overdue
      assert.equal(json.data.accountability.breakdown.length, 2);

      const missedItem = json.data.accountability.breakdown.find((b: { prayerId: string }) => b.prayerId === 'fajr');
      assert.ok(missedItem);
      assert.equal(missedItem.status, 'MISSED');
      assert.equal(missedItem.totalAmount, 15000);

      const madeUpItem = json.data.accountability.breakdown.find((b: { prayerId: string }) => b.prayerId === 'dhuhr');
      assert.ok(madeUpItem);
      assert.equal(madeUpItem.status, 'MADE_UP');
      assert.equal(madeUpItem.totalAmount, 15000);
      assert.equal(madeUpItem.isOverdue, false);
    });
  });
});
