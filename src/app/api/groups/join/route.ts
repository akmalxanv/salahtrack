import { NextRequest, NextResponse } from 'next/server.js';
import { connectDB } from '../../../../lib/mongodb.ts';
import { authenticateRequest } from '../../../../lib/auth/guard.ts';
import { Group } from '../../../../models/Group.ts';
import mongoose from 'mongoose';

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Session required', code: 'AUTH_UNAUTHORIZED' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { inviteCode } = body;

    if (!inviteCode || typeof inviteCode !== 'string' || !inviteCode.trim()) {
      return NextResponse.json(
        { success: false, error: 'Invite code is required', code: 'INVALID_INVITE_CODE' },
        { status: 400 }
      );
    }

    const normalizedCode = inviteCode.trim().toUpperCase();

    await connectDB();

    const group = await Group.findOne({ inviteCode: normalizedCode });
    if (!group) {
      return NextResponse.json(
        { success: false, error: 'No circle found with this invite code', code: 'CIRCLE_NOT_FOUND' },
        { status: 404 }
      );
    }

    const userObjectId = new mongoose.Types.ObjectId(auth.user.id);
    const isAlreadyMember = group.members.some(
      (m) => m.userId.toString() === auth.user.id
    );

    if (isAlreadyMember) {
      return NextResponse.json(
        { success: false, error: 'You are already a member of this circle', code: 'CIRCLE_ALREADY_MEMBER' },
        { status: 400 }
      );
    }

    // Add user as member
    group.members.push({
      userId: userObjectId,
      role: 'member',
      joinedAt: new Date(),
    });

    await group.save();

    return NextResponse.json(
      {
        success: true,
        data: {
          id: group._id.toString(),
          name: group.name,
          description: group.description,
          inviteCode: group.inviteCode,
          memberCount: group.members.length,
          role: 'member',
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('POST /api/groups/join error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' },
      { status: 500 }
    );
  }
}
