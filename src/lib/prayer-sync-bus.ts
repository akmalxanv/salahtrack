/**
 * Client-side Cross-Route Prayer Cache Invalidation Bus
 *
 * Ensures that any prayer mutation, rollover, or Qaza settlement on Home, Progress,
 * History, or Circles immediately invalidates module-level caches across all pages
 * so stale cached stats or circle leaderboards are never shown.
 */

export const PRAYER_CACHE_INVALIDATE_EVENT = 'salahtrack_prayer_cache_invalidate';

type CacheInvalidationListener = () => void;
const listeners = new Set<CacheInvalidationListener>();

let cacheEpoch = 1;

export function getPrayerCacheEpoch(): number {
  return cacheEpoch;
}

export function subscribePrayerCacheInvalidation(listener: CacheInvalidationListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function invalidateAllPrayerCaches(): void {
  cacheEpoch += 1;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore listener errors
    }
  }
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(PRAYER_CACHE_INVALIDATE_EVENT, { detail: { epoch: cacheEpoch } }));
    } catch {
      // ignore
    }
  }
}
