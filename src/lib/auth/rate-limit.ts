/**
 * In-Memory Sliding-Window Rate Limiter
 *
 * Implements sliding-window counter tracking for sensitive authentication endpoints
 * (such as /api/auth/login and /api/auth/forgot-password) to mitigate brute-force
 * credential stuffing and password-spraying attacks without external infrastructure.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimitConfig {
  maxAttempts: number;
  windowMs: number;
}

/**
 * Approved defaults from AGENTS.md:
 * - 5 failed attempts
 * - 15-minute sliding window (900,000 ms)
 */
export const DEFAULT_AUTH_RATE_LIMIT: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000, // 15 minutes
};

// In-memory store: Map<key, timestamp[]>
const rateLimitStore = new Map<string, number[]>();

// Maximum tracking entries before triggering proactive garbage collection
const MAX_STORE_SIZE = 5000;

/**
 * Generates a normalized rate-limit cache key based on IP and an optional identifier.
 *
 * @param ip Client IP address (e.g., from x-forwarded-for or request header)
 * @param identifier Optional username or email
 */
export function createRateLimitKey(ip: string, identifier?: string): string {
  const cleanIp = (ip || 'unknown-ip').trim().toLowerCase();
  const cleanId = (identifier || '').trim().toLowerCase();
  return cleanId ? `${cleanIp}:${cleanId}` : cleanIp;
}

/**
 * Cleans expired timestamps for a specific entry and returns the active timestamps.
 */
function pruneTimestamps(timestamps: number[], now: number, windowMs: number): number[] {
  const threshold = now - windowMs;
  return timestamps.filter((t) => t > threshold);
}

/**
 * Checks whether an action for a given key is currently allowed under the rate limit.
 * Does NOT record a new attempt (read-only query).
 *
 * @param key Unique identifier key (e.g., ip or ip:identifier)
 * @param config Optional rate limit configuration (defaults to 5 attempts per 15 min)
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig = DEFAULT_AUTH_RATE_LIMIT
): RateLimitResult {
  const now = Date.now();
  const rawTimestamps = rateLimitStore.get(key) || [];
  const activeTimestamps = pruneTimestamps(rawTimestamps, now, config.windowMs);

  // Update store with pruned timestamps if changed
  if (activeTimestamps.length !== rawTimestamps.length) {
    if (activeTimestamps.length === 0) {
      rateLimitStore.delete(key);
    } else {
      rateLimitStore.set(key, activeTimestamps);
    }
  }

  const attemptCount = activeTimestamps.length;
  const allowed = attemptCount < config.maxAttempts;
  const remaining = Math.max(0, config.maxAttempts - attemptCount);

  let retryAfterSeconds = 0;
  if (!allowed && activeTimestamps.length > 0) {
    // Oldest attempt in the active window determines when the first slot frees up
    const oldestTimestamp = activeTimestamps[0];
    const expiryTime = oldestTimestamp + config.windowMs;
    retryAfterSeconds = Math.max(1, Math.ceil((expiryTime - now) / 1000));
  }

  return {
    allowed,
    remaining,
    retryAfterSeconds,
  };
}

/**
 * Records a failed attempt for the given key and returns the updated rate limit status.
 * Used by authentication handlers after verifying that a credential check failed.
 *
 * @param key Unique identifier key
 * @param config Optional rate limit configuration
 */
export function recordFailedAttempt(
  key: string,
  config: RateLimitConfig = DEFAULT_AUTH_RATE_LIMIT
): RateLimitResult {
  const now = Date.now();
  const rawTimestamps = rateLimitStore.get(key) || [];
  const activeTimestamps = pruneTimestamps(rawTimestamps, now, config.windowMs);

  // Record this failure
  activeTimestamps.push(now);
  rateLimitStore.set(key, activeTimestamps);

  // Proactive cleanup if store size exceeds bounds
  if (rateLimitStore.size > MAX_STORE_SIZE) {
    cleanupExpiredRateLimits(config.windowMs);
  }

  const attemptCount = activeTimestamps.length;
  const allowed = attemptCount <= config.maxAttempts;
  const remaining = Math.max(0, config.maxAttempts - attemptCount);

  let retryAfterSeconds = 0;
  if (!allowed && activeTimestamps.length > 0) {
    const oldestTimestamp = activeTimestamps[0];
    const expiryTime = oldestTimestamp + config.windowMs;
    retryAfterSeconds = Math.max(1, Math.ceil((expiryTime - now) / 1000));
  }

  return {
    allowed,
    remaining,
    retryAfterSeconds,
  };
}

/**
 * Resets the rate limit counter for a key.
 * Should be called immediately upon successful authentication to clear previous failed attempts.
 */
export function resetRateLimit(key: string): void {
  rateLimitStore.delete(key);
}

/**
 * Sweeps the rate limit store to remove expired keys.
 *
 * @param windowMs Window duration to consider keys expired
 * @returns Number of cleaned keys
 */
export function cleanupExpiredRateLimits(windowMs: number = DEFAULT_AUTH_RATE_LIMIT.windowMs): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, timestamps] of rateLimitStore.entries()) {
    const active = pruneTimestamps(timestamps, now, windowMs);
    if (active.length === 0) {
      rateLimitStore.delete(key);
      cleaned++;
    } else {
      rateLimitStore.set(key, active);
    }
  }

  return cleaned;
}

/**
 * Returns current store size (used primarily for test assertion and monitoring).
 */
export function getRateLimitStoreSize(): number {
  return rateLimitStore.size;
}

/**
 * Clears all rate limit records (used in test tear-down).
 */
export function clearRateLimitStore(): void {
  rateLimitStore.clear();
}
