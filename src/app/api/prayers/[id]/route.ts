import { NextRequest, NextResponse } from 'next/server.js';
import mongoose from 'mongoose';
import { connectDB } from '../../../../lib/mongodb.ts';
import { PrayerRecord } from '../../../../models/Prayer.ts';
import { authenticateRequest } from '../../../../lib/auth/guard.ts';
import { getMaxAllowedDate, sanitizeNotes } from '../route.ts';
import { calculateAccountabilityFines } from '../../../../lib/accountability.ts';
import type { PrayerId, PrayerStatus } from '../../../../types/prayer.ts';

const VALID_PRAYER_IDS: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const VALID_STATUSES: PrayerStatus[] = [
  'PENDING',
  'PRAYED_ON_TIME',
  'PRAYED_LATE',
  'MISSED',
  'MADE_UP',
  'PRAYED',
];

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/prayers/[id]
 * Retrieves a single prayer record document with document-level BOLA/IDOR protection.
 */
export async function GET(request: NextRequest, props: RouteContext) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Authentication required' },
        { status: 401 }
      );
    }

    const params = await props.params;
    const { id } = params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, error: 'Invalid or missing prayer record ID' },
        { status: 400 }
      );
    }

    await connectDB();

    const record = await PrayerRecord.findById(id);
    if (!record) {
      return NextResponse.json(
        { success: false, error: 'Prayer record not found' },
        { status: 404 }
      );
    }

    // Strict ownership verification (BOLA / IDOR prevention)
    if (record.userId.toString() !== auth.user.id) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: You do not have permission to view this record' },
        { status: 403 }
      );
    }

    // Deterministically recalculate fines accrued in case overdue threshold was crossed since last write
    const currentFines = calculateAccountabilityFines(record.date, record.prayers);
    if (record.finesAccrued !== currentFines) {
      record.finesAccrued = currentFines;
      if (typeof record.save === 'function') {
        if (typeof record.markModified === 'function') {
          record.markModified('finesAccrued');
        }
        await record.save();
      }
      if (typeof PrayerRecord.updateOne === 'function') {
        await PrayerRecord.updateOne(
          { _id: record._id, userId: auth.user.id },
          { $set: { finesAccrued: currentFines } }
        );
      }
    }

    return NextResponse.json(
      {
        success: true,
        data: record,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in GET /api/prayers/[id]:', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/prayers/[id]
 * Updates a prayer record document with document-level ownership enforcement
 * and future-date modification prevention.
 */
export async function PUT(request: NextRequest, props: RouteContext) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Authentication required' },
        { status: 401 }
      );
    }

    const params = await props.params;
    const { id } = params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, error: 'Invalid or missing prayer record ID' },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Invalid request payload' },
        { status: 400 }
      );
    }

    await connectDB();

    const record = await PrayerRecord.findById(id);
    if (!record) {
      return NextResponse.json(
        { success: false, error: 'Prayer record not found' },
        { status: 404 }
      );
    }

    // Strict ownership check
    if (record.userId.toString() !== auth.user.id) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: You do not have permission to modify this record' },
        { status: 403 }
      );
    }

    // Prohibit modifying future records
    const maxDate = getMaxAllowedDate();
    if (record.date > maxDate) {
      return NextResponse.json(
        { success: false, error: 'Cannot log or modify prayer records for future dates' },
        { status: 400 }
      );
    }

    const { prayerId, status, prayers: batchPrayers, notes } = body;
    const now = new Date();
    const sanitizedNotes = sanitizeNotes(notes);

    if (batchPrayers && typeof batchPrayers === 'object' && !Array.isArray(batchPrayers)) {
      for (const pId of VALID_PRAYER_IDS) {
        const pStatus = batchPrayers[pId];
        if (pStatus && VALID_STATUSES.includes(pStatus as PrayerStatus)) {
          const norm: PrayerStatus = pStatus === 'PRAYED' ? 'PRAYED_ON_TIME' : pStatus;
          const existing = record.prayers[pId] || { status: 'PENDING' };

          if (existing.isPaid && norm !== existing.status && norm !== 'MADE_UP') {
            return NextResponse.json(
              {
                success: false,
                error: `Cannot alter settled/paid prayer '${pId}' to '${norm}'. Settled Qaza prayers may only be updated to MADE_UP.`,
                code: 'PAID_PRAYER_LOCKED',
              },
              { status: 400 }
            );
          }

          let prayedAt = existing.prayedAt;
          let missedAt = existing.missedAt;
          let madeUpAt = existing.madeUpAt;

          if (norm === 'PRAYED_ON_TIME' || norm === 'PRAYED_LATE') {
            if (!prayedAt || existing.status !== norm) prayedAt = now;
          } else if (norm === 'MISSED') {
            if (!missedAt) missedAt = now;
          } else if (norm === 'MADE_UP') {
            if (!madeUpAt) madeUpAt = now;
          }

          record.prayers[pId] = {
            status: norm,
            prayedAt,
            missedAt,
            madeUpAt,
            notes: existing.notes,
            isPaid: existing.isPaid ?? false,
            paidAt: existing.paidAt,
            paidAmount: existing.paidAmount ?? 0,
          };
        }
      }
      if (sanitizedNotes !== undefined && prayerId && VALID_PRAYER_IDS.includes(prayerId as PrayerId)) {
        if (record.prayers[prayerId as PrayerId]) {
          record.prayers[prayerId as PrayerId].notes = sanitizedNotes;
        }
      }
    } else if (prayerId && status) {
      if (!VALID_PRAYER_IDS.includes(prayerId as PrayerId)) {
        return NextResponse.json(
          { success: false, error: `Invalid prayerId. Must be one of: ${VALID_PRAYER_IDS.join(', ')}` },
          { status: 400 }
        );
      }
      if (!VALID_STATUSES.includes(status as PrayerStatus)) {
        return NextResponse.json(
          { success: false, error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
          { status: 400 }
        );
      }

      const normalizedStatus: PrayerStatus = status === 'PRAYED' ? 'PRAYED_ON_TIME' : status;
      const existing = record.prayers[prayerId as PrayerId] || { status: 'PENDING' };

      if (existing.isPaid && normalizedStatus !== existing.status && normalizedStatus !== 'MADE_UP') {
        return NextResponse.json(
          {
            success: false,
            error: `Cannot alter settled/paid prayer '${prayerId}' to '${normalizedStatus}'. Settled Qaza prayers may only be updated to MADE_UP.`,
            code: 'PAID_PRAYER_LOCKED',
          },
          { status: 400 }
        );
      }

      let prayedAt = existing.prayedAt;
      let missedAt = existing.missedAt;
      let madeUpAt = existing.madeUpAt;

      if (normalizedStatus === 'PRAYED_ON_TIME' || normalizedStatus === 'PRAYED_LATE') {
        if (!prayedAt || existing.status !== normalizedStatus) prayedAt = now;
      } else if (normalizedStatus === 'MISSED') {
        if (!missedAt) missedAt = now;
      } else if (normalizedStatus === 'MADE_UP') {
        if (!madeUpAt) madeUpAt = now;
      }

      record.prayers[prayerId as PrayerId] = {
        status: normalizedStatus,
        prayedAt,
        missedAt,
        madeUpAt,
        notes: sanitizedNotes !== undefined ? sanitizedNotes : existing.notes,
        isPaid: existing.isPaid ?? false,
        paidAt: existing.paidAt,
        paidAmount: existing.paidAmount ?? 0,
      };
    } else {
      return NextResponse.json(
        { success: false, error: 'Either (prayerId and status) or prayers map is required' },
        { status: 400 }
      );
    }

    // Recalculate fines accrued
    record.finesAccrued = calculateAccountabilityFines(record.date, record.prayers);
    await record.save();

    return NextResponse.json(
      {
        success: true,
        data: record,
        message: 'Prayer record updated successfully',
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in PUT /api/prayers/[id]:', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/prayers/[id]
 * Deletes a prayer record document with ownership verification.
 */
export async function DELETE(request: NextRequest, props: RouteContext) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Authentication required' },
        { status: 401 }
      );
    }

    const params = await props.params;
    const { id } = params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, error: 'Invalid or missing prayer record ID' },
        { status: 400 }
      );
    }

    await connectDB();

    const record = await PrayerRecord.findById(id);
    if (!record) {
      return NextResponse.json(
        { success: false, error: 'Prayer record not found' },
        { status: 404 }
      );
    }

    if (record.userId.toString() !== auth.user.id) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: You do not have permission to delete this record' },
        { status: 403 }
      );
    }

    await PrayerRecord.findByIdAndDelete(id);

    return NextResponse.json(
      {
        success: true,
        message: 'Prayer record deleted successfully',
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in DELETE /api/prayers/[id]:', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
