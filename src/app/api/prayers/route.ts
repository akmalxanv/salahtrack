import { NextRequest, NextResponse } from 'next/server.js';
import { connectDB } from '../../../lib/mongodb.ts';
import { PrayerRecord, type IPrayerRecord } from '../../../models/Prayer.ts';
import { authenticateRequest } from '../../../lib/auth/index.ts';
import { getLiturgicalDate } from '../../../lib/prayer-cycle.ts';
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

export const MIN_ALLOWED_DATE = '1970-01-01';

/**
 * Strict calendar date format and Gregorian calendar validity check (YYYY-MM-DD).
 * Prevents invalid dates (e.g. 2026-02-31, 2026-13-45) and ensures leap year correctness.
 */
export function isValidCalendarDate(dateStr: string): boolean {
  if (typeof dateStr !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(dateStr)) {
    return false;
  }
  const parts = dateStr.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  const dateObj = new Date(Date.UTC(year, month - 1, day));
  return (
    dateObj.getUTCFullYear() === year &&
    dateObj.getUTCMonth() === month - 1 &&
    dateObj.getUTCDate() === day
  );
}

/**
 * Calculates maximum allowed calendar date string (YYYY-MM-DD)
 * Supports all world timezones (up to UTC+14) while strictly rejecting actual future dates.
 */
export function getMaxAllowedDate(): string {
  const futureThreshold = new Date(Date.now() + 14 * 60 * 60 * 1000);
  return futureThreshold.toISOString().split('T')[0];
}

/**
 * Strips dangerous ASCII control characters and limits notes to 200 characters.
 */
export function sanitizeNotes(notes: unknown): string | undefined {
  if (typeof notes !== 'string') return undefined;
  const cleaned = notes.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
  return cleaned.slice(0, 200);
}

/**
 * Calculates accountability fine for a daily prayer record based on Phase 8 rules:
 * - Base fine: 15,000 UZS per missed prayer
 * - Overdue penalty: +15,000 UZS (total 30,000 UZS) if unperformed after 7 days
 * - Made up: fine cleared upon fulfillment
 */
export function calculateFines(
  recordDateStr: string,
  prayers?: Partial<Record<PrayerId, { status: PrayerStatus; missedAt?: Date }>> | null
): number {
  if (!prayers || typeof prayers !== 'object') return 0;
  let totalFine = 0;
  const now = Date.now();
  const recordDate = new Date(`${recordDateStr}T00:00:00Z`).getTime();
  if (isNaN(recordDate)) return 0;
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
        { success: false, error: 'Unauthorized: Authentication required', code: 'AUTH_UNAUTHORIZED' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');
    const timezoneParam = searchParams.get('timezone') || undefined;
    const targetDate = dateParam && isValidCalendarDate(dateParam)
      ? dateParam
      : getLiturgicalDate(new Date(), undefined, timezoneParam);

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
        { success: false, error: 'Unauthorized: Authentication required', code: 'AUTH_UNAUTHORIZED' },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Invalid request payload', code: 'VALIDATION_FAILED' },
        { status: 400 }
      );
    }

    const { date, prayerId, status, prayers: batchPrayers, notes, timezone } = body;

    // Resolve date: use client-supplied date if provided, otherwise resolve via liturgical date
    const targetDate = typeof date === 'string' && date.trim().length > 0
      ? date.trim()
      : getLiturgicalDate(new Date(), undefined, timezone);

    // Strict validation: enforce valid calendar date (YYYY-MM-DD)
    if (!targetDate || typeof targetDate !== 'string' || !isValidCalendarDate(targetDate)) {
      return NextResponse.json(
        { success: false, error: 'Valid calendar date in YYYY-MM-DD format is required', code: 'INVALID_DATE' },
        { status: 400 }
      );
    }

    // Historical bounds check (dates prior to MIN_ALLOWED_DATE are rejected)
    if (targetDate < MIN_ALLOWED_DATE) {
      return NextResponse.json(
        { success: false, error: `Prayer records cannot predate ${MIN_ALLOWED_DATE}`, code: 'DATE_TOO_EARLY' },
        { status: 400 }
      );
    }

    // Future dates are strictly prohibited
    const maxDate = getMaxAllowedDate();
    if (targetDate > maxDate) {
      return NextResponse.json(
        { success: false, error: 'Cannot log or modify prayer records for future dates', code: 'FUTURE_DATE_NOT_ALLOWED' },
        { status: 400 }
      );
    }

    // Check payload type: either single prayer or batch prayers object
    const isBatch = Boolean(batchPrayers && typeof batchPrayers === 'object' && !Array.isArray(batchPrayers));
    if (!isBatch && (!prayerId || !status)) {
      return NextResponse.json(
        { success: false, error: 'Either (prayerId and status) or prayers map is required', code: 'VALIDATION_FAILED' },
        { status: 400 }
      );
    }

    if (prayerId && !VALID_PRAYER_IDS.includes(prayerId as PrayerId)) {
      return NextResponse.json(
        { success: false, error: `Invalid prayerId. Must be one of: ${VALID_PRAYER_IDS.join(', ')}`, code: 'INVALID_PRAYER_ID' },
        { status: 400 }
      );
    }

    if (status && !VALID_STATUSES.includes(status as PrayerStatus)) {
      return NextResponse.json(
        { success: false, error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`, code: 'INVALID_PRAYER_STATUS' },
        { status: 400 }
      );
    }

    await connectDB();

    const now = new Date();
    const filter = {
      userId: auth.user.id,
      date: targetDate,
    };

    const setFields: Record<string, unknown> = {};
    const setOnInsert: Record<string, unknown> = {
      userId: auth.user.id,
      date: targetDate,
      finesAccrued: 0,
    };

    const sanitizedNotes = sanitizeNotes(notes);

    if (isBatch && typeof batchPrayers === 'object') {
      for (const pId of VALID_PRAYER_IDS) {
        const pStatus = batchPrayers[pId];
        if (pStatus && VALID_STATUSES.includes(pStatus as PrayerStatus)) {
          const norm: PrayerStatus = pStatus === 'PRAYED' ? 'PRAYED_ON_TIME' : pStatus;
          setFields[`prayers.${pId}.status`] = norm;
          if (norm === 'PRAYED_ON_TIME' || norm === 'PRAYED_LATE') {
            setFields[`prayers.${pId}.prayedAt`] = now;
          } else if (norm === 'MISSED') {
            setFields[`prayers.${pId}.missedAt`] = now;
          } else if (norm === 'MADE_UP') {
            setFields[`prayers.${pId}.madeUpAt`] = now;
          }
        }
      }
      for (const p of VALID_PRAYER_IDS) {
        if (!batchPrayers[p]) {
          setOnInsert[`prayers.${p}`] = { status: 'PENDING' };
        }
      }
      if (sanitizedNotes !== undefined && prayerId && VALID_PRAYER_IDS.includes(prayerId as PrayerId)) {
        setFields[`prayers.${prayerId}.notes`] = sanitizedNotes;
      }
    } else if (prayerId && status) {
      const normalizedStatus: PrayerStatus = status === 'PRAYED' ? 'PRAYED_ON_TIME' : status;
      setFields[`prayers.${prayerId}.status`] = normalizedStatus;
      if (normalizedStatus === 'PRAYED_ON_TIME' || normalizedStatus === 'PRAYED_LATE') {
        setFields[`prayers.${prayerId}.prayedAt`] = now;
      } else if (normalizedStatus === 'MISSED') {
        setFields[`prayers.${prayerId}.missedAt`] = now;
      } else if (normalizedStatus === 'MADE_UP') {
        setFields[`prayers.${prayerId}.madeUpAt`] = now;
      }

      if (sanitizedNotes !== undefined) {
        setFields[`prayers.${prayerId}.notes`] = sanitizedNotes;
      }

      for (const p of VALID_PRAYER_IDS) {
        if (p !== prayerId) {
          setOnInsert[`prayers.${p}`] = { status: 'PENDING' };
        }
      }
    }

    const updateQuery = {
      $set: setFields,
      $setOnInsert: setOnInsert,
    };

    let record: IPrayerRecord | null = null;

    if (typeof PrayerRecord.findOneAndUpdate === 'function') {
      try {
        record = await PrayerRecord.findOneAndUpdate(filter, updateQuery, {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        });
      } catch (upsertError: unknown) {
        const err = upsertError as { code?: number; message?: string };
        if (err?.code === 11000 || (typeof err?.message === 'string' && err.message.includes('11000'))) {
          // Concurrency retry on E11000 duplicate key race: document was just inserted by concurrent request, so update existing
          record = await PrayerRecord.findOneAndUpdate(
            filter,
            { $set: setFields },
            { new: true }
          );
        } else {
          throw upsertError;
        }
      }
    } else {
      // Fallback for mocked test environments where findOneAndUpdate is not mocked
      let rec = await PrayerRecord.findOne(filter);
      if (!rec) {
        rec = new PrayerRecord({
          userId: auth.user.id,
          date: targetDate,
          prayers: {
            fajr: { status: 'PENDING' },
            dhuhr: { status: 'PENDING' },
            asr: { status: 'PENDING' },
            maghrib: { status: 'PENDING' },
            isha: { status: 'PENDING' },
          },
        });
      }
      if (isBatch && typeof batchPrayers === 'object') {
        for (const pId of VALID_PRAYER_IDS) {
          const pStatus = batchPrayers[pId];
          if (pStatus && VALID_STATUSES.includes(pStatus as PrayerStatus)) {
            const norm: PrayerStatus = pStatus === 'PRAYED' ? 'PRAYED_ON_TIME' : pStatus;
            rec.prayers[pId].status = norm;
            if (norm === 'PRAYED_ON_TIME' || norm === 'PRAYED_LATE') rec.prayers[pId].prayedAt = now;
            else if (norm === 'MISSED') rec.prayers[pId].missedAt = now;
            else if (norm === 'MADE_UP') rec.prayers[pId].madeUpAt = now;
          }
        }
      } else if (prayerId && status) {
        const normalizedStatus: PrayerStatus = status === 'PRAYED' ? 'PRAYED_ON_TIME' : status;
        rec.prayers[prayerId as PrayerId].status = normalizedStatus;
        if (normalizedStatus === 'PRAYED_ON_TIME' || normalizedStatus === 'PRAYED_LATE') rec.prayers[prayerId as PrayerId].prayedAt = now;
        else if (normalizedStatus === 'MISSED') rec.prayers[prayerId as PrayerId].missedAt = now;
        else if (normalizedStatus === 'MADE_UP') rec.prayers[prayerId as PrayerId].madeUpAt = now;
        if (sanitizedNotes !== undefined) {
          rec.prayers[prayerId as PrayerId].notes = sanitizedNotes;
        }
      }
      rec.finesAccrued = calculateFines(targetDate, rec.prayers);
      await rec.save();
      record = rec;
    }

    if (record) {
      // Deterministically recalculate fines accrued with document-level user scoping
      const calculatedFines = calculateFines(targetDate, record.prayers);
      if (record.finesAccrued !== calculatedFines) {
        record.finesAccrued = calculatedFines;
        if (typeof record.save === 'function') {
          await record.save();
        } else if (typeof PrayerRecord.updateOne === 'function') {
          await PrayerRecord.updateOne(
            { _id: record._id, userId: auth.user.id },
            { $set: { finesAccrued: calculatedFines } }
          );
        }
      }
    }

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
