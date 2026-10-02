import { NextRequest, NextResponse } from 'next/server.js';
import { connectDB } from '../../../lib/mongodb.ts';
import { authenticateRequest } from '../../../lib/auth/guard.ts';
import { Group } from '../../../models/Group.ts';
import { generateInviteCode } from '../../../lib/groups.ts';
import mongoose from 'mongoose';

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Session required' },
        { status: 401 }
      );
    }

    await connectDB();

    const userObjectId = new mongoose.Types.ObjectId(auth.user.id);
    const groups = await Group.find({ 'members.userId': userObjectId })
      .populate('creatorId', 'name username')
      .sort({ createdAt: -1 })
      .lean();

    const formattedGroups = groups.map((g) => {
      const userMember = g.members.find(
        (m) => m.userId.toString() === auth.user.id
      );

      const creator = g.creatorId as unknown as { name?: string; username?: string } | undefined;

      return {
        id: g._id.toString(),
        name: g.name,
        description: g.description || '',
        inviteCode: g.inviteCode,
        creatorName: creator?.name || 'Creator',
        creatorUsername: creator?.username || '',
        memberCount: g.members.length,
        role: userMember?.role || 'member',
        createdAt: g.createdAt,
      };
    });

    return NextResponse.json(
      { success: true, data: formattedGroups },
      { status: 200 }
    );
  } catch (error) {
    console.error('GET /api/groups error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Session required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { name, description } = body;

    if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 60) {
      return NextResponse.json(
        { success: false, error: 'Group name must be between 2 and 60 characters' },
        { status: 400 }
      );
    }

    await connectDB();

    const userObjectId = new mongoose.Types.ObjectId(auth.user.id);

    // Generate unique invite code with collision check
    let inviteCode = generateInviteCode();
    let collision = await Group.findOne({ inviteCode });
    let attempts = 0;
    while (collision && attempts < 5) {
      inviteCode = generateInviteCode();
      collision = await Group.findOne({ inviteCode });
      attempts++;
    }

    const group = await Group.create({
      name: name.trim(),
      description: typeof description === 'string' ? description.trim().slice(0, 200) : '',
      creatorId: userObjectId,
      inviteCode,
      members: [
        {
          userId: userObjectId,
          role: 'owner',
          joinedAt: new Date(),
        },
      ],
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          id: group._id.toString(),
          name: group.name,
          description: group.description,
          inviteCode: group.inviteCode,
          memberCount: 1,
          role: 'owner',
          createdAt: group.createdAt,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('POST /api/groups error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
