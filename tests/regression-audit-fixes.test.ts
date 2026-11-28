import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server.js';

import { User } from '../src/models/User.ts';
import { Session } from '../src/models/Session.ts';
import { Group } from '../src/models/Group.ts';
import { PrayerRecord } from '../src/models/Prayer.ts';
import { QazaPayment } from '../src/models/QazaPayment.ts';
import { sanitizeUser, invalidateSessionCache } from '../src/lib/auth/guard.ts';
import {
  PLATFORM_LAUNCH_DATE,
  resolveUserStartDate,
  isPreStartDate,
  getLiturgicalDate,
  resolvePrayerCycle,
} from '../src/lib/prayer-cycle.ts';
import {
  archiveLiturgicalDay,
  catchupMultiDayGap,
  syncActiveUserContext,
  STORAGE_KEY_DAILY_PRAYERS,
  STORAGE_KEY_HISTORY_RECORDS,
  STORAGE_KEY_ACTIVE_USER_ID,
} from '../src/lib/storage-sync.ts';
import { POST as rolloverHandler } from '../src/app/api/prayers/rollover/route.ts';
import { POST as upsertPrayerHandler } from '../src/app/api/prayers/route.ts';
import { GET as getStatsHandler } from '../src/app/api/stats/route.ts';
import { DELETE as deleteGroupHandler, GET as getGroupHandler } from '../src/app/api/groups/[id]/route.ts';
import { GET as getLeaderboardHandler, clearLeaderboardCache } from '../src/app/api/leaderboard/route.ts';
import type { PrayerId, PrayerItem, PrayerStatus } from '../src/types/prayer.ts';

interface MockPrayerDoc {
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
  markModified: (p: string) => void;
  save: () => Promise<MockPrayerDoc>;
}

interface MockUserDoc {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  username: string;
  role: 'user' | 'admin';
  platformStartDate?: string;
  preferences: {
    language: 'uz' | 'ru' | 'en';
    showOnLeaderboard?: boolean;
    timezone?: string;
  };
  createdAt: Date;
  updatedAt: Date;
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
  sessionToken: string;
  userId: mongoose.Types.ObjectId;
  expiresAt: Date;
  lastActiveAt: Date;
  save: () => Promise<unknown>;
}> = [];
let mockRecords: MockPrayerDoc[] = [];
let mockGroups: MockGroupDoc[] = [];

function makePrayersMap(
  overrides: Partial<Record<PrayerId, PrayerStatus>> = {}
): MockPrayerDoc['prayers'] {
  const ids: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const out = {} as MockPrayerDoc['prayers'];
  for (const id of ids) {
    out[id] = { status: overrides[id] || 'PENDING', isPaid: false, paidAmount: 0 };
  }
  return out;
}

function makeRecord(
  userId: mongoose.Types.ObjectId,
  date: string,
  overrides: Partial<Record<PrayerId, PrayerStatus>> = {}
): MockPrayerDoc {
  const doc: MockPrayerDoc = {
    _id: new mongoose.Types.ObjectId(),
    userId,
    date,
    prayers: makePrayersMap(overrides),
    finesAccrued: 0,
    markModified: () => {},
    save: async () => {
      const idx = mockRecords.findIndex(
        (r) => r.userId.toString() === userId.toString() && r.date === date
      );
      if (idx >= 0) mockRecords[idx] = doc;
      else mockRecords.push(doc);
      return doc;
    },
  };
  return doc;
}

function setupMocks() {
  invalidateSessionCache();
  clearLeaderboardCache();
  mockUsers = [];
  mockSessions = [];
  mockRecords = [];
  mockGroups = [];

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

  userModel.find = (query: {
    'preferences.showOnLeaderboard'?: boolean;
    _id?: { $in?: mongoose.Types.ObjectId[] };
  }) => {
    let result = [...mockUsers];
    if (query['preferences.showOnLeaderboard'] !== undefined) {
      result = result.filter(
        (u) => Boolean(u.preferences?.showOnLeaderboard) === query['preferences.showOnLeaderboard']
      );
    }
    if (query._id?.$in) {
      const allowed = new Set(query._id.$in.map((id) => id.toString()));
      result = result.filter((u) => allowed.has(u._id.toString()));
    }
    const qHelper = {
      sort: () => qHelper,
      select: () => qHelper,
      lean: async () => result,
      then: (resolve: (list: MockUserDoc[]) => void) => resolve(result),
    };
    return qHelper;
  };

  sessionModel.findOne = (query: { sessionToken?: string }) => {
    const found = mockSessions.find((s) => s.sessionToken === query.sessionToken) || null;
    return {
      lean: async () => found,
      then: (resolve: (s: unknown) => void) => resolve(found),
    };
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
      $setOnInsert?: Record<string, unknown>;
    }
  ) => {
    const uId = filter.userId.toString();
    let doc = mockRecords.find((r) => r.userId.toString() === uId && r.date === filter.date);
    if (!doc) {
      doc = makeRecord(new mongoose.Types.ObjectId(uId), filter.date);
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

  PrayerRecord.prototype.save = async function (this: unknown) {
    const doc = this as MockPrayerDoc;
    if (!doc._id) doc._id = new mongoose.Types.ObjectId();
    const idx = mockRecords.findIndex(
      (r) => r.userId.toString() === doc.userId.toString() && r.date === doc.date
    );
    if (idx >= 0) mockRecords[idx] = doc;
    else mockRecords.push(doc);
    return doc;
  };

  paymentModel.find = () => {
    const qHelper = {
      lean: async () => [],
      then: (resolve: (list: unknown[]) => void) => resolve([]),
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

  groupModel.findByIdAndDelete = async (id: mongoose.Types.ObjectId | string) => {
    const idx = mockGroups.findIndex((g) => g._id.toString() === id.toString());
    if (idx >= 0) {
      const [removed] = mockGroups.splice(idx, 1);
      return removed;
    }
    return null;
  };
}

function createUserWithSession(opts: {
  name: string;
  username: string;
  createdAt?: Date;
  platformStartDate?: string;
  showOnLeaderboard?: boolean;
  timezone?: string;
}) {
  const userId = new mongoose.Types.ObjectId();
  const token = `tok-${userId.toString()}`;
  const user: MockUserDoc = {
    _id: userId,
    name: opts.name,
    email: `${opts.username}@example.com`,
    username: opts.username,
    role: 'user',
    platformStartDate: opts.platformStartDate,
    preferences: {
      language: 'uz',
      showOnLeaderboard: opts.showOnLeaderboard,
      timezone: opts.timezone || 'Asia/Tashkent',
    },
    createdAt: opts.createdAt || new Date('2026-11-10T10:00:00Z'),
    updatedAt: new Date(),
  };
  mockUsers.push(user);
  mockSessions.push({
    sessionToken: token,
    userId,
    expiresAt: new Date(Date.now() + 86400_000),
    lastActiveAt: new Date(),
    save: async () => true,
  });
  return { user, token };
}

describe('Regression Audit Suite: All 9 Improvements', () => {
  beforeEach(() => {
    setupMocks();
  });

  describe('1. Circle Owner Deletion vs Regular Member Leave', () => {
    it('prevents non-owner members from deleting a circle (403 Forbidden)', async () => {
      const { user: owner } = createUserWithSession({ name: 'Owner', username: 'owner1' });
      const { user: member, token: memberToken } = createUserWithSession({
        name: 'Member',
        username: 'member1',
      });
      const groupId = new mongoose.Types.ObjectId();
      const groupDoc: MockGroupDoc = {
        _id: groupId,
        name: 'Test Circle',
        description: '',
        creatorId: owner._id,
        inviteCode: 'ABCD-2345',
        members: [
          { userId: owner._id, role: 'owner', joinedAt: new Date() },
          { userId: member._id, role: 'member', joinedAt: new Date() },
        ],
        save: async () => groupDoc,
      };
      mockGroups.push(groupDoc);

      const req = new NextRequest(`http://localhost:3000/api/groups/${groupId}?intent=delete`, {
        method: 'DELETE',
        headers: { cookie: `salahtrack_session=${memberToken}` },
      });
      const res = await deleteGroupHandler(req, {
        params: Promise.resolve({ id: groupId.toString() }),
      });

      assert.equal(res.status, 403);
      const json = await res.json();
      assert.equal(json.code, 'FORBIDDEN_OWNER_ONLY');
      assert.equal(mockGroups.length, 1, 'Circle must NOT be deleted by regular member');
    });

    it('allows regular members to leave without deleting the circle', async () => {
      const { user: owner } = createUserWithSession({ name: 'Owner', username: 'owner2' });
      const { user: member, token: memberToken } = createUserWithSession({
        name: 'Member',
        username: 'member2',
      });
      const groupId = new mongoose.Types.ObjectId();
      const groupDoc: MockGroupDoc = {
        _id: groupId,
        name: 'Shared Circle',
        description: '',
        creatorId: owner._id,
        inviteCode: 'EFGH-5678',
        members: [
          { userId: owner._id, role: 'owner', joinedAt: new Date() },
          { userId: member._id, role: 'member', joinedAt: new Date() },
        ],
        save: async () => groupDoc,
      };
      mockGroups.push(groupDoc);

      const req = new NextRequest(`http://localhost:3000/api/groups/${groupId}?intent=leave`, {
        method: 'DELETE',
        headers: { cookie: `salahtrack_session=${memberToken}` },
      });
      const res = await deleteGroupHandler(req, {
        params: Promise.resolve({ id: groupId.toString() }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.action, 'left');
      assert.equal(mockGroups.length, 1);
      assert.equal(mockGroups[0].members.length, 1);
      assert.equal(mockGroups[0].members[0].userId.toString(), owner._id.toString());
    });

    it('allows circle owner to delete a multi-member circle permanently', async () => {
      const { user: owner, token: ownerToken } = createUserWithSession({
        name: 'Owner',
        username: 'owner3',
      });
      const { user: member } = createUserWithSession({ name: 'Member', username: 'member3' });
      const groupId = new mongoose.Types.ObjectId();
      const groupDoc: MockGroupDoc = {
        _id: groupId,
        name: 'Owner Circle',
        description: '',
        creatorId: owner._id,
        inviteCode: 'JKLM-9012',
        members: [
          { userId: owner._id, role: 'owner', joinedAt: new Date() },
          { userId: member._id, role: 'member', joinedAt: new Date() },
        ],
        save: async () => groupDoc,
      };
      mockGroups.push(groupDoc);

      const req = new NextRequest(`http://localhost:3000/api/groups/${groupId}?intent=delete`, {
        method: 'DELETE',
        headers: { cookie: `salahtrack_session=${ownerToken}` },
      });
      const res = await deleteGroupHandler(req, {
        params: Promise.resolve({ id: groupId.toString() }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.action, 'deleted');
      assert.equal(mockGroups.length, 0, 'Owner deletion must remove the circle completely');
    });

    it('includes ownerId and currentUserRole in GET /api/groups/[id]', async () => {
      const { user: owner, token: ownerToken } = createUserWithSession({
        name: 'Owner',
        username: 'owner4',
      });
      const groupId = new mongoose.Types.ObjectId();
      const groupDoc: MockGroupDoc = {
        _id: groupId,
        name: 'Role Metadata Circle',
        description: '',
        creatorId: owner._id,
        inviteCode: 'NPQR-3456',
        members: [{ userId: owner._id, role: 'owner', joinedAt: new Date() }],
        save: async () => groupDoc,
      };
      mockGroups.push(groupDoc);

      const req = new NextRequest(
        `http://localhost:3000/api/groups/${groupId}?period=weekly&timezone=Asia/Tashkent`,
        {
          headers: { cookie: `salahtrack_session=${ownerToken}` },
        }
      );
      const res = await getGroupHandler(req, {
        params: Promise.resolve({ id: groupId.toString() }),
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.data.ownerId, owner._id.toString());
      assert.equal(json.data.currentUserRole, 'owner');
    });
  });

  describe('2, 3, 4. Leaderboard Order, Consistent Titles & Privacy-by-Default', () => {
    it('keeps user profiles private by default on schema, sanitizeUser, and /api/leaderboard', async () => {
      const { user: privateUser, token } = createUserWithSession({
        name: 'Private User',
        username: 'privuser',
        // showOnLeaderboard omitted -> must default to false
      });
      const { user: publicUser } = createUserWithSession({
        name: 'Public User',
        username: 'pubuser',
        showOnLeaderboard: true,
      });

      const safe = sanitizeUser(privateUser as unknown as Parameters<typeof sanitizeUser>[0]);
      assert.equal(safe.preferences.showOnLeaderboard, false);

      const schemaDefault = User.schema.path('preferences.showOnLeaderboard').options.default;
      assert.equal(schemaDefault, false);

      const req = new NextRequest('http://localhost:3000/api/leaderboard?period=daily', {
        headers: { cookie: `salahtrack_session=${token}` },
      });
      const res = await getLeaderboardHandler(req);
      assert.equal(res.status, 200);
      const json = await res.json();
      const usernames = (json.data.leaderboard as Array<{ username: string }>).map(
        (e) => e.username
      );
      assert.ok(!usernames.includes(privateUser.username), 'Private user must not appear');
      assert.ok(usernames.includes(publicUser.username), 'Opted-in user must appear');
    });

    it('verifies Leaderboard tabs order (My Circles first, Overall Leaderboard second), switch toggle, and consistent title', () => {
      const src = fs.readFileSync(
        path.resolve(process.cwd(), 'src/app/leaderboard/page.tsx'),
        'utf-8'
      );
      const circlesIdx = src.indexOf("handleTabChange('circles')");
      const globalIdx = src.indexOf("handleTabChange('global')");
      assert.ok(circlesIdx !== -1 && globalIdx !== -1 && circlesIdx < globalIdx);
      assert.match(src, /const activeTab: LeaderboardTab = tabParam === 'global' \? 'global' : 'circles'/);
      assert.match(src, /role="switch"/);
      assert.match(src, /aria-checked=\{isOptedIn\}/);
      assert.doesNotMatch(src, /Consistency Leaderboard/);
    });
  });

  describe('5. Progress Page Redesign & Stats Completeness', () => {
    it('removes Analytical Insights and Recent Days Log from Progress Overview', () => {
      const src = fs.readFileSync(
        path.resolve(process.cwd(), 'src/app/progress/page.tsx'),
        'utf-8'
      );
      assert.doesNotMatch(src, /t\.progress\.insights\.title/);
      assert.doesNotMatch(src, /t\.progress\.recentHistoryTitle/);
    });

    it('GET /api/stats returns multi-month missedByPrayer, prayerBreakdown, and platformStartDate', async () => {
      const { user, token } = createUserWithSession({
        name: 'Stats User',
        username: 'statsuser',
        platformStartDate: '2026-10-15',
      });
      mockRecords.push(
        makeRecord(user._id, '2026-10-20', { fajr: 'MISSED', dhuhr: 'PRAYED_ON_TIME' }),
        makeRecord(user._id, '2026-11-25', { fajr: 'MISSED', isha: 'MISSED' })
      );

      const req = new NextRequest(
        'http://localhost:3000/api/stats?today=2026-11-27&timezone=Asia/Tashkent',
        { headers: { cookie: `salahtrack_session=${token}` } }
      );
      const res = await getStatsHandler(req);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.data.platformStartDate, '2026-10-15');
      assert.equal(json.data.missedByPrayer.fajr, 2);
      assert.equal(json.data.missedByPrayer.isha, 1);
      assert.ok(json.data.prayerBreakdown.dhuhr);
    });
  });

  describe('6 & 7. Date Accuracy, Midnight Rollover & Cache Isolation', () => {
    it('keeps post-midnight pre-Fajr on previous liturgical day in local timezone', () => {
      // 2026-11-27 01:30 in Tashkent (UTC+5) = 2026-11-26T20:30:00Z
      const instant = new Date('2026-11-26T20:30:00.000Z');
      const cycleTashkent = resolvePrayerCycle({
        now: instant,
        fajrTimeStr: '05:45',
        timezone: 'Asia/Tashkent',
      });
      assert.equal(cycleTashkent.calendarDate, '2026-11-27');
      assert.equal(cycleTashkent.liturgicalDate, '2026-11-26');
      assert.equal(
        getLiturgicalDate(instant, '05:45', 'Asia/Tashkent'),
        '2026-11-26'
      );
      assert.equal(cycleTashkent.isPostMidnight, true);

      // Same instant in America/New_York (EST UTC-5) = 2026-11-26 15:30
      const cycleNy = resolvePrayerCycle({
        now: instant,
        fajrTimeStr: '05:45',
        timezone: 'America/New_York',
      });
      assert.equal(cycleNy.calendarDate, '2026-11-26');
      assert.equal(cycleNy.liturgicalDate, '2026-11-26');
      assert.equal(cycleNy.isPostMidnight, false);
    });

    it('isolates localStorage prayer data when switching accounts or logging out', () => {
      const store = new Map<string, string>();
      (globalThis as unknown as { window: unknown }).window = {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => store.set(k, v),
          removeItem: (k: string) => store.delete(k),
        },
        location: { protocol: 'http:' },
        dispatchEvent: () => true,
      };

      try {
        store.set(STORAGE_KEY_ACTIVE_USER_ID, 'userA');
        store.set(STORAGE_KEY_DAILY_PRAYERS, '[{"id":"fajr","status":"PRAYED_ON_TIME"}]');
        store.set(STORAGE_KEY_HISTORY_RECORDS, '{"2026-11-27":{}}');

        // Switching to userB clears userA's cached data
        const cleared = syncActiveUserContext('userB');
        assert.equal(cleared, true);
        assert.equal(store.get(STORAGE_KEY_DAILY_PRAYERS), undefined);
        assert.equal(store.get(STORAGE_KEY_HISTORY_RECORDS), undefined);
        assert.equal(store.get(STORAGE_KEY_ACTIVE_USER_ID), 'userB');

        // Logging out clears userB's cached data
        store.set(STORAGE_KEY_DAILY_PRAYERS, '[{"id":"dhuhr","status":"MISSED"}]');
        const loggedOutCleared = syncActiveUserContext(null);
        assert.equal(loggedOutCleared, true);
        assert.equal(store.get(STORAGE_KEY_DAILY_PRAYERS), undefined);
        assert.equal(store.get(STORAGE_KEY_ACTIVE_USER_ID), undefined);
      } finally {
        delete (globalThis as unknown as { window?: unknown }).window;
      }
    });
  });

  describe('9. Automatic Qaza Exclusion Before Platform Start Date & Historical Manual Override', () => {
    it('resolves user start date enforcing PLATFORM_LAUNCH_DATE floor', () => {
      assert.equal(
        resolveUserStartDate({ createdAt: new Date('2025-01-01T12:00:00Z'), timezone: 'Asia/Tashkent' }),
        PLATFORM_LAUNCH_DATE
      );
      assert.equal(
        resolveUserStartDate({ createdAt: new Date('2026-11-20T12:00:00Z'), timezone: 'Asia/Tashkent' }),
        '2026-11-20'
      );
      assert.equal(isPreStartDate('2026-11-19', '2026-11-20'), true);
      assert.equal(isPreStartDate('2026-11-20', '2026-11-20'), false);
    });

    it('POST /api/prayers/rollover NEVER creates MISSED records for dates before user platformStartDate and preserves historical records', async () => {
      const { user, token } = createUserWithSession({
        name: 'New User',
        username: 'newuser',
        platformStartDate: '2026-11-24',
        createdAt: new Date('2026-11-24T09:00:00Z'),
      });

      // Pre-existing legitimate manual historical record before start date
      mockRecords.push(
        makeRecord(user._id, '2026-11-20', {
          fajr: 'PRAYED_ON_TIME',
          dhuhr: 'PENDING',
        })
      );

      // Rollover triggered from 2026-11-20 -> 2026-11-26
      const req = new NextRequest('http://localhost:3000/api/prayers/rollover', {
        method: 'POST',
        headers: { cookie: `salahtrack_session=${token}` },
        body: JSON.stringify({
          fromDate: '2026-11-20',
          toDate: '2026-11-26',
          timezone: 'Asia/Tashkent',
        }),
      });
      const res = await rolloverHandler(req);
      assert.equal(res.status, 200);

      // 1. Pre-start date 2026-11-20 MUST NOT have PENDING converted to MISSED
      const preStartExisting = mockRecords.find((r) => r.date === '2026-11-20');
      assert.ok(preStartExisting);
      assert.equal(preStartExisting.prayers.fajr.status, 'PRAYED_ON_TIME');
      assert.equal(
        preStartExisting.prayers.dhuhr.status,
        'PENDING',
        'Pre-start PENDING prayer must NOT be converted to MISSED by rollover'
      );

      // 2. Intermediate pre-start dates (Nov 21, 22, 23) MUST NOT be generated at all
      assert.equal(mockRecords.find((r) => r.date === '2026-11-21'), undefined);
      assert.equal(mockRecords.find((r) => r.date === '2026-11-22'), undefined);
      assert.equal(mockRecords.find((r) => r.date === '2026-11-23'), undefined);

      // 3. Post-start intermediate dates (Nov 24, 25) ARE properly tracked as MISSED
      const postStart1 = mockRecords.find((r) => r.date === '2026-11-24');
      const postStart2 = mockRecords.find((r) => r.date === '2026-11-25');
      assert.ok(postStart1, 'Activation date 2026-11-24 must be rolled over');
      assert.equal(postStart1.prayers.fajr.status, 'MISSED');
      assert.ok(postStart2, 'Post-activation date 2026-11-25 must be rolled over');
      assert.equal(postStart2.prayers.fajr.status, 'MISSED');
    });

    it('client archiveLiturgicalDay and catchupMultiDayGap strictly exclude dates before minStartDate', () => {
      const store = new Map<string, string>();
      (globalThis as unknown as { window: unknown }).window = {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => store.set(k, v),
          removeItem: (k: string) => store.delete(k),
        },
        location: { protocol: 'http:' },
        dispatchEvent: () => true,
      };

      try {
        const pendingPrayers: PrayerItem[] = [
          { id: 'fajr', name: 'Fajr', time: '05:00', endTime: '06:30', status: 'PENDING' },
          { id: 'dhuhr', name: 'Dhuhr', time: '12:15', endTime: '15:45', status: 'PENDING' },
          { id: 'asr', name: 'Asr', time: '15:45', endTime: '17:30', status: 'PENDING' },
          { id: 'maghrib', name: 'Maghrib', time: '17:30', endTime: '19:00', status: 'PENDING' },
          { id: 'isha', name: 'Isha', time: '19:00', endTime: '05:00', status: 'PENDING' },
        ];

        const arch = archiveLiturgicalDay('2026-11-20', pendingPrayers, '2026-11-24');
        assert.equal(arch.uncompletedCount, 0);

        const gapCount = catchupMultiDayGap('2026-11-20', '2026-11-26', '2026-11-24');
        // Only Nov 24 and Nov 25 should be created (2 * 5 = 10), NOT Nov 21, 22, 23
        assert.equal(gapCount, 10);

        const parsed = JSON.parse(store.get(STORAGE_KEY_HISTORY_RECORDS) || '{}');
        assert.equal(parsed['2026-11-20'], undefined);
        assert.equal(parsed['2026-11-21'], undefined);
        assert.equal(parsed['2026-11-23'], undefined);
        assert.ok(parsed['2026-11-24']);
        assert.ok(parsed['2026-11-25']);
      } finally {
        delete (globalThis as unknown as { window?: unknown }).window;
      }
    });

    it('allows manual historical override (Prayed, Made Up, Missed) and batch reset to Pending, clearing stale timestamps', async () => {
      const { token } = createUserWithSession({
        name: 'Hist User',
        username: 'histuser',
        platformStartDate: '2026-11-24',
      });

      // Manually mark pre-start historical date 2026-10-05 as PRAYED_ON_TIME, MADE_UP, MISSED
      const setRes = await upsertPrayerHandler(
        new NextRequest('http://localhost:3000/api/prayers', {
          method: 'POST',
          headers: { cookie: `salahtrack_session=${token}` },
          body: JSON.stringify({
            date: '2026-10-05',
            prayers: {
              fajr: 'PRAYED_ON_TIME',
              dhuhr: 'MADE_UP',
              asr: 'MISSED',
            },
          }),
        })
      );
      assert.equal(setRes.status, 200);
      const setJson = await setRes.json();
      assert.equal(setJson.data.prayers.fajr.status, 'PRAYED_ON_TIME');
      assert.ok(setJson.data.prayers.fajr.prayedAt);
      assert.equal(setJson.data.prayers.dhuhr.status, 'MADE_UP');
      assert.equal(setJson.data.prayers.asr.status, 'MISSED');

      // Reset all on 2026-10-05 back to PENDING
      const resetRes = await upsertPrayerHandler(
        new NextRequest('http://localhost:3000/api/prayers', {
          method: 'POST',
          headers: { cookie: `salahtrack_session=${token}` },
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
      assert.equal(resetJson.data.prayers.fajr.prayedAt, undefined);
      assert.equal(resetJson.data.prayers.dhuhr.status, 'PENDING');
      assert.equal(resetJson.data.prayers.dhuhr.madeUpAt, undefined);
      assert.equal(resetJson.data.prayers.asr.status, 'PENDING');
      assert.equal(resetJson.data.prayers.asr.missedAt, undefined);
    });
  });
});
