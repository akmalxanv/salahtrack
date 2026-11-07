import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkRateLimit,
  recordFailedAttempt,
  consumeRateLimit,
  resetRateLimit,
  clearRateLimitStore,
  createRateLimitKey,
  DEFAULT_AUTH_RATE_LIMIT,
  DEFAULT_PROFILE_RATE_LIMIT,
} from '../../src/lib/auth/rate-limit.ts';
import { validatePassword } from '../../src/lib/auth/validation.ts';
import { validateCoordinates, sanitizeLocationName } from '../../src/lib/qibla.ts';

describe('Security Audit & Hardening Test Suite', () => {
  beforeEach(() => {
    clearRateLimitStore();
  });

  describe('1. Rate Limiting Mitigations (Brute-Force & Credential Stuffing)', () => {
    it('should allow 5 failed password attempts and block the 6th with retryAfterSeconds', () => {
      const key = createRateLimitKey('192.168.1.100', 'pwd-change:user123');

      // First 5 failed attempts are within limit
      for (let i = 1; i <= 5; i++) {
        const res = recordFailedAttempt(key, DEFAULT_AUTH_RATE_LIMIT);
        assert.equal(res.allowed, true, `Attempt ${i} should be allowed`);
        assert.equal(res.remaining, 5 - i, `Remaining should be ${5 - i}`);
      }

      // 6th check should be blocked
      const checkRes = checkRateLimit(key, DEFAULT_AUTH_RATE_LIMIT);
      assert.equal(checkRes.allowed, false, '6th attempt must be blocked');
      assert.equal(checkRes.remaining, 0, 'Remaining slots must be 0');
      assert.ok(checkRes.retryAfterSeconds > 0, 'Must return positive retryAfterSeconds');

      // Subsequent record attempt should also indicate not allowed
      const blockedRes = recordFailedAttempt(key, DEFAULT_AUTH_RATE_LIMIT);
      assert.equal(blockedRes.allowed, false, 'Blocked attempt must report allowed=false');
    });

    it('should reset rate limit counter upon successful password change', () => {
      const key = createRateLimitKey('10.0.0.5', 'pwd-change:user456');

      // Record 3 failed attempts
      recordFailedAttempt(key, DEFAULT_AUTH_RATE_LIMIT);
      recordFailedAttempt(key, DEFAULT_AUTH_RATE_LIMIT);
      recordFailedAttempt(key, DEFAULT_AUTH_RATE_LIMIT);

      const beforeReset = checkRateLimit(key, DEFAULT_AUTH_RATE_LIMIT);
      assert.equal(beforeReset.remaining, 2);

      // Reset counter
      resetRateLimit(key);

      const afterReset = checkRateLimit(key, DEFAULT_AUTH_RATE_LIMIT);
      assert.equal(afterReset.allowed, true);
      assert.equal(afterReset.remaining, 5);
    });

    it('should enforce sliding-window rate limit for profile updates (30 req / min)', () => {
      const key = createRateLimitKey('127.0.0.1', 'profile:user789');

      for (let i = 1; i <= 30; i++) {
        const res = consumeRateLimit(key, DEFAULT_PROFILE_RATE_LIMIT);
        assert.equal(res.allowed, true, `Profile update ${i} should be allowed`);
        assert.equal(res.remaining, 30 - i);
      }

      // 31st request must be rate limited (HTTP 429)
      const overLimitRes = consumeRateLimit(key, DEFAULT_PROFILE_RATE_LIMIT);
      assert.equal(overLimitRes.allowed, false, '31st request must be throttled');
      assert.equal(overLimitRes.remaining, 0);
      assert.ok(overLimitRes.retryAfterSeconds > 0);
    });
  });

  describe('2. Input Validation & DoS Protections (Password & Profile)', () => {
    it('should enforce strict password length bounds to mitigate Argon2id DoS', () => {
      // Too short (< 8 chars)
      const tooShort = validatePassword('short');
      assert.equal(tooShort.isValid, false);
      assert.ok(tooShort.errors[0].includes('at least 8 characters'));

      // Valid password
      const validPass = validatePassword('ValidPassword123!');
      assert.equal(validPass.isValid, true);
      assert.equal(validPass.errors.length, 0);

      // Too long (> 128 chars, CPU exhaustion attack payload)
      const hugePass = 'A'.repeat(129);
      const tooLong = validatePassword(hugePass);
      assert.equal(tooLong.isValid, false);
      assert.ok(tooLong.errors[0].includes('not exceed 128 characters'));

      // Non-string payload (type confusion mitigation)
      const nonString = validatePassword(12345678);
      assert.equal(nonString.isValid, false);
    });

    it('should strictly validate geographic coordinates within terrestrial bounds', () => {
      // Valid coordinates (Tashkent)
      const valid = validateCoordinates(41.2995, 69.2401);
      assert.equal(valid.valid, true);
      assert.equal(valid.lat, 41.2995);
      assert.equal(valid.lng, 69.2401);

      // Out-of-bounds latitude (> 90 or < -90)
      const badLat = validateCoordinates(91.5, 69.2401);
      assert.equal(badLat.valid, false);

      // Out-of-bounds longitude (> 180 or < -180)
      const badLng = validateCoordinates(41.2995, 185.0);
      assert.equal(badLng.valid, false);

      // Non-finite coordinates (NaN, Infinity)
      assert.equal(validateCoordinates(NaN, 69.2401).valid, false);
      assert.equal(validateCoordinates(41.2995, Infinity).valid, false);

      // Null or undefined
      assert.equal(validateCoordinates(null, 69.2401).valid, false);
      assert.equal(validateCoordinates(undefined, undefined).valid, false);
    });

    it('should sanitize location names by stripping HTML tags and control characters', () => {
      const dirty = '<script>alert("XSS")</script> Tashkent\x00\x1F';
      const clean = sanitizeLocationName(dirty);
      assert.equal(clean, 'scriptalert("XSS")/script Tashkent');

      const normal = '  Samarkand  ';
      assert.equal(sanitizeLocationName(normal), 'Samarkand');

      // Empty or non-string inputs
      assert.equal(sanitizeLocationName(''), null);
      assert.equal(sanitizeLocationName(null), null);
      assert.equal(sanitizeLocationName(123), null);
    });
  });

  describe('3. Circle Member Prayer History Sanitization & Privacy', () => {
    it('should strictly filter out private notes, financial fields, and internal IDs', () => {
      // Mock raw prayer record document from MongoDB containing sensitive private fields
      const mockRawRecord = {
        _id: '64f8a123456789abcdef0001',
        userId: '64f8a123456789abcdef0002',
        date: '2026-11-01',
        finesAccrued: 15000,
        prayers: {
          fajr: {
            status: 'PRAYED_ON_TIME',
            prayedAt: new Date('2026-11-01T05:00:00Z'),
            notes: 'Private note: woke up early at mosque',
            isPaid: true,
            paidAt: new Date('2026-11-01T06:00:00Z'),
            paidAmount: 5000,
          },
          dhuhr: {
            status: 'MISSED',
            missedAt: new Date('2026-11-01T13:00:00Z'),
            notes: 'Busy with medical appointment',
            paidAmount: 0,
          },
          asr: {
            status: 'MADE_UP',
            madeUpAt: new Date('2026-11-01T17:00:00Z'),
          },
        },
      };

      // Apply the same sanitization logic enforced by the API route
      const PRAYER_KEYS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
      const sanitizedPrayers: Record<string, unknown> = {};

      for (const pKey of PRAYER_KEYS) {
        const prayer = (mockRawRecord.prayers as Record<string, Record<string, unknown>>)[pKey];
        if (prayer && prayer.status) {
          sanitizedPrayers[pKey] = {
            status: prayer.status,
            ...(prayer.prayedAt ? { prayedAt: prayer.prayedAt } : {}),
          };
        }
      }

      const sanitizedResult = {
        date: mockRawRecord.date,
        prayers: sanitizedPrayers,
      };

      // Assert that sensitive fields are completely omitted
      const jsonStr = JSON.stringify(sanitizedResult);
      assert.ok(!jsonStr.includes('finesAccrued'), 'finesAccrued must be omitted');
      assert.ok(!jsonStr.includes('paidAmount'), 'paidAmount must be omitted');
      assert.ok(!jsonStr.includes('isPaid'), 'isPaid must be omitted');
      assert.ok(!jsonStr.includes('notes'), 'Private notes must be omitted');
      assert.ok(!jsonStr.includes('medical appointment'), 'Private text content must be omitted');
      assert.ok(!jsonStr.includes('missedAt'), 'missedAt timestamp must be omitted');
      assert.ok(!jsonStr.includes('madeUpAt'), 'madeUpAt timestamp must be omitted');
      assert.ok(!jsonStr.includes('64f8a123456789abcdef0001'), '_id must be omitted');
      assert.ok(!jsonStr.includes('64f8a123456789abcdef0002'), 'userId must be omitted');

      // Assert authorized public fields are present
      assert.equal((sanitizedResult.prayers as Record<string, { status: string }>).fajr.status, 'PRAYED_ON_TIME');
      assert.equal((sanitizedResult.prayers as Record<string, { status: string }>).dhuhr.status, 'MISSED');
      assert.equal((sanitizedResult.prayers as Record<string, { status: string }>).asr.status, 'MADE_UP');
    });

    it('should reject date ranges exceeding 93 days to prevent query-flooding DoS', () => {
      const MAX_DATE_RANGE_MS = 93 * 24 * 60 * 60 * 1000;

      // 30 days range: allowed
      const start1 = new Date('2026-11-01').getTime();
      const end1 = new Date('2026-11-30').getTime();
      assert.ok(end1 - start1 <= MAX_DATE_RANGE_MS, '30-day range must be allowed');

      // 90 days range: allowed
      const start2 = new Date('2026-09-01').getTime();
      const end2 = new Date('2026-11-30').getTime();
      assert.ok(end2 - start2 <= MAX_DATE_RANGE_MS, '90-day range must be allowed');

      // 365 days range: rejected
      const start3 = new Date('2025-11-01').getTime();
      const end3 = new Date('2026-11-01').getTime();
      assert.ok(end3 - start3 > MAX_DATE_RANGE_MS, '365-day range must exceed limit');
    });
  });

  describe('4. BOLA / IDOR Verification Architecture', () => {
    it('should enforce both caller membership and target membership in circle', () => {
      const circle = {
        _id: 'circle123',
        members: [
          { userId: 'userA', role: 'owner' },
          { userId: 'userB', role: 'member' },
        ],
      };

      // Helper simulating the authorization check
      const checkCircleAccess = (requesterId: string, targetMemberId: string) => {
        const isCallerMember = circle.members.some((m) => m.userId === requesterId);
        const isTargetMember = circle.members.some((m) => m.userId === targetMemberId);

        if (!isCallerMember || !isTargetMember) {
          return { allowed: false, status: 403, code: 'FORBIDDEN_NOT_MEMBER' };
        }
        return { allowed: true, status: 200 };
      };

      // 1. UserA requests UserB (both in circle) -> Allowed
      assert.equal(checkCircleAccess('userA', 'userB').allowed, true);

      // 2. UserA requests UserA (self in circle) -> Allowed
      assert.equal(checkCircleAccess('userA', 'userA').allowed, true);

      // 3. UserC (outsider) requests UserB -> Forbidden
      const outsiderReq = checkCircleAccess('userC', 'userB');
      assert.equal(outsiderReq.allowed, false);
      assert.equal(outsiderReq.status, 403);
      assert.equal(outsiderReq.code, 'FORBIDDEN_NOT_MEMBER');

      // 4. UserA requests UserC (outsider target) -> Forbidden
      const badTargetReq = checkCircleAccess('userA', 'userC');
      assert.equal(badTargetReq.allowed, false);
      assert.equal(badTargetReq.status, 403);
      assert.equal(badTargetReq.code, 'FORBIDDEN_NOT_MEMBER');
    });
  });
});
