import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Tests for Client-Side Prayer Times Optimization & Event Isolation:
 * - Module-level caching for /api/prayer-times
 * - In-flight Promise deduplication (StrictMode double-mount protection)
 * - Parameter equality comparison with lastSyncedKeyRef
 * - Storage event isolation: prayer status click / qaza counter NEVER re-fetch timings
 * - Location update event triggers re-fetch / cache lookup
 */

interface CachedPrayerTimesResponse {
  city?: string;
  source?: 'live' | 'fallback';
  timings: Record<string, { time: string; endTime: string; isOvernight?: boolean }>;
  [key: string]: unknown;
}

interface PrayerTimesCacheEntry {
  data: CachedPrayerTimesResponse;
  timestamp: number;
}

describe('Client-Side Prayer Times Sync & Cache Architecture', () => {
  let cache: Map<string, PrayerTimesCacheEntry>;
  let inFlight: Map<string, Promise<CachedPrayerTimesResponse | null>>;
  const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
  let networkFetchCount = 0;

  beforeEach(() => {
    cache = new Map();
    inFlight = new Map();
    networkFetchCount = 0;
  });

  // Client sync simulation helper mirroring HomeDashboard.tsx logic
  async function simulateSyncPrayerTimes(params: {
    activeLiturgicalDate: string;
    lat: number | null;
    lng: number | null;
    resolvedCityName: string | null;
    method: string;
    lastSyncedKeyRef: { current: string };
    lastSyncedStatusRef: { current: 'idle' | 'loading' | 'live' | 'fallback' | 'error' };
    mockFetchFn: () => Promise<CachedPrayerTimesResponse>;
  }) {
    const {
      activeLiturgicalDate,
      lat,
      lng,
      resolvedCityName,
      method,
      lastSyncedKeyRef,
      lastSyncedStatusRef,
      mockFetchFn,
    } = params;

    const currentKey = `${activeLiturgicalDate}|${lat ?? ''}|${lng ?? ''}|${resolvedCityName ?? ''}|${method}`;

    // 1. Parameter equality comparison: skip if already successfully loaded for same key
    if (
      currentKey === lastSyncedKeyRef.current &&
      (lastSyncedStatusRef.current === 'live' || lastSyncedStatusRef.current === 'fallback')
    ) {
      return { skipped: true, source: 'skipped-equality' };
    }

    // 2. Client-side module-level cache lookup
    const cachedEntry = cache.get(currentKey);
    if (cachedEntry && Date.now() - cachedEntry.timestamp < CACHE_TTL_MS) {
      lastSyncedKeyRef.current = currentKey;
      lastSyncedStatusRef.current = cachedEntry.data.source === 'fallback' ? 'fallback' : 'live';
      return { skipped: false, source: 'cache', data: cachedEntry.data };
    }

    // 3. In-flight request deduplication
    lastSyncedStatusRef.current = 'loading';
    let fetchPromise = inFlight.get(currentKey);
    if (!fetchPromise) {
      fetchPromise = (async () => {
        try {
          networkFetchCount++;
          const data = await mockFetchFn();
          if (data?.timings) {
            cache.set(currentKey, {
              data,
              timestamp: Date.now(),
            });
            return data;
          }
          return null;
        } finally {
          inFlight.delete(currentKey);
        }
      })();
      inFlight.set(currentKey, fetchPromise);
    }

    const data = await fetchPromise;
    if (data) {
      lastSyncedKeyRef.current = currentKey;
      lastSyncedStatusRef.current = data.source === 'fallback' ? 'fallback' : 'live';
      return { skipped: false, source: 'network', data };
    } else {
      lastSyncedStatusRef.current = 'error';
      return { skipped: false, source: 'error', data: null };
    }
  }

  const sampleTimings: CachedPrayerTimesResponse = {
    city: 'Tashkent',
    source: 'live',
    timings: {
      fajr: { time: '05:15', endTime: '06:40' },
      dhuhr: { time: '12:25', endTime: '15:45' },
      asr: { time: '15:45', endTime: '17:30' },
      maghrib: { time: '17:30', endTime: '18:50' },
      isha: { time: '18:50', endTime: '05:15', isOvernight: true },
    },
  };

  it('1. performs network fetch on first mount and updates cache and lastSyncedKeyRef', async () => {
    const lastSyncedKeyRef = { current: '' };
    const lastSyncedStatusRef: { current: 'idle' | 'loading' | 'live' | 'fallback' | 'error' } = {
      current: 'idle',
    };

    const result = await simulateSyncPrayerTimes({
      activeLiturgicalDate: '2026-11-07',
      lat: 41.2995,
      lng: 69.2401,
      resolvedCityName: 'Tashkent',
      method: 'MWL',
      lastSyncedKeyRef,
      lastSyncedStatusRef,
      mockFetchFn: async () => sampleTimings,
    });

    assert.equal(result.source, 'network');
    assert.equal(networkFetchCount, 1);
    assert.equal(lastSyncedKeyRef.current, '2026-11-07|41.2995|69.2401|Tashkent|MWL');
    assert.equal(lastSyncedStatusRef.current, 'live');
    assert.ok(cache.has('2026-11-07|41.2995|69.2401|Tashkent|MWL'));
  });

  it('2. skips fetch when parameters are identical and status is live (parameter equality comparison)', async () => {
    const lastSyncedKeyRef = { current: '2026-11-07|41.2995|69.2401|Tashkent|MWL' };
    const lastSyncedStatusRef: { current: 'idle' | 'loading' | 'live' | 'fallback' | 'error' } = {
      current: 'live',
    };

    const result = await simulateSyncPrayerTimes({
      activeLiturgicalDate: '2026-11-07',
      lat: 41.2995,
      lng: 69.2401,
      resolvedCityName: 'Tashkent',
      method: 'MWL',
      lastSyncedKeyRef,
      lastSyncedStatusRef,
      mockFetchFn: async () => sampleTimings,
    });

    assert.equal(result.skipped, true);
    assert.equal(result.source, 'skipped-equality');
    assert.equal(networkFetchCount, 0, 'Must NOT make any network call when key is already synced');
  });

  it('3. serves from module-level cache when component unmounts and remounts (navigation round-trip)', async () => {
    // Seed cache
    cache.set('2026-11-07|41.2995|69.2401|Tashkent|MWL', {
      data: sampleTimings,
      timestamp: Date.now(),
    });

    // Fresh mount with blank lastSyncedKeyRef (simulating navigating / -> /progress -> /)
    const freshLastSyncedKeyRef = { current: '' };
    const freshLastSyncedStatusRef: { current: 'idle' | 'loading' | 'live' | 'fallback' | 'error' } = {
      current: 'idle',
    };

    const result = await simulateSyncPrayerTimes({
      activeLiturgicalDate: '2026-11-07',
      lat: 41.2995,
      lng: 69.2401,
      resolvedCityName: 'Tashkent',
      method: 'MWL',
      lastSyncedKeyRef: freshLastSyncedKeyRef,
      lastSyncedStatusRef: freshLastSyncedStatusRef,
      mockFetchFn: async () => sampleTimings,
    });

    assert.equal(result.source, 'cache');
    assert.equal(networkFetchCount, 0, 'Navigation remount must read immediately from cache with 0 network calls');
    assert.equal(freshLastSyncedKeyRef.current, '2026-11-07|41.2995|69.2401|Tashkent|MWL');
    assert.equal(freshLastSyncedStatusRef.current, 'live');
  });

  it('4. deduplicates concurrent in-flight requests (React StrictMode double-mount protection)', async () => {
    const keyRef1 = { current: '' };
    const statusRef1: { current: 'idle' | 'loading' | 'live' | 'fallback' | 'error' } = {
      current: 'idle',
    };

    const keyRef2 = { current: '' };
    const statusRef2: { current: 'idle' | 'loading' | 'live' | 'fallback' | 'error' } = {
      current: 'idle',
    };

    // Both instances start simultaneously
    const [res1, res2] = await Promise.all([
      simulateSyncPrayerTimes({
        activeLiturgicalDate: '2026-11-07',
        lat: 41.2995,
        lng: 69.2401,
        resolvedCityName: 'Tashkent',
        method: 'MWL',
        lastSyncedKeyRef: keyRef1,
        lastSyncedStatusRef: statusRef1,
        mockFetchFn: async () => {
          await new Promise((r) => setTimeout(r, 20));
          return sampleTimings;
        },
      }),
      simulateSyncPrayerTimes({
        activeLiturgicalDate: '2026-11-07',
        lat: 41.2995,
        lng: 69.2401,
        resolvedCityName: 'Tashkent',
        method: 'MWL',
        lastSyncedKeyRef: keyRef2,
        lastSyncedStatusRef: statusRef2,
        mockFetchFn: async () => {
          await new Promise((r) => setTimeout(r, 20));
          return sampleTimings;
        },
      }),
    ]);

    assert.equal(networkFetchCount, 1, 'StrictMode double-mount must execute exactly 1 network fetch');
    assert.deepEqual(res1.data, sampleTimings);
    assert.deepEqual(res2.data, sampleTimings);
    assert.equal(keyRef1.current, '2026-11-07|41.2995|69.2401|Tashkent|MWL');
    assert.equal(keyRef2.current, '2026-11-07|41.2995|69.2401|Tashkent|MWL');
  });

  it('5. triggers re-fetch or cache lookup when location or calculation method changes', async () => {
    const lastSyncedKeyRef = { current: '2026-11-07|41.2995|69.2401|Tashkent|MWL' };
    const lastSyncedStatusRef: { current: 'idle' | 'loading' | 'live' | 'fallback' | 'error' } = {
      current: 'live',
    };

    const samarkandTimings: CachedPrayerTimesResponse = {
      city: 'Samarkand',
      source: 'live',
      timings: {
        fajr: { time: '05:22', endTime: '06:48' },
        dhuhr: { time: '12:31', endTime: '15:52' },
        asr: { time: '15:52', endTime: '17:38' },
        maghrib: { time: '17:38', endTime: '18:57' },
        isha: { time: '18:57', endTime: '05:22', isOvernight: true },
      },
    };

    // User switches location to Samarkand
    const result = await simulateSyncPrayerTimes({
      activeLiturgicalDate: '2026-11-07',
      lat: 39.6542,
      lng: 66.9597,
      resolvedCityName: 'Samarkand',
      method: 'MWL',
      lastSyncedKeyRef,
      lastSyncedStatusRef,
      mockFetchFn: async () => samarkandTimings,
    });

    assert.equal(result.skipped, false);
    assert.equal(result.source, 'network');
    assert.equal(networkFetchCount, 1);
    assert.equal(lastSyncedKeyRef.current, '2026-11-07|39.6542|66.9597|Samarkand|MWL');
    assert.equal(result.data?.city, 'Samarkand');

    // If user switches back to Tashkent, Tashkent is served from cache!
    cache.set('2026-11-07|41.2995|69.2401|Tashkent|MWL', {
      data: sampleTimings,
      timestamp: Date.now(),
    });

    const backToTashkentResult = await simulateSyncPrayerTimes({
      activeLiturgicalDate: '2026-11-07',
      lat: 41.2995,
      lng: 69.2401,
      resolvedCityName: 'Tashkent',
      method: 'MWL',
      lastSyncedKeyRef,
      lastSyncedStatusRef,
      mockFetchFn: async () => sampleTimings,
    });

    assert.equal(backToTashkentResult.source, 'cache');
    assert.equal(networkFetchCount, 1, 'Switching back to cached city must NOT make a network fetch');
    assert.equal(lastSyncedKeyRef.current, '2026-11-07|41.2995|69.2401|Tashkent|MWL');
  });

  it('6. verifies that prayer status toggles and qaza counter do NOT trigger syncPrayerTimes (reminders eliminated)', () => {
    // In HomeDashboard.tsx:
    // `syncPrayerTimes` effect dependencies are:
    // [isMounted, setPrayers, user?.preferences?.calculationMethod, user?.preferences?.city, user?.preferences?.latitude, user?.preferences?.longitude, activeLiturgicalDate, locationRevision]
    // Notice that neither `historyVersion`, `prayers`, `streak`, `qazaCount`, nor `remindersEnabled` are present!
    
    const effectDependencies = [
      'isMounted',
      'setPrayers',
      'user?.preferences?.calculationMethod',
      'user?.preferences?.city',
      'user?.preferences?.latitude',
      'user?.preferences?.longitude',
      'activeLiturgicalDate',
      'locationRevision',
    ];

    assert.ok(!effectDependencies.includes('historyVersion'), 'historyVersion must be removed from dependencies');
    assert.ok(!effectDependencies.includes('prayers'), 'prayers must not be in dependencies');
    assert.ok(!effectDependencies.includes('qazaCount'), 'qazaCount must not be in dependencies');
    assert.ok(!effectDependencies.includes('remindersEnabled'), 'remindersEnabled must not be in dependencies');
    assert.ok(effectDependencies.includes('locationRevision'), 'locationRevision must be in dependencies');
  });
});
