import { NextRequest, NextResponse } from 'next/server.js';
import { connectDB, execLean } from '../../../../lib/mongodb.ts';
import { authenticateRequest } from '../../../../lib/auth/guard.ts';
import { Group, type IGroup } from '../../../../models/Group.ts';
import { User } from '../../../../models/User.ts';
import { PrayerRecord } from '../../../../models/Prayer.ts';
import { calculateAuthoritativeDebt, type RawRecordInput } from '../../../../lib/accountability.ts';
import { getLiturgicalDate, sanitizeTimezone } from '../../../../lib/prayer-cycle.ts';
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

    const group = await execLean<IGroup | null>(Group.findById(id));
    if (!group) {
      return NextResponse.json(
        { success: false, error: 'Circle not found' },
        { status: 404 }
      );
    }

    // Strict Authorization: Caller MUST be a member of this circle
    const callerMember = group.members.find(
      (m) => m.userId.toString() === auth.user.id
    );

    if (!callerMember) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: You are not a member of this circle' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || 'weekly';
    const timezone = sanitizeTimezone(searchParams.get('timezone') || auth.user.preferences?.timezone);

    // Calculate date boundaries in the caller's resolved local timezone (DST-safe UTC day arithmetic)
    const now = new Date();
    const todayStr = getLiturgicalDate(now, undefined, timezone);
    const [ty, tm, td] = todayStr.split('-').map(Number);
    const todayUtc = Date.UTC(ty, tm - 1, td);
    let startDateStr = todayStr;
    let maxPrayers = 5;

    if (period === 'weekly') {
      const weekAgo = new Date(todayUtc - 6 * 24 * 60 * 60 * 1000);
      startDateStr = weekAgo.toISOString().split('T')[0];
      maxPrayers = 35;
    } else if (period === 'monthly') {
      const monthAgo = new Date(todayUtc - 29 * 24 * 60 * 60 * 1000);
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
    const rawRecordsQuery = PrayerRecord.find({
      userId: { $in: memberUserIds },
    });
    const selectedRecordsQuery =
      typeof (rawRecordsQuery as { select?: (fields: string) => unknown })?.select === 'function'
        ? (rawRecordsQuery as { select: (fields: string) => unknown }).select('userId date prayers')
        : rawRecordsQuery;
    const records = await execLean<
      Array<{ userId: mongoose.Types.ObjectId | string; date: string; prayers?: unknown }>
    >(selectedRecordsQuery);

    // Map records by userId
    const memberRecordsMap = new Map<
      string,
      Array<{ date: string; prayers?: unknown }>
    >();

    for (const mId of memberUserIds) {
      memberRecordsMap.set(mId.toString(), []);
    }

    for (const rec of records) {
      const uId = rec.userId.toString();
      const list = memberRecordsMap.get(uId);
      if (list) {
        list.push(rec);
      }
    }

    const memberStatsMap = new Map<
      string,
      { completedCount: number; onTimeCount: number; sadaqahOwed: number }
    >();

    for (const mId of memberUserIds) {
      const uId = mId.toString();
      const userRecords = memberRecordsMap.get(uId) || [];
      const debt = calculateAuthoritativeDebt(userRecords as unknown as RawRecordInput[], { referenceDate: todayStr });

      let completedCount = 0;
      let onTimeCount = 0;

      for (const rec of userRecords) {
        const isWithinPeriod = rec.date >= startDateStr && rec.date <= todayStr;
        if (isWithinPeriod && rec.prayers && typeof rec.prayers === 'object') {
          for (const pKey of PRAYER_KEYS) {
            const prayer = (rec.prayers as Record<string, { status: string }>)[pKey];
            if (!prayer) continue;
            if (prayer.status === 'PRAYED_ON_TIME' || prayer.status === 'PRAYED') {
              completedCount++;
              onTimeCount++;
            } else if (prayer.status === 'PRAYED_LATE') {
              completedCount++;
            }
          }
        }
      }

      memberStatsMap.set(uId, {
        completedCount,
        onTimeCount,
        sadaqahOwed: debt.totalFinancialDebt,
      });
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
          ownerId: group.creatorId?.toString?.() || '',
          currentUserRole: callerMember.role,
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
        {
          success: false,
          error: 'Forbidden: You are not a member of this circle',
          code: 'FORBIDDEN_NOT_MEMBER',
        },
        { status: 403 }
      );
    }

    const isOwner =
      group.creatorId?.toString?.() === auth.user.id ||
      group.members[memberIndex].role === 'owner';

    const { searchParams } = new URL(request.url);
    const intent = searchParams.get('intent');

    if (intent === 'delete' && !isOwner) {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden: Only the circle owner can delete this circle',
          code: 'FORBIDDEN_OWNER_ONLY',
        },
        { status: 403 }
      );
    }

    if (intent === 'leave' && isOwner) {
      return NextResponse.json(
        {
          success: false,
          error: 'Circle owners cannot leave without deleting the circle',
          code: 'OWNER_MUST_DELETE',
        },
        { status: 400 }
      );
    }

    if (isOwner) {
      // Group owner deletes the entire circle for all members
      await Group.findByIdAndDelete(id);
      return NextResponse.json(
        {
          success: true,
          action: 'deleted',
          message: 'Circle deleted successfully',
        },
        { status: 200 }
      );
    }

    // Regular member leaves the circle
    group.members.splice(memberIndex, 1);
    await group.save();

    return NextResponse.json(
      {
        success: true,
        action: 'left',
        message: 'Left circle successfully',
      },
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
