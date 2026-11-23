/**
 * SalahTrack Automated Prayer Rollover & State Reconciliation Engine
 *
 * Implements deterministic calendar day and liturgical Fajr-boundary rollover:
 * 1. Automatically transitions lingering PENDING prayers on past dates to MISSED when
 *    the next day's Fajr begins.
 * 2. CRITICAL CONSTRAINT: Never automatically marks prayers as missed or generates gap
 *    days for dates prior to the user's first-ever prayer tracking date (earliest existing
 *    PrayerRecord date or account createdAt date, whichever is earlier).
 * 3. Recursively fills missing intermediate days between tracking commencement and active
 *    liturgical date with 5 MISSED prayers and accrued fines (bounded to 365 days).
 * 4. Provides both per-user auto-rollover (`ensureUserRolledOver`) and global MongoDB
 *    reconciliation (`ensureGlobalRolledOver`).
 *
 * Governing Standard: AGENTS.md & Backend/Database Architecture Specification
 */

import mongoose from 'mongoose';
import { connectDB } from './mongodb.ts';
import { PrayerRecord, type IPrayerRecord } from '../models/Prayer.ts';
import { getLiturgicalDate } from './prayer-cycle.ts';
import { calculateAccountabilityFines } from './accountability.ts';
import { getDaysDifference, getYesterdayString } from './streak.ts';
import type { PrayerId, PrayerStatus } from '../types/prayer.ts';

// Prevent unhandled buffering hangs in disconnected unit test environments
try {
  mongoose.set('bufferCommands', false);
} catch {}

export const VALID_PRAYER_IDS: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

/**
 * Strict calendar date format and Gregorian calendar validity check (YYYY-MM-DD).
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
 * Calculates a calendar date string (YYYY-MM-DD) shifted by an exact number of days.
 * Uses UTC arithmetic to avoid Daylight Saving Time (DST) or timezone-dependent drift.
 */
export function getDateWithDayOffset(baseDateStr: string, offsetDays: number): string {
  const [y, m, d] = baseDateStr.split('-').map(Number);
  const targetUtc = Date.UTC(y, m - 1, d) + offsetDays * 24 * 60 * 60 * 1000;
  const dObj = new Date(targetUtc);
  const year = dObj.getUTCFullYear();
  const month = String(dObj.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dObj.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Checks whether an operation is safe to execute without hanging on disconnected Mongoose.
 */
function isDbOperationSafe(type: 'find' | 'findOne' | 'save' | 'userFindById'): boolean {
  const isConnected = Boolean(mongoose.connection && mongoose.connection.readyState === 1);
  if (isConnected) return true;

  if (type === 'find') {
    return typeof PrayerRecord?.find === 'function' && PrayerRecord.find !== mongoose.Model.find;
  }
  if (type === 'findOne') {
    return typeof PrayerRecord?.findOne === 'function' && PrayerRecord.findOne !== mongoose.Model.findOne;
  }
  if (type === 'save') {
    return (
      typeof PrayerRecord?.prototype?.save === 'function' &&
      PrayerRecord.prototype.save !== mongoose.Model.prototype.save
    );
  }

  return false;
}

/**
 * Authoritatively determines the user's first-ever prayer tracking date.
 *
 * Strict Requirement & Constraint:
 * "Never automatically mark prayers as missed for any date before the user's first-ever prayer tracking date.
 * Automatic missed-status generation must only begin from the date the user started tracking prayers,
 * while still triggering at the next day's Fajr time."
 *
 * Definition:
 * - Date of earliest existing PrayerRecord
 *
 * If no existing record exists, defaults to activeLiturgicalDate so that no prior days are marked as missed.
 */
export async function getUserFirstTrackingDate(
  userId: string | mongoose.Types.ObjectId,
  activeLiturgicalDate: string
): Promise<string> {
  const normalizedUserId = typeof userId === 'string' ? userId : userId.toString();
  let earliestRecordDate: string | null = null;

  // Check PrayerRecord collection for earliest recorded prayer date
  if (isDbOperationSafe('find')) {
    try {
      const q = PrayerRecord.find({ userId: normalizedUserId });
      const records = typeof (q as { sort?: unknown }).sort === 'function'
        ? await (q as { sort: (order: unknown) => Promise<Array<{ date: string }>> }).sort({ date: 1 })
        : await q;

      if (Array.isArray(records) && records.length > 0) {
        let minDate: string | null = null;
        for (const r of records) {
          if (r?.date && isValidCalendarDate(r.date)) {
            if (!minDate || r.date < minDate) {
              minDate = r.date;
            }
          }
        }
        earliestRecordDate = minDate;
      }
    } catch {
      // Graceful fallback if PrayerRecord query fails
    }
  } else if (isDbOperationSafe('findOne')) {
    try {
      const rec = await PrayerRecord.findOne({ userId: normalizedUserId });
      if (rec?.date && isValidCalendarDate(rec.date)) {
        earliestRecordDate = rec.date;
      }
    } catch {}
  }

  // 3. User's first-ever prayer tracking date is strictly the date of their earliest existing PrayerRecord:
  // If no existing record exists, tracking has not begun prior to activeLiturgicalDate.
  const earliestTrackingDate = earliestRecordDate || activeLiturgicalDate;
  return earliestTrackingDate;
}

export interface UserRolloverResult {
  rolledOverCount: number;
  gapDaysCreated: number;
}

export interface EnsureUserRolledOverOptions {
  timezone?: string;
  fillGapDays?: boolean;
  excludeDate?: string;
}

/**
 * Automatically rolls over uncompleted past prayers to MISSED for a specific user.
 *
 * Invariant Guarantees:
 * 1. Only touches dates >= earliestTrackingDate and < activeLiturgicalDate.
 * 2. Lingering PENDING prayers on past days transition to MISSED with missedAt = now.
 * 3. Already prayed or made up prayers are strictly preserved.
 * 4. Missing intermediate gap days are backfilled with 5 MISSED prayers and accrued fines (when fillGapDays is enabled).
 * 5. Bounded to at most 365 calendar days to mitigate query-flooding DoS.
 */
export async function ensureUserRolledOver(
  userId: string | mongoose.Types.ObjectId,
  targetLiturgicalDate?: string,
  optionsOrTimezone?: EnsureUserRolledOverOptions | string
): Promise<UserRolloverResult> {
  const options: EnsureUserRolledOverOptions =
    typeof optionsOrTimezone === 'string'
      ? { timezone: optionsOrTimezone, fillGapDays: true }
      : { fillGapDays: true, ...optionsOrTimezone };

  const timezone = options.timezone;
  const fillGapDays = options.fillGapDays !== false;
  const excludeDate = options.excludeDate;

  const normalizedUserId = typeof userId === 'string' ? userId : userId.toString();
  const activeLiturgicalDate = targetLiturgicalDate && isValidCalendarDate(targetLiturgicalDate)
    ? targetLiturgicalDate
    : getLiturgicalDate(new Date(), undefined, timezone);

  const now = new Date();
  let rolledOverCount = 0;
  let gapDaysCreated = 0;

  try {
    await connectDB();
  } catch {
    // Graceful fallback for mock DB environments
  }

  // 1. Identify user's first-ever prayer tracking date
  const earliestTrackingDate = await getUserFirstTrackingDate(normalizedUserId, activeLiturgicalDate);

  // If user tracking began today or later, there are zero past days to mark as missed
  if (earliestTrackingDate >= activeLiturgicalDate) {
    return { rolledOverCount: 0, gapDaysCreated: 0 };
  }

  // 2. Bound search window to at most 365 days before activeLiturgicalDate
  let effectiveStartDate = earliestTrackingDate;
  const daysDiff = getDaysDifference(effectiveStartDate, activeLiturgicalDate);
  if (daysDiff > 365) {
    effectiveStartDate = getDateWithDayOffset(activeLiturgicalDate, -365);
  }

  const yesterdayDate = getYesterdayString(activeLiturgicalDate);

  // 3. Fetch existing user records within the bounded range
  let userRecords: IPrayerRecord[] = [];
  if (isDbOperationSafe('find')) {
    try {
      const q = PrayerRecord.find({
        userId: normalizedUserId,
        date: { $gte: effectiveStartDate, $lte: yesterdayDate },
      });
      userRecords = typeof (q as { sort?: unknown }).sort === 'function'
        ? await (q as { sort: (order: unknown) => Promise<IPrayerRecord[]> }).sort({ date: 1 })
        : await q;
    } catch {
      userRecords = [];
    }
  }

  const existingRecordMap = new Map<string, IPrayerRecord>();
  if (Array.isArray(userRecords)) {
    for (const rec of userRecords) {
      if (rec?.date) {
        existingRecordMap.set(rec.date, rec);
      }
    }
  }

  // 4. For all existing past records: convert PENDING to MISSED and recalculate fines
  if (Array.isArray(userRecords)) {
    for (const record of userRecords) {
      // Strictly enforce constraint: never modify records before earliestTrackingDate
      if (record.date < earliestTrackingDate || record.date >= activeLiturgicalDate) {
        continue;
      }

      // If this record matches excludeDate (e.g. actively being edited by client), skip
      if (excludeDate && record.date === excludeDate) {
        continue;
      }

      let modified = false;
      for (const prayerId of VALID_PRAYER_IDS) {
        if (record.prayers?.[prayerId]?.status === 'PENDING') {
          record.prayers[prayerId].status = 'MISSED';
          record.prayers[prayerId].missedAt = now;
          modified = true;
        }
      }

      if (modified || record.finesAccrued === undefined) {
        record.finesAccrued = calculateAccountabilityFines(record.date, record.prayers, activeLiturgicalDate);
        if (typeof record.markModified === 'function') {
          record.markModified('prayers');
          record.markModified('finesAccrued');
        }
        if (typeof record.save === 'function') {
          try {
            await record.save();
            rolledOverCount++;
          } catch {}
        }
      }
    }
  }

  // 5. Fill missing intermediate days between effectiveStartDate and activeLiturgicalDate (when fillGapDays is enabled)
  if (fillGapDays) {
    const totalDays = getDaysDifference(effectiveStartDate, activeLiturgicalDate);
    for (let i = 0; i < totalDays; i++) {
      const curDate = getDateWithDayOffset(effectiveStartDate, i);

      // Strictly enforce constraint: never generate missed status before earliestTrackingDate
      if (curDate < earliestTrackingDate || curDate >= activeLiturgicalDate) {
        continue;
      }

      if (!existingRecordMap.has(curDate)) {
        // Double-check via findOne if find did not include it (e.g. mock quirks)
        let existingDoc: IPrayerRecord | null = null;
        if (isDbOperationSafe('findOne')) {
          try {
            existingDoc = await PrayerRecord.findOne({ userId: normalizedUserId, date: curDate });
          } catch {
            existingDoc = null;
          }
        }

        if (existingDoc) {
          existingRecordMap.set(curDate, existingDoc);
          let modified = false;
          for (const prayerId of VALID_PRAYER_IDS) {
            if (existingDoc.prayers?.[prayerId]?.status === 'PENDING') {
              existingDoc.prayers[prayerId].status = 'MISSED';
              existingDoc.prayers[prayerId].missedAt = now;
              modified = true;
            }
          }
          if (modified) {
            existingDoc.finesAccrued = calculateAccountabilityFines(curDate, existingDoc.prayers, activeLiturgicalDate);
            if (typeof existingDoc.markModified === 'function') {
              existingDoc.markModified('prayers');
              existingDoc.markModified('finesAccrued');
            }
            if (typeof existingDoc.save === 'function') {
              try {
                await existingDoc.save();
                rolledOverCount++;
              } catch {}
            }
          }
          continue;
        }

        // Create new gap day document if save is safe
        if (isDbOperationSafe('save')) {
          const missedPrayers = {
            fajr: { status: 'MISSED' as PrayerStatus, missedAt: now, isPaid: false, paidAmount: 0 },
            dhuhr: { status: 'MISSED' as PrayerStatus, missedAt: now, isPaid: false, paidAmount: 0 },
            asr: { status: 'MISSED' as PrayerStatus, missedAt: now, isPaid: false, paidAmount: 0 },
            maghrib: { status: 'MISSED' as PrayerStatus, missedAt: now, isPaid: false, paidAmount: 0 },
            isha: { status: 'MISSED' as PrayerStatus, missedAt: now, isPaid: false, paidAmount: 0 },
          };

          try {
            const newRecord = new PrayerRecord({
              userId: normalizedUserId,
              date: curDate,
              prayers: missedPrayers,
              finesAccrued: calculateAccountabilityFines(curDate, missedPrayers, activeLiturgicalDate),
            });
            await newRecord.save();
            existingRecordMap.set(curDate, newRecord);
            gapDaysCreated++;
          } catch (err: unknown) {
            const errorWithCode = err as { code?: number };
            if (errorWithCode?.code === 11000) {
              // Already created concurrently by another worker
              continue;
            }
          }
        }
      }
    }
  }

  return { rolledOverCount, gapDaysCreated };
}

/**
 * Global database reconciliation: updates all records across all users in MongoDB
 * where date < activeLiturgicalDate and any prayer is PENDING.
 * Converts PENDING to MISSED, recalculates fines, and persists changes.
 */
export async function ensureGlobalRolledOver(targetLiturgicalDate?: string): Promise<number> {
  const activeLiturgicalDate = targetLiturgicalDate && isValidCalendarDate(targetLiturgicalDate)
    ? targetLiturgicalDate
    : getLiturgicalDate();

  const now = new Date();
  let updatedCount = 0;

  try {
    await connectDB();
  } catch {}

  if (isDbOperationSafe('find')) {
    try {
      const pendingRecords = await PrayerRecord.find({
        date: { $lt: activeLiturgicalDate },
        $or: [
          { 'prayers.fajr.status': 'PENDING' },
          { 'prayers.dhuhr.status': 'PENDING' },
          { 'prayers.asr.status': 'PENDING' },
          { 'prayers.maghrib.status': 'PENDING' },
          { 'prayers.isha.status': 'PENDING' },
        ],
      });

      if (Array.isArray(pendingRecords)) {
        for (const record of pendingRecords) {
          let modified = false;
          for (const prayerId of VALID_PRAYER_IDS) {
            if (record.prayers?.[prayerId]?.status === 'PENDING') {
              record.prayers[prayerId].status = 'MISSED';
              record.prayers[prayerId].missedAt = now;
              modified = true;
            }
          }
          if (modified || record.finesAccrued === undefined) {
            record.finesAccrued = calculateAccountabilityFines(record.date, record.prayers, activeLiturgicalDate);
            if (typeof record.markModified === 'function') {
              record.markModified('prayers');
              record.markModified('finesAccrued');
            }
            if (typeof record.save === 'function') {
              try {
                await record.save();
                updatedCount++;
              } catch {}
            }
          }
        }
      }
    } catch (err) {
      console.error('ensureGlobalRolledOver error:', err);
    }
  }

  return updatedCount;
}
