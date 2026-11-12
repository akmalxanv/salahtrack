import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server.js';

import { User } from '../src/models/User.ts';
import { Session } from '../src/models/Session.ts';
import { Group } from '../src/models/Group.ts';
import { PrayerRecord } from '../src/models/Prayer.ts';

import { PUT as updateProfileHandler } from '../src/app/api/user/profile/route.ts';
import { GET as getPrayerTimesHandler, clearPrayerTimesCache } from '../src/app/api/prayer-times/route.ts';
import { GET as getMemberPrayersHandler } from '../src/app/api/groups/[id]/members/[memberId]/prayers/route.ts';
import { GET as getMemberHistoryHandler } from '../src/app/api/groups/[id]/member-history/route.ts';
import { GET as getLeaderboardHandler, clearLeaderboardCache } from '../src/app/api/leaderboard/route.ts';
import { findCityByNameOrId, findCityByCoordinates } from '../src/lib/cities.ts';

interface MockUserDoc {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  username: string;
  role: 'user' | 'admin';
  preferences: {
    language: 'uz' | 'ru' | 'en';
    showOnLeaderboard?: boolean;
    city?: string;
    latitude?: number;
    longitude?: number;
    timezone?: string;
  };
  createdAt: Date;
  updatedAt: Date;
  save: () => Promise<MockUserDoc>;
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
    prayedAt?: Date;
    isPaid?: boolean;
    paidAmount?: number;
  }>;
  finesAccrued?: number;
}

interface MockGroupDoc {
  _id: mongoose.Types.ObjectId;
  name: string;
  description?: string;
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
let mockSessions: MockSessionDoc[] = [];
let mockPrayerRecords: MockPrayerRecordDoc[] = [];
let mockGroups: MockGroupDoc[] = [];

const userAId = new mongoose.Types.ObjectId();
const userBId = new mongoose.Types.ObjectId();
const userOutsideId = new mongoose.Types.ObjectId();

const sessionTokenUserA = 'session-token-user-a';
const sessionTokenUserB = 'session-token-user-b';
const sessionTokenOutside = 'session-token-outside';

function setupMocks() {
  mockUsers = [
    {
      _id: userAId,
      name: 'User Alpha',
      email: 'alpha@example.com',
      username: 'user_alpha',
      role: 'user',
      preferences: {
        language: 'uz',
        showOnLeaderboard: true,
        city: 'Samarkand',
        latitude: 39.6542,
        longitude: 66.9597,
        timezone: 'Asia/Samarkand',
      },
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date(),
      save: async function () {
        return this;
      },
    },
    {
      _id: userBId,
      name: 'User Beta',
      email: 'beta@example.com',
      username: 'user_beta',
      role: 'user',
      preferences: {
        language: 'en',
        showOnLeaderboard: true,
        city: 'Tashkent',
        latitude: 41.2995,
        longitude: 69.2401,
        timezone: 'Asia/Tashkent',
      },
      createdAt: new Date('2026-01-02T00:00:00Z'),
      updatedAt: new Date(),
      save: async function () {
        return this;
      },
    },
    {
      _id: userOutsideId,
      name: 'User Outside',
      email: 'outside@example.com',
      username: 'user_outside',
      role: 'user',
      preferences: {
        language: 'ru',
        showOnLeaderboard: false,
      },
      createdAt: new Date('2026-01-03T00:00:00Z'),
      updatedAt: new Date(),
      save: async function () {
        return this;
      },
    },
  ];

  mockSessions = [
    {
      _id: new mongoose.Types.ObjectId(),
      sessionToken: sessionTokenUserA,
      userId: userAId,
      expiresAt: new Date(Date.now() + 86400000),
      lastActiveAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      save: async function () {
        return this;
      },
    },
    {
      _id: new mongoose.Types.ObjectId(),
      sessionToken: sessionTokenUserB,
      userId: userBId,
      expiresAt: new Date(Date.now() + 86400000),
      lastActiveAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      save: async function () {
        return this;
      },
    },
    {
      _id: new mongoose.Types.ObjectId(),
      sessionToken: sessionTokenOutside,
      userId: userOutsideId,
      expiresAt: new Date(Date.now() + 86400000),
      lastActiveAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      save: async function () {
        return this;
      },
    },
  ];

  mockPrayerRecords = [];
  mockGroups = [];

  global.mongooseCache = {
    conn: mongoose,
    promise: Promise.resolve(mongoose),
  };

  const userModel = User as unknown as Record<string, unknown>;
  const sessionModel = Session as unknown as Record<string, unknown>;
  const prayerModel = PrayerRecord as unknown as Record<string, unknown>;
  const groupModel = Group as unknown as Record<string, unknown>;

  userModel.findById = async (id: mongoose.Types.ObjectId | string) => {
    return mockUsers.find((u) => u._id.toString() === id.toString()) || null;
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
    return mockSessions.find((s) => s.sessionToken === query.sessionToken) || null;
  };

  prayerModel.find = (query: {
    userId?: { $in?: mongoose.Types.ObjectId[] } | mongoose.Types.ObjectId | string;
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
        sort: () => ({
          lean: async () => result,
        }),
        lean: async () => result,
      }),
      sort: () => ({
        select: () => ({
          lean: async () => result,
        }),
        lean: async () => result,
      }),
      lean: async () => result,
    };
  };

  groupModel.findById = async (id: mongoose.Types.ObjectId | string) => {
    return mockGroups.find((g) => g._id.toString() === id.toString()) || null;
  };
}

let mockFetchFailure = false;
let lastUpstreamUrl: URL | null = null;
const originalFetch = global.fetch;

function setupMockFetch() {
  global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (urlStr.includes('api.fatvo.uz')) {
      if (mockFetchFailure) {
        throw new Error('Upstream network connection timed out');
      }

      const parsedUrl = new URL(urlStr);
      lastUpstreamUrl = parsedUrl;
      const lng = parseFloat(parsedUrl.searchParams.get('lon') || '69.2401');

      // Longitude progression: as longitude decreases (moving west: Tashkent 69.2° -> Samarkand 67.0° -> Bukhara 64.4°),
      // solar noon occurs later. Calculate base minutes offset based on longitude diff from Tashkent (69.24°).
      const off = Math.max(0, Math.round((69.2401 - lng) * 4)); // east of Tashkent clamps to 0
      const pad = (n: number) => String(n).padStart(2, '0');
      const hm = (h: number, m: number) => `${pad(h + Math.floor(m / 60))}:${pad(m % 60)}`;

      return {
        ok: true,
        status: 200,
        json: async () => ({
          date: parsedUrl.searchParams.get('date'),
          imsak: hm(5, 17 + off),
          fajr: hm(5, 27 + off),
          sunrise: hm(6, 55 + off),
          dhuhr: hm(12, 5 + off),
          asr: hm(15, 10 + off),
          maghrib: hm(17, 15 + off),
          isha: hm(18, 41 + off),
          midnight: '00:06',
          address: { region: '', city: 'Toshkent', county: '', country: 'Oʻzbekiston' },
        }),
      } as unknown as Response;
    }

    return originalFetch(input, init);
  };
}

describe('Backend Enhancements: Location, Methods, Circle Prayer History & Leaderboard Streaks', () => {
  beforeEach(() => {
    setupMocks();
    setupMockFetch();
    mockFetchFailure = false;
    lastUpstreamUrl = null;
    clearPrayerTimesCache();
    clearLeaderboardCache();
  });

  after(() => {
    global.fetch = originalFetch;
  });

  // =========================================================================
  // 1. User Profile Location & Timezone Persistence
  // =========================================================================
  describe('1. Location & Timezone Preferences in User Profile', () => {
    it('successfully updates city, latitude, longitude, and timezone in user preferences', async () => {
      const req = new NextRequest('http://localhost:3000/api/user/profile', {
        method: 'PUT',
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
        body: JSON.stringify({
          preferences: {
            city: 'Bukhara',
            latitude: 39.7747,
            longitude: 64.4286,
            timezone: 'Asia/Samarkand',
          },
        }),
      });

      const res = await updateProfileHandler(req);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.user.preferences.city, 'Bukhara');
      assert.equal(json.data.user.preferences.latitude, 39.7747);
      assert.equal(json.data.user.preferences.longitude, 64.4286);
      assert.equal(json.data.user.preferences.timezone, 'Asia/Samarkand');
      assert.equal(json.data.user.preferences.calculationMethod, undefined);
    });

    it('rejects invalid latitude and longitude values with 400', async () => {
      // Latitude out of range (> 90)
      const reqBadLat = new NextRequest('http://localhost:3000/api/user/profile', {
        method: 'PUT',
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
        body: JSON.stringify({
          preferences: {
            latitude: 95.5,
          },
        }),
      });
      const resBadLat = await updateProfileHandler(reqBadLat);
      assert.equal(resBadLat.status, 400);
      const jsonBadLat = await resBadLat.json();
      assert.equal(jsonBadLat.code, 'INVALID_LATITUDE');

      // Longitude out of range (< -180)
      const reqBadLng = new NextRequest('http://localhost:3000/api/user/profile', {
        method: 'PUT',
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
        body: JSON.stringify({
          preferences: {
            longitude: -195.0,
          },
        }),
      });
      const resBadLng = await updateProfileHandler(reqBadLng);
      assert.equal(resBadLng.status, 400);
      const jsonBadLng = await resBadLng.json();
      assert.equal(jsonBadLng.code, 'INVALID_LONGITUDE');
    });

    it('rejects invalid timezone values with 400', async () => {
      // Timezone string exceeding 50 characters
      const reqLongTz = new NextRequest('http://localhost:3000/api/user/profile', {
        method: 'PUT',
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
        body: JSON.stringify({
          preferences: {
            timezone: 'A'.repeat(51),
          },
        }),
      });
      const resLongTz = await updateProfileHandler(reqLongTz);
      assert.equal(resLongTz.status, 400);
      const jsonLongTz = await resLongTz.json();
      assert.equal(jsonLongTz.code, 'INVALID_TIMEZONE');

      // Non-string timezone
      const reqBadTypeTz = new NextRequest('http://localhost:3000/api/user/profile', {
        method: 'PUT',
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
        body: JSON.stringify({
          preferences: {
            timezone: 12345,
          },
        }),
      });
      const resBadTypeTz = await updateProfileHandler(reqBadTypeTz);
      assert.equal(resBadTypeTz.status, 400);
      const jsonBadTypeTz = await resBadTypeTz.json();
      assert.equal(jsonBadTypeTz.code, 'INVALID_TIMEZONE');
    });
  });

  // =========================================================================
  // 2. Prayer Times Route (fatvo.uz)
  // =========================================================================
  describe('2. Prayer Times Route (fatvo.uz): Preferences, Timezones & City Resolution', () => {
    it('findCityByNameOrId and findCityByCoordinates resolve known cities accurately', () => {
      const samarkand = findCityByNameOrId('samarkand');
      assert.ok(samarkand);
      assert.equal(samarkand.country, 'Uzbekistan');

      const byCoords = findCityByCoordinates(41.2995, 69.2401);
      assert.ok(byCoords);
      assert.equal(byCoords.id, 'tashkent');
    });

    it('reads the saved location from user preferences when not supplied in searchParams', async () => {
      const req = new NextRequest('http://localhost:3000/api/prayer-times', {
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
      });

      const res = await getPrayerTimesHandler(req);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      // User A preference has city 'Samarkand' with Samarkand coordinates
      assert.equal(json.method, undefined, 'calculation methods are retired');
      assert.equal(json.city, 'Samarkand');
      assert.equal(json.location.latitude, 39.6542);
      assert.equal(json.location.longitude, 66.9597);
    });

    it('calls fatvo.uz with lat/lon, DD-MM-YYYY date, tz_offset from the city timezone, and lang', async () => {
      const req = new NextRequest('http://localhost:3000/api/prayer-times?city=Tashkent&date=2026-11-12&lang=ru');
      const res = await getPrayerTimesHandler(req);
      assert.equal(res.status, 200);
      const json = await res.json();

      assert.ok(lastUpstreamUrl, 'Upstream fatvo.uz must be called');
      assert.equal(lastUpstreamUrl.searchParams.get('lat'), '41.2995');
      assert.equal(lastUpstreamUrl.searchParams.get('lon'), '69.2401');
      assert.equal(lastUpstreamUrl.searchParams.get('date'), '12-11-2026');
      assert.equal(lastUpstreamUrl.searchParams.get('tz_offset'), '5');
      assert.equal(lastUpstreamUrl.searchParams.get('lang'), 'ru');
      assert.equal(json.provider, 'fatvo.uz');
      assert.equal(json.tzOffset, 5);
      assert.equal(json.timings.fajr.endTime, json.extras.sunrise, 'Fajr window must end at sunrise');
    });

    it('derives tz_offset from the client timezone for custom coordinates (incl. fractional offsets)', async () => {
      const req = new NextRequest(
        'http://localhost:3000/api/prayer-times?latitude=19.07&longitude=72.87&timezone=Asia/Kolkata&date=2026-11-12'
      );
      const res = await getPrayerTimesHandler(req);
      assert.equal(res.status, 200);
      assert.equal(lastUpstreamUrl?.searchParams.get('tz_offset'), '5.5');
      const json = await res.json();
      assert.equal(json.timezone, 'Asia/Kolkata');
    });

    it('ignores invalid timezone strings and falls back to a longitude estimate', async () => {
      const req = new NextRequest(
        'http://localhost:3000/api/prayer-times?latitude=19.07&longitude=72.87&timezone=Not/AZone&date=2026-11-12'
      );
      const res = await getPrayerTimesHandler(req);
      assert.equal(res.status, 200);
      assert.equal(lastUpstreamUrl?.searchParams.get('tz_offset'), '5'); // round(72.87 / 15)
      const json = await res.json();
      assert.notEqual(json.timezone, 'Not/AZone');
    });

    it('uses the reverse-geocoded fatvo.uz city name for custom coordinates', async () => {
      const req = new NextRequest('http://localhost:3000/api/prayer-times?latitude=41.6&longitude=70.1&timezone=Asia/Tashkent');
      const res = await getPrayerTimesHandler(req);
      const json = await res.json();
      assert.equal(json.city, 'Toshkent');
    });

    it('changing location (Tashkent vs Samarkand vs Bukhara) changes timings according to longitude progression', async () => {
      const reqTashkent = new NextRequest('http://localhost:3000/api/prayer-times?city=tashkent');
      const resTashkent = await getPrayerTimesHandler(reqTashkent);
      const jsonTashkent = await resTashkent.json();

      const reqSamarkand = new NextRequest('http://localhost:3000/api/prayer-times?city=samarkand');
      const resSamarkand = await getPrayerTimesHandler(reqSamarkand);
      const jsonSamarkand = await resSamarkand.json();

      const reqBukhara = new NextRequest('http://localhost:3000/api/prayer-times?city=bukhara');
      const resBukhara = await getPrayerTimesHandler(reqBukhara);
      const jsonBukhara = await resBukhara.json();

      assert.equal(jsonTashkent.success, true);
      assert.equal(jsonSamarkand.success, true);
      assert.equal(jsonBukhara.success, true);

      // Moving west (Tashkent 69.2°E -> Samarkand 67.0°E -> Bukhara 64.4°E) means solar noon / prayer times occur later
      assert.ok(
        jsonSamarkand.timings.dhuhr.time > jsonTashkent.timings.dhuhr.time,
        'Samarkand Dhuhr should be later than Tashkent due to lower longitude'
      );
      assert.ok(
        jsonBukhara.timings.dhuhr.time > jsonSamarkand.timings.dhuhr.time,
        'Bukhara Dhuhr should be later than Samarkand due to lower longitude'
      );
    });

    it('non-Tashkent location returns 502 error on API failure rather than misleading Tashkent times', async () => {
      mockFetchFailure = true;
      try {
        const req = new NextRequest('http://localhost:3000/api/prayer-times?city=samarkand');
        const res = await getPrayerTimesHandler(req);
        assert.equal(res.status, 502);
        const json = await res.json();
        assert.equal(json.success, false);
        assert.equal(json.code, 'PRAYER_TIMES_UNAVAILABLE');
        assert.equal(
          json.error,
          'Prayer times service (fatvo.uz) is unavailable. Please try again later.'
        );
      } finally {
        mockFetchFailure = false;
      }
    });

    it('Tashkent also returns 502 on API failure — no hardcoded fallback timings exist anymore', async () => {
      mockFetchFailure = true;
      try {
        const req = new NextRequest('http://localhost:3000/api/prayer-times?city=tashkent');
        const res = await getPrayerTimesHandler(req);
        assert.equal(res.status, 502);
        const json = await res.json();
        assert.equal(json.success, false);
        assert.equal(json.code, 'PRAYER_TIMES_UNAVAILABLE');
        assert.equal(json.timings, undefined);
      } finally {
        mockFetchFailure = false;
      }
    });

    it('rejects unknown city name when coordinates cannot be resolved', async () => {
      const req = new NextRequest('http://localhost:3000/api/prayer-times?city=NonExistentCityXYZ');
      const res = await getPrayerTimesHandler(req);
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.code, 'COORDINATES_REQUIRED');
      assert.ok(json.error.includes('NonExistentCityXYZ'));
    });

    it('never serves Tashkent fallback for named non-Tashkent cities even on external API failure', async () => {
      mockFetchFailure = true;
      try {
        // Query London with coordinates
        const req = new NextRequest('http://localhost:3000/api/prayer-times?city=London&lat=51.5074&lng=-0.1278');
        const res = await getPrayerTimesHandler(req);
        assert.equal(res.status, 502);
        const json = await res.json();
        assert.equal(json.success, false);
        assert.equal(json.code, 'PRAYER_TIMES_UNAVAILABLE');
      } finally {
        mockFetchFailure = false;
      }
    });
  });

  // =========================================================================
  // 3. Private Circle Prayer History API
  // =========================================================================
  describe('3. Private Circle Prayer History API', () => {
    let circleId: mongoose.Types.ObjectId;

    beforeEach(() => {
      circleId = new mongoose.Types.ObjectId();
      const circle: MockGroupDoc = {
        _id: circleId,
        name: 'Accountability Brothers',
        creatorId: userAId,
        inviteCode: 'ACC123',
        members: [
          { userId: userAId, role: 'owner', joinedAt: new Date() },
          { userId: userBId, role: 'member', joinedAt: new Date() },
        ],
        save: async function () {
          return this;
        },
      };
      mockGroups.push(circle);

      // Add prayer records for userB
      mockPrayerRecords.push({
        _id: new mongoose.Types.ObjectId(),
        userId: userBId,
        date: '2026-11-05',
        prayers: {
          fajr: { status: 'PRAYED_ON_TIME', prayedAt: new Date('2026-11-05T05:30:00Z'), isPaid: false, paidAmount: 0 },
          dhuhr: { status: 'MISSED', isPaid: true, paidAmount: 15000 },
          asr: { status: 'PRAYED_ON_TIME', prayedAt: new Date('2026-11-05T15:30:00Z') },
          maghrib: { status: 'PRAYED_ON_TIME', prayedAt: new Date('2026-11-05T18:00:00Z') },
          isha: { status: 'MISSED', isPaid: false, paidAmount: 0 },
        },
        finesAccrued: 15000,
      });
    });

    it('rejects unauthenticated requests with 401', async () => {
      const req = new NextRequest(
        `http://localhost:3000/api/groups/${circleId.toString()}/members/${userBId.toString()}/prayers`
      );
      const res = await getMemberPrayersHandler(req, {
        params: Promise.resolve({ id: circleId.toString(), memberId: userBId.toString() }),
      });
      assert.equal(res.status, 401);
    });

    it('rejects non-members of the circle with 403 Forbidden', async () => {
      // User Outside is not in this circle
      const req = new NextRequest(
        `http://localhost:3000/api/groups/${circleId.toString()}/members/${userBId.toString()}/prayers`,
        { headers: { cookie: `salahtrack_session=${sessionTokenOutside}` } }
      );
      const res = await getMemberPrayersHandler(req, {
        params: Promise.resolve({ id: circleId.toString(), memberId: userBId.toString() }),
      });
      assert.equal(res.status, 403);
      const json = await res.json();
      assert.equal(json.code, 'FORBIDDEN_NOT_MEMBER');
    });

    it('rejects querying prayer history of a user who is not a member of the circle with 403', async () => {
      // User A is in circle, but target User Outside is NOT in circle
      const req = new NextRequest(
        `http://localhost:3000/api/groups/${circleId.toString()}/members/${userOutsideId.toString()}/prayers`,
        { headers: { cookie: `salahtrack_session=${sessionTokenUserA}` } }
      );
      const res = await getMemberPrayersHandler(req, {
        params: Promise.resolve({ id: circleId.toString(), memberId: userOutsideId.toString() }),
      });
      assert.equal(res.status, 403);
    });

    it('allows fellow circle member to view sanitized prayer records with zero financial leaks', async () => {
      const req = new NextRequest(
        `http://localhost:3000/api/groups/${circleId.toString()}/members/${userBId.toString()}/prayers?startDate=2026-11-01&endDate=2026-11-30`,
        { headers: { cookie: `salahtrack_session=${sessionTokenUserA}` } }
      );
      const res = await getMemberPrayersHandler(req, {
        params: Promise.resolve({ id: circleId.toString(), memberId: userBId.toString() }),
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.records.length, 1);

      const record = json.data.records[0];
      assert.equal(record.date, '2026-11-05');
      assert.equal(record.prayers.fajr.status, 'PRAYED_ON_TIME');
      assert.equal(record.prayers.dhuhr.status, 'MISSED');

      // CRITICAL SECURITY ASSERTION: Financial fields must NOT be present
      assert.equal(record.finesAccrued, undefined, 'finesAccrued must not be exposed');
      assert.equal(record.prayers.dhuhr.isPaid, undefined, 'isPaid must not be exposed');
      assert.equal(record.prayers.dhuhr.paidAmount, undefined, 'paidAmount must not be exposed');
    });

    it('supports query-based alias GET /api/groups/[id]/member-history', async () => {
      const req = new NextRequest(
        `http://localhost:3000/api/groups/${circleId.toString()}/member-history?memberId=${userBId.toString()}&startDate=2026-11-01&endDate=2026-11-30`,
        { headers: { cookie: `salahtrack_session=${sessionTokenUserA}` } }
      );
      const res = await getMemberHistoryHandler(req, {
        params: Promise.resolve({ id: circleId.toString() }),
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.records.length, 1);
      assert.equal(json.data.records[0].prayers.dhuhr.status, 'MISSED');
      assert.equal(json.data.records[0].prayers.dhuhr.paidAmount, undefined);
    });
  });

  // =========================================================================
  // 4. Global Leaderboard with Current Streak
  // =========================================================================
  describe('4. Global Leaderboard with Current Streak', () => {
    it('includes currentStreak: number for each participant and does not expose private prayer data', async () => {
      const todayStr = new Date().toISOString().split('T')[0];
      const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split('T')[0];

      // Give User A 5/5 completed prayers on yesterday and today -> current streak = 2
      mockPrayerRecords.push(
        {
          _id: new mongoose.Types.ObjectId(),
          userId: userAId,
          date: yesterdayStr,
          prayers: {
            fajr: { status: 'PRAYED_ON_TIME' },
            dhuhr: { status: 'PRAYED_ON_TIME' },
            asr: { status: 'PRAYED_ON_TIME' },
            maghrib: { status: 'PRAYED_ON_TIME' },
            isha: { status: 'PRAYED_ON_TIME' },
          },
          finesAccrued: 0,
        },
        {
          _id: new mongoose.Types.ObjectId(),
          userId: userAId,
          date: todayStr,
          prayers: {
            fajr: { status: 'PRAYED_ON_TIME' },
            dhuhr: { status: 'PRAYED_ON_TIME' },
            asr: { status: 'PRAYED_ON_TIME' },
            maghrib: { status: 'PRAYED_ON_TIME' },
            isha: { status: 'PRAYED_ON_TIME' },
          },
          finesAccrued: 0,
        }
      );

      // User B has 0 completed prayers -> streak = 0

      const req = new NextRequest(`http://localhost:3000/api/leaderboard?period=daily&date=${todayStr}`, {
        headers: { cookie: `salahtrack_session=${sessionTokenUserA}` },
      });

      const res = await getLeaderboardHandler(req);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.ok(Array.isArray(json.data.leaderboard));

      const entryA = json.data.leaderboard.find((e: { username: string }) => e.username === 'user_alpha');
      const entryB = json.data.leaderboard.find((e: { username: string }) => e.username === 'user_beta');

      assert.ok(entryA);
      assert.ok(entryB);

      // Requirement 8: currentStreak is a number
      assert.equal(typeof entryA.currentStreak, 'number');
      assert.equal(entryA.currentStreak, 2);

      assert.equal(typeof entryB.currentStreak, 'number');
      assert.equal(entryB.currentStreak, 0);

      // Privacy verification: no private data or financial numbers
      for (const entry of json.data.leaderboard) {
        assert.equal(entry.prayers, undefined);
        assert.equal(entry.finesAccrued, undefined);
        assert.equal(entry.debt, undefined);
        assert.equal(entry.sadaqahOwed, undefined);
      }
    });
  });
});
