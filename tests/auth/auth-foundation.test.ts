import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  hashPassword,
  verifyPassword,
  ARGON2_CONFIG,
  MAX_PASSWORD_LENGTH,
} from '../../src/lib/auth/password.ts';

import {
  generateSessionToken,
  getSessionCookieOptions,
  getExpiredSessionCookieOptions,
  calculateSessionExpiry,
  SESSION_COOKIE_NAME,
  STANDARD_SESSION_DURATION_SECONDS,
  REMEMBER_ME_SESSION_DURATION_SECONDS,
} from '../../src/lib/auth/session.ts';

import {
  checkRateLimit,
  recordFailedAttempt,
  resetRateLimit,
  cleanupExpiredRateLimits,
  clearRateLimitStore,
  createRateLimitKey,
} from '../../src/lib/auth/rate-limit.ts';

import {
  isValidEmail,
  normalizeEmail,
  isValidUsername,
  normalizeUsername,
  validatePassword,
  validateSignupPayload,
  validateLoginPayload,
  validateForgotPasswordPayload,
  validateResetPasswordPayload,
} from '../../src/lib/auth/validation.ts';

describe('1. Password Hashing Module (Argon2id)', () => {
  const testPassword = 'StrongPassword123!#';

  it('has approved Argon2id parameters matching AGENTS.md', () => {
    assert.strictEqual(ARGON2_CONFIG.memoryCost, 19456, 'Memory cost must be 19 MiB (19456 KiB)');
    assert.strictEqual(ARGON2_CONFIG.timeCost, 2, 'Time cost must be 2 iterations');
    assert.strictEqual(ARGON2_CONFIG.parallelism, 1, 'Parallelism must be 1');
  });

  it('hashes a plaintext password into a valid Argon2id hash', async () => {
    const hash = await hashPassword(testPassword);
    assert.strictEqual(typeof hash, 'string');
    // Argon2id hashes have the standard PHC format: $argon2id$v=19$...
    assert.ok(hash.startsWith('$argon2id$v=19$'), 'Hash must start with $argon2id$v=19$');
    assert.notStrictEqual(hash, testPassword, 'Hash must not equal plaintext');
    assert.ok(!hash.includes(testPassword), 'Hash must never contain the plaintext password');
  });

  it('uses unique cryptographic salts for identical plaintext passwords', async () => {
    const hash1 = await hashPassword(testPassword);
    const hash2 = await hashPassword(testPassword);
    assert.notStrictEqual(hash1, hash2, 'Two hashes of the same password must differ due to unique salts');
  });

  it('verifies the correct password against its hash', async () => {
    const hash = await hashPassword(testPassword);
    const isValid = await verifyPassword(testPassword, hash);
    assert.strictEqual(isValid, true, 'Correct password must verify successfully');
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword(testPassword);
    const isValid = await verifyPassword('WrongPassword999!', hash);
    assert.strictEqual(isValid, false, 'Incorrect password must be rejected');
  });

  it('fails safely with invalid or empty inputs without throwing', async () => {
    assert.strictEqual(await verifyPassword('', 'somehash'), false);
    assert.strictEqual(await verifyPassword(testPassword, ''), false);
    assert.strictEqual(await verifyPassword(testPassword, 'invalid$argon2$hash'), false);
  });

  it('rejects empty password when hashing', async () => {
    await assert.rejects(
      async () => await hashPassword(''),
      { message: 'Password must be a non-empty string' }
    );
  });

  it('rejects passwords exceeding maximum length to prevent DoS', async () => {
    const hugePassword = 'A'.repeat(MAX_PASSWORD_LENGTH + 1);
    await assert.rejects(
      async () => await hashPassword(hugePassword),
      /must not exceed/
    );
  });
});

describe('2. Session Token & Cookie Options Module', () => {
  it('generates a 64-character hexadecimal cryptographically secure token', () => {
    const token = generateSessionToken();
    assert.strictEqual(typeof token, 'string');
    assert.strictEqual(token.length, 64, 'Token must be exactly 64 hex characters (256 bits)');
    assert.ok(/^[0-9a-f]{64}$/.test(token), 'Token must contain only lowercase hexadecimal characters');
  });

  it('generates unique and unpredictable tokens across calls', () => {
    const tokenSet = new Set<string>();
    for (let i = 0; i < 50; i++) {
      tokenSet.add(generateSessionToken());
    }
    assert.strictEqual(tokenSet.size, 50, 'All generated tokens must be distinct');
  });

  it('returns standard session cookie options with required security attributes', () => {
    const options = getSessionCookieOptions(false);
    assert.strictEqual(options.name, SESSION_COOKIE_NAME);
    assert.strictEqual(options.httpOnly, true, 'HttpOnly must be true to prevent client script access');
    assert.strictEqual(options.sameSite, 'lax', 'SameSite must be lax for CSRF defense');
    assert.strictEqual(options.path, '/');
    assert.strictEqual(options.maxAge, STANDARD_SESSION_DURATION_SECONDS, 'Standard maxAge must be 7 days');
  });

  it('returns extended duration when rememberMe is true', () => {
    const options = getSessionCookieOptions(true);
    assert.strictEqual(options.maxAge, REMEMBER_ME_SESSION_DURATION_SECONDS, 'Remember Me maxAge must be 30 days');
    assert.strictEqual(options.httpOnly, true);
  });

  it('returns maxAge=0 for logout cookie invalidation', () => {
    const options = getExpiredSessionCookieOptions();
    assert.strictEqual(options.name, SESSION_COOKIE_NAME);
    assert.strictEqual(options.maxAge, 0, 'maxAge must be 0 for deletion');
  });

  it('calculates session expiry dates correctly for MongoDB TTL indexes', () => {
    const now = Date.now();
    const standardExpiry = calculateSessionExpiry(false);
    const rememberExpiry = calculateSessionExpiry(true);

    const standardDiffSeconds = Math.round((standardExpiry.getTime() - now) / 1000);
    const rememberDiffSeconds = Math.round((rememberExpiry.getTime() - now) / 1000);

    // Allow slight execution variance (<2 seconds)
    assert.ok(Math.abs(standardDiffSeconds - STANDARD_SESSION_DURATION_SECONDS) <= 2);
    assert.ok(Math.abs(rememberDiffSeconds - REMEMBER_ME_SESSION_DURATION_SECONDS) <= 2);
  });
});

describe('3. In-Memory Sliding-Window Rate Limiter', () => {
  const testKey = 'test-ip:test-user';

  beforeEach(() => {
    clearRateLimitStore();
  });

  it('allows requests when no previous attempts exist', () => {
    const result = checkRateLimit(testKey);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.remaining, 5);
    assert.strictEqual(result.retryAfterSeconds, 0);
  });

  it('decrements remaining attempts on recorded failures', () => {
    const res1 = recordFailedAttempt(testKey);
    assert.strictEqual(res1.allowed, true);
    assert.strictEqual(res1.remaining, 4);

    const res2 = recordFailedAttempt(testKey);
    assert.strictEqual(res2.allowed, true);
    assert.strictEqual(res2.remaining, 3);
  });

  it('blocks attempts after exceeding max attempts (5)', () => {
    // Record 5 failed attempts
    for (let i = 0; i < 5; i++) {
      recordFailedAttempt(testKey);
    }

    // 6th attempt must be blocked
    const blockedRes = recordFailedAttempt(testKey);
    assert.strictEqual(blockedRes.allowed, false, '6th attempt must be blocked');
    assert.strictEqual(blockedRes.remaining, 0);
    assert.ok(blockedRes.retryAfterSeconds > 0, 'retryAfterSeconds must be positive');
    assert.ok(blockedRes.retryAfterSeconds <= 15 * 60, 'retryAfterSeconds must be within window (15 mins)');

    // Read check must also show blocked
    const checkRes = checkRateLimit(testKey);
    assert.strictEqual(checkRes.allowed, false);
    assert.strictEqual(checkRes.remaining, 0);
  });

  it('resets rate limit upon calling resetRateLimit (e.g. successful login)', () => {
    for (let i = 0; i < 5; i++) {
      recordFailedAttempt(testKey);
    }
    assert.strictEqual(checkRateLimit(testKey).remaining, 0);

    resetRateLimit(testKey);
    const restored = checkRateLimit(testKey);
    assert.strictEqual(restored.allowed, true);
    assert.strictEqual(restored.remaining, 5);
  });

  it('isolates rate limits by distinct keys', () => {
    const key1 = createRateLimitKey('192.168.1.1', 'user1');
    const key2 = createRateLimitKey('192.168.1.2', 'user2');

    for (let i = 0; i < 5; i++) {
      recordFailedAttempt(key1);
    }

    assert.strictEqual(checkRateLimit(key1).remaining, 0);
    assert.strictEqual(checkRateLimit(key2).remaining, 5, 'Key 2 must not be affected by Key 1 failures');
  });

  it('cleans expired entries when window expires', () => {
    const customConfig = { maxAttempts: 3, windowMs: 50 }; // 50ms window
    recordFailedAttempt(testKey, customConfig);

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const cleaned = cleanupExpiredRateLimits(customConfig.windowMs);
        assert.ok(cleaned >= 1, 'Expired entry must be cleaned');
        assert.strictEqual(checkRateLimit(testKey, customConfig).remaining, 3);
        resolve();
      }, 70);
    });
  });
});

describe('4. Input Validation & Sanitization Module', () => {
  describe('Email validation', () => {
    it('accepts standard valid email addresses', () => {
      assert.strictEqual(isValidEmail('user@example.com'), true);
      assert.strictEqual(isValidEmail('first.last+tag@sub.domain.org'), true);
      assert.strictEqual(isValidEmail('muslim_dev@salahtrack.uz'), true);
    });

    it('rejects invalid email formats', () => {
      assert.strictEqual(isValidEmail('not-an-email'), false);
      assert.strictEqual(isValidEmail('@missinguser.com'), false);
      assert.strictEqual(isValidEmail('user@'), false);
      assert.strictEqual(isValidEmail('spaces in@domain.com'), false);
      assert.strictEqual(isValidEmail(''), false);
      assert.strictEqual(isValidEmail(null), false);
    });

    it('normalizes emails to lowercase and trimmed', () => {
      assert.strictEqual(normalizeEmail('  USER@Domain.COM  '), 'user@domain.com');
    });
  });

  describe('Username validation', () => {
    it('accepts valid usernames', () => {
      assert.strictEqual(isValidUsername('abubakr'), true);
      assert.strictEqual(isValidUsername('user_123'), true);
      assert.strictEqual(isValidUsername('dev_specialist'), true);
    });

    it('rejects usernames violating constraints', () => {
      assert.strictEqual(isValidUsername('ab'), false, 'Too short (<3)');
      assert.strictEqual(isValidUsername('a'.repeat(31)), false, 'Too long (>30)');
      assert.strictEqual(isValidUsername('user name'), false, 'Spaces not allowed');
      assert.strictEqual(isValidUsername('user@domain'), false, 'Special chars not allowed');
      assert.strictEqual(isValidUsername('user-dash'), false, 'Hyphens not allowed (only underscores)');
    });

    it('normalizes usernames to lowercase and trimmed', () => {
      assert.strictEqual(normalizeUsername('  MyUserName_99  '), 'myusername_99');
    });
  });

  describe('Password complexity validation', () => {
    it('accepts strong passwords meeting all requirements', () => {
      const result = validatePassword('T@shkent2026!');
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('rejects weak passwords missing required characteristics', () => {
      // Too short
      assert.strictEqual(validatePassword('Short1!').isValid, false);
      // Missing uppercase
      assert.strictEqual(validatePassword('lowercase123!').isValid, false);
      // Missing lowercase
      assert.strictEqual(validatePassword('UPPERCASE123!').isValid, false);
      // Missing digit
      assert.strictEqual(validatePassword('NoDigitsHere!').isValid, false);
      // Missing special symbol
      assert.strictEqual(validatePassword('NoSymbols1234').isValid, false);
    });
  });

  describe('Payload validation schemas', () => {
    it('validates a correct signup payload', () => {
      const payload = {
        name: 'Abubakr Akmalxonov',
        email: 'dev@salahtrack.uz',
        username: 'abubakr_dev',
        password: 'SecurePassword123!',
        confirmPassword: 'SecurePassword123!',
      };

      const result = validateSignupPayload(payload);
      assert.strictEqual(result.isValid, true);
      assert.ok(result.data);
      assert.strictEqual(result.data.email, 'dev@salahtrack.uz');
      assert.strictEqual(result.data.username, 'abubakr_dev');
    });

    it('rejects signup payload when password and confirmPassword do not match', () => {
      const payload = {
        name: 'Abubakr Akmalxonov',
        email: 'dev@salahtrack.uz',
        username: 'abubakr_dev',
        password: 'SecurePassword123!',
        confirmPassword: 'DifferentPassword123!',
      };

      const result = validateSignupPayload(payload);
      assert.strictEqual(result.isValid, false);
      assert.strictEqual(result.errors.confirmPassword, 'Passwords do not match');
    });

    it('validates a correct login payload', () => {
      const payload = {
        identifier: 'dev@salahtrack.uz',
        password: 'SecurePassword123!',
        rememberMe: true,
      };

      const result = validateLoginPayload(payload);
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.data?.identifier, 'dev@salahtrack.uz');
      assert.strictEqual(result.data?.rememberMe, true);
    });

    it('rejects login payload with missing password', () => {
      const payload = {
        identifier: 'dev@salahtrack.uz',
        password: '',
      };

      const result = validateLoginPayload(payload);
      assert.strictEqual(result.isValid, false);
      assert.strictEqual(result.errors.password, 'Please provide your password');
    });

    it('validates a forgot-password payload', () => {
      const valid = validateForgotPasswordPayload({ email: 'user@example.com' });
      assert.strictEqual(valid.isValid, true);

      const invalid = validateForgotPasswordPayload({ email: 'invalid-email' });
      assert.strictEqual(invalid.isValid, false);
    });

    it('validates a reset-password payload', () => {
      const validToken = 'a'.repeat(64);
      const valid = validateResetPasswordPayload({
        token: validToken,
        newPassword: 'NewP@ssword2026!',
        confirmPassword: 'NewP@ssword2026!',
      });
      assert.strictEqual(valid.isValid, true);

      const mismatched = validateResetPasswordPayload({
        token: validToken,
        newPassword: 'NewP@ssword2026!',
        confirmPassword: 'WrongConfirmation2026!',
      });
      assert.strictEqual(mismatched.isValid, false);
      assert.strictEqual(mismatched.errors.confirmPassword, 'Passwords do not match');
    });
  });
});
