import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';

import { connectDB, execLean } from '../../src/lib/mongodb.ts';
import { User } from '../../src/models/User.ts';
import { Session } from '../../src/models/Session.ts';
import { PrayerRecord } from '../../src/models/Prayer.ts';
import { QazaPayment } from '../../src/models/QazaPayment.ts';
import { Group } from '../../src/models/Group.ts';

describe('Database Hardening & Schema Index Audit', () => {
  const originalConnect = mongoose.connect;
  const originalCache = global.mongooseCache;
  const originalUri = process.env.MONGODB_URI;
  const originalDbName = process.env.MONGODB_DB_NAME;
  const originalConsoleError = console.error;

  afterEach(() => {
    (mongoose as unknown as { connect: typeof mongoose.connect }).connect = originalConnect;
    global.mongooseCache = originalCache;
    if (originalUri === undefined) {
      delete process.env.MONGODB_URI;
    } else {
      process.env.MONGODB_URI = originalUri;
    }
    if (originalDbName === undefined) {
      delete process.env.MONGODB_DB_NAME;
    } else {
      process.env.MONGODB_DB_NAME = originalDbName;
    }
    console.error = originalConsoleError;
  });

  describe('1. connectDB() Singleton Cache Consistency & Pool Options', () => {
    it('reads and writes .conn and .promise consistently on global.mongooseCache even after cache reset', async () => {
      let connectCalls = 0;
      let capturedOpts: Record<string, unknown> | undefined;

      (mongoose as unknown as { connect: unknown }).connect = async (
        _uri: string,
        opts?: Record<string, unknown>
      ) => {
        connectCalls++;
        capturedOpts = opts;
        return mongoose;
      };

      process.env.MONGODB_URI = 'mongodb://127.0.0.1:27098/namozlarim_test';
      process.env.MONGODB_DB_NAME = '  custom_namozlarim  ';

      // Reset global.mongooseCache to a fresh object
      global.mongooseCache = { conn: null, promise: null };

      const conn1 = await connectDB();
      assert.strictEqual(conn1, mongoose);
      assert.strictEqual(connectCalls, 1);
      assert.strictEqual(global.mongooseCache?.conn, mongoose);
      assert.ok(global.mongooseCache?.promise);

      // Verify production pool & timeout options
      assert.strictEqual(capturedOpts?.bufferCommands, false);
      assert.strictEqual(capturedOpts?.serverSelectionTimeoutMS, 5000);
      assert.strictEqual(capturedOpts?.connectTimeoutMS, 5000);
      assert.strictEqual(capturedOpts?.socketTimeoutMS, 20000);
      assert.strictEqual(capturedOpts?.maxPoolSize, 10);
      assert.strictEqual(capturedOpts?.dbName, 'custom_namozlarim');

      // Re-invoking returns cached connection without calling mongoose.connect again
      const conn2 = await connectDB();
      assert.strictEqual(conn2, mongoose);
      assert.strictEqual(connectCalls, 1);

      // Resetting global.mongooseCache to undefined must trigger a fresh connection (no stale module-local promise reuse)
      global.mongooseCache = undefined;
      delete process.env.MONGODB_DB_NAME;

      const conn3 = await connectDB();
      assert.strictEqual(conn3, mongoose);
      assert.strictEqual(connectCalls, 2);
      const repopulatedCache = global.mongooseCache as { conn: unknown; promise: unknown } | undefined;
      assert.strictEqual(repopulatedCache?.conn, mongoose);
      assert.strictEqual('dbName' in (capturedOpts || {}), false);
    });

    it('clears cache on failure and masks URI credentials in connection error logs', async () => {
      const loggedArgs: unknown[] = [];
      console.error = (...args: unknown[]) => {
        loggedArgs.push(args);
      };

      (mongoose as unknown as { connect: unknown }).connect = async () => {
        throw new Error('Authentication failed for mongodb+srv://myUser:mySecretPass@cluster0.example.net/');
      };

      process.env.MONGODB_URI = 'mongodb+srv://myUser:mySecretPass@cluster0.example.net/';
      global.mongooseCache = { conn: null, promise: null };

      await assert.rejects(() => connectDB(), /Authentication failed/);

      assert.strictEqual(global.mongooseCache?.conn, null);
      assert.strictEqual(global.mongooseCache?.promise, null);

      const serialized = JSON.stringify(loggedArgs);
      assert.strictEqual(serialized.includes('mySecretPass'), false);
      assert.strictEqual(serialized.includes('//***:***@'), true);
    });

    it('execLean handles both Mongoose queries with .lean() and raw promises', async () => {
      const leanRes = await execLean<{ ok: boolean }>({
        lean: async () => ({ ok: true }),
      });
      assert.deepStrictEqual(leanRes, { ok: true });

      const promiseRes = await execLean<number>(Promise.resolve(42));
      assert.strictEqual(promiseRes, 42);
    });
  });

  describe('2. Schema Index Coverage Audit', () => {
    it('User schema indexes email, username, preferences.showOnLeaderboard, and passwordResetTokenHash', () => {
      const indexes = User.schema.indexes();
      assert.strictEqual(User.schema.path('email').options.unique, true);
      assert.strictEqual(User.schema.path('username').options.unique, true);

      const hasLeaderboardIndex = indexes.some(
        ([keys]) => keys['preferences.showOnLeaderboard'] === 1
      );
      assert.ok(hasLeaderboardIndex, 'User schema must index preferences.showOnLeaderboard');

      const hasResetTokenIndex = indexes.some(
        ([keys, opts]) => keys.passwordResetTokenHash === 1 && opts?.sparse === true
      );
      assert.ok(hasResetTokenIndex, 'User schema must have sparse index on passwordResetTokenHash');
    });

    it('Session schema defines unique sessionToken, userId index, and TTL expiresAt index', () => {
      assert.strictEqual(Session.schema.path('sessionToken').options.unique, true);
      assert.strictEqual(Session.schema.path('userId').options.index, true);
      assert.strictEqual(Session.schema.path('expiresAt').options.expires, 0);
    });

    it('PrayerRecord schema defines unique { userId: 1, date: 1 } and { userId: 1, date: -1 } indexes', () => {
      const indexes = PrayerRecord.schema.indexes();
      const hasUniqueDaily = indexes.some(
        ([keys, opts]) => keys.userId === 1 && keys.date === 1 && opts?.unique === true
      );
      const hasDescRange = indexes.some(
        ([keys]) => keys.userId === 1 && keys.date === -1
      );
      assert.ok(hasUniqueDaily, 'PrayerRecord must have unique { userId: 1, date: 1 } index');
      assert.ok(hasDescRange, 'PrayerRecord must have { userId: 1, date: -1 } index');
    });

    it('QazaPayment schema defines { userId: 1, createdAt: -1 } and partial unique idempotency index', () => {
      const indexes = QazaPayment.schema.indexes();
      const hasHistoryIndex = indexes.some(
        ([keys]) => keys.userId === 1 && keys.createdAt === -1
      );
      const hasIdempotencyIndex = indexes.some(
        ([keys, opts]) =>
          keys.userId === 1 &&
          keys.idempotencyKey === 1 &&
          opts?.unique === true &&
          Boolean(opts?.partialFilterExpression)
      );
      assert.ok(hasHistoryIndex, 'QazaPayment must have { userId: 1, createdAt: -1 } index');
      assert.ok(hasIdempotencyIndex, 'QazaPayment must have partial unique idempotency index');
    });

    it('Group schema defines compound { members.userId: 1, createdAt: -1 } and unique inviteCode', () => {
      const indexes = Group.schema.indexes();
      assert.strictEqual(Group.schema.path('inviteCode').options.unique, true);
      const hasMemberSortedIndex = indexes.some(
        ([keys]) => keys['members.userId'] === 1 && keys.createdAt === -1
      );
      assert.ok(
        hasMemberSortedIndex,
        'Group must have compound { members.userId: 1, createdAt: -1 } index'
      );
    });

    it('verifies deprecated src/lib/db.ts wrapper was removed', () => {
      const legacyDbPath = path.join(process.cwd(), 'src', 'lib', 'db.ts');
      assert.strictEqual(fs.existsSync(legacyDbPath), false);
    });
  });
});
