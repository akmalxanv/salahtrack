import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server.js';

import { User, type IUser } from '../../src/models/User.ts';
import { Session, type ISession } from '../../src/models/Session.ts';
import {
  validateSessionToken,
  sanitizeUser,
} from '../../src/lib/auth/guard.ts';
import { clearRateLimitStore } from '../../src/lib/auth/rate-limit.ts';
import { hashPassword } from '../../src/lib/auth/password.ts';

// Import route handlers
import { POST as signupHandler } from '../../src/app/api/auth/signup/route.ts';
import { POST as loginHandler } from '../../src/app/api/auth/login/route.ts';
import { POST as logoutHandler } from '../../src/app/api/auth/logout/route.ts';
import { GET as meHandler } from '../../src/app/api/auth/me/route.ts';
// In-memory document storage for deterministic route testing
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

interface MongooseCacheGlobal {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  var mongooseCache: MongooseCacheGlobal | undefined;
}

interface UserQueryFilter {
  $or?: Array<{ email?: string; username?: string }>;
  email?: string;
  username?: string;
}

interface SessionQueryFilter {
  _id?: mongoose.Types.ObjectId;
  sessionToken?: string;
}

let mockUsers: MockUserDoc[] = [];
let mockSessions: MockSessionDoc[] = [];

// Setup mocks on Mongoose and DB module
function setupMocks() {
  mockUsers = [];
  mockSessions = [];

  // Cache connection in global.mongooseCache so connectDB() returns instantly
  global.mongooseCache = {
    conn: mongoose,
    promise: Promise.resolve(mongoose),
  };

  const userModel = User as unknown as Record<string, unknown>;
  const sessionModel = Session as unknown as Record<string, unknown>;

  // Mock User.findOne
  userModel.findOne = (query: UserQueryFilter) => {
    let matched: MockUserDoc | undefined;
    if (query.$or) {
      for (const cond of query.$or) {
        matched = mockUsers.find((u) => {
          if (cond.email && u.email === cond.email) return true;
          if (cond.username && u.username === cond.username) return true;
          return false;
        });
        if (matched) break;
      }
    } else if (query.email) {
      matched = mockUsers.find((u) => u.email === query.email);
    } else if (query.username) {
      matched = mockUsers.find((u) => u.username === query.username);
    }

    const result = matched ? { ...matched } : null;
    return {
      select: () => Promise.resolve(result),
      then: (resolve: (val: MockUserDoc | null) => unknown) => Promise.resolve(result).then(resolve),
    };
  };

  // Mock User.create
  userModel.create = async (doc: Partial<MockUserDoc>) => {
    const userDoc: MockUserDoc = {
      _id: new mongoose.Types.ObjectId(),
      name: doc.name || '',
      email: doc.email || '',
      username: doc.username || '',
      passwordHash: doc.passwordHash || '',
      role: doc.role || 'user',
      preferences: doc.preferences || { language: 'uz', calculationMethod: 'MWL' },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockUsers.push(userDoc);
    return userDoc as unknown as IUser;
  };

  // Mock User.findById
  userModel.findById = async (id: mongoose.Types.ObjectId | string) => {
    const idStr = id.toString();
    const found = mockUsers.find((u) => u._id.toString() === idStr);
    return found ? (found as unknown as IUser) : null;
  };

  // Mock Session.findOne
  sessionModel.findOne = async (query: SessionQueryFilter) => {
    const found = mockSessions.find((s) => s.sessionToken === query.sessionToken);
    return found ? (found as unknown as ISession) : null;
  };

  // Mock Session.create
  sessionModel.create = async (doc: Partial<MockSessionDoc>) => {
    const sessionDoc: MockSessionDoc = {
      _id: new mongoose.Types.ObjectId(),
      sessionToken: doc.sessionToken || '',
      userId: doc.userId || new mongoose.Types.ObjectId(),
      expiresAt: doc.expiresAt || new Date(),
      userAgent: doc.userAgent,
      ipAddress: doc.ipAddress,
      lastActiveAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      save: async function () { return this; },
    };
    mockSessions.push(sessionDoc);
    return sessionDoc as unknown as ISession;
  };

  // Mock Session.deleteOne
  sessionModel.deleteOne = async (query: SessionQueryFilter) => {
    if (query._id) {
      const idStr = query._id.toString();
      mockSessions = mockSessions.filter((s) => s._id.toString() !== idStr);
    } else if (query.sessionToken) {
      mockSessions = mockSessions.filter((s) => s.sessionToken !== query.sessionToken);
    }
    return { deletedCount: 1 };
  };
}

describe('Backend Authentication Layer Tests', () => {
  beforeEach(() => {
    setupMocks();
    clearRateLimitStore();
  });

  describe('1. Mongoose Schema Declarations & Protections', () => {
    it('enforces select: false on passwordHash and passwordReset fields in User', () => {
      const passwordHashPath = User.schema.path('passwordHash');
      assert.strictEqual(passwordHashPath.options.select, false, 'passwordHash must have select: false');

      const resetTokenPath = User.schema.path('passwordResetTokenHash');
      assert.strictEqual(resetTokenPath.options.select, false, 'passwordResetTokenHash must have select: false');

      const resetExpiresPath = User.schema.path('passwordResetExpires');
      assert.strictEqual(resetExpiresPath.options.select, false, 'passwordResetExpires must have select: false');
    });

    it('enforces unique constraints on email and username in User', () => {
      assert.strictEqual(User.schema.path('email').options.unique, true);
      assert.strictEqual(User.schema.path('username').options.unique, true);
    });

    it('enforces TTL index on expiresAt in Session', () => {
      const expiresPath = Session.schema.path('expiresAt');
      assert.strictEqual(expiresPath.options.expires, 0, 'expiresAt must declare expires: 0 for MongoDB TTL auto-cleanup');
    });

    it('enforces User reference on userId in Session', () => {
      assert.strictEqual(Session.schema.path('userId').options.ref, 'User');
    });

    it('sanitizeUser strips passwordHash and returns trusted user profile', () => {
      const mockDoc = {
        _id: new mongoose.Types.ObjectId(),
        name: 'Ahmad User',
        email: 'ahmad@example.com',
        username: 'ahmad_01',
        passwordHash: '$argon2id$v=19$hiddenhash',
        role: 'user' as const,
        preferences: { language: 'uz' as const, calculationMethod: 'MWL' },
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as IUser;

      const safe = sanitizeUser(mockDoc);
      assert.strictEqual(safe.name, 'Ahmad User');
      assert.strictEqual(safe.email, 'ahmad@example.com');
      assert.strictEqual('passwordHash' in safe, false, 'passwordHash must never be present in safe profile');
    });
  });

  describe('2. POST /api/auth/signup', () => {
    it('creates a new user, hashes password, creates session, and sets cookie', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Bilal Khan',
          email: 'bilal@salahtrack.uz',
          username: 'bilal_k',
          password: 'Password123!#',
          confirmPassword: 'Password123!#',
        }),
      });

      const res = await signupHandler(req);
      assert.strictEqual(res.status, 201);

      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.data.user.name, 'Bilal Khan');
      assert.strictEqual(json.data.user.email, 'bilal@salahtrack.uz');
      assert.strictEqual(json.data.user.username, 'bilal_k');
      assert.strictEqual(json.data.user.passwordHash, undefined, 'passwordHash must NOT be returned in response');

      // Check cookie
      const cookieHeader = res.headers.get('set-cookie');
      assert.ok(cookieHeader, 'Set-Cookie header must be present');
      assert.ok(cookieHeader.includes('salahtrack_session='), 'Cookie name must be salahtrack_session');
      assert.ok(cookieHeader.toLowerCase().includes('httponly'), 'Cookie must be HttpOnly');

      // Verify user in store
      assert.strictEqual(mockUsers.length, 1);
      assert.notStrictEqual(mockUsers[0].passwordHash, 'Password123!#', 'Password must be hashed');
      assert.ok(mockUsers[0].passwordHash.startsWith('$argon2id$'), 'Password must be Argon2id hash');

      // Verify session in store
      assert.strictEqual(mockSessions.length, 1);
      assert.strictEqual(mockSessions[0].userId.toString(), mockUsers[0]._id.toString());
    });

    it('rejects invalid signup payload with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'A', // too short
          email: 'invalid-email',
          username: 'ab', // too short
          password: 'weak',
          confirmPassword: 'mismatch',
        }),
      });

      const res = await signupHandler(req);
      assert.strictEqual(res.status, 400);

      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.ok(json.errors);
      assert.strictEqual(mockUsers.length, 0);
    });

    it('rejects duplicate email with 409 Conflict', async () => {
      // Seed existing user
      mockUsers.push({
        _id: new mongoose.Types.ObjectId(),
        name: 'Existing User',
        email: 'taken@salahtrack.uz',
        username: 'unique_user',
        passwordHash: 'somehash',
        role: 'user',
        preferences: { language: 'uz' },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const req = new NextRequest('http://localhost:3000/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Person',
          email: 'taken@salahtrack.uz', // duplicate
          username: 'brand_new_username',
          password: 'Password123!#',
          confirmPassword: 'Password123!#',
        }),
      });

      const res = await signupHandler(req);
      assert.strictEqual(res.status, 409);

      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.ok(json.error.includes('Email is already registered'));
    });
  });

  describe('2. POST /api/auth/login', () => {
    const plainPass = 'ValidSecret123!#';
    let hashedPass: string;

    beforeEach(async () => {
      hashedPass = await hashPassword(plainPass);
      mockUsers.push({
        _id: new mongoose.Types.ObjectId(),
        name: 'Login Tester',
        email: 'tester@salahtrack.uz',
        username: 'tester_01',
        passwordHash: hashedPass,
        role: 'user',
        preferences: { language: 'uz' },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('authenticates with valid credentials and sets session cookie', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: 'tester@salahtrack.uz',
          password: plainPass,
          rememberMe: true,
        }),
      });

      const res = await loginHandler(req);
      assert.strictEqual(res.status, 200);

      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.data.user.email, 'tester@salahtrack.uz');
      assert.strictEqual(json.data.user.passwordHash, undefined, 'passwordHash must never be exposed');

      const cookieHeader = res.headers.get('set-cookie');
      assert.ok(cookieHeader);
      assert.ok(cookieHeader.includes('salahtrack_session='));

      // Check session in store
      assert.strictEqual(mockSessions.length, 1);
    });

    it('authenticates with username as identifier', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: 'tester_01', // username
          password: plainPass,
        }),
      });

      const res = await loginHandler(req);
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.data.user.username, 'tester_01');
    });

    it('rejects incorrect password with generic error message', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: 'tester@salahtrack.uz',
          password: 'IncorrectPassword999!',
        }),
      });

      const res = await loginHandler(req);
      assert.strictEqual(res.status, 401);

      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.error, 'Invalid email/username or password');
    });

    it('rejects non-existent user with the same generic error (prevents enumeration)', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: 'nonexistent@salahtrack.uz',
          password: plainPass,
        }),
      });

      const res = await loginHandler(req);
      assert.strictEqual(res.status, 401);

      const json = await res.json();
      assert.strictEqual(json.error, 'Invalid email/username or password');
    });

    it('enforces rate limiting after 5 failed login attempts', async () => {
      const badReq = () =>
        new NextRequest('http://localhost:3000/api/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': '10.0.0.1',
          },
          body: JSON.stringify({
            identifier: 'tester@salahtrack.uz',
            password: 'BadPassword!',
          }),
        });

      // 5 failed attempts
      for (let i = 0; i < 5; i++) {
        const res = await loginHandler(badReq());
        assert.strictEqual(res.status, 401);
      }

      // 6th attempt must be blocked with HTTP 429 Too Many Requests
      const blockedRes = await loginHandler(badReq());
      assert.strictEqual(blockedRes.status, 429);

      const json = await blockedRes.json();
      assert.strictEqual(json.success, false);
      assert.ok(json.error.includes('Too many failed login attempts'));
      assert.ok(blockedRes.headers.get('retry-after'));
    });
  });

  describe('3. POST /api/auth/logout', () => {
    it('invalidates database session and clears session cookie', async () => {
      const sessionToken = 'valid_active_token_123';
      mockSessions.push({
        _id: new mongoose.Types.ObjectId(),
        sessionToken,
        userId: new mongoose.Types.ObjectId(),
        expiresAt: new Date(Date.now() + 100000),
        lastActiveAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        save: async function () { return this; },
      });

      const req = new NextRequest('http://localhost:3000/api/auth/logout', {
        method: 'POST',
        headers: {
          cookie: `salahtrack_session=${sessionToken}`,
        },
      });

      const res = await logoutHandler(req);
      assert.strictEqual(res.status, 200);

      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.message, 'Logged out successfully');

      // Session must be deleted from database
      assert.strictEqual(mockSessions.length, 0);

      // Cookie must have Max-Age=0 (cleared)
      const cookieHeader = res.headers.get('set-cookie');
      assert.ok(cookieHeader);
      assert.ok(cookieHeader.includes('Max-Age=0') || cookieHeader.includes('max-age=0'));
    });
  });

  describe('4. GET /api/auth/me', () => {
    it('returns sanitized user data when valid session cookie is provided', async () => {
      const userId = new mongoose.Types.ObjectId();
      const sessionToken = 'me_valid_session_token';

      mockUsers.push({
        _id: userId,
        name: 'Profile Owner',
        email: 'owner@salahtrack.uz',
        username: 'owner_user',
        passwordHash: '$argon2id$v=19$somehash',
        role: 'user',
        preferences: { language: 'uz', calculationMethod: 'MWL' },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockSessions.push({
        _id: new mongoose.Types.ObjectId(),
        sessionToken,
        userId,
        expiresAt: new Date(Date.now() + 1000000),
        lastActiveAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        save: async function () { return this; },
      });

      const req = new NextRequest('http://localhost:3000/api/auth/me', {
        method: 'GET',
        headers: {
          cookie: `salahtrack_session=${sessionToken}`,
        },
      });

      const res = await meHandler(req);
      assert.strictEqual(res.status, 200);

      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.data.user.email, 'owner@salahtrack.uz');
      assert.strictEqual(json.data.user.username, 'owner_user');
      assert.strictEqual(json.data.user.passwordHash, undefined, 'passwordHash must never be exposed');
    });

    it('returns 401 Unauthorized when session cookie is missing', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/me', {
        method: 'GET',
      });

      const res = await meHandler(req);
      assert.strictEqual(res.status, 401);

      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.ok(json.error.includes('Unauthorized'));
    });
  });

  describe('5. Session Guard (validateSessionToken)', () => {
    it('returns null and purges expired session from database', async () => {
      const expiredToken = 'expired_session_token';
      const expiredSessionId = new mongoose.Types.ObjectId();

      mockSessions.push({
        _id: expiredSessionId,
        sessionToken: expiredToken,
        userId: new mongoose.Types.ObjectId(),
        expiresAt: new Date(Date.now() - 5000), // expired 5 seconds ago
        lastActiveAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        save: async function () { return this; },
      });

      const result = await validateSessionToken(expiredToken);
      assert.strictEqual(result, null, 'Expired session must return null');

      // Verified purged from database
      assert.strictEqual(mockSessions.length, 0, 'Expired session must be deleted from database');
    });

    it('returns null for non-existent token', async () => {
      const result = await validateSessionToken('non_existent_token');
      assert.strictEqual(result, null);
    });
  });
});
