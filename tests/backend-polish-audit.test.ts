import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server.js';

import { User } from '../src/models/User.ts';
import { Session } from '../src/models/Session.ts';
import { Group } from '../src/models/Group.ts';
import { PrayerRecord } from '../src/models/Prayer.ts';
import { QazaPayment } from '../src/models/QazaPayment.ts';
import { invalidateSessionCache } from '../src/lib/auth/guard.ts';
import { clearRateLimitStore } from '../src/lib/auth/rate-limit.ts';
import { PRIMARY_SESSION_COOKIE } from '../src/lib/auth/session.ts';

import { GET as healthHandler } from '../src/app/api/health/route.ts';
import { GET as statsHandler } from '../src/app/api/stats/route.ts';
import { GET as prayerTimesHandler, clearPrayerTimesCache } from '../src/app/api/prayer-times/route.ts';
import { PUT as updateProfileHandler } from '../src/app/api/user/profile/route.ts';
import { GET as getPrayersHandler, POST as upsertPrayerHandler } from '../src/app/api/prayers/route.ts';
import { GET as getHistoryHandler } from '../src/app/api/prayers/history/route.ts';
import { GET as getLeaderboardHandler, clearLeaderboardCache } from '../src/app/api/leaderboard/route.ts';
import { POST as signupHandler } from '../src/app/api/auth/signup/route.ts';
import { GET as memberHistoryHandler } from '../src/app/api/groups/[id]/member-history/route.ts';
import { POST as joinGroupHandler } from '../src/app/api/groups/join/route.ts';
import { DELETE as deleteGroupHandler } from '../src/app/api/groups/[id]/route.ts';
import type { PrayerId, PrayerStatus } from '../src/types/prayer.ts';

interface MockPrayerEntry {
  status: PrayerStatus;
  prayedAt?: Date;
  missedAt?: Date;
  madeUpAt?: Date;
  notes?: string;
  isPaid?: boolean;
  paidAmount?: number;
}

interface MockPrayerDoc {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  date: string;
  prayers: Record<PrayerId, MockPrayerEntry>;
  finesAccrued: number;
  markModified: (p: string) => void;
  save: () => Promise<MockPrayerDoc>;
}

interface MockUserDoc {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  username: string;
  passwordHash: string;
  role: 'user' | 'admin';
  platformStartDate?: string;
  preferences: {
    language: 'uz' | 'ru' | 'en';
    showOnLeaderboard: boolean;
    timezone?: string;
  };
  createdAt: Date;
  updatedAt: Date;
  save: () => Promise<MockUserDoc>;
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
  save: () => Promise<MockGroupDoc>;
}

let mockUsers: MockUserDoc[] = [];
let mockSessions: Array<{
  _id: mongoose.Types.ObjectId;
  sessionToken: string;
  userId: mongoose.Types.ObjectId;
  expiresAt: Date;
  lastActiveAt: Date;
}> = [];
let mockRecords: MockPrayerDoc[] = [];
let mockGroups: MockGroupDoc[] = [];
let lastPaymentSelect: string | null = null;
let deleteOneCalls: Array<{ userId: string; date: string }> = [];

function makePrayersMap(
  overrides: Partial<Record<PrayerId, Partial<MockPrayerEntry>>> = {}
): MockPrayerDoc['prayers'] {
  const ids: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const out = {} as MockPrayerDoc['prayers'];
  for (const id of ids) {
    out[id] = {
      status: 'PENDING',
      isPaid: false,
      paidAmount: 0,
      ...(overrides[id] || {}),
    };
  }
  return out;
}

function setupMocks() {
  invalidateSessionCache();
  clearRateLimitStore();
  clearLeaderboardCache();
  clearPrayerTimesCache();
  mockUsers = [];
  mockSessions = [];
  mockRecords = [];
  mockGroups = [];
  lastPaymentSelect = null;
  deleteOneCalls = [];

  global.mongooseCache = {
    conn: mongoose,
    promise: Promise.resolve(mongoose),
  };

  const userModel = User as unknown as Record<string, unknown>;
  const sessionModel = Session as unknown as Record<string, unknown>;
  const prayerModel = PrayerRecord as unknown as Record<string, unknown>;
  const groupModel = Group as unknown as Record<string, unknown>;
  const paymentModel = QazaPayment as unknown as Record<string, unknown>;

  userModel.findById = (id: mongoose.Types.ObjectId | string) => {
    const idStr = id.toString();
    const found = mockUsers.find((u) => u._id.toString() === idStr) || null;
    return {
      lean: async () => found,
      then: (resolve: (u: MockUserDoc | null) => void) => resolve(found),
    };
  };

  userModel.findOne = () => ({
    select: () => Promise.resolve(null),
    then: (resolve: (u: null) => void) => resolve(null),
  });

  userModel.find = (query: { 'preferences.showOnLeaderboard'?: boolean }) => {
    let list = [...mockUsers];
    if (query['preferences.showOnLeaderboard'] !== undefined) {
      list = list.filter(
        (u) => Boolean(u.preferences?.showOnLeaderboard) === query['preferences.showOnLeaderboard']
      );
    }
    const qHelper = {
      select: () => qHelper,
      lean: async () => list,
      then: (resolve: (v: MockUserDoc[]) => void) => resolve(list),
    };
    return qHelper;
  };

  userModel.create = async (doc: Partial<MockUserDoc>) => {
    const created: MockUserDoc = {
      _id: new mongoose.Types.ObjectId(),
      name: doc.name || '',
      email: doc.email || '',
      username: doc.username || '',
      passwordHash: doc.passwordHash || '',
      role: doc.role || 'user',
      platformStartDate: doc.platformStartDate,
      preferences: {
        language: doc.preferences?.language || 'uz',
        showOnLeaderboard: Boolean(doc.preferences?.showOnLeaderboard),
        timezone: doc.preferences?.timezone,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      save: async function () {
        return this;
      },
    };
    mockUsers.push(created);
    return created;
  };

  sessionModel.findOne = (query: { sessionToken?: string }) => {
    const found = mockSessions.find((s) => s.sessionToken === query.sessionToken) || null;
    return {
      lean: async () => found,
      then: (resolve: (s: unknown) => void) => resolve(found),
    };
  };

  sessionModel.create = async (doc: {
    sessionToken: string;
    userId: mongoose.Types.ObjectId;
    expiresAt: Date;
  }) => {
    const s = {
      _id: new mongoose.Types.ObjectId(),
      sessionToken: doc.sessionToken,
      userId: doc.userId,
      expiresAt: doc.expiresAt,
      lastActiveAt: new Date(),
    };
    mockSessions.push(s);
    return s;
  };

  sessionModel.updateOne = async () => ({ modifiedCount: 1 });

  prayerModel.findOne = (query: { userId?: mongoose.Types.ObjectId | string; date?: string }) => {
    const uId = query.userId?.toString();
    const found = mockRecords.find((r) => r.userId.toString() === uId && r.date === query.date) || null;
    return {
      lean: async () => found,
      then: (resolve: (r: MockPrayerDoc | null) => void) => resolve(found),
    };
  };

  prayerModel.find = (query: {
    userId?: { $in?: mongoose.Types.ObjectId[] } | mongoose.Types.ObjectId | string;
    date?: { $gte?: string; $lte?: string };
  }) => {
    let result = [...mockRecords];
    if (query.userId) {
      if (typeof query.userId === 'object' && '$in' in query.userId && query.userId.$in) {
        const allowed = new Set(query.userId.$in.map((id) => id.toString()));
        result = result.filter((r) => allowed.has(r.userId.toString()));
      } else {
        const target = query.userId.toString();
        result = result.filter((r) => r.userId.toString() === target);
      }
    }
    if (query.date) {
      if (query.date.$gte) result = result.filter((r) => r.date >= query.date!.$gte!);
      if (query.date.$lte) result = result.filter((r) => r.date <= query.date!.$lte!);
    }
    const qHelper = {
      select: () => qHelper,
      sort: () => qHelper,
      lean: async () => result,
      then: (resolve: (list: MockPrayerDoc[]) => void) => resolve(result),
    };
    return qHelper;
  };

  prayerModel.findOneAndUpdate = async (
    filter: { userId: mongoose.Types.ObjectId | string; date: string },
    update: {
      $set?: Record<string, unknown>;
      $unset?: Record<string, unknown>;
    }
  ) => {
    const uId = filter.userId.toString();
    let doc = mockRecords.find((r) => r.userId.toString() === uId && r.date === filter.date);
    if (!doc) {
      doc = {
        _id: new mongoose.Types.ObjectId(),
        userId: new mongoose.Types.ObjectId(uId),
        date: filter.date,
        prayers: makePrayersMap(),
        finesAccrued: 0,
        markModified: () => {},
        save: async function () {
          return this;
        },
      };
      mockRecords.push(doc);
    }
    if (update.$set) {
      for (const [key, val] of Object.entries(update.$set)) {
        if (key.startsWith('prayers.')) {
          const [, pId, field] = key.split('.') as [string, PrayerId, string];
          (doc.prayers[pId] as unknown as Record<string, unknown>)[field] = val;
        }
      }
    }
    if (update.$unset) {
      for (const key of Object.keys(update.$unset)) {
        if (key.startsWith('prayers.')) {
          const [, pId, field] = key.split('.') as [string, PrayerId, string];
          delete (doc.prayers[pId] as unknown as Record<string, unknown>)[field];
        }
      }
    }
    return doc;
  };

  prayerModel.updateOne = async (
    filter: { _id?: mongoose.Types.ObjectId; userId?: string; date?: string },
    update: { $set?: Record<string, unknown> }
  ) => {
    const doc = mockRecords.find((r) =>
      filter._id ? r._id.toString() === filter._id.toString() : r.date === filter.date
    );
    if (doc && update.$set && typeof update.$set.finesAccrued === 'number') {
      doc.finesAccrued = update.$set.finesAccrued;
    }
    return { modifiedCount: doc ? 1 : 0 };
  };

  prayerModel.deleteOne = async (filter: { userId: string; date: string }) => {
    deleteOneCalls.push({ userId: filter.userId.toString(), date: filter.date });
    const before = mockRecords.length;
    mockRecords = mockRecords.filter(
      (r) => !(r.userId.toString() === filter.userId.toString() && r.date === filter.date)
    );
    return { deletedCount: before - mockRecords.length };
  };

  paymentModel.find = () => {
    const qHelper = {
      select: (fields: string) => {
        lastPaymentSelect = fields;
        return qHelper;
      },
      lean: async () => [{ totalAmount: 15000 }],
      then: (resolve: (list: unknown[]) => void) => resolve([{ totalAmount: 15000 }]),
    };
    return qHelper;
  };

  groupModel.findById = (id: mongoose.Types.ObjectId | string) => {
    const found = mockGroups.find((g) => g._id.toString() === id.toString()) || null;
    return {
      lean: async () => found,
      then: (resolve: (g: MockGroupDoc | null) => void) => resolve(found),
    };
  };

  groupModel.findOne = async (query: { inviteCode?: string }) => {
    return mockGroups.find((g) => g.inviteCode === query.inviteCode) || null;
  };
}

function createUserWithSession(opts: {
  name: string;
  username: string;
  platformStartDate?: string;
  showOnLeaderboard?: boolean;
  timezone?: string;
  createdAt?: Date;
}) {
  const userId = new mongoose.Types.ObjectId();
  const token = `tok-${userId.toString()}`;
  const user: MockUserDoc = {
    _id: userId,
    name: opts.name,
    email: `${opts.username}@example.com`,
    username: opts.username,
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=1$fake',
    role: 'user',
    platformStartDate: opts.platformStartDate,
    preferences: {
      language: 'uz',
      showOnLeaderboard: Boolean(opts.showOnLeaderboard),
      timezone: opts.timezone || 'Asia/Tashkent',
    },
    createdAt: opts.createdAt || new Date('2026-10-15T10:00:00Z'),
    updatedAt: new Date(),
    save: async function () {
      return this;
    },
  };
  mockUsers.push(user);
  mockSessions.push({
    _id: new mongoose.Types.ObjectId(),
    sessionToken: token,
    userId,
    expiresAt: new Date(Date.now() + 86400_000),
    lastActiveAt: new Date(),
  });
  return { user, token };
}

describe('Backend Deep Audit & Polish Tests', () => {
  beforeEach(() => {
    setupMocks();
  });

  describe('1. GET /api/health', () => {
    it('returns 200 with ok status, readyState, and latencyMs when DB ping succeeds', async () => {
      global.mongooseCache = {
        conn: {
          connection: {
            readyState: 1,
            db: {
              admin: () => ({
                ping: async () => ({ ok: 1 }),
              }),
            },
          },
        } as unknown as typeof mongoose,
        promise: Promise.resolve(mongoose),
      };

      const res = await healthHandler();
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.status, 'ok');
      assert.equal(json.data.readyState, 1);
      assert.equal(typeof json.data.latencyMs, 'number');
      assert.ok(json.data.latencyMs >= 0);
    });

    it('returns 503 DB_UNAVAILABLE without leaking secrets when DB ping fails', async () => {
      global.mongooseCache = {
        conn: {
          connection: {
            readyState: 0,
            db: {
              admin: () => ({
                ping: async () => {
                  throw new Error('mongodb+srv://secretUser:secretPass@cluster.example.com failed');
                },
              }),
            },
          },
        } as unknown as typeof mongoose,
        promise: Promise.resolve(mongoose),
      };

      const res = await healthHandler();
      assert.equal(res.status, 503);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.error, 'Database unavailable');
      assert.equal(json.code, 'DB_UNAVAILABLE');
      assert.equal(JSON.stringify(json).includes('secret'), false);
    });
  });

  describe('2. Stats summary mode & QazaPayment projection', () => {
    it('omits accountability.breakdown when summary=true and preserves totals + selects totalAmount', async () => {
      const { user, token } = createUserWithSession({
        name: 'Stats User',
        username: 'stats_summary',
        platformStartDate: '2026-10-15',
      });
      mockRecords.push({
        _id: new mongoose.Types.ObjectId(),
        userId: user._id,
        date: '2026-10-20',
        prayers: makePrayersMap({ fajr: { status: 'MISSED' } }),
        finesAccrued: 15000,
        markModified: () => {},
        save: async function () {
          return this;
        },
      });

      const summaryRes = await statsHandler(
        new NextRequest('http://localhost:3000/api/stats?today=2026-11-27&summary=true', {
          headers: { cookie: `${PRIMARY_SESSION_COOKIE}=${token}` },
        })
      );
      assert.equal(summaryRes.status, 200);
      const summaryJson = await summaryRes.json();
      assert.equal(lastPaymentSelect, 'totalAmount');
      assert.equal('breakdown' in summaryJson.data.accountability, false);
      assert.equal(summaryJson.data.accountability.totalPaidAmount, 15000);
      assert.equal(summaryJson.data.missedByPrayer.fajr, 1);

      const fullRes = await statsHandler(
        new NextRequest('http://localhost:3000/api/stats?today=2026-11-27', {
          headers: { cookie: `${PRIMARY_SESSION_COOKIE}=${token}` },
        })
      );
      assert.equal(fullRes.status, 200);
      const fullJson = await fullRes.json();
      assert.ok(Array.isArray(fullJson.data.accountability.breakdown));
      assert.equal(fullJson.data.accountability.breakdown.length, 1);
    });
  });

  describe('3. Prayer Times Auth Skip & Profile Leaderboard Cache Invalidation', () => {
    it('skips session DB lookups when no cookie OR when explicit location + lang are supplied', async () => {
      let sessionLookups = 0;
      const sessionModel = Session as unknown as Record<string, unknown>;
      sessionModel.findOne = () => {
        sessionLookups++;
        return { lean: async () => null };
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            date: '27-11-2026',
            fajr: '05:50',
            sunrise: '07:20',
            dhuhr: '12:15',
            asr: '15:10',
            maghrib: '17:00',
            isha: '18:30',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );

      try {
        // 1. No cookie -> 0 session lookups
        const resNoCookie = await prayerTimesHandler(
          new NextRequest('http://localhost:3000/api/prayer-times?city=tashkent')
        );
        assert.equal(resNoCookie.status, 200);
        assert.equal(sessionLookups, 0);

        // 2. Cookie present, but explicit city + lang -> 0 session lookups
        clearPrayerTimesCache();
        const resExplicit = await prayerTimesHandler(
          new NextRequest('http://localhost:3000/api/prayer-times?city=tashkent&lang=en', {
            headers: { cookie: `${PRIMARY_SESSION_COOKIE}=some_token` },
          })
        );
        assert.equal(resExplicit.status, 200);
        assert.equal(sessionLookups, 0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('clears leaderboard cache when user updates their name via PUT /api/user/profile', async () => {
      const { token } = createUserWithSession({
        name: 'Old Name',
        username: 'leader_user',
        showOnLeaderboard: true,
      });

      // Populate leaderboard cache
      const lb1 = await getLeaderboardHandler(
        new NextRequest('http://localhost:3000/api/leaderboard?period=daily&date=2026-11-27', {
          headers: { cookie: `${PRIMARY_SESSION_COOKIE}=${token}` },
        })
      );
      const lb1Json = await lb1.json();
      assert.equal(lb1Json.data.leaderboard[0].name, 'Old Name');

      // Update name via profile endpoint
      const profRes = await updateProfileHandler(
        new NextRequest('http://localhost:3000/api/user/profile', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            cookie: `${PRIMARY_SESSION_COOKIE}=${token}`,
          },
          body: JSON.stringify({ name: 'New Display Name' }),
        })
      );
      assert.equal(profRes.status, 200);

      // Subsequent leaderboard query must reflect New Display Name (cache was cleared)
      const lb2 = await getLeaderboardHandler(
        new NextRequest('http://localhost:3000/api/leaderboard?period=daily&date=2026-11-27', {
          headers: { cookie: `${PRIMARY_SESSION_COOKIE}=${token}` },
        })
      );
      const lb2Json = await lb2.json();
      assert.equal(lb2Json.data.leaderboard[0].name, 'New Display Name');
    });
  });

  describe('4. Liturgical Date fajrTime, Pre-Start Reset Cleanup & Signup Timezone', () => {
    it('deletes empty pre-start PrayerRecord on reset while preserving records with notes', async () => {
      const { user, token } = createUserWithSession({
        name: 'Reset User',
        username: 'reset_user',
        platformStartDate: '2026-11-24',
      });

      // Seed a pre-start record (2026-10-05 < 2026-11-24)
      mockRecords.push({
        _id: new mongoose.Types.ObjectId(),
        userId: user._id,
        date: '2026-10-05',
        prayers: makePrayersMap({ fajr: { status: 'PRAYED_ON_TIME', prayedAt: new Date() } }),
        finesAccrued: 0,
        markModified: () => {},
        save: async function () {
          return this;
        },
      });

      // Reset all prayers to PENDING with no notes -> must delete document
      const resetRes = await upsertPrayerHandler(
        new NextRequest('http://localhost:3000/api/prayers', {
          method: 'POST',
          headers: { cookie: `${PRIMARY_SESSION_COOKIE}=${token}` },
          body: JSON.stringify({
            date: '2026-10-05',
            prayers: {
              fajr: 'PENDING',
              dhuhr: 'PENDING',
              asr: 'PENDING',
              maghrib: 'PENDING',
              isha: 'PENDING',
            },
          }),
        })
      );
      assert.equal(resetRes.status, 200);
      const resetJson = await resetRes.json();
      assert.equal(resetJson.data.prayers.fajr.status, 'PENDING');
      assert.equal(resetJson.data.finesAccrued, 0);
      assert.equal(deleteOneCalls.length, 1);
      assert.equal(deleteOneCalls[0].date, '2026-10-05');
      assert.equal(mockRecords.length, 0);

      // If notes exist on a pre-start PENDING reset, keep document (non-destructive)
      const notedRes = await upsertPrayerHandler(
        new NextRequest('http://localhost:3000/api/prayers', {
          method: 'POST',
          headers: { cookie: `${PRIMARY_SESSION_COOKIE}=${token}` },
          body: JSON.stringify({
            date: '2026-10-06',
            prayerId: 'fajr',
            status: 'PENDING',
            notes: 'Keep this note',
          }),
        })
      );
      assert.equal(notedRes.status, 200);
      assert.equal(deleteOneCalls.length, 1);
      assert.equal(mockRecords.length, 1);
    });

    it('accepts validated fajrTime on /api/prayers and /api/prayers/history and respects resolveUserStartDate', async () => {
      const { token } = createUserWithSession({
        name: 'Liturgical User',
        username: 'liturgical_user',
        platformStartDate: '2026-11-20',
      });

      const prayerRes = await getPrayersHandler(
        new NextRequest('http://localhost:3000/api/prayers?fajrTime=06:15&timezone=Asia/Tashkent', {
          headers: { cookie: `${PRIMARY_SESSION_COOKIE}=${token}` },
        })
      );
      assert.equal(prayerRes.status, 200);

      const historyRes = await getHistoryHandler(
        new NextRequest('http://localhost:3000/api/prayers/history?fajrTime=06:15&timezone=Asia/Tashkent', {
          headers: { cookie: `${PRIMARY_SESSION_COOKIE}=${token}` },
        })
      );
      assert.equal(historyRes.status, 200);
      const historyJson = await historyRes.json();
      assert.equal(historyJson.data.platformStartDate, '2026-11-20');
      assert.ok(historyJson.data.startDate >= '2026-11-20' || historyJson.data.endDate < '2026-11-20');
    });

    it('accepts optional timezone on POST /api/auth/signup and passes to resolveUserStartDate', async () => {
      const res = await signupHandler(
        new NextRequest('http://localhost:3000/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'New York User',
            email: 'nyuser@example.com',
            username: 'ny_user',
            password: 'Password123!#',
            confirmPassword: 'Password123!#',
            timezone: 'America/New_York',
          }),
        })
      );
      assert.equal(res.status, 201);
      const json = await res.json();
      assert.equal(json.data.user.preferences.timezone, 'America/New_York');
      assert.match(json.data.user.platformStartDate, /^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('5. Circle Member History Validation, Join Rate Limit & DELETE 403', () => {
    it('rejects invalid calendar dates like 2026-02-31 in GET /api/groups/[id]/member-history', async () => {
      const { user: owner, token } = createUserWithSession({
        name: 'Circle Owner',
        username: 'c_owner',
      });
      const groupId = new mongoose.Types.ObjectId();
      mockGroups.push({
        _id: groupId,
        name: 'Audit Circle',
        description: '',
        creatorId: owner._id,
        inviteCode: 'AUDT-1234',
        members: [{ userId: owner._id, role: 'owner', joinedAt: new Date() }],
        save: async function () {
          return this;
        },
      });

      const res = await memberHistoryHandler(
        new NextRequest(
          `http://localhost:3000/api/groups/${groupId}?memberId=${owner._id}&startDate=2026-02-31&endDate=2026-03-05`,
          { headers: { cookie: `${PRIMARY_SESSION_COOKIE}=${token}` } }
        ),
        { params: Promise.resolve({ id: groupId.toString() }) }
      );
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.code, 'INVALID_DATE');
    });

    it('enforces sliding-window rate limit (429 + Retry-After) on POST /api/groups/join', async () => {
      const { token } = createUserWithSession({
        name: 'Join Tester',
        username: 'join_tester',
      });

      for (let i = 0; i < 10; i++) {
        const res = await joinGroupHandler(
          new NextRequest('http://localhost:3000/api/groups/join', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-forwarded-for': '203.0.113.9',
              cookie: `${PRIMARY_SESSION_COOKIE}=${token}`,
            },
            body: JSON.stringify({ inviteCode: `BAD-${i}` }),
          })
        );
        assert.equal(res.status, 404);
      }

      const blocked = await joinGroupHandler(
        new NextRequest('http://localhost:3000/api/groups/join', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': '203.0.113.9',
            cookie: `${PRIMARY_SESSION_COOKIE}=${token}`,
          },
          body: JSON.stringify({ inviteCode: 'BAD-99' }),
        })
      );
      assert.equal(blocked.status, 429);
      assert.ok(blocked.headers.get('retry-after'));
      const json = await blocked.json();
      assert.equal(json.code, 'AUTH_RATE_LIMITED');
    });

    it('returns 403 FORBIDDEN_NOT_MEMBER when non-member calls DELETE /api/groups/[id]', async () => {
      const { user: owner } = createUserWithSession({ name: 'Owner', username: 'del_owner' });
      const { token: outsiderToken } = createUserWithSession({
        name: 'Outsider',
        username: 'del_outsider',
      });
      const groupId = new mongoose.Types.ObjectId();
      mockGroups.push({
        _id: groupId,
        name: 'Private Circle',
        description: '',
        creatorId: owner._id,
        inviteCode: 'PRIV-5678',
        members: [{ userId: owner._id, role: 'owner', joinedAt: new Date() }],
        save: async function () {
          return this;
        },
      });

      const res = await deleteGroupHandler(
        new NextRequest(`http://localhost:3000/api/groups/${groupId}`, {
          method: 'DELETE',
          headers: { cookie: `${PRIMARY_SESSION_COOKIE}=${outsiderToken}` },
        }),
        { params: Promise.resolve({ id: groupId.toString() }) }
      );
      assert.equal(res.status, 403);
      const json = await res.json();
      assert.equal(json.code, 'FORBIDDEN_NOT_MEMBER');
    });
  });
});
