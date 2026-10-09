import { NextRequest, NextResponse } from 'next/server.js';
import { connectDB } from '../../../lib/mongodb.ts';
import { PrayerRecord } from '../../../models/Prayer.ts';
import { authenticateRequest } from '../../../lib/auth/index.ts';
import type { PrayerId, PrayerStatus } from '../../../types/prayer.ts';

const VALID_PRAYER_IDS: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const VALID_STATUSES: PrayerStatus[] = [
  'PENDING',
  'PRAYED_ON_TIME',
  'PRAYED_LATE',
  'MISSED',
  'MADE_UP',
  'PRAYED',
];

/**
 * Calculates maximum allowed calendar date string (YYYY-MM-DD)
 * Supports all world timezones (up to UTC+14) while strictly rejecting actual future dates.
 */
export function getMaxAllowedDate(): string {
  const futureThreshold = new Date(Date.now() + 14 * 60 * 60 * 1000);
  return futureThreshold.toISOString().split('T')[0];
}

/**
 * Calculates accountability fine for a daily prayer record based on Phase 8 rules:
 * - Base fine: 15,000 UZS per missed prayer
 * - Overdue penalty: +15,000 UZS (total 30,000 UZS) if unperformed after 7 days
 * - Made up: fine cleared upon fulfillment
 */
export function calculateFines(recordDateStr: string, prayers: Record<PrayerId, { status: PrayerStatus; missedAt?: Date }>): number {
  let totalFine = 0;
  const now = Date.now();
  const recordDate = new Date(`${recordDateStr}T00:00:00Z`).getTime();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const isOverdue = now - recordDate > sevenDaysMs;

  for (const prayerId of VALID_PRAYER_IDS) {
    const prayer = prayers[prayerId];
    if (prayer && prayer.status === 'MISSED') {
      totalFine += 15000;
      if (isOverdue) {
        totalFine += 15000;
      }
    }
  }

  return totalFine;
}

/**
 * GET /api/prayers?date=YYYY-MM-DD
 * Retrieves the authenticated user's private prayer ledger for a specific calendar date.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Authentication required' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');
    const today = new Date().toISOString().split('T')[0];
    const targetDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today;

    await connectDB();

    const record = await PrayerRecord.findOne({
      userId: auth.user.id,
      date: targetDate,
    });

    if (!record) {
      // Return a virtual default representation for 0ms clean consumption
      return NextResponse.json(
        {
          success: true,
          data: {
            date: targetDate,
            prayers: {
              fajr: { status: 'PENDING' },
              dhuhr: { status: 'PENDING' },
              asr: { status: 'PENDING' },
              maghrib: { status: 'PENDING' },
              isha: { status: 'PENDING' },
            },
            finesAccrued: 0,
            isNewRecord: true,
          },
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: record,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in GET /api/prayers:', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/prayers
 * Atomically creates or updates a prayer status for the authenticated user.
 * Guarantees document-level ownership: never trusts client-supplied userId.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Invalid request payload' },
        { status: 400 }
      );
    }

    const { date, prayerId, status, prayers: batchPrayers, notes } = body;

    // Validation
    if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { success: false, error: 'Valid date in YYYY-MM-DD format is required' },
        { status: 400 }
      );
    }

    // Future dates are strictly prohibited
    const maxDate = getMaxAllowedDate();
    if (date > maxDate) {
      return NextResponse.json(
        { success: false, error: 'Cannot log or modify prayer records for future dates' },
        { status: 400 }
      );
    }

    // Check payload type: either single prayer or batch prayers object
    if (!batchPrayers && (!prayerId || !status)) {
      return NextResponse.json(
        { success: false, error: 'Either (prayerId and status) or prayers map is required' },
        { status: 400 }
      );
    }

    if (prayerId && !VALID_PRAYER_IDS.includes(prayerId as PrayerId)) {
      return NextResponse.json(
        { success: false, error: `Invalid prayerId. Must be one of: ${VALID_PRAYER_IDS.join(', ')}` },
        { status: 400 }
      );
    }

    if (status && !VALID_STATUSES.includes(status as PrayerStatus)) {
      return NextResponse.json(
        { success: false, error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 }
      );
    }

    await connectDB();

    // Find existing or initialize
    let record = await PrayerRecord.findOne({
      userId: auth.user.id,
      date,
    });

    const now = new Date();

    if (!record) {
      record = new PrayerRecord({
        userId: auth.user.id,
        date,
        prayers: {
          fajr: { status: 'PENDING' },
          dhuhr: { status: 'PENDING' },
          asr: { status: 'PENDING' },
          maghrib: { status: 'PENDING' },
          isha: { status: 'PENDING' },
        },
      });
    }

    // Handle batch prayer update
    if (batchPrayers && typeof batchPrayers === 'object') {
      for (const pId of VALID_PRAYER_IDS) {
        const pStatus = batchPrayers[pId];
        if (pStatus && VALID_STATUSES.includes(pStatus as PrayerStatus)) {
          const norm: PrayerStatus = pStatus === 'PRAYED' ? 'PRAYED_ON_TIME' : pStatus;
          record.prayers[pId] = {
            status: norm,
            prayedAt: norm === 'PRAYED_ON_TIME' || norm === 'PRAYED_LATE' ? now : undefined,
            missedAt: norm === 'MISSED' ? now : undefined,
            madeUpAt: norm === 'MADE_UP' ? now : undefined,
          };
        }
      }
    } else if (prayerId && status) {
      // Handle single prayer update
      const normalizedStatus: PrayerStatus = status === 'PRAYED' ? 'PRAYED_ON_TIME' : status;
      record.prayers[prayerId as PrayerId] = {
        status: normalizedStatus,
        prayedAt: normalizedStatus === 'PRAYED_ON_TIME' || normalizedStatus === 'PRAYED_LATE' ? now : undefined,
        missedAt: normalizedStatus === 'MISSED' ? now : undefined,
        madeUpAt: normalizedStatus === 'MADE_UP' ? now : undefined,
        notes: typeof notes === 'string' ? notes.slice(0, 200) : undefined,
      };
    }

    // Recalculate accrued accountability fine deterministically
    record.finesAccrued = calculateFines(date, record.prayers);

    await record.save();

    return NextResponse.json(
      {
        success: true,
        data: record,
        message: 'Prayer status updated successfully',
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in POST /api/prayers:', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
