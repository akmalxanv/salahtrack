import { NextRequest, NextResponse } from 'next/server.js';
import { connectDB } from '../../../../lib/mongodb.ts';
import { authenticateRequest } from '../../../../lib/auth/guard.ts';
import { Group } from '../../../../models/Group.ts';
import { User } from '../../../../models/User.ts';
import { PrayerRecord } from '../../../../models/Prayer.ts';
import mongoose from 'mongoose';

const PRAYER_KEYS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Session required' },
        { status: 401 }
      );
    }

    const { id } = await props.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, error: 'Invalid circle ID' },
        { status: 400 }
      );
    }

    await connectDB();

    const group = await Group.findById(id).lean();
    if (!group) {
      return NextResponse.json(
        { success: false, error: 'Circle not found' },
        { status: 404 }
      );
    }

    // Strict Authorization: Caller MUST be a member of this circle
    const isMember = group.members.some(
      (m) => m.userId.toString() === auth.user.id
    );

    if (!isMember) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: You are not a member of this circle' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || 'weekly';

    // Calculate date boundaries
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    let startDateStr = todayStr;
    let maxPrayers = 5;

    if (period === 'weekly') {
      const weekAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
      startDateStr = weekAgo.toISOString().split('T')[0];
      maxPrayers = 35;
    } else if (period === 'monthly') {
      const monthAgo = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
      startDateStr = monthAgo.toISOString().split('T')[0];
      maxPrayers = 150;
    }

    // Fetch members and their prayer records
    const memberUserIds = group.members.map((m) => m.userId);
    const users = await User.find({ _id: { $in: memberUserIds } })
      .select('_id name username createdAt')
      .lean();

    const userMap = new Map<string, { name: string; username: string; createdAt: Date }>();
    for (const u of users) {
      userMap.set(u._id.toString(), {
        name: u.name,
        username: u.username,
        createdAt: u.createdAt,
      });
    }

    // Query prayer records for all circle members to compute period stats and total outstanding sadaqah owed
    const records = await PrayerRecord.find({
      userId: { $in: memberUserIds },
    })
      .select('userId date prayers')
      .lean();

    // Map records by userId
    const memberStatsMap = new Map<
      string,
      { completedCount: number; onTimeCount: number; sadaqahOwed: number }
    >();

    for (const mId of memberUserIds) {
      memberStatsMap.set(mId.toString(), {
        completedCount: 0,
        onTimeCount: 0,
        sadaqahOwed: 0,
      });
    }

    const nowTime = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    for (const rec of records) {
      const uId = rec.userId.toString();
      const stats = memberStatsMap.get(uId);
      if (!stats) continue;

      const recDate = new Date(`${rec.date}T00:00:00Z`).getTime();
      const isOverdue = !isNaN(recDate) && nowTime - recDate > sevenDaysMs;
      const isWithinPeriod = rec.date >= startDateStr && rec.date <= todayStr;

      for (const pKey of PRAYER_KEYS) {
        const prayer = rec.prayers?.[pKey];
        if (!prayer) continue;

        // In private circles ONLY:
        // Compute applicable outstanding sadaqah owed:
        // - Unpaid MISSED is 15,000 UZS base + 15,000 UZS if >7 days overdue
        // - Unpaid MADE_UP is 15,000 UZS base
        // - Exclude paid/settled prayers (prayer.isPaid: true)
        if (!prayer.isPaid) {
          if (prayer.status === 'MISSED') {
            stats.sadaqahOwed += 15000 + (isOverdue ? 15000 : 0);
          } else if (prayer.status === 'MADE_UP') {
            stats.sadaqahOwed += 15000;
          }
        }

        // Leaderboard stats within active period
        if (isWithinPeriod) {
          if (prayer.status === 'PRAYED_ON_TIME' || prayer.status === 'PRAYED') {
            stats.completedCount++;
            stats.onTimeCount++;
          } else if (prayer.status === 'PRAYED_LATE') {
            stats.completedCount++;
          }
        }
      }
    }

    // Assemble member entries with clean defaults and sadaqahOwed
    const memberEntries = group.members.map((m) => {
      const uId = m.userId.toString();
      const uInfo = userMap.get(uId);
      const stats = memberStatsMap.get(uId) || {
        completedCount: 0,
        onTimeCount: 0,
        sadaqahOwed: 0,
      };

      const rawPercentage =
        maxPrayers > 0
          ? Math.round((stats.completedCount / maxPrayers) * 100)
          : 0;
      const consistencyPercentage = isNaN(rawPercentage) ? 0 : Math.min(100, rawPercentage);

      return {
        userId: uId,
        name: uInfo?.name || 'User',
        username: uInfo?.username || 'member',
        role: m.role,
        joinedAt: m.joinedAt,
        completedCount: stats.completedCount,
        onTimeCount: stats.onTimeCount,
        sadaqahOwed: stats.sadaqahOwed,
        maxPossible: maxPrayers,
        consistencyPercentage,
        isCurrentUser: uId === auth.user.id,
      };
    });

    // Deterministic sorting:
    // 1. Percentage / completed prayers descending
    // 2. On-time prayers descending
    // 3. Joined date ascending
    // 4. Deterministic fallback by userId
    memberEntries.sort((a, b) => {
      if (b.consistencyPercentage !== a.consistencyPercentage) {
        return b.consistencyPercentage - a.consistencyPercentage;
      }
      if (b.completedCount !== a.completedCount) {
        return b.completedCount - a.completedCount;
      }
      if (b.onTimeCount !== a.onTimeCount) {
        return b.onTimeCount - a.onTimeCount;
      }
      const joinedA = new Date(a.joinedAt).getTime();
      const joinedB = new Date(b.joinedAt).getTime();
      if (joinedA !== joinedB) {
        return joinedA - joinedB;
      }
      return a.userId.localeCompare(b.userId);
    });

    // Assign ranks using Standard Competition Ranking (1224 ranking):
    // Identical performance metrics share the rank; next rank reflects true position.
    let currentRank = 1;
    const rankedMembers = memberEntries.map((entry, idx) => {
      if (idx > 0) {
        const prev = memberEntries[idx - 1];
        const isTie =
          entry.consistencyPercentage === prev.consistencyPercentage &&
          entry.completedCount === prev.completedCount &&
          entry.onTimeCount === prev.onTimeCount;

        if (!isTie) {
          currentRank = idx + 1;
        }
      } else {
        currentRank = 1;
      }

      return {
        ...entry,
        rank: currentRank,
      };
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          id: group._id.toString(),
          name: group.name,
          description: group.description,
          inviteCode: group.inviteCode,
          memberCount: group.members.length,
          period,
          maxPossible: maxPrayers,
          members: rankedMembers,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('GET /api/groups/[id] error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Session required' },
        { status: 401 }
      );
    }

    const { id } = await props.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, error: 'Invalid circle ID' },
        { status: 400 }
      );
    }

    await connectDB();

    const group = await Group.findById(id);
    if (!group) {
      return NextResponse.json(
        { success: false, error: 'Circle not found' },
        { status: 404 }
      );
    }

    const memberIndex = group.members.findIndex(
      (m) => m.userId.toString() === auth.user.id
    );

    if (memberIndex === -1) {
      return NextResponse.json(
        { success: false, error: 'You are not a member of this circle' },
        { status: 400 }
      );
    }

    const isOwner = group.members[memberIndex].role === 'owner';

    if (group.members.length === 1) {
      // Sole member leaving deletes circle
      await Group.findByIdAndDelete(id);
      return NextResponse.json(
        { success: true, message: 'Circle disbanded successfully' },
        { status: 200 }
      );
    }

    // If owner is leaving, transfer ownership to the next member
    group.members.splice(memberIndex, 1);
    if (isOwner && group.members.length > 0) {
      group.members[0].role = 'owner';
    }

    await group.save();

    return NextResponse.json(
      { success: true, message: 'Left circle successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('DELETE /api/groups/[id] error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
