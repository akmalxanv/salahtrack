import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server.js';

import { Group } from '../../src/models/Group.ts';
import { generateInviteCode } from '../../src/lib/groups.ts';
import * as authGuard from '../../src/lib/auth/guard.ts';
import { GET as listGroupsHandler, POST as createGroupHandler } from '../../src/app/api/groups/route.ts';
import { POST as joinGroupHandler } from '../../src/app/api/groups/join/route.ts';
import { GET as getGroupHandler, DELETE as leaveGroupHandler } from '../../src/app/api/groups/[id]/route.ts';

process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/salahtrack_test';

// In-memory mock stores
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
  createdAt: Date;
  updatedAt: Date;
}

let mockGroups: MockGroupDoc[] = [];

describe('Multi-User Accountability Circles & BOLA Protection', () => {
  beforeEach(() => {
    mockGroups = [];
  });

  describe('1. Invite Code Generator', () => {
    it('generates valid 8-character hyphenated uppercase codes (XXXX-XXXX)', () => {
      const code1 = generateInviteCode();
      const code2 = generateInviteCode();

      assert.match(code1, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
      assert.match(code2, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
      assert.notEqual(code1, code2);
    });

    it('excludes ambiguous characters (0, O, 1, I, L) to avoid transcription errors', () => {
      for (let i = 0; i < 50; i++) {
        const code = generateInviteCode();
        assert.ok(!code.includes('0'), `Code ${code} contained 0`);
        assert.ok(!code.includes('O'), `Code ${code} contained O`);
        assert.ok(!code.includes('1'), `Code ${code} contained 1`);
        assert.ok(!code.includes('I'), `Code ${code} contained I`);
        assert.ok(!code.includes('L'), `Code ${code} contained L`);
      }
    });
  });

  describe('2. Group Model Schema & Security Constraints', () => {
    it('defines required fields and indices on Group schema', () => {
      assert.ok(Group.schema.paths.name, 'Name path must exist');
      assert.ok(Group.schema.paths.inviteCode, 'Invite code path must exist');
      assert.ok(Group.schema.paths.creatorId, 'CreatorId path must exist');
      assert.ok(Group.schema.paths.members, 'Members path must exist');

      // Check indexing on members.userId for efficient membership lookups
      const indexes = Group.schema.indexes();
      const hasMemberUserIndex = indexes.some(
        ([idx]) => idx['members.userId'] === 1
      );
      assert.ok(hasMemberUserIndex, 'Must have index on members.userId');
    });
  });

  describe('3. Group API Endpoints & Authorization', () => {
    it('rejects unauthenticated requests to /api/groups with 401 Unauthorized', async () => {
      // Mock unauthenticated
      (authGuard as unknown as { authenticateRequest: () => Promise<null> }).authenticateRequest = async () => null;

      const req = new NextRequest('http://localhost:3000/api/groups');
      const res = await listGroupsHandler(req);
      assert.equal(res.status, 401);

      const json = await res.json();
      assert.equal(json.success, false);
      assert.match(json.error, /Unauthorized/i);
    });

    it('rejects group creation with missing or invalid name with 400 Bad Request', async () => {
      const userAId = new mongoose.Types.ObjectId();
      (authGuard as unknown as {
        authenticateRequest: () => Promise<{ user: { id: string; name: string; username: string }; session: object }>;
      }).authenticateRequest = async () => ({
        user: { id: userAId.toString(), name: 'User A', username: 'usera' },
        session: {},
      });

      const req = new NextRequest('http://localhost:3000/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: ' ' }),
      });

      const res = await createGroupHandler(req);
      assert.equal(res.status, 400);

      const json = await res.json();
      assert.equal(json.success, false);
      assert.match(json.error, /between 2 and 60 characters/i);
    });

    it('rejects joining a group with empty invite code with 400 Bad Request', async () => {
      const userBId = new mongoose.Types.ObjectId();
      (authGuard as unknown as {
        authenticateRequest: () => Promise<{ user: { id: string; name: string; username: string }; session: object }>;
      }).authenticateRequest = async () => ({
        user: { id: userBId.toString(), name: 'User B', username: 'userb' },
        session: {},
      });

      const req = new NextRequest('http://localhost:3000/api/groups/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode: '' }),
      });

      const res = await joinGroupHandler(req);
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.match(json.error, /Invite code is required/i);
    });

    it('rejects GET /api/groups/[id] with invalid ObjectId with 400 Bad Request', async () => {
      const userAId = new mongoose.Types.ObjectId();
      (authGuard as unknown as {
        authenticateRequest: () => Promise<{ user: { id: string; name: string; username: string }; session: object }>;
      }).authenticateRequest = async () => ({
        user: { id: userAId.toString(), name: 'User A', username: 'usera' },
        session: {},
      });

      const req = new NextRequest('http://localhost:3000/api/groups/invalid-id');
      const res = await getGroupHandler(req, { params: Promise.resolve({ id: 'invalid-id' }) });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.match(json.error, /Invalid circle ID/i);
    });

    it('enforces membership authorization: non-members receive 403 Forbidden', async () => {
      const userCId = new mongoose.Types.ObjectId();
      const mockGroupId = new mongoose.Types.ObjectId();
      const ownerId = new mongoose.Types.ObjectId();

      (authGuard as unknown as {
        authenticateRequest: () => Promise<{ user: { id: string; name: string; username: string }; session: object }>;
      }).authenticateRequest = async () => ({
        user: { id: userCId.toString(), name: 'User C', username: 'userc' },
        session: {},
      });

      // Mock Group.findById to return a group where User C is NOT a member
      (Group as unknown as { findById: () => { lean: () => Promise<object> } }).findById = () => ({
        lean: async () => ({
          _id: mockGroupId,
          name: 'Private Circle',
          creatorId: ownerId,
          inviteCode: 'TEST-CODE',
          members: [{ userId: ownerId, role: 'owner', joinedAt: new Date() }],
        }),
      });

      const req = new NextRequest(`http://localhost:3000/api/groups/${mockGroupId}`);
      const res = await getGroupHandler(req, { params: Promise.resolve({ id: mockGroupId.toString() }) });
      assert.equal(res.status, 403);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.match(json.error, /Forbidden: You are not a member/i);
    });
  });
});
