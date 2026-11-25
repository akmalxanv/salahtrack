/**
 * Server-side prayer actions shared by non-HTTP clients (the Telegram bot).
 *
 * These mirror the rules enforced by the website's Route Handlers:
 *  - PUT/POST /api/prayers            → setPrayerStatus()
 *  - POST /api/prayers/qaza-payment   → payQazaItems()
 *  - GET /api/stats                   → loadUserSummary()
 *
 * Every function takes the userId of an already-verified identity and scopes every
 * query to it (BOLA defense): callers must never pass a userId taken from user input.
 */
import mongoose from 'mongoose';
import { PrayerRecord, type IPrayerRecord, type ISinglePrayerRecord } from '../models/Prayer.ts';
import { QazaPayment } from '../models/QazaPayment.ts';
import {
  BASE_PLEDGE_AMOUNT,
  OVERDUE_PENALTY_AMOUNT,
  calculateAccountabilityFines,
  calculateAuthoritativeDebt,
  calculateDaysPassed,
  isOverduePrayer,
  type AuthoritativeDebtResult,
} from './accountability.ts';
import { calculateStreakFromHistory } from './streak.ts';
import { ensureUserRolledOver, getDateWithDayOffset, isValidCalendarDate } from './prayer-rollover.ts';
import type { PrayerId, PrayerStatus } from '../types/prayer.ts';

export const ACTION_PRAYER_IDS: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
/** Statuses a user can choose (same three choices + reset as the dashboard). */
export const SETTABLE_STATUSES: PrayerStatus[] = ['PENDING', 'PRAYED_ON_TIME', 'MADE_UP', 'MISSED'];
/** Same per-request cap as POST /api/prayers/qaza-payment. */
export const MAX_PAY_ITEMS = 500;

const COMPLETED = new Set<PrayerStatus>(['PRAYED_ON_TIME', 'PRAYED', 'PRAYED_LATE']);

export function isCompletedStatus(status: PrayerStatus | undefined): boolean {
  return Boolean(status && COMPLETED.has(status));
}

type UserId = string | mongoose.Types.ObjectId;

export type SetStatusResult =
  | { ok: true; previous: PrayerStatus; status: PrayerStatus; record: IPrayerRecord }
  | { ok: false; code: 'INVALID' | 'FUTURE_DATE' | 'PAID_PRAYER_LOCKED' };

/**
 * Sets one prayer's status for the user's own record (creating the day if needed).
 * `today` is the user's current liturgical date; later dates are rejected.
 */
export async function setPrayerStatus(
  userId: UserId,
  date: string,
  prayerId: PrayerId,
  status: PrayerStatus,
  opts: { today: string; timezone?: string }
): Promise<SetStatusResult> {
  if (!isValidCalendarDate(date) || !ACTION_PRAYER_IDS.includes(prayerId) || !SETTABLE_STATUSES.includes(status)) {
    return { ok: false, code: 'INVALID' };
  }
  if (date > opts.today) return { ok: false, code: 'FUTURE_DATE' };

  // Same lazy rollover POST /api/prayers runs before writing
  await ensureUserRolledOver(userId, opts.today, { timezone: opts.timezone, fillGapDays: false, excludeDate: date }).catch(
    (err) => console.error('[prayer-actions] rollover failed', err)
  );

  let record = await PrayerRecord.findOne({ userId, date });
  if (!record) {
    try {
      record = await PrayerRecord.create({ userId, date, finesAccrued: 0 });
    } catch (err) {
      // Another request created the day concurrently: use that document
      if ((err as { code?: number })?.code !== 11000) throw err;
      record = await PrayerRecord.findOne({ userId, date });
      if (!record) throw err;
    }
  }

  const existing: ISinglePrayerRecord = record.prayers?.[prayerId] ?? { status: 'PENDING' };
  // Settled (paid) qaza may only move to MADE_UP, exactly like the API routes
  if (existing.isPaid && status !== existing.status && status !== 'MADE_UP') {
    return { ok: false, code: 'PAID_PRAYER_LOCKED' };
  }

  const now = new Date();
  let { prayedAt, missedAt, madeUpAt } = existing;
  if (status === 'PRAYED_ON_TIME') {
    if (!prayedAt || existing.status !== status) prayedAt = now;
  } else if (status === 'MISSED') {
    if (!missedAt) missedAt = now;
  } else if (status === 'MADE_UP') {
    if (!madeUpAt) madeUpAt = now;
  }

  record.prayers[prayerId] = {
    status,
    prayedAt,
    missedAt,
    madeUpAt,
    notes: existing.notes,
    isPaid: existing.isPaid ?? false,
    paidAt: existing.paidAt,
    paidAmount: existing.paidAmount ?? 0,
  };
  record.markModified(`prayers.${prayerId}`);
  record.finesAccrued = calculateAccountabilityFines(record.date, record.prayers);
  await record.save();

  return { ok: true, previous: existing.status, status, record };
}

export interface PaidItem {
  date: string;
  prayerId: PrayerId;
  status: PrayerStatus;
  amount: number;
  isOverdue: boolean;
}

export interface PayResult {
  paid: PaidItem[];
  totalAmount: number;
  /** Items that were not payable (already paid, not a qaza, or unknown). */
  skipped: number;
}

/** Fine owed for one unpaid qaza on `today` (same rule as the payment route). */
export function qazaAmount(status: PrayerStatus, date: string, today: string): { amount: number; isOverdue: boolean } {
  const isOverdue = status === 'MISSED' && isOverduePrayer(calculateDaysPassed(date, today));
  return { amount: BASE_PLEDGE_AMOUNT + (isOverdue ? OVERDUE_PENALTY_AMOUNT : 0), isOverdue };
}

/**
 * Marks the given MISSED / MADE_UP prayers as paid and writes a QazaPayment receipt.
 *
 * Each prayer is flipped with a conditional update (`isPaid != true`), so a double tap
 * or a concurrent payment from the website can never charge the same prayer twice.
 * The status stays as it is: paying a fine is separate from making up the prayer.
 */
export async function payQazaItems(
  userId: UserId,
  items: { date: string; prayerId: PrayerId }[],
  opts: { today: string; note?: string }
): Promise<PayResult> {
  const unique = new Map<string, { date: string; prayerId: PrayerId }>();
  for (const it of items.slice(0, MAX_PAY_ITEMS)) {
    if (isValidCalendarDate(it.date) && ACTION_PRAYER_IDS.includes(it.prayerId)) unique.set(`${it.date}:${it.prayerId}`, it);
  }
  const list = [...unique.values()];
  const result: PayResult = { paid: [], totalAmount: 0, skipped: items.length - list.length };
  if (list.length === 0) return result;

  const records = await PrayerRecord.find({ userId, date: { $in: [...new Set(list.map((i) => i.date))] } })
    .select('_id date prayers')
    .lean();
  const byDate = new Map(records.map((r) => [r.date, r]));
  const now = new Date();
  const touched = new Set<string>();
  const receipt: (PaidItem & { prayerRecordId: mongoose.Types.ObjectId })[] = [];

  for (const it of list) {
    const rec = byDate.get(it.date);
    const prayer = rec?.prayers?.[it.prayerId];
    if (!rec || !prayer || prayer.isPaid || (prayer.status !== 'MISSED' && prayer.status !== 'MADE_UP')) {
      result.skipped++;
      continue;
    }
    const { amount, isOverdue } = qazaAmount(prayer.status, it.date, opts.today);
    const update = await PrayerRecord.updateOne(
      {
        _id: rec._id,
        userId,
        [`prayers.${it.prayerId}.status`]: prayer.status,
        [`prayers.${it.prayerId}.isPaid`]: { $ne: true },
      },
      {
        $set: {
          [`prayers.${it.prayerId}.isPaid`]: true,
          [`prayers.${it.prayerId}.paidAt`]: now,
          [`prayers.${it.prayerId}.paidAmount`]: amount,
        },
      }
    );
    if (update.modifiedCount !== 1) {
      result.skipped++;
      continue;
    }
    touched.add(rec._id.toString());
    const paid = { date: it.date, prayerId: it.prayerId, status: prayer.status, amount, isOverdue };
    result.paid.push(paid);
    receipt.push({ ...paid, prayerRecordId: rec._id });
    result.totalAmount += amount;
  }

  // Receipt first: the per-day finesAccrued below is only a cache that every read recomputes,
  // so a failure there must not cost us the audit record. (Not a transaction: Mongo
  // transactions need a replica set, and the website's payment route has the same ordering.)
  if (receipt.length > 0) {
    try {
      await QazaPayment.create({ userId, items: receipt, totalAmount: result.totalAmount, note: opts.note?.slice(0, 300) });
    } catch (err) {
      console.error('[prayer-actions] QazaPayment receipt FAILED after marking paid', { userId: String(userId), receipt }, err);
      throw err;
    }
  }

  // Paid prayers no longer accrue: refresh the cached per-day total
  for (const id of touched) {
    const rec = await PrayerRecord.findOne({ _id: id, userId }).select('date prayers').lean();
    if (rec) {
      await PrayerRecord.updateOne({ _id: id, userId }, { $set: { finesAccrued: calculateAccountabilityFines(rec.date, rec.prayers) } }).catch(
        (err) => console.error('[prayer-actions] finesAccrued refresh failed', err)
      );
    }
  }
  return result;
}

export interface UserSummary {
  debt: AuthoritativeDebtResult;
  today: Record<PrayerId, ISinglePrayerRecord> | null;
  streak: { current: number; best: number };
  weekly: { completed: number; percentage: number };
  monthly: { completed: number; percentage: number };
}

/**
 * Today's record, debt and stats for one user, after the same rollover the dashboard runs
 * (past unmarked prayers → MISSED, untracked gap days filled), so numbers match the website.
 */
export async function loadUserSummary(userId: UserId, opts: { today: string; timezone?: string }): Promise<UserSummary> {
  await ensureUserRolledOver(userId, opts.today, { timezone: opts.timezone, fillGapDays: true }).catch((err) =>
    console.error('[prayer-actions] rollover failed', err)
  );

  const records = await PrayerRecord.find({ userId, date: { $lte: opts.today } })
    .select('date prayers')
    .lean();

  const weekStart = getDateWithDayOffset(opts.today, -6);
  const monthStart = getDateWithDayOffset(opts.today, -29);
  let weekly = 0;
  let monthly = 0;
  const streakMap = new Map<string, number>();
  let today: UserSummary['today'] = null;

  for (const r of records) {
    let completed = 0;
    for (const p of ACTION_PRAYER_IDS) if (isCompletedStatus(r.prayers?.[p]?.status)) completed++;
    streakMap.set(r.date, completed === 5 ? 5 : 0);
    if (r.date >= monthStart) monthly += completed;
    if (r.date >= weekStart) weekly += completed;
    if (r.date === opts.today) today = r.prayers;
  }

  const streak = calculateStreakFromHistory(streakMap, opts.today);
  return {
    debt: calculateAuthoritativeDebt(records, { referenceDate: opts.today, timezone: opts.timezone }),
    today,
    streak: { current: streak.current, best: streak.best },
    weekly: { completed: weekly, percentage: Math.round((weekly / 35) * 100) },
    monthly: { completed: monthly, percentage: Math.round((monthly / 150) * 100) },
  };
}
