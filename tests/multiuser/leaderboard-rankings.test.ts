import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server.js';

import { Group } from '../../src/models/Group.ts';
import { User } from '../../src/models/User.ts';
import { Session } from '../../src/models/Session.ts';
import { PrayerRecord } from '../../src/models/Prayer.ts';
import { GET as getLeaderboardHandler } from '../../src/app/api/leaderboard/route.ts';
import { GET as getGroupHandler } from '../../src/app/api/groups/[id]/route.ts';

// In-memory mock documents
interface MockUserDoc {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  username: string;
  role: 'user' | 'admin';
  preferences: {
    language: 'uz' | 'ru' | 'en';
    showOnLeaderboard?: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

interface MockSessionDoc {
  _id: mongoose.Types.ObjectId;
  sessionToken: string;
  userId: mongoose.Types.ObjectId;
  expiresAt: Date;
  lastActiveAt: Date;
  createdAt: Date;
  updatedAt: Date;
  save: () => Promise<MockSessionDoc>;
}

interface MockPrayerRecordDoc {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  date: string;
  prayers: Record<string, {
    status: string;
    isPaid?: boolean;
    paidAmount?: number;
  }>;
  finesAccrued?: number;
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
}

let mockUsers: MockUserDoc[] = [];
let mockSessions: MockSessionDoc[] = [];
let mockPrayerRecords: MockPrayerRecordDoc[] = [];
let mockGroups: MockGroupDoc[] = [];

function setupMocks() {
  mockUsers = [];
  mockSessions = [];
  mockPrayerRecords = [];
  mockGroups = [];

  // Cache connection in global.mongooseCache so connectDB() returns instantly
  global.mongooseCache = {
    conn: mongoose,
    promise: Promise.resolve(mongoose),
  };

  const userModel = User as unknown as Record<string, unknown>;
  const sessionModel = Session as unknown as Record<string, unknown>;
  const prayerModel = PrayerRecord as unknown as Record<string, unknown>;
  const groupModel = Group as unknown as Record<string, unknown>;

  userModel.findById = async (id: mongoose.Types.ObjectId | string) => {
    const idStr = id.toString();
    const found = mockUsers.find((u) => u._id.toString() === idStr);
    return found || null;
  };

  userModel.find = (query: { 'preferences.showOnLeaderboard'?: boolean; _id?: { $in?: mongoose.Types.ObjectId[] } }) => {
    let result = [...mockUsers];
    if (query['preferences.showOnLeaderboard'] !== undefined) {
      result = result.filter((u) => u.preferences?.showOnLeaderboard === query['preferences.showOnLeaderboard']);
    }
    if (query._id?.$in) {
      const allowed = new Set(query._id.$in.map((id) => id.toString()));
      result = result.filter((u) => allowed.has(u._id.toString()));
    }
    return {
      select: () => ({
        lean: async () => result,
      }),
      lean: async () => result,
    };
  };

  sessionModel.findOne = async (query: { sessionToken?: string }) => {
    const found = mockSessions.find((s) => s.sessionToken === query.sessionToken);
    return found || null;
  };

  prayerModel.find = (query: {
    userId?: { $in?: mongoose.Types.ObjectId[] } | mongoose.Types.ObjectId;
    date?: { $gte?: string; $lte?: string };
  }) => {
    let result = [...mockPrayerRecords];
    if (query.userId) {
      if (typeof query.userId === 'object' && '$in' in query.userId && query.userId.$in) {
        const allowed = new Set(query.userId.$in.map((id) => id.toString()));
        result = result.filter((r) => allowed.has(r.userId.toString()));
      } else {
        const targetId = query.userId.toString();
        result = result.filter((r) => r.userId.toString() === targetId);
      }
    }
    if (query.date) {
      if (query.date.$gte) {
        result = result.filter((r) => r.date >= query.date!.$gte!);
      }
      if (query.date.$lte) {
        result = result.filter((r) => r.date <= query.date!.$lte!);
      }
    }
    return {
      select: () => ({
        lean: async () => result,
      }),
      lean: async () => result,
    };
  };

  groupModel.findById = (id: mongoose.Types.ObjectId | string) => {
    const idStr = id.toString();
    const found = mockGroups.find((g) => g._id.toString() === idStr);
    return {
      lean: async () => found || null,
    };
  };
}

function createTestUser(name: string, username: string, daysAgoCreated = 0): MockUserDoc {
  const user: MockUserDoc = {
    _id: new mongoose.Types.ObjectId(),
    name,
    email: `${username}@example.com`,
    username,
    role: 'user',
    preferences: {
      language: 'uz',
      showOnLeaderboard: true,
    },
    createdAt: new Date(Date.now() - daysAgoCreated * 24 * 60 * 60 * 1000),
    updatedAt: new Date(),
  };
  mockUsers.push(user);
  return user;
}

function createSessionForUser(user: MockUserDoc): string {
  const token = `token-${user._id.toString()}`;
  mockSessions.push({
    _id: new mongoose.Types.ObjectId(),
    sessionToken: token,
    userId: user._id,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    lastActiveAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    save: async function () { return this; },
  });
  return token;
}

describe('Accurate Rankings & Privacy Rules (Global Leaderboard & Private Circles)', () => {
  beforeEach(() => {
    setupMocks();
  });

  describe('1. Global Leaderboard Rankings & Tie Handling', () => {
    it('ranks users deterministically by completed percentage, on-time count, and account age', async () => {
      const todayStr = new Date().toISOString().split('T')[0];

      // User 1: 5 on-time prayers (100% on daily)
      const u1 = createTestUser('Alice Perfect', 'alice', 10);
      mockPrayerRecords.push({
        _id: new mongoose.Types.ObjectId(),
        userId: u1._id,
        date: todayStr,
        prayers: {
          fajr: { status: 'PRAYED_ON_TIME' },
          dhuhr: { status: 'PRAYED_ON_TIME' },
          asr: { status: 'PRAYED_ON_TIME' },
          maghrib: { status: 'PRAYED_ON_TIME' },
          isha: { status: 'PRAYED_ON_TIME' },
        },
      });

      // User 2: 4 on-time prayers, 1 late (5 completed = 100%, 4 on-time)
      const u2 = createTestUser('Bob Late', 'bob', 5);
      mockPrayerRecords.push({
        _id: new mongoose.Types.ObjectId(),
        userId: u2._id,
        date: todayStr,
        prayers: {
          fajr: { status: 'PRAYED_ON_TIME' },
          dhuhr: { status: 'PRAYED_ON_TIME' },
          asr: { status: 'PRAYED_ON_TIME' },
          maghrib: { status: 'PRAYED_ON_TIME' },
          isha: { status: 'PRAYED_LATE' },
        },
      });

      // User 3: 4 on-time prayers (80% on daily)
      const u3 = createTestUser('Charlie Four', 'charlie', 2);
      mockPrayerRecords.push({
        _id: new mongoose.Types.ObjectId(),
        userId: u3._id,
        date: todayStr,
        prayers: {
          fajr: { status: 'PRAYED_ON_TIME' },
          dhuhr: { status: 'PRAYED_ON_TIME' },
          asr: { status: 'PRAYED_ON_TIME' },
          maghrib: { status: 'PRAYED_ON_TIME' },
          isha: { status: 'PENDING' },
        },
      });

      const req = new NextRequest(`http://localhost:3000/api/leaderboard?period=daily&date=${todayStr}`);
      const res = await getLeaderboardHandler(req);
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.equal(json.success, true);
      const lb = json.data.leaderboard;

      assert.equal(lb.length, 3);
      // Alice is Rank 1 (100% percentage, 5 on-time)
      assert.equal(lb[0].username, 'alice');
      assert.equal(lb[0].rank, 1);
      assert.equal(lb[0].consistencyPercentage, 100);
      assert.equal(lb[0].completedCount, 5);
      assert.equal(lb[0].onTimeCount, 5);

      // Bob is Rank 2 (100% percentage, 4 on-time)
      assert.equal(lb[1].username, 'bob');
      assert.equal(lb[1].rank, 2);
      assert.equal(lb[1].consistencyPercentage, 100);
      assert.equal(lb[1].completedCount, 5);
      assert.equal(lb[1].onTimeCount, 4);

      // Charlie is Rank 3 (80% percentage, 4 on-time)
      assert.equal(lb[2].username, 'charlie');
      assert.equal(lb[2].rank, 3);
      assert.equal(lb[2].consistencyPercentage, 80);
      assert.equal(lb[2].completedCount, 4);
    });

    it('assigns identical ranks to tied users using standard competition ranking (1224)', async () => {
      const todayStr = new Date().toISOString().split('T')[0];

      // Two users with identical perfect scores (100%, 5 completed, 5 on-time)
      const u1 = createTestUser('Twin 1', 'twin1', 20); // older account
      const u2 = createTestUser('Twin 2', 'twin2', 10); // newer account
      for (const u of [u1, u2]) {
        mockPrayerRecords.push({
          _id: new mongoose.Types.ObjectId(),
          userId: u._id,
          date: todayStr,
          prayers: {
            fajr: { status: 'PRAYED_ON_TIME' },
            dhuhr: { status: 'PRAYED_ON_TIME' },
            asr: { status: 'PRAYED_ON_TIME' },
            maghrib: { status: 'PRAYED_ON_TIME' },
            isha: { status: 'PRAYED_ON_TIME' },
          },
        });
      }

      // Third user with 4 completed (80%)
      const u3 = createTestUser('Third Runner', 'third', 5);
      mockPrayerRecords.push({
        _id: new mongoose.Types.ObjectId(),
        userId: u3._id,
        date: todayStr,
        prayers: {
          fajr: { status: 'PRAYED_ON_TIME' },
          dhuhr: { status: 'PRAYED_ON_TIME' },
          asr: { status: 'PRAYED_ON_TIME' },
          maghrib: { status: 'PRAYED_ON_TIME' },
          isha: { status: 'MISSED' },
        },
      });

      const req = new NextRequest(`http://localhost:3000/api/leaderboard?period=daily&date=${todayStr}`);
      const res = await getLeaderboardHandler(req);
      assert.equal(res.status, 200);

      const json = await res.json();
      const lb = json.data.leaderboard;

      assert.equal(lb.length, 3);
      // Both twin1 and twin2 should share Rank 1
      assert.equal(lb[0].rank, 1);
      assert.equal(lb[1].rank, 1);
      // Standard competition ranking skips rank 2: third user must be Rank 3
      assert.equal(lb[2].rank, 3);
      assert.equal(lb[2].username, 'third');
    });

    it('handles missing prayer records cleanly: defaults to 0 and ranks at bottom without NaN', async () => {
      const todayStr = new Date().toISOString().split('T')[0];

      // Active user with 5 prayers
      const activeUser = createTestUser('Active User', 'active', 10);
      mockPrayerRecords.push({
        _id: new mongoose.Types.ObjectId(),
        userId: activeUser._id,
        date: todayStr,
        prayers: {
          fajr: { status: 'PRAYED_ON_TIME' },
          dhuhr: { status: 'PRAYED_ON_TIME' },
          asr: { status: 'PRAYED_ON_TIME' },
          maghrib: { status: 'PRAYED_ON_TIME' },
          isha: { status: 'PRAYED_ON_TIME' },
        },
      });

      // Inactive opted-in user with zero prayer records
      createTestUser('Zero Records', 'zero_records', 1);

      const req = new NextRequest(`http://localhost:3000/api/leaderboard?period=daily&date=${todayStr}`);
      const res = await getLeaderboardHandler(req);
      assert.equal(res.status, 200);

      const json = await res.json();
      const lb = json.data.leaderboard;

      assert.equal(lb.length, 2);
      assert.equal(lb[0].username, 'active');
      assert.equal(lb[0].rank, 1);

      // Inactive user must be at bottom
      const zeroEntry = lb[1];
      assert.equal(zeroEntry.username, 'zero_records');
      assert.equal(zeroEntry.rank, 2);
      assert.equal(zeroEntry.completedCount, 0);
      assert.equal(zeroEntry.onTimeCount, 0);
      assert.equal(zeroEntry.consistencyPercentage, 0);
      assert.ok(!isNaN(zeroEntry.consistencyPercentage));
    });

    it('guarantees privacy: never exposes sadaqah or fine amounts in global leaderboard', async () => {
      const todayStr = new Date().toISOString().split('T')[0];
      const user = createTestUser('Private User', 'privateuser', 10);
      mockPrayerRecords.push({
        _id: new mongoose.Types.ObjectId(),
        userId: user._id,
        date: todayStr,
        finesAccrued: 45000,
        prayers: {
          fajr: { status: 'MISSED', isPaid: false, paidAmount: 0 },
          dhuhr: { status: 'PRAYED_ON_TIME' },
          asr: { status: 'PRAYED_ON_TIME' },
          maghrib: { status: 'PRAYED_ON_TIME' },
          isha: { status: 'PRAYED_ON_TIME' },
        },
      });

      const req = new NextRequest(`http://localhost:3000/api/leaderboard?period=daily&date=${todayStr}`);
      const res = await getLeaderboardHandler(req);
      const json = await res.json();

      assert.equal(json.success, true);
      const entry = json.data.leaderboard[0];
      assert.ok(entry, 'Entry must exist');

      // Verify NO fine or sadaqah fields are exposed
      assert.equal('sadaqahOwed' in entry, false, 'sadaqahOwed must NOT be present in global leaderboard');
      assert.equal('finesAccrued' in entry, false, 'finesAccrued must NOT be present in global leaderboard');
      assert.equal('fine' in entry, false, 'fine must NOT be present in global leaderboard');
      assert.equal('sadaqah' in entry, false, 'sadaqah must NOT be present in global leaderboard');

      const responseString = JSON.stringify(json);
      assert.ok(!responseString.includes('45000'), 'Private fine amount must not leak into response string');
      assert.ok(!responseString.includes('sadaqahOwed'), 'sadaqahOwed key must not exist in global response');
    });
  });

  describe('2. Private Accountability Circles Authorization & Sadaqah Calculation', () => {
    it('enforces authorization: non-members are rejected with 403 Forbidden', async () => {
      const owner = createTestUser('Circle Owner', 'owner');
      const outsider = createTestUser('Outsider', 'outsider');
      const token = createSessionForUser(outsider);

      const circleId = new mongoose.Types.ObjectId();
      mockGroups.push({
        _id: circleId,
        name: 'Family Circle',
        description: 'Private family accountability',
        creatorId: owner._id,
        inviteCode: 'TEST-1234',
        members: [{ userId: owner._id, role: 'owner', joinedAt: new Date() }],
      });

      const req = new NextRequest(`http://localhost:3000/api/groups/${circleId.toString()}`, {
        headers: { Cookie: `salahtrack_session=${token}` },
      });
      const res = await getGroupHandler(req, { params: Promise.resolve({ id: circleId.toString() }) });
      assert.equal(res.status, 403);

      const json = await res.json();
      assert.equal(json.success, false);
      assert.match(json.error, /Forbidden/i);
    });

    it('rejects unauthenticated requests with 401 Unauthorized', async () => {
      const circleId = new mongoose.Types.ObjectId();
      const req = new NextRequest(`http://localhost:3000/api/groups/${circleId.toString()}`);
      const res = await getGroupHandler(req, { params: Promise.resolve({ id: circleId.toString() }) });
      assert.equal(res.status, 401);
    });

    it('calculates deterministic rankings with tie handling and computes accurate sadaqahOwed for circle members', async () => {
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];

      // Date 10 days ago (overdue for missed prayers)
      const tenDaysAgoStr = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      // Date 2 days ago (within 7-day grace period, not overdue)
      const twoDaysAgoStr = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Member A:
      // Today: 5 on-time prayers
      // Past unpaid MISSED (10 days ago -> overdue): 15,000 base + 15,000 overdue = 30,000 UZS
      // Past unpaid MADE_UP (2 days ago): 15,000 base = 15,000 UZS
      // Past paid MISSED (settled): 0 UZS
      // Total expected sadaqahOwed: 45,000 UZS
      const memberA = createTestUser('Member A', 'member_a', 30);
      mockPrayerRecords.push({
        _id: new mongoose.Types.ObjectId(),
        userId: memberA._id,
        date: todayStr,
        prayers: {
          fajr: { status: 'PRAYED_ON_TIME' },
          dhuhr: { status: 'PRAYED_ON_TIME' },
          asr: { status: 'PRAYED_ON_TIME' },
          maghrib: { status: 'PRAYED_ON_TIME' },
          isha: { status: 'PRAYED_ON_TIME' },
        },
      });
      mockPrayerRecords.push({
        _id: new mongoose.Types.ObjectId(),
        userId: memberA._id,
        date: tenDaysAgoStr,
        prayers: {
          fajr: { status: 'MISSED', isPaid: false }, // 30,000 UZS (overdue)
          dhuhr: { status: 'MISSED', isPaid: true }, // settled: 0
        },
      });
      mockPrayerRecords.push({
        _id: new mongoose.Types.ObjectId(),
        userId: memberA._id,
        date: twoDaysAgoStr,
        prayers: {
          fajr: { status: 'MADE_UP', isPaid: false }, // 15,000 UZS
        },
      });

      // Member B:
      // Today: 5 on-time prayers (identical to Member A in daily period!)
      // Unpaid MISSED (2 days ago -> within grace): 15,000 UZS base
      // Total expected sadaqahOwed: 15,000 UZS
      const memberB = createTestUser('Member B', 'member_b', 20);
      mockPrayerRecords.push({
        _id: new mongoose.Types.ObjectId(),
        userId: memberB._id,
        date: todayStr,
        prayers: {
          fajr: { status: 'PRAYED_ON_TIME' },
          dhuhr: { status: 'PRAYED_ON_TIME' },
          asr: { status: 'PRAYED_ON_TIME' },
          maghrib: { status: 'PRAYED_ON_TIME' },
          isha: { status: 'PRAYED_ON_TIME' },
        },
      });
      mockPrayerRecords.push({
        _id: new mongoose.Types.ObjectId(),
        userId: memberB._id,
        date: twoDaysAgoStr,
        prayers: {
          dhuhr: { status: 'MISSED', isPaid: false }, // 15,000 UZS
        },
      });

      // Member C:
      // Today: 4 on-time prayers (80%)
      // Clean ledger: 0 sadaqah owed
      const memberC = createTestUser('Member C', 'member_c', 10);
      mockPrayerRecords.push({
        _id: new mongoose.Types.ObjectId(),
        userId: memberC._id,
        date: todayStr,
        prayers: {
          fajr: { status: 'PRAYED_ON_TIME' },
          dhuhr: { status: 'PRAYED_ON_TIME' },
          asr: { status: 'PRAYED_ON_TIME' },
          maghrib: { status: 'PRAYED_ON_TIME' },
          isha: { status: 'PENDING' },
        },
      });

      // Create group with A, B, and C
      const circleId = new mongoose.Types.ObjectId();
      mockGroups.push({
        _id: circleId,
        name: 'Accountability Brothers',
        description: 'Weekly prayer check-in',
        creatorId: memberA._id,
        inviteCode: 'ACCT-8888',
        members: [
          { userId: memberA._id, role: 'owner', joinedAt: new Date(Date.now() - 30 * 86400000) },
          { userId: memberB._id, role: 'member', joinedAt: new Date(Date.now() - 20 * 86400000) },
          { userId: memberC._id, role: 'member', joinedAt: new Date(Date.now() - 10 * 86400000) },
        ],
      });

      // Authenticate as Member A (authorized member)
      const token = createSessionForUser(memberA);

      const req = new NextRequest(`http://localhost:3000/api/groups/${circleId.toString()}?period=daily`, {
        headers: { Cookie: `salahtrack_session=${token}` },
      });
      const res = await getGroupHandler(req, { params: Promise.resolve({ id: circleId.toString() }) });
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.equal(json.success, true);
      const members = json.data.members;

      assert.equal(members.length, 3);

      // Verify Tie Handling:
      // Member A and Member B have identical performance scores (100%, 5 completed, 5 on-time)
      assert.equal(members[0].rank, 1);
      assert.equal(members[1].rank, 1);
      // Member C must be Rank 3 under standard competition ranking
      assert.equal(members[2].rank, 3);
      assert.equal(members[2].username, 'member_c');

      // Verify Sadaqah Owed Calculations:
      const aEntry = members.find((m: { username: string }) => m.username === 'member_a');
      const bEntry = members.find((m: { username: string }) => m.username === 'member_b');
      const cEntry = members.find((m: { username: string }) => m.username === 'member_c');

      assert.equal(aEntry.sadaqahOwed, 45000, 'Member A: 30,000 (overdue missed) + 15,000 (made up) = 45,000 UZS');
      assert.equal(bEntry.sadaqahOwed, 15000, 'Member B: 15,000 (grace period missed) = 15,000 UZS');
      assert.equal(cEntry.sadaqahOwed, 0, 'Member C: clean ledger = 0 UZS');
    });
  });
});
