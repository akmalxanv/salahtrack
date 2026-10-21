import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server.js';

import { PrayerRecord } from '../../src/models/Prayer.ts';
import { QazaPayment, type IQazaPaymentItem } from '../../src/models/QazaPayment.ts';
import { User } from '../../src/models/User.ts';
import { Session } from '../../src/models/Session.ts';
import { Group } from '../../src/models/Group.ts';

import {
  calculateAuthoritativeDebt,
  calculateAccountabilityFines,
  calculateAccountabilityLedger,
  calculateDaysPassed,
  isOverduePrayer,
} from '../../src/lib/accountability.ts';

import { POST as payQazaHandler } from '../../src/app/api/prayers/qaza-payment/route.ts';
import { POST as updatePrayerHandler } from '../../src/app/api/prayers/route.ts';
import { POST as rolloverHandler } from '../../src/app/api/prayers/rollover/route.ts';
import { GET as getStatsHandler } from '../../src/app/api/stats/route.ts';
import { GET as getGroupHandler } from '../../src/app/api/groups/[id]/route.ts';

import type { PrayerId, PrayerStatus, PrayerHistoryRecord } from '../../src/types/prayer.ts';

// ---------------------------------------------------------------------------
// In-Memory Test Harness & Database Mocks
// ---------------------------------------------------------------------------

interface MockRecordDoc {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  date: string;
  prayers: Record<
    PrayerId,
    {
      status: PrayerStatus;
      prayedAt?: Date;
      missedAt?: Date;
      madeUpAt?: Date;
      notes?: string;
      isPaid?: boolean;
      paidAt?: Date;
      paidAmount?: number;
    }
  >;
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

interface MockGroupDoc {
  _id: mongoose.Types.ObjectId;
  name: string;
  description: string;
  creatorId: mongoose.Types.ObjectId;
  inviteCode: string;
  members: Array<{
    userId: mongoose.Types.ObjectId;
    role: 'owner' | 'admin' | 'member';
    joinedAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
  save: () => Promise<MockGroupDoc>;
}

let mockRecords: MockRecordDoc[] = [];
let mockPayments: MockPaymentDoc[] = [];
let mockGroups: MockGroupDoc[] = [];
let mockUsers: Array<{
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  username: string;
  role: string;
  createdAt: Date;
}> = [];
let mockSessions: Array<{
  sessionToken: string;
  userId: mongoose.Types.ObjectId;
  expiresAt: Date;
  lastActiveAt: Date;
  save: () => Promise<unknown>;
}> = [];

const userAId = new mongoose.Types.ObjectId();
const userBId = new mongoose.Types.ObjectId();
const userNonMemberId = new mongoose.Types.ObjectId();

const sessionTokenUserA = 'session-user-a-debt-test';
const sessionTokenUserB = 'session-user-b-debt-test';
const sessionTokenNonMember = 'session-user-nonmember-debt-test';

function createMockRecord(
  date: string,
  userId = userAId,
  prayersConfig: Partial<Record<PrayerId, { status: PrayerStatus; isPaid?: boolean; paidAmount?: number }>> = {}
): MockRecordDoc {
  const pIds: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const prayers: MockRecordDoc['prayers'] = {} as MockRecordDoc['prayers'];

  for (const p of pIds) {
    const cfg = prayersConfig[p];
    prayers[p] = {
      status: cfg?.status || 'PENDING',
      isPaid: cfg?.isPaid || false,
      paidAmount: cfg?.paidAmount || 0,
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
      return this;
    },
  };

  doc.finesAccrued = calculateAccountabilityFines(date, doc.prayers, '2026-10-21');
  return doc;
}

function setupDatabaseMocks() {
  mockRecords = [];
  mockPayments = [];
  mockGroups = [];
  mockUsers = [
    { _id: userAId, name: 'User A', email: 'usera@example.com', username: 'usera', role: 'user', createdAt: new Date() },
    { _id: userBId, name: 'User B', email: 'userb@example.com', username: 'userb', role: 'user', createdAt: new Date() },
    {
      _id: userNonMemberId,
      name: 'User NonMember',
      email: 'nonmember@example.com',
      username: 'nonmember',
      role: 'user',
      createdAt: new Date(),
    },
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
    {
      sessionToken: sessionTokenNonMember,
      userId: userNonMemberId,
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
  const groupModel = Group as unknown as Record<string, unknown>;

  userModel.findById = async (id: mongoose.Types.ObjectId | string) => {
    return mockUsers.find((u) => u._id.toString() === id.toString()) || null;
  };

  userModel.find = (query?: { _id?: { $in?: Array<mongoose.Types.ObjectId | string> } }) => {
    let result = [...mockUsers];
    if (query?._id?.$in) {
      const idStrings = query._id.$in.map((id) => id.toString());
      result = result.filter((u) => idStrings.includes(u._id.toString()));
    }
    return {
      select: () => ({
        lean: async () => result,
      }),
      lean: async () => result,
    };
  };

  sessionModel.findOne = async (query: { sessionToken?: string }) => {
    return mockSessions.find((s) => s.sessionToken === query.sessionToken) || null;
  };

  prayerModel.findOne = async (query: { userId?: mongoose.Types.ObjectId | string; date?: string }) => {
    const uId = query.userId?.toString();
    return mockRecords.find((r) => r.userId.toString() === uId && r.date === query.date) || null;
  };

  prayerModel.find = (query: {
    userId?: mongoose.Types.ObjectId | string | { $in?: Array<mongoose.Types.ObjectId | string> };
    date?: unknown;
  }) => {
    let result = [...mockRecords];
    if (query?.userId) {
      if (typeof query.userId === 'object' && '$in' in query.userId && Array.isArray(query.userId.$in)) {
        const idStrings = query.userId.$in.map((id) => id.toString());
        result = result.filter((r) => idStrings.includes(r.userId.toString()));
      } else {
        const uId = query.userId.toString();
        result = result.filter((r) => r.userId.toString() === uId);
      }
    }

    const queryDate = query?.date as { $in?: string[]; $gte?: string; $lte?: string } | undefined;
    if (queryDate?.$in) {
      result = result.filter((r) => queryDate.$in!.includes(r.date));
    }
    if (queryDate?.$gte) {
      result = result.filter((r) => r.date >= queryDate.$gte!);
    }
    if (queryDate?.$lte) {
      result = result.filter((r) => r.date <= queryDate.$lte!);
    }

    const sortFn = (crit: { date?: number }) => {
      if (crit.date === -1) {
        result.sort((a, b) => b.date.localeCompare(a.date));
      } else if (crit.date === 1) {
        result.sort((a, b) => a.date.localeCompare(b.date));
      }
      return result;
    };

    const chain = {
      select: () => chain,
      lean: async () => result,
      sort: (crit: { date?: number }) => {
        sortFn(crit);
        return chain;
      },
      then: (resolve: (val: MockRecordDoc[]) => void) => resolve(result),
      [Symbol.iterator]: () => result[Symbol.iterator](),
    };
    return chain;
  };

  prayerModel.updateOne = async () => ({ modifiedCount: 1 });

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
        } else if (path === 'finesAccrued') {
          rec.finesAccrued = val as number;
        }
      }
    }
    return rec;
  };

  paymentModel.find = (query: { userId?: mongoose.Types.ObjectId | string }) => {
    const uId = query.userId?.toString();
    const result = mockPayments.filter((p) => !uId || p.userId.toString() === uId);
    return {
      sort: () => result,
      then: (resolve: (val: MockPaymentDoc[]) => void) => resolve(result),
    };
  };

  paymentModel.findOne = async (query: { userId?: mongoose.Types.ObjectId | string; idempotencyKey?: string }) => {
    const uId = query.userId?.toString();
    return (
      mockPayments.find(
        (p) => p.userId.toString() === uId && p.idempotencyKey === query.idempotencyKey
      ) || null
    );
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

  groupModel.findById = (id: mongoose.Types.ObjectId | string) => {
    const found = mockGroups.find((g) => g._id.toString() === id.toString()) || null;
    return {
      lean: async () => found,
      then: (resolve: (val: unknown) => void) => resolve(found),
    };
  };
}

// ---------------------------------------------------------------------------
// Regression Test Suite: Debt Consistency, Overdue Rules & Qaza Separation
// ---------------------------------------------------------------------------

describe('Debt Consistency, Overdue Penalties & Separate Qaza Obligations Suite', () => {
  beforeEach(() => {
    setupDatabaseMocks();
  });

  // =========================================================================
  // Requirement A: Single Authoritative Calculation across Dashboard, Progress, Leaderboard
  // =========================================================================
  describe('Requirement A: Single Authoritative Calculation across UI & API Consumers', () => {
    const referenceDate = '2026-10-21';

    const sampleDataset: PrayerHistoryRecord[] = [
      {
        date: '2026-10-19', // 2 days ago (<= 7 days): Fajr MISSED = 15,000 UZS
        finesAccrued: 15000,
        prayers: {
          fajr: { status: 'MISSED' },
          dhuhr: { status: 'PRAYED_ON_TIME' },
          asr: { status: 'PRAYED_ON_TIME' },
          maghrib: { status: 'PRAYED_ON_TIME' },
          isha: { status: 'PRAYED_ON_TIME' },
        },
      },
      {
        date: '2026-10-10', // 11 days ago (> 7 days): Dhuhr MISSED = 30,000 UZS
        finesAccrued: 30000,
        prayers: {
          fajr: { status: 'PRAYED_ON_TIME' },
          dhuhr: { status: 'MISSED' },
          asr: { status: 'PRAYED_ON_TIME' },
          maghrib: { status: 'PRAYED_ON_TIME' },
          isha: { status: 'PRAYED_ON_TIME' },
        },
      },
      {
        date: '2026-10-01', // 20 days ago (> 7 days): Asr MADE_UP = 15,000 UZS (capped)
        finesAccrued: 15000,
        prayers: {
          fajr: { status: 'PRAYED_ON_TIME' },
          dhuhr: { status: 'PRAYED_ON_TIME' },
          asr: { status: 'MADE_UP' },
          maghrib: { status: 'PRAYED_ON_TIME' },
          isha: { status: 'PRAYED_ON_TIME' },
        },
      },
      {
        date: '2026-09-25', // Settled/Paid MISSED prayer = 0 UZS debt
        finesAccrued: 0,
        prayers: {
          fajr: { status: 'MISSED', isPaid: true, paidAmount: 30000 },
          dhuhr: { status: 'PRAYED_ON_TIME' },
          asr: { status: 'PRAYED_ON_TIME' },
          maghrib: { status: 'PRAYED_ON_TIME' },
          isha: { status: 'PRAYED_ON_TIME' },
        },
      },
    ];

    it('produces identical financial debt whether called with Array (API/Leaderboard) or Dictionary (Dashboard/Progress)', () => {
      // 1. Array input (as passed by Route Handlers, e.g. Leaderboard and Stats)
      const arrayResult = calculateAuthoritativeDebt(sampleDataset, { referenceDate });

      // 2. Dictionary input (as stored in LocalStorage for HomeDashboard and Progress)
      const dictInput: Record<string, PrayerHistoryRecord> = {};
      for (const rec of sampleDataset) {
        dictInput[rec.date] = rec;
      }
      const dictResult = calculateAuthoritativeDebt(dictInput, { referenceDate });

      // Financial debt matches exactly: 15,000 + 30,000 + 15,000 = 60,000 UZS
      assert.equal(arrayResult.totalFinancialDebt, 60000);
      assert.equal(dictResult.totalFinancialDebt, 60000);
      assert.equal(arrayResult.totalFinancialDebt, dictResult.totalFinancialDebt);

      // Base debt and overdue debt match exactly
      assert.equal(arrayResult.totalBaseDebt, 45000); // 3 unpaid prayers * 15,000
      assert.equal(dictResult.totalBaseDebt, 45000);
      assert.equal(arrayResult.totalOverdueDebt, 15000); // 1 overdue missed prayer * 15,000
      assert.equal(dictResult.totalOverdueDebt, 15000);

      // Spiritual Qaza count matches exactly: 3 MISSED prayers (2 unpaid + 1 paid)
      assert.equal(arrayResult.pendingQazaCount, 3);
      assert.equal(dictResult.pendingQazaCount, 3);

      // Completed Qaza count matches exactly: 1 MADE_UP prayer
      assert.equal(arrayResult.completedQazaCount, 1);
      assert.equal(dictResult.completedQazaCount, 1);

      // Unpaid vs Settled financial counts match exactly
      assert.equal(arrayResult.unpaidFinancialCount, 3);
      assert.equal(dictResult.unpaidFinancialCount, 3);
      assert.equal(arrayResult.settledFinancialCount, 1);
      assert.equal(dictResult.settledFinancialCount, 1);
    });

    it('matches calculateAccountabilityLedger and calculateAccountabilityFines results deterministically', () => {
      const dictInput: Record<string, PrayerHistoryRecord> = {};
      for (const rec of sampleDataset) {
        dictInput[rec.date] = rec;
      }

      const authoritative = calculateAuthoritativeDebt(dictInput, { referenceDate });
      const ledger = calculateAccountabilityLedger(dictInput, referenceDate);

      assert.equal(ledger.totalAmount, authoritative.totalFinancialDebt);
      assert.equal(ledger.totalFinancialDebt, authoritative.totalFinancialDebt);
      assert.equal(ledger.pendingQazaCount, authoritative.pendingQazaCount);
      assert.equal(ledger.unpaidCount, authoritative.unpaidFinancialCount);
      assert.equal(ledger.items.length, authoritative.items.length);

      // Single daily record fine calculation matches individual items
      const dayFines = calculateAccountabilityFines('2026-10-10', sampleDataset[1].prayers, referenceDate);
      assert.equal(dayFines, 30000);
    });

    it('guarantees Leaderboard Circle member metrics match calculateAuthoritativeDebt exactly', async () => {
      const circleId = new mongoose.Types.ObjectId();
      const circleGroup: MockGroupDoc = {
        _id: circleId,
        name: 'Accountability Circle',
        description: 'Test circle',
        creatorId: userAId,
        inviteCode: 'TEST1234',
        members: [
          { userId: userAId, role: 'owner', joinedAt: new Date() },
          { userId: userBId, role: 'member', joinedAt: new Date() },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
        save: async function () {
          return this;
        },
      };
      mockGroups.push(circleGroup);

      // Populate User A records with sample dataset
      for (const rec of sampleDataset) {
        const doc = createMockRecord(rec.date, userAId, rec.prayers);
        mockRecords.push(doc);
      }

      // Query GET /api/groups/[id] as User A
      const req = new NextRequest(`http://localhost:3000/api/groups/${circleId.toString()}?period=monthly`, {
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
      });
      const res = await getGroupHandler(req, { params: Promise.resolve({ id: circleId.toString() }) });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);

      // Verify User A's sadaqahOwed in leaderboard exactly matches calculateAuthoritativeDebt
      const userAEntry = json.data.members.find((m: { userId: string }) => m.userId === userAId.toString());
      assert.ok(userAEntry, 'User A must exist in circle member list');

      const expectedDebt = calculateAuthoritativeDebt(sampleDataset, { referenceDate: new Date().toISOString().split('T')[0] });
      assert.equal(userAEntry.sadaqahOwed, expectedDebt.totalFinancialDebt);
    });
  });

  // =========================================================================
  // Requirement B: Grace Period & Overdue Threshold (7 days vs > 7 days)
  // =========================================================================
  describe('Requirement B: Grace Period & Overdue Threshold Boundary Rules', () => {
    const referenceDate = '2026-10-21';

    it('evaluates prayer at exactly 7 days (daysPassed = 7) as within grace period with 0 overdue penalty', () => {
      // 2026-10-14 to 2026-10-21 is exactly 7 days
      const daysPassed = calculateDaysPassed('2026-10-14', referenceDate);
      assert.equal(daysPassed, 7);
      assert.equal(isOverduePrayer(daysPassed), false);

      const record: PrayerHistoryRecord = {
        date: '2026-10-14',
        finesAccrued: 15000,
        prayers: {
          fajr: { status: 'MISSED' },
          dhuhr: { status: 'PRAYED_ON_TIME' },
          asr: { status: 'PRAYED_ON_TIME' },
          maghrib: { status: 'PRAYED_ON_TIME' },
          isha: { status: 'PRAYED_ON_TIME' },
        },
      };

      const result = calculateAuthoritativeDebt([record], { referenceDate });
      assert.equal(result.totalFinancialDebt, 15000);
      assert.equal(result.totalBaseDebt, 15000);
      assert.equal(result.totalOverdueDebt, 0);
      assert.equal(result.items[0].isOverdue, false);
      assert.equal(result.items[0].baseAmount, 15000);
      assert.equal(result.items[0].overdueAmount, 0);
      assert.equal(result.items[0].totalAmount, 15000);
    });

    it('evaluates prayer at 8 days (daysPassed = 8, > 7) as OVERDUE with 15,000 UZS overdue penalty (total 30,000 UZS)', () => {
      // 2026-10-13 to 2026-10-21 is 8 days
      const daysPassed = calculateDaysPassed('2026-10-13', referenceDate);
      assert.equal(daysPassed, 8);
      assert.equal(isOverduePrayer(daysPassed), true);

      const record: PrayerHistoryRecord = {
        date: '2026-10-13',
        finesAccrued: 30000,
        prayers: {
          dhuhr: { status: 'MISSED' },
          fajr: { status: 'PRAYED_ON_TIME' },
          asr: { status: 'PRAYED_ON_TIME' },
          maghrib: { status: 'PRAYED_ON_TIME' },
          isha: { status: 'PRAYED_ON_TIME' },
        },
      };

      const result = calculateAuthoritativeDebt([record], { referenceDate });
      assert.equal(result.totalFinancialDebt, 30000);
      assert.equal(result.totalBaseDebt, 15000);
      assert.equal(result.totalOverdueDebt, 15000);
      assert.equal(result.items[0].isOverdue, true);
      assert.equal(result.items[0].baseAmount, 15000);
      assert.equal(result.items[0].overdueAmount, 15000);
      assert.equal(result.items[0].totalAmount, 30000);
    });

    it('assesses overdue penalty EXACTLY ONCE across long periods (10 days, 30 days, 90 days without stacking)', () => {
      const datesToTest = [
        { date: '2026-10-11', expectedDays: 10 },
        { date: '2026-09-21', expectedDays: 30 },
        { date: '2026-07-23', expectedDays: 90 },
      ];

      for (const { date, expectedDays } of datesToTest) {
        const daysPassed = calculateDaysPassed(date, referenceDate);
        assert.equal(daysPassed, expectedDays);
        assert.equal(isOverduePrayer(daysPassed), true);

        const record: PrayerHistoryRecord = {
          date,
          finesAccrued: 30000,
          prayers: {
            asr: { status: 'MISSED' },
            fajr: { status: 'PRAYED_ON_TIME' },
            dhuhr: { status: 'PRAYED_ON_TIME' },
            maghrib: { status: 'PRAYED_ON_TIME' },
            isha: { status: 'PRAYED_ON_TIME' },
          },
        };

        const result = calculateAuthoritativeDebt([record], { referenceDate });
        // The fine is capped at exactly 30,000 UZS (15,000 base + 15,000 penalty) and never stacks further
        assert.equal(result.totalFinancialDebt, 30000, `Fine for date ${date} (${expectedDays}d) must not exceed 30,000 UZS`);
        assert.equal(result.totalBaseDebt, 15000);
        assert.equal(result.totalOverdueDebt, 15000);
      }
    });
  });

  // =========================================================================
  // Requirement C: Multiple Missed Prayers without Duplication
  // =========================================================================
  describe('Requirement C: Multiple Missed Prayers Additive Consistency & Deduplication', () => {
    const referenceDate = '2026-10-21';

    it('calculates multiple missed prayers across different dates additively without double-counting', () => {
      const records: PrayerHistoryRecord[] = [
        {
          date: '2026-10-20', // 1 day ago (recent): 15,000 UZS
          finesAccrued: 15000,
          prayers: {
            fajr: { status: 'MISSED' },
            dhuhr: { status: 'PRAYED_ON_TIME' },
            asr: { status: 'PRAYED_ON_TIME' },
            maghrib: { status: 'PRAYED_ON_TIME' },
            isha: { status: 'PRAYED_ON_TIME' },
          },
        },
        {
          date: '2026-10-18', // 3 days ago (recent): 15,000 UZS
          finesAccrued: 15000,
          prayers: {
            fajr: { status: 'PRAYED_ON_TIME' },
            dhuhr: { status: 'MISSED' },
            asr: { status: 'PRAYED_ON_TIME' },
            maghrib: { status: 'PRAYED_ON_TIME' },
            isha: { status: 'PRAYED_ON_TIME' },
          },
        },
        {
          date: '2026-10-10', // 11 days ago (overdue): 30,000 UZS
          finesAccrued: 30000,
          prayers: {
            fajr: { status: 'PRAYED_ON_TIME' },
            dhuhr: { status: 'PRAYED_ON_TIME' },
            asr: { status: 'MISSED' },
            maghrib: { status: 'PRAYED_ON_TIME' },
            isha: { status: 'PRAYED_ON_TIME' },
          },
        },
      ];

      const result = calculateAuthoritativeDebt(records, { referenceDate });
      // Total = 15,000 + 15,000 + 30,000 = 60,000 UZS
      assert.equal(result.totalFinancialDebt, 60000);
      assert.equal(result.totalBaseDebt, 45000);
      assert.equal(result.totalOverdueDebt, 15000);
      assert.equal(result.pendingQazaCount, 3);
      assert.equal(result.unpaidFinancialCount, 3);
      assert.equal(result.items.length, 3);
    });

    it('correctly assesses multiple missed prayers on the same date without duplication or omissions', () => {
      // 3 prayers missed on the same day (10 days ago, overdue)
      const record: PrayerHistoryRecord = {
        date: '2026-10-11',
        finesAccrued: 90000,
        prayers: {
          fajr: { status: 'MISSED' },     // 30,000 UZS
          dhuhr: { status: 'MISSED' },    // 30,000 UZS
          asr: { status: 'MISSED' },      // 30,000 UZS
          maghrib: { status: 'PRAYED_ON_TIME' },
          isha: { status: 'PRAYED_ON_TIME' },
        },
      };

      const result = calculateAuthoritativeDebt([record], { referenceDate });
      // Total = 3 * 30,000 = 90,000 UZS
      assert.equal(result.totalFinancialDebt, 90000);
      assert.equal(result.totalBaseDebt, 45000);
      assert.equal(result.totalOverdueDebt, 45000);
      assert.equal(result.pendingQazaCount, 3);
      assert.equal(result.unpaidFinancialCount, 3);
      assert.equal(result.items.length, 3);

      // Verify each individual prayer item in the breakdown
      const itemPrayerIds = result.items.map((it) => it.prayerId);
      assert.deepEqual(itemPrayerIds, ['fajr', 'dhuhr', 'asr']);
      for (const item of result.items) {
        assert.equal(item.totalAmount, 30000);
        assert.equal(item.isOverdue, true);
      }
    });
  });

  // =========================================================================
  // Requirement D: Making Up a Prayer while Financial Debt Remains Unpaid
  // =========================================================================
  describe('Requirement D: Making Up Prayer (Spiritual Fulfilled) with Unpaid Debt', () => {
    it('decrements pendingQazaCount to 0 when status becomes MADE_UP while financial debt remains capped at 15,000 UZS', async () => {
      const oldDate = '2026-09-15'; // 36 days ago (well past 7 days)
      const record = createMockRecord(oldDate, userAId, {
        fajr: { status: 'MISSED', isPaid: false, paidAmount: 0 },
      });
      mockRecords.push(record);

      // Initial state before make-up:
      // spiritual debt = 1, financial debt = 30,000 UZS (overdue missed)
      const beforeDebt = calculateAuthoritativeDebt([record], { referenceDate: '2026-10-21' });
      assert.equal(beforeDebt.pendingQazaCount, 1);
      assert.equal(beforeDebt.completedQazaCount, 0);
      assert.equal(beforeDebt.totalFinancialDebt, 30000);

      // User performs Qaza prayer and updates status to MADE_UP via POST /api/prayers
      const req = new NextRequest('http://localhost:3000/api/prayers', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
        body: JSON.stringify({
          date: oldDate,
          prayerId: 'fajr',
          status: 'MADE_UP',
        }),
      });

      const res = await updatePrayerHandler(req);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(record.prayers.fajr.status, 'MADE_UP');

      // Post make-up state:
      // 1. Spiritual debt is fulfilled: pendingQazaCount decrements to 0!
      // 2. Completed Qaza count increments to 1
      // 3. Financial fine remains 15,000 UZS (base fine unpaid; overdue penalty permanently waived)
      const afterDebt = calculateAuthoritativeDebt([record], { referenceDate: '2026-10-21' });
      assert.equal(afterDebt.pendingQazaCount, 0, 'Spiritual Qaza count must decrement to 0 when prayer is MADE_UP');
      assert.equal(afterDebt.completedQazaCount, 1);
      assert.equal(afterDebt.totalFinancialDebt, 15000, 'Financial debt must remain at 15,000 UZS base fine until paid');
      assert.equal(afterDebt.totalOverdueDebt, 0, 'Overdue penalty must be 0 for MADE_UP prayers');
      assert.equal(afterDebt.unpaidFinancialCount, 1, 'Still counts as 1 unpaid financial fine');
    });
  });

  // =========================================================================
  // Requirement E: Paying Financial Debt Without Completing Qaza
  // =========================================================================
  describe('Requirement E: Paying Financial Debt Without Completing Qaza (Spiritual Separation)', () => {
    it('clears financial debt to 0 UZS while prayer status remains MISSED and pendingQazaCount does not decrement', async () => {
      const missedDate = '2026-10-18'; // 3 days ago
      const record = createMockRecord(missedDate, userAId, {
        dhuhr: { status: 'MISSED', isPaid: false, paidAmount: 0 },
      });
      mockRecords.push(record);

      // Pre-settlement state:
      // spiritual debt = 1 (MISSED), financial debt = 15,000 UZS
      const preCheck = calculateAuthoritativeDebt([record], { referenceDate: '2026-10-21' });
      assert.equal(preCheck.pendingQazaCount, 1);
      assert.equal(preCheck.totalFinancialDebt, 15000);

      // Settle financial obligation via POST /api/prayers/qaza-payment
      const req = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
        body: JSON.stringify({
          items: [{ date: missedDate, prayerId: 'dhuhr' }],
          note: 'Paying financial fine ahead of performing Qaza',
        }),
      });

      const res = await payQazaHandler(req);
      assert.equal(res.status, 201);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.totalAmount, 15000);

      // Verification of Requirement E criteria:
      // 1. prayer.isPaid === true
      assert.equal(record.prayers.dhuhr.isPaid, true);
      assert.equal(record.prayers.dhuhr.paidAmount, 15000);

      // 2. Financial debt is cleared (0 UZS)
      assert.equal(record.finesAccrued, 0);
      assert.equal(json.data.remainingFinancialDebt, 0);

      // 3. Prayer status strictly remains 'MISSED' (money does not substitute obligatory prayer!)
      assert.equal(record.prayers.dhuhr.status, 'MISSED');

      // 4. pendingQazaCount does NOT decrement (still 1 prayer owed to Allah!)
      const postDebt = calculateAuthoritativeDebt([record], { referenceDate: '2026-10-21' });
      assert.equal(postDebt.pendingQazaCount, 1, 'pendingQazaCount must remain 1 because prayer has not been performed');
      assert.equal(postDebt.totalFinancialDebt, 0, 'Financial debt must be completely cleared (0 UZS)');
      assert.equal(postDebt.unpaidFinancialCount, 0);
      assert.equal(postDebt.settledFinancialCount, 1);
    });
  });

  // =========================================================================
  // Requirement F: Settled Items Not Being Charged Again
  // =========================================================================
  describe('Requirement F: Settled Items Idempotency & Immunity Against Re-Charging', () => {
    it('returns 409 Conflict (ALREADY_PAID) when attempting to pay an already settled prayer', async () => {
      const date = '2026-10-15';
      const record = createMockRecord(date, userAId, {
        maghrib: { status: 'MISSED', isPaid: true, paidAmount: 15000 },
      });
      mockRecords.push(record);

      const req = new NextRequest('http://localhost:3000/api/prayers/qaza-payment', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
        body: JSON.stringify({
          items: [{ date, prayerId: 'maghrib' }],
        }),
      });

      const res = await payQazaHandler(req);
      assert.equal(res.status, 409);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.code, 'ALREADY_PAID');
    });

    it('settled items never accrue fines or overdue penalties across subsequent calculations or daily rollovers', async () => {
      const settledDate = '2026-10-01'; // 20 days ago
      const record = createMockRecord(settledDate, userAId, {
        fajr: { status: 'PRAYED_ON_TIME' },
        dhuhr: { status: 'PRAYED_ON_TIME' },
        asr: { status: 'PRAYED_ON_TIME' },
        maghrib: { status: 'PRAYED_ON_TIME' },
        isha: { status: 'MISSED', isPaid: true, paidAmount: 30000 },
      });
      record.finesAccrued = 0;
      mockRecords.push(record);

      // 1. Authoritative debt calculation produces 0 UZS
      const debtAt20d = calculateAuthoritativeDebt([record], { referenceDate: '2026-10-21' });
      assert.equal(debtAt20d.totalFinancialDebt, 0);
      assert.equal(debtAt20d.totalOverdueDebt, 0);

      // 2. Perform daily rollover across fromDate to toDate
      const req = new NextRequest('http://localhost:3000/api/prayers/rollover', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
        body: JSON.stringify({
          fromDate: settledDate,
          toDate: '2026-10-02',
        }),
      });

      const res = await rolloverHandler(req);
      assert.equal(res.status, 200);

      // Settled prayer finesAccrued remains 0 and was never re-penalized
      assert.equal(record.finesAccrued, 0);
      assert.equal(record.prayers.isha.isPaid, true);
    });
  });

  // =========================================================================
  // Requirement G: Multi-User & Privacy Isolation
  // =========================================================================
  describe('Requirement G: Multi-User Isolation & Privacy Circle Authorization', () => {
    it('guarantees User A unpaid fines do not leak into User B stats or debt total', async () => {
      // User A has 3 unpaid missed prayers (total 45,000 UZS)
      const recA1 = createMockRecord('2026-10-18', userAId, {
        fajr: { status: 'MISSED', isPaid: false },
        dhuhr: { status: 'MISSED', isPaid: false },
      });
      const recA2 = createMockRecord('2026-10-19', userAId, {
        asr: { status: 'MISSED', isPaid: false },
      });
      mockRecords.push(recA1, recA2);

      // User B has a clean record (all on time, 0 fines)
      const recB1 = createMockRecord('2026-10-18', userBId, {
        fajr: { status: 'PRAYED_ON_TIME' },
        dhuhr: { status: 'PRAYED_ON_TIME' },
        asr: { status: 'PRAYED_ON_TIME' },
        maghrib: { status: 'PRAYED_ON_TIME' },
        isha: { status: 'PRAYED_ON_TIME' },
      });
      mockRecords.push(recB1);

      // 1. Query User B's stats
      const reqB = new NextRequest('http://localhost:3000/api/stats?today=2026-10-21', {
        headers: { cookie: `salahtrack_session=${sessionTokenUserB}` },
      });
      const resB = await getStatsHandler(reqB);
      assert.equal(resB.status, 200);
      const jsonB = await resB.json();

      assert.equal(jsonB.data.accountability.totalAmount, 0, 'User B must have 0 outstanding fines');
      assert.equal(jsonB.data.accountability.totalMissed, 0);
      assert.equal(jsonB.data.accountability.breakdown.length, 0);

      // 2. Query User A's stats
      const reqA = new NextRequest('http://localhost:3000/api/stats?today=2026-10-21', {
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
      });
      const resA = await getStatsHandler(reqA);
      assert.equal(resA.status, 200);
      const jsonA = await resA.json();

      assert.equal(jsonA.data.accountability.totalAmount, 45000, 'User A must have exactly 45,000 UZS debt');
      assert.equal(jsonA.data.accountability.totalMissed, 3);
    });

    it('strictly forbids non-members from accessing private circle data with 403 Forbidden', async () => {
      const privateCircleId = new mongoose.Types.ObjectId();
      const circleGroup: MockGroupDoc = {
        _id: privateCircleId,
        name: 'Private Accountability Family',
        description: 'Only for family members',
        creatorId: userAId,
        inviteCode: 'FAM9988',
        members: [{ userId: userAId, role: 'owner', joinedAt: new Date() }],
        createdAt: new Date(),
        updatedAt: new Date(),
        save: async function () {
          return this;
        },
      };
      mockGroups.push(circleGroup);

      // Non-member attempts to read private circle data
      const reqUnauthorized = new NextRequest(
        `http://localhost:3000/api/groups/${privateCircleId.toString()}`,
        {
          headers: { cookie: `salahtrack_session=${sessionTokenNonMember}` },
        }
      );

      const res = await getGroupHandler(reqUnauthorized, {
        params: Promise.resolve({ id: privateCircleId.toString() }),
      });
      assert.equal(res.status, 403, 'Non-member must be denied with 403 Forbidden');
      const json = await res.json();
      assert.equal(json.success, false);
      assert.match(json.error, /not a member of this circle/i);
    });

    it('verifies sadaqahOwed in private circles exactly matches calculateAuthoritativeDebt for each member', async () => {
      const circleId = new mongoose.Types.ObjectId();
      const circleGroup: MockGroupDoc = {
        _id: circleId,
        name: 'Brothers Circle',
        description: 'Private circle',
        creatorId: userAId,
        inviteCode: 'BRO123',
        members: [
          { userId: userAId, role: 'owner', joinedAt: new Date() },
          { userId: userBId, role: 'member', joinedAt: new Date() },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
        save: async function () {
          return this;
        },
      };
      mockGroups.push(circleGroup);

      // User A records: 1 recent missed (15,000 UZS) + 1 overdue missed (30,000 UZS) = 45,000 UZS
      const recA1 = createMockRecord('2026-10-19', userAId, { fajr: { status: 'MISSED' } });
      const recA2 = createMockRecord('2026-10-10', userAId, { dhuhr: { status: 'MISSED' } });
      mockRecords.push(recA1, recA2);

      // User B records: 1 made up prayer (15,000 UZS capped)
      const recB1 = createMockRecord('2026-10-12', userBId, { asr: { status: 'MADE_UP' } });
      mockRecords.push(recB1);

      // Authorized User A queries private circle
      const req = new NextRequest(`http://localhost:3000/api/groups/${circleId.toString()}`, {
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
      });
      const res = await getGroupHandler(req, {
        params: Promise.resolve({ id: circleId.toString() }),
      });
      assert.equal(res.status, 200);
      const json = await res.json();

      const memberA = json.data.members.find((m: { userId: string }) => m.userId === userAId.toString());
      const memberB = json.data.members.find((m: { userId: string }) => m.userId === userBId.toString());

      assert.ok(memberA);
      assert.ok(memberB);

      // Authoritative debt verification
      const userADebt = calculateAuthoritativeDebt([recA1, recA2], { referenceDate: new Date().toISOString().split('T')[0] });
      const userBDebt = calculateAuthoritativeDebt([recB1], { referenceDate: new Date().toISOString().split('T')[0] });

      assert.equal(memberA.sadaqahOwed, userADebt.totalFinancialDebt);
      assert.equal(memberA.sadaqahOwed, 45000);

      assert.equal(memberB.sadaqahOwed, userBDebt.totalFinancialDebt);
      assert.equal(memberB.sadaqahOwed, 15000);
    });
  });
});
