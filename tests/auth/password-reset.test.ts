import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { NextRequest } from 'next/server.js';

import { User, type IUser } from '../../src/models/User.ts';
import { Session } from '../../src/models/Session.ts';
import { clearRateLimitStore } from '../../src/lib/auth/rate-limit.ts';
import { hashPassword, verifyPassword } from '../../src/lib/auth/password.ts';

import { POST as forgotPasswordHandler } from '../../src/app/api/auth/forgot-password/route.ts';
import { POST as resetPasswordHandler } from '../../src/app/api/auth/reset-password/route.ts';

interface MockUserDoc {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  username: string;
  passwordHash: string;
  role: 'user' | 'admin';
  preferences: {
    language: 'uz' | 'ru' | 'en';
    calculationMethod?: string;
  };
  passwordResetTokenHash?: string;
  passwordResetExpires?: Date;
  createdAt: Date;
  updatedAt: Date;
  save: () => Promise<MockUserDoc>;
}

interface MockSessionDoc {
  _id: mongoose.Types.ObjectId;
  sessionToken: string;
  userId: mongoose.Types.ObjectId;
  expiresAt: Date;
  userAgent?: string;
  ipAddress?: string;
  lastActiveAt: Date;
  createdAt: Date;
  updatedAt: Date;
  save: () => Promise<MockSessionDoc>;
}

let mockUsers: MockUserDoc[] = [];
let mockSessions: MockSessionDoc[] = [];

function setupMocks() {
  mockUsers = [];
  mockSessions = [];

  global.mongooseCache = {
    conn: mongoose,
    promise: Promise.resolve(mongoose),
  };

  const userModel = User as unknown as Record<string, unknown>;
  const sessionModel = Session as unknown as Record<string, unknown>;

  userModel.findOne = (query: Record<string, unknown>) => {
    let matched: MockUserDoc | undefined;
    if (query.email) {
      matched = mockUsers.find((u) => u.email === query.email);
    } else if (query.passwordResetTokenHash) {
      matched = mockUsers.find((u) => {
        if (query.passwordResetTokenHash !== u.passwordResetTokenHash) return false;
        const expiresFilter = query.passwordResetExpires as { $gt?: Date } | undefined;
        if (expiresFilter && expiresFilter.$gt) {
          const minDate = expiresFilter.$gt;
          if (!u.passwordResetExpires || u.passwordResetExpires.getTime() <= minDate.getTime()) {
            return false;
          }
        }
        return true;
      });
    }

    const result = matched ? matched : null;
    return {
      select: () => Promise.resolve(result),
      then: (resolve: (val: MockUserDoc | null) => unknown) => Promise.resolve(result).then(resolve),
    };
  };

  userModel.create = async (doc: Partial<MockUserDoc>) => {
    const userDoc: MockUserDoc = {
      _id: new mongoose.Types.ObjectId(),
      name: doc.name || 'Test User',
      email: doc.email || '',
      username: doc.username || 'testuser',
      passwordHash: doc.passwordHash || '',
      role: 'user',
      preferences: { language: 'uz', calculationMethod: 'MWL' },
      createdAt: new Date(),
      updatedAt: new Date(),
      save: async function () { return this; },
    };
    mockUsers.push(userDoc);
    return userDoc as unknown as IUser;
  };

  sessionModel.deleteMany = async (query: { userId?: mongoose.Types.ObjectId }) => {
    if (query.userId) {
      const idStr = query.userId.toString();
      mockSessions = mockSessions.filter((s) => s.userId.toString() !== idStr);
    }
    return { deletedCount: 1 };
  };
}

describe('Password Recovery & Reset Endpoints', () => {
  beforeEach(() => {
    setupMocks();
    clearRateLimitStore();
  });

  describe('POST /api/auth/forgot-password', () => {
    it('returns uniform 200 OK and sets reset token when email exists', async () => {
      const passwordHash = await hashPassword('StrongPassword123!');
      const existingUser: MockUserDoc = {
        _id: new mongoose.Types.ObjectId(),
        name: 'Ahmad Aliyev',
        email: 'ahmad@example.com',
        username: 'ahmad',
        passwordHash,
        role: 'user',
        preferences: { language: 'uz', calculationMethod: 'MWL' },
        createdAt: new Date(),
        updatedAt: new Date(),
        save: async function () { return this; },
      };
      mockUsers.push(existingUser);

      const req = new NextRequest('http://localhost:3000/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'ahmad@example.com' }),
      });

      const res = await forgotPasswordHandler(req);
      assert.strictEqual(res.status, 200);

      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.ok(json.message.includes('password reset instructions have been sent'));

      // Check user document was updated with hash and 15m expiration
      assert.ok(existingUser.passwordResetTokenHash);
      assert.ok(existingUser.passwordResetExpires);
      assert.ok(existingUser.passwordResetExpires.getTime() > Date.now());
    });

    it('returns uniform 200 OK without leaking nonexistence when email does not exist', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nonexistent@example.com' }),
      });

      const res = await forgotPasswordHandler(req);
      assert.strictEqual(res.status, 200);

      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.ok(json.message.includes('password reset instructions have been sent'));
    });

    it('rejects invalid email with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'invalid-email-format' }),
      });

      const res = await forgotPasswordHandler(req);
      assert.strictEqual(res.status, 400);

      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.ok(json.errors.email);
    });
  });

  describe('POST /api/auth/reset-password', () => {
    it('resets password, invalidates active sessions, and clears token on valid request', async () => {
      const rawToken = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

      const oldPasswordHash = await hashPassword('OldPassword123!');
      const userId = new mongoose.Types.ObjectId();

      const user: MockUserDoc = {
        _id: userId,
        name: 'Ahmad Aliyev',
        email: 'ahmad@example.com',
        username: 'ahmad',
        passwordHash: oldPasswordHash,
        passwordResetTokenHash: tokenHash,
        passwordResetExpires: new Date(Date.now() + 10 * 60 * 1000), // 10m left
        role: 'user',
        preferences: { language: 'uz', calculationMethod: 'MWL' },
        createdAt: new Date(),
        updatedAt: new Date(),
        save: async function () { return this; },
      };
      mockUsers.push(user);

      // Active session in database
      mockSessions.push({
        _id: new mongoose.Types.ObjectId(),
        sessionToken: 'active_session_to_be_revoked',
        userId,
        expiresAt: new Date(Date.now() + 100000),
        lastActiveAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        save: async function () { return this; },
      });

      const newPassword = 'BrandNewPassword99!';
      const req = new NextRequest('http://localhost:3000/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: rawToken,
          newPassword,
          confirmPassword: newPassword,
        }),
      });

      const res = await resetPasswordHandler(req);
      assert.strictEqual(res.status, 200);

      const json = await res.json();
      assert.strictEqual(json.success, true);

      // Password must be changed
      assert.strictEqual(await verifyPassword(newPassword, user.passwordHash), true);
      assert.strictEqual(await verifyPassword('OldPassword123!', user.passwordHash), false);

      // Reset tokens must be cleared
      assert.strictEqual(user.passwordResetTokenHash, undefined);
      assert.strictEqual(user.passwordResetExpires, undefined);

      // Active sessions must be purged
      assert.strictEqual(mockSessions.length, 0);
    });

    it('rejects expired token with 400 Bad Request', async () => {
      const rawToken = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

      const user: MockUserDoc = {
        _id: new mongoose.Types.ObjectId(),
        name: 'Ahmad Aliyev',
        email: 'ahmad@example.com',
        username: 'ahmad',
        passwordHash: 'oldhash',
        passwordResetTokenHash: tokenHash,
        passwordResetExpires: new Date(Date.now() - 5000), // Expired 5 seconds ago
        role: 'user',
        preferences: { language: 'uz', calculationMethod: 'MWL' },
        createdAt: new Date(),
        updatedAt: new Date(),
        save: async function () { return this; },
      };
      mockUsers.push(user);

      const req = new NextRequest('http://localhost:3000/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: rawToken,
          newPassword: 'BrandNewPassword99!',
          confirmPassword: 'BrandNewPassword99!',
        }),
      });

      const res = await resetPasswordHandler(req);
      assert.strictEqual(res.status, 400);

      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.ok(json.error.includes('Invalid or expired'));
    });
  });
});
