import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server.js';
import fs from 'node:fs';
import path from 'node:path';

import { PrayerRecord } from '../../src/models/Prayer.ts';
import { QazaPayment, type IQazaPaymentItem } from '../../src/models/QazaPayment.ts';
import { User } from '../../src/models/User.ts';
import { Session } from '../../src/models/Session.ts';
import { POST as payQazaHandler, GET as getPaymentHistoryHandler } from '../../src/app/api/prayers/qaza-payment/route.ts';
import { POST as updatePrayerHandler } from '../../src/app/api/prayers/route.ts';
import { GET as getStatsHandler } from '../../src/app/api/stats/route.ts';
import nextConfig from '../../next.config.ts';
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

const userAId = new mongoose.Types.ObjectId();
const userBId = new mongoose.Types.ObjectId();
const sessionTokenUserA = 'session-user-a';
const sessionTokenUserB = 'session-user-b';

function setupSecurityMocks() {
  mockRecords = [];
  mockPayments = [];
  mockUsers = [
    { _id: userAId, username: 'user_a' },
    { _id: userBId, username: 'user_b' },
  ];
  mockSessions = [
    {
      sessionToken: sessionTokenUserA,
      userId: userAId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      lastActiveAt: new Date(),
      save: async () => true,
    },
    {
      sessionToken: sessionTokenUserB,
      userId: userBId,
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
    // Check compound unique index { userId, idempotencyKey }
    if (doc.idempotencyKey) {
      const collision = mockPayments.find(
        (p) => p.userId.toString() === doc.userId.toString() && p.idempotencyKey === doc.idempotencyKey
      );
      if (collision) {
        const err = new Error('E11000 duplicate key error') as Error & { code: number };
        err.code = 11000;
        throw err;
      }
    }
    if (!doc._id) doc._id = new mongoose.Types.ObjectId();
    if (!doc.createdAt) doc.createdAt = new Date();
    if (!doc.updatedAt) doc.updatedAt = new Date();
    mockPayments.push(doc);
    return doc;
  };
}

function createRecordForUser(userId: mongoose.Types.ObjectId, date: string): MockRecordDoc {
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
    save: async function () { return this; },
    markModified: () => {},
  };
  return doc;
}

describe('End-to-End Qaza / Sadaqah Security & DevOps Audit', () => {
  beforeEach(() => {
    setupSecurityMocks();
  });

  describe('1. Authorization & BOLA / IDOR Verification', () => {
    it('rejects unauthenticated requests with 401 Unauthorized', async () => {
      const getRes = await getPaymentHistoryHandler(new NextRequest('http://localhost:3000/api/prayers/qaza-payment'));
      assert.equal(getRes.status, 401);

      const postRes = await payQazaHandler(new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        body: JSON.stringify({ items: [{ date: '2026-10-10', prayerId: 'fajr' }] }),
      }));
      assert.equal(postRes.status, 401);
    });

    it('prevents User A from settling User B prayer records (BOLA/IDOR prevention)', async () => {
      // Create prayer record exclusively belonging to User B
      const recordB = createRecordForUser(userBId, '2026-10-10');
      recordB.prayers.fajr = { status: 'MISSED', isPaid: false, paidAmount: 0 };
      mockRecords.push(recordB);

      // User A attempts to settle User B's record
      const req = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
        body: JSON.stringify({
          items: [{ date: '2026-10-10', prayerId: 'fajr' }],
          confirmedMadeUp: true,
        }),
      });

      const res = await payQazaHandler(req);
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.code, 'RECORD_NOT_FOUND');
      // Verify User B's prayer remains untouched
      assert.equal(recordB.prayers.fajr.status, 'MISSED');
      assert.equal(recordB.prayers.fajr.isPaid, false);
    });

    it('isolates payment history in GET /api/prayers/qaza-payment strictly to authenticated user', async () => {
      // Payment doc for User B
      mockPayments.push({
        _id: new mongoose.Types.ObjectId(),
        userId: userBId,
        items: [{ date: '2026-10-01', prayerId: 'fajr', status: 'MISSED', amount: 30000, isOverdue: true }],
        totalAmount: 30000,
        createdAt: new Date(),
        updatedAt: new Date(),
        save: async function () { return this; },
      });

      // User A requests history
      const req = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
      });
      const res = await getPaymentHistoryHandler(req);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.data.length, 0);
    });
  });

  describe('2. Idempotency Key Handling & Replay Protection', () => {
    it('returns 200 OK idempotent replay on duplicate request and avoids double mutation', async () => {
      const recA = createRecordForUser(userAId, '2026-10-15');
      recA.prayers.fajr = { status: 'MISSED', isPaid: false, paidAmount: 0 };
      mockRecords.push(recA);

      const payload = {
        items: [{ date: '2026-10-15', prayerId: 'fajr' }],
        confirmedMadeUp: true,
        idempotencyKey: 'tx-audit-key-100',
      };

      // Initial request
      const req1 = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
        body: JSON.stringify(payload),
      });
      const res1 = await payQazaHandler(req1);
      assert.equal(res1.status, 201);
      const json1 = await res1.json();
      const originalPaymentId = json1.data.id;

      // Replay request
      const req2 = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
        body: JSON.stringify(payload),
      });
      const res2 = await payQazaHandler(req2);
      assert.equal(res2.status, 200);
      const json2 = await res2.json();
      assert.equal(json2.data.id, originalPaymentId);
      assert.match(json2.message, /idempotent replay/i);

      // Verify only 1 payment was recorded in total
      const paymentsForUser = mockPayments.filter((p) => p.userId.toString() === userAId.toString());
      assert.equal(paymentsForUser.length, 1);
    });

    it('isolates idempotency keys across users: User B can use the same key without cross-user collision', async () => {
      const recA = createRecordForUser(userAId, '2026-10-15');
      recA.prayers.fajr = { status: 'MISSED', isPaid: false, paidAmount: 0 };
      mockRecords.push(recA);

      const recB = createRecordForUser(userBId, '2026-10-16');
      recB.prayers.dhuhr = { status: 'MISSED', isPaid: false, paidAmount: 0 };
      mockRecords.push(recB);

      const sharedKey = 'common-device-generated-key';

      // User A submits with sharedKey
      const reqA = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
        body: JSON.stringify({
          items: [{ date: '2026-10-15', prayerId: 'fajr' }],
          confirmedMadeUp: true,
          idempotencyKey: sharedKey,
        }),
      });
      const resA = await payQazaHandler(reqA);
      assert.equal(resA.status, 201);

      // User B submits with the same sharedKey
      const reqB = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${sessionTokenUserB}` },
        body: JSON.stringify({
          items: [{ date: '2026-10-16', prayerId: 'dhuhr' }],
          confirmedMadeUp: true,
          idempotencyKey: sharedKey,
        }),
      });
      const resB = await payQazaHandler(reqB);
      // User B should succeed with 201 Created independently (NOT trigger User A replay or 500 collision)
      assert.equal(resB.status, 201);
      const jsonB = await resB.json();
      assert.equal(jsonB.data.userId, userBId.toString());
      assert.equal(mockPayments.length, 2);
    });

    it('rejects batch payloads exceeding MAX_PAYMENT_ITEMS with 400 BATCH_LIMIT_EXCEEDED', async () => {
      const excessiveItems = Array.from({ length: 501 }, () => ({
        date: '2026-01-01',
        prayerId: 'fajr' as PrayerId,
      }));

      const req = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
        body: JSON.stringify({
          items: excessiveItems,
          confirmedMadeUp: true,
        }),
      });
      const res = await payQazaHandler(req);
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.code, 'BATCH_LIMIT_EXCEEDED');
    });
  });

  describe('3. Confirmation Enforcement & Religious Guardrails', () => {
    it('strictly requires confirmedMadeUp === true for MISSED prayers', async () => {
      const rec = createRecordForUser(userAId, '2026-10-18');
      rec.prayers.asr = { status: 'MISSED', isPaid: false, paidAmount: 0 };
      mockRecords.push(rec);

      // Missing confirmation
      const reqMissing = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
        body: JSON.stringify({ items: [{ date: '2026-10-18', prayerId: 'asr' }] }),
      });
      const resMissing = await payQazaHandler(reqMissing);
      assert.equal(resMissing.status, 400);
      assert.equal((await resMissing.json()).code, 'CONFIRMATION_REQUIRED');

      // Falsy confirmation
      const reqFalse = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
        body: JSON.stringify({ items: [{ date: '2026-10-18', prayerId: 'asr' }], confirmedMadeUp: false }),
      });
      const resFalse = await payQazaHandler(reqFalse);
      assert.equal(resFalse.status, 400);

      // String truthy confirmation
      const reqString = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
        body: JSON.stringify({ items: [{ date: '2026-10-18', prayerId: 'asr' }], confirmedMadeUp: 'true' }),
      });
      const resString = await payQazaHandler(reqString);
      assert.equal(resString.status, 400);
    });

    it('allows settling already MADE_UP prayers without confirmedMadeUp flag', async () => {
      const rec = createRecordForUser(userAId, '2026-10-18');
      rec.prayers.maghrib = { status: 'MADE_UP', isPaid: false, paidAmount: 0 };
      mockRecords.push(rec);

      const req = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
        body: JSON.stringify({ items: [{ date: '2026-10-18', prayerId: 'maghrib' }] }),
      });
      const res = await payQazaHandler(req);
      assert.equal(res.status, 201);
      const json = await res.json();
      assert.equal(json.success, true);
    });
  });

  describe('4. Status Transition & Tamper Resistance', () => {
    it('rejects settling prayers with non-MISSED/MADE_UP status', async () => {
      const rec = createRecordForUser(userAId, '2026-10-18');
      rec.prayers.isha = { status: 'PRAYED_ON_TIME', isPaid: false };
      mockRecords.push(rec);

      const req = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
        body: JSON.stringify({ items: [{ date: '2026-10-18', prayerId: 'isha' }] }),
      });
      const res = await payQazaHandler(req);
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.code, 'INVALID_PRAYER_STATUS_FOR_PAYMENT');
    });

    it('rejects settling already settled prayers with 409 Conflict', async () => {
      const rec = createRecordForUser(userAId, '2026-10-18');
      rec.prayers.fajr = { status: 'MADE_UP', isPaid: true, paidAmount: 15000 };
      mockRecords.push(rec);

      const req = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
        body: JSON.stringify({ items: [{ date: '2026-10-18', prayerId: 'fajr' }] }),
      });
      const res = await payQazaHandler(req);
      assert.equal(res.status, 409);
      const json = await res.json();
      assert.equal(json.code, 'ALREADY_PAID');
    });

    it('ignores client-supplied amounts and enforces server-calculated fines', async () => {
      const rec = createRecordForUser(userAId, '2026-10-18');
      rec.prayers.fajr = { status: 'MISSED', isPaid: false };
      mockRecords.push(rec);

      const req = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
        body: JSON.stringify({
          items: [{ date: '2026-10-18', prayerId: 'fajr', amount: 100 }], // Attempt to pay 100 UZS
          confirmedMadeUp: true,
        }),
      });
      const res = await payQazaHandler(req);
      assert.equal(res.status, 201);
      const json = await res.json();
      // Server enforces 15,000 UZS base fine
      assert.equal(json.data.totalAmount, 15000);
      assert.equal(rec.prayers.fajr.paidAmount, 15000);
    });

    it('locks settled/paid prayers in POST /api/prayers against reversal to PENDING or PRAYED_ON_TIME', async () => {
      const rec = createRecordForUser(userAId, '2026-10-18');
      rec.prayers.fajr = { status: 'MADE_UP', isPaid: true, paidAmount: 15000 };
      mockRecords.push(rec);

      const req = new NextRequest('http://localhost:3000/api/prayers', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
        body: JSON.stringify({
          date: '2026-10-18',
          prayerId: 'fajr',
          status: 'PENDING',
        }),
      });
      const res = await updatePrayerHandler(req);
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.code, 'PAID_PRAYER_LOCKED');
    });
  });

  describe('5. GET /api/stats Isolation & Query Safety', () => {
    it('calculates totalPaidAmount strictly isolated to the authenticated user', async () => {
      // User A payment: 15,000
      mockPayments.push({
        _id: new mongoose.Types.ObjectId(),
        userId: userAId,
        items: [{ date: '2026-10-10', prayerId: 'fajr', status: 'MADE_UP', amount: 15000, isOverdue: false }],
        totalAmount: 15000,
        createdAt: new Date(),
        updatedAt: new Date(),
        save: async function () { return this; },
      });

      // User B payment: 45,000 (must NOT be counted in User A stats)
      mockPayments.push({
        _id: new mongoose.Types.ObjectId(),
        userId: userBId,
        items: [{ date: '2026-10-10', prayerId: 'dhuhr', status: 'MADE_UP', amount: 45000, isOverdue: true }],
        totalAmount: 45000,
        createdAt: new Date(),
        updatedAt: new Date(),
        save: async function () { return this; },
      });

      const req = new NextRequest('http://localhost:3000/api/stats?today=2026-10-20', {
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
      });
      const res = await getStatsHandler(req);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.data.accountability.totalPaidAmount, 15000);
    });

    it('safely handles malicious NoSQL operator strings in today query param without throwing', async () => {
      const maliciousPayloads = [
        '{"$gt": ""}',
        '{"$ne": null}',
        '2026-10-20; $where: "1 == 1"',
        '../etc/passwd',
      ];

      for (const payload of maliciousPayloads) {
        const req = new NextRequest(`http://localhost:3000/api/stats?today=${encodeURIComponent(payload)}`, {
          headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
        });
        const res = await getStatsHandler(req);
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.success, true);
      }
    });
  });

  describe('6. Secrets Hygiene & Security Headers Configuration', () => {
    it('verifies .env.local is strictly git-ignored in .gitignore', () => {
      const gitignoreContent = fs.readFileSync(path.resolve(process.cwd(), '.gitignore'), 'utf8');
      assert.match(gitignoreContent, /\.env\.\*/);
      assert.match(gitignoreContent, /!\.env\.example/);
    });

    it('verifies next.config.ts exports strict production security headers', async () => {
      const headersConfig = typeof nextConfig.headers === 'function' ? await nextConfig.headers() : [];
      assert.ok(Array.isArray(headersConfig) && headersConfig.length > 0);

      const allRouteHeaders = headersConfig[0].headers;
      const headerMap = new Map(allRouteHeaders.map((h: { key: string; value: string }) => [h.key, h.value]));

      // Verify HSTS
      assert.ok(headerMap.has('Strict-Transport-Security'));
      assert.match(headerMap.get('Strict-Transport-Security')!, /max-age=63072000/);

      // Verify Content-Security-Policy
      assert.ok(headerMap.has('Content-Security-Policy'));
      assert.match(headerMap.get('Content-Security-Policy')!, /default-src 'self'/);

      // Verify Frame Options & Nosniff
      assert.equal(headerMap.get('X-Frame-Options'), 'DENY');
      assert.equal(headerMap.get('X-Content-Type-Options'), 'nosniff');

      // Verify Cross Origin Isolation
      assert.equal(headerMap.get('Cross-Origin-Opener-Policy'), 'same-origin');
      assert.equal(headerMap.get('Cross-Origin-Resource-Policy'), 'same-origin');
    });
  });
});
