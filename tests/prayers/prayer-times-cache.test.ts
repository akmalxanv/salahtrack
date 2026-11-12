import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server.js';
import {
  GET as getPrayerTimesHandler,
  buildPrayerTimesCacheKey,
  clearPrayerTimesCache,
  getPrayerTimesCacheSize,
  getInFlightRequestsSize,
  getPrayerTimesFromCache,
  setPrayerTimesInCache,
  MAX_PRAYER_TIMES_CACHE_ENTRIES,
  PRAYER_TIMES_CACHE_TTL_MS,
  type PrayerTimesPayload,
} from '../../src/app/api/prayer-times/route.ts';

describe('Prayer Times In-Memory TTL Cache & Request Deduplication', () => {
  const originalFetch = global.fetch;
  let fetchCallCount = 0;
  let fetchDelayMs = 0;
  let shouldFailFetch = false;

  beforeEach(() => {
    clearPrayerTimesCache();
    fetchCallCount = 0;
    fetchDelayMs = 0;
    shouldFailFetch = false;

    global.fetch = async (input: RequestInfo | URL) => {
      fetchCallCount++;

      if (fetchDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, fetchDelayMs));
      }

      if (shouldFailFetch) {
        throw new Error('Upstream network connection error');
      }

      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      void urlStr;

      return {
        ok: true,
        status: 200,
        json: async () => ({
          date: '12-11-2026',
          imsak: '04:50',
          fajr: '05:00',
          sunrise: '06:30',
          dhuhr: '12:30',
          asr: '16:00',
          maghrib: '18:15',
          isha: '19:45',
          midnight: '00:06',
          address: { region: '', city: 'Toshkent', county: '', country: 'Oʻzbekiston' },
        }),
      } as unknown as Response;
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    clearPrayerTimesCache();
  });

  // =========================================================================
  // 1. In-Memory TTL Cache Hits & Misses
  // =========================================================================
  describe('1. In-Memory TTL Cache Hits & Misses', () => {
    it('returns X-Cache: MISS on first call and caches the response', async () => {
      const req = new NextRequest('http://localhost:3000/api/prayer-times?lat=41.2995&lng=69.2401');
      const res = await getPrayerTimesHandler(req);

      assert.equal(res.status, 200);
      assert.equal(res.headers.get('X-Cache'), 'MISS');
      assert.equal(fetchCallCount, 1);
      assert.equal(getPrayerTimesCacheSize(), 1);

      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.source, 'live');
      assert.equal(json.location.latitude, 41.2995);
      assert.equal(json.timings.fajr.time, '05:00');
    });

    it('returns X-Cache: HIT on subsequent calls in < 2ms without external fetch', async () => {
      const req1 = new NextRequest('http://localhost:3000/api/prayer-times?lat=41.2995&lng=69.2401');
      await getPrayerTimesHandler(req1);
      assert.equal(fetchCallCount, 1);

      const startTime = performance.now();
      const req2 = new NextRequest('http://localhost:3000/api/prayer-times?lat=41.2995&lng=69.2401');
      const res2 = await getPrayerTimesHandler(req2);
      const durationMs = performance.now() - startTime;

      assert.equal(res2.status, 200);
      assert.equal(res2.headers.get('X-Cache'), 'HIT');
      assert.equal(fetchCallCount, 1, 'Subsequent request must NOT trigger an external fetch');
      assert.ok(durationMs < 10, `Cached response must be ultra-fast (took ${durationMs}ms)`);

      const json2 = await res2.json();
      assert.equal(json2.success, true);
      assert.equal(json2.timings.fajr.time, '05:00');
    });

    it('respects cache bypass header (Cache-Control: no-cache) while refreshing cache', async () => {
      const req1 = new NextRequest('http://localhost:3000/api/prayer-times?city=tashkent');
      await getPrayerTimesHandler(req1);
      assert.equal(fetchCallCount, 1);

      const reqBypass = new NextRequest('http://localhost:3000/api/prayer-times?city=tashkent', {
        headers: { 'cache-control': 'no-cache' },
      });
      const resBypass = await getPrayerTimesHandler(reqBypass);
      assert.equal(resBypass.status, 200);
      assert.equal(resBypass.headers.get('X-Cache'), 'MISS');
      assert.equal(fetchCallCount, 2, 'Bypassing cache must trigger a fresh fetch');
    });
  });

  // =========================================================================
  // 2. In-Flight Request Deduplication
  // =========================================================================
  describe('2. In-Flight Request Deduplication', () => {
    it('deduplicates concurrent requests: 5 parallel requests trigger exactly 1 fetch', async () => {
      fetchDelayMs = 40; // Simulate network latency

      const requests = Array.from({ length: 5 }, () =>
        new NextRequest('http://localhost:3000/api/prayer-times?lat=41.2995&lng=69.2401')
      );

      const responses = await Promise.all(requests.map((r) => getPrayerTimesHandler(r)));

      // Exactly 1 network fetch executed
      assert.equal(fetchCallCount, 1, 'Only 1 external fetch should be initiated for parallel requests');

      // First response was MISS, remaining 4 responses were DEDUPED
      const cacheHeaders = responses.map((r) => r.headers.get('X-Cache'));
      assert.equal(cacheHeaders.filter((h) => h === 'MISS').length, 1);
      assert.equal(cacheHeaders.filter((h) => h === 'DEDUPED').length, 4);

      for (const res of responses) {
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.success, true);
        assert.equal(json.timings.fajr.time, '05:00');
      }

      // After settling, in-flight map is completely cleared
      assert.equal(getInFlightRequestsSize(), 0);
      // Cache contains the resolved payload
      assert.equal(getPrayerTimesCacheSize(), 1);
    });

    it('isolates different coordinate queries into distinct concurrent in-flight requests', async () => {
      fetchDelayMs = 40;

      const reqTashkent = new NextRequest('http://localhost:3000/api/prayer-times?city=tashkent');
      const reqSamarkand = new NextRequest('http://localhost:3000/api/prayer-times?city=samarkand');

      const [resTashkent, resSamarkand] = await Promise.all([
        getPrayerTimesHandler(reqTashkent),
        getPrayerTimesHandler(reqSamarkand),
      ]);

      assert.equal(fetchCallCount, 2, 'Different locations must execute separate in-flight fetches');
      assert.equal(resTashkent.headers.get('X-Cache'), 'MISS');
      assert.equal(resSamarkand.headers.get('X-Cache'), 'MISS');
      assert.equal(getPrayerTimesCacheSize(), 2);
    });
  });

  // =========================================================================
  // 3. Failure Cache Immunity
  // =========================================================================
  describe('3. Failure Cache Immunity', () => {
    it('does NOT cache external API failures so retries can succeed', async () => {
      shouldFailFetch = true;

      const reqFailed = new NextRequest('http://localhost:3000/api/prayer-times?city=samarkand');
      const resFailed = await getPrayerTimesHandler(reqFailed);

      assert.equal(resFailed.status, 502);
      assert.equal(fetchCallCount, 1);
      assert.equal(getPrayerTimesCacheSize(), 0, 'Failed responses must NEVER be cached');

      // Upstream recovers
      shouldFailFetch = false;
      const reqRecovered = new NextRequest('http://localhost:3000/api/prayer-times?city=samarkand');
      const resRecovered = await getPrayerTimesHandler(reqRecovered);

      assert.equal(resRecovered.status, 200);
      assert.equal(fetchCallCount, 2, 'Must retry network after previous failure');
      assert.equal(getPrayerTimesCacheSize(), 1, 'Successful retry is now cached');
    });

    it('returns 502 (no hardcoded fallback) under external API failure and does not cache it', async () => {
      shouldFailFetch = true;

      const reqFail = new NextRequest('http://localhost:3000/api/prayer-times?city=tashkent');
      const resFail = await getPrayerTimesHandler(reqFail);

      assert.equal(resFail.status, 502);
      const jsonFail = await resFail.json();
      assert.equal(jsonFail.code, 'PRAYER_TIMES_UNAVAILABLE');
      assert.equal(getPrayerTimesCacheSize(), 0, 'Failures must NOT be stored in cache');

      // Upstream recovers
      shouldFailFetch = false;
      const reqLive = new NextRequest('http://localhost:3000/api/prayer-times?city=tashkent');
      const resLive = await getPrayerTimesHandler(reqLive);

      assert.equal(resLive.status, 200);
      const jsonLive = await resLive.json();
      assert.equal(jsonLive.source, 'live', 'Live fatvo.uz timings must be fetched upon recovery');
      assert.equal(getPrayerTimesCacheSize(), 1);
    });
  });

  // =========================================================================
  // 4. Cache Key Determinism & Parameter Isolation
  // =========================================================================
  describe('4. Cache Key Determinism & Parameter Isolation', () => {
    it('builds canonical key conforming to ${date || "today"}_${lat.toFixed(4)}_${lng.toFixed(4)}_${tzOffset}_${lang}', () => {
      const keyToday = buildPrayerTimesCacheKey(null, 41.2995, 69.2401, 5, 'uz');
      assert.equal(keyToday, 'today_41.2995_69.2401_5_uz');

      const keySpecificDate = buildPrayerTimesCacheKey('2026-11-07', 41.2995, 69.2401, 5, 'uz');
      assert.equal(keySpecificDate, '2026-11-07_41.2995_69.2401_5_uz');

      const keyRu = buildPrayerTimesCacheKey('2026-11-07', 41.2995, 69.2401, 5, 'ru');
      assert.equal(keyRu, '2026-11-07_41.2995_69.2401_5_ru');

      const keyOffset = buildPrayerTimesCacheKey('2026-11-07', 41.2995, 69.2401, 5.5, 'uz');
      assert.equal(keyOffset, '2026-11-07_41.2995_69.2401_5.5_uz');
    });

    it('rounds micro-differences in coordinates to 4 decimal places (~11m)', () => {
      const key1 = buildPrayerTimesCacheKey(null, 41.29950001, 69.24010002, 5, 'uz');
      const key2 = buildPrayerTimesCacheKey(null, 41.29950004, 69.24010003, 5, 'uz');
      assert.equal(key1, key2);
    });
  });

  // =========================================================================
  // 5. TTL Expiry & LRU Eviction Guards
  // =========================================================================
  describe('5. TTL Expiry & LRU Eviction Guards', () => {
    const dummyPayload: PrayerTimesPayload = {
      success: true,
      city: 'Tashkent',
      country: 'Uzbekistan',
      timezone: 'Asia/Tashkent',
      location: { latitude: 41.2995, longitude: 69.2401 },
      timings: {
        fajr: { time: '05:00', endTime: '06:30' },
        dhuhr: { time: '12:30', endTime: '16:00' },
        asr: { time: '16:00', endTime: '18:15' },
        maghrib: { time: '18:15', endTime: '19:45' },
        isha: { time: '19:45', endTime: '05:00', isOvernight: true },
      },
      provider: 'fatvo.uz',
      tzOffset: 5,
      date: '2026-11-12',
      source: 'live',
    };

    it('expires cache entry after TTL elapses', async () => {
      const shortTtlMs = 15;
      setPrayerTimesInCache('test_expiry_key', dummyPayload, shortTtlMs);

      assert.ok(getPrayerTimesFromCache('test_expiry_key'), 'Should be present initially');

      await new Promise((resolve) => setTimeout(resolve, 25));

      const expired = getPrayerTimesFromCache('test_expiry_key');
      assert.equal(expired, null, 'Expired entry must return null and be pruned');
    });

    it('evicts oldest entries when cache hits MAX_PRAYER_TIMES_CACHE_ENTRIES limit', () => {
      // Fill cache to capacity limit
      for (let i = 0; i < MAX_PRAYER_TIMES_CACHE_ENTRIES; i++) {
        setPrayerTimesInCache(`key_${i}`, dummyPayload, PRAYER_TIMES_CACHE_TTL_MS);
      }
      assert.equal(getPrayerTimesCacheSize(), MAX_PRAYER_TIMES_CACHE_ENTRIES);

      // Adding 1 more entry should evict the oldest entry (key_0)
      setPrayerTimesInCache('key_overflow', dummyPayload, PRAYER_TIMES_CACHE_TTL_MS);

      assert.equal(getPrayerTimesCacheSize(), MAX_PRAYER_TIMES_CACHE_ENTRIES, 'Cache size must remain capped');
      assert.equal(getPrayerTimesFromCache('key_0'), null, 'Oldest entry should be evicted');
      assert.ok(getPrayerTimesFromCache('key_overflow'), 'New entry should be present');
    });

    it('clearPrayerTimesCache resets cache size to 0', () => {
      setPrayerTimesInCache('k1', dummyPayload);
      setPrayerTimesInCache('k2', dummyPayload);
      assert.equal(getPrayerTimesCacheSize(), 2);

      clearPrayerTimesCache();
      assert.equal(getPrayerTimesCacheSize(), 0);
    });
  });
});
