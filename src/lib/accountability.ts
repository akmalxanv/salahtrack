/**
 * SalahTrack Authoritative Qaza Accountability & Debt Calculation Service
 *
 * Implements pure, canonical debt and fine calculations for both backend and frontend.
 *
 * Core Canonical Rules:
 * - Base Pledge Fine: 15,000 UZS per missed prayer (`BASE_PLEDGE_AMOUNT = 15000`).
 * - Overdue Penalty: 15,000 UZS (`OVERDUE_PENALTY_AMOUNT = 15000`).
 * - Overdue Threshold: A missed prayer is overdue ONLY when MORE THAN 7 full days have passed
 *   from the prayer date (`daysPassed > 7`, i.e., 8 or more days).
 *   On day 7, it is strictly within the 7-day grace period (not overdue).
 * - MADE_UP Status: baseAmount = 15,000 UZS, overdueAmount = 0 (permanently capped; no overdue fine).
 * - Paid Status (`isPaid === true`): 0 UZS outstanding debt (settled).
 * - Strict Separation:
 *   * Qaza obligations: `pendingQazaCount` = count of prayers with status === 'MISSED' (spiritual debt, regardless of payment).
 *   * Financial debt: `totalFinancialDebt` = sum of unpaid base fines + overdue penalties for MISSED and MADE_UP prayers where `!isPaid`.
 */

import type { PrayerId, PrayerStatus, SinglePrayerEntry, PrayerHistoryRecord } from '../types/prayer.ts';
import { getZonedDateParts, DEFAULT_TIMEZONE } from './prayer-cycle.ts';

export const BASE_PLEDGE_AMOUNT = 15000;
export const OVERDUE_PENALTY_AMOUNT = 15000;
export const GRACE_PERIOD_DAYS = 7;
export const SEVEN_DAYS_MS = GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;

export const PRAYER_ORDER: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

export interface PayableQazaItem {
  date: string;
  prayerId: PrayerId;
  status: PrayerStatus;
  isQazaCompleted?: boolean;
  isPaid?: boolean;
  baseAmount: number;
  overdueAmount: number;
  totalAmount: number;
  amount: number; // backward compatibility alias for totalAmount
  isOverdue: boolean;
  daysPassed: number;
  overdueReason?: string;
  paidAmount?: number;
  paidAt?: Date | string;
}

export interface AuthoritativeDebtResult {
  totalFinancialDebt: number;
  totalBaseDebt: number;
  totalOverdueDebt: number;
  pendingQazaCount: number;      // missed prayers needing make-up
  completedQazaCount: number;    // made up prayers
  settledFinancialCount: number; // paid items
  unpaidFinancialCount: number;  // unpaid items
  items: PayableQazaItem[];      // itemized breakdown
}

export interface CalculateAuthoritativeDebtOptions {
  referenceDate?: string | Date | number;
  timezone?: string;
  includeSettled?: boolean;
}

export interface AccountabilityLedgerResult {
  totalAmount: number;
  totalFinancialDebt: number;
  pendingQazaCount: number;
  unpaidCount: number;
  missedCount: number;
  madeUpCount: number;
  items: PayableQazaItem[];
}

export interface RawPrayerInput {
  status?: PrayerStatus;
  isPaid?: boolean;
  paidAmount?: number;
  paidAt?: Date | string;
  prayedAt?: Date | string;
  missedAt?: Date | string;
  madeUpAt?: Date | string;
  notes?: string;
}

export interface RawRecordInput {
  date?: string;
  prayers?: Partial<Record<PrayerId, RawPrayerInput>> | null;
}

/**
 * Calculates calendar days elapsed between prayer record date and reference date.
 * Both dates must be YYYY-MM-DD.
 * Uses UTC midnight timestamps to eliminate timezone/DST drift.
 */
export function calculateDaysPassed(recordDateStr: string, referenceDateStr: string): number {
  if (!recordDateStr || !referenceDateStr) return 0;
  const rParts = recordDateStr.split('-').map(Number);
  const tParts = referenceDateStr.split('-').map(Number);
  if (rParts.length !== 3 || tParts.length !== 3) return 0;
  const [ry, rm, rd] = rParts;
  const [ty, tm, td] = tParts;
  if (isNaN(ry) || isNaN(rm) || isNaN(rd) || isNaN(ty) || isNaN(tm) || isNaN(td)) {
    return 0;
  }
  const recUtc = Date.UTC(ry, rm - 1, rd);
  const refUtc = Date.UTC(ty, tm - 1, td);
  const diffMs = refUtc - recUtc;
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

/**
 * A missed prayer is overdue only when MORE THAN 7 full days have passed (daysPassed > 7, i.e., 8 or more days).
 * On day 7, it is within the 7-day grace period (not overdue).
 */
export function isOverduePrayer(daysPassed: number): boolean {
  return daysPassed > GRACE_PERIOD_DAYS;
}

/**
 * Normalizes any reference date input (YYYY-MM-DD, ISO string, timestamp number, or Date)
 * into a canonical YYYY-MM-DD string in the target timezone.
 */
export function resolveReferenceDateStr(
  ref?: string | Date | number,
  timezone: string = DEFAULT_TIMEZONE
): string {
  if (typeof ref === 'string') {
    const trimmed = ref.trim();
    if (/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(trimmed)) {
      return trimmed;
    }
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return getZonedDateParts(parsed, timezone).dateStr;
    }
  } else if (typeof ref === 'number' && !isNaN(ref)) {
    return getZonedDateParts(new Date(ref), timezone).dateStr;
  } else if (ref instanceof Date && !isNaN(ref.getTime())) {
    return getZonedDateParts(ref, timezone).dateStr;
  }
  return getZonedDateParts(new Date(), timezone).dateStr;
}

/**
 * Authoritative Single Source of Truth calculation function for Qaza and Financial Debt.
 *
 * Computes deterministic financial debt and separates Qaza counts across any collection of records.
 * Accepts:
 * - Array of prayer records (e.g. from MongoDB `PrayerRecord.find()`)
 * - Date-keyed dictionary (e.g. `Record<string, PrayerHistoryRecord>` from local storage or cache)
 */
export function calculateAuthoritativeDebt(
  records: RawRecordInput[] | Record<string, RawRecordInput> | null | undefined,
  options?: CalculateAuthoritativeDebtOptions
): AuthoritativeDebtResult {
  const timezone = options?.timezone || DEFAULT_TIMEZONE;
  const refDateStr = resolveReferenceDateStr(options?.referenceDate, timezone);
  const includeSettled = Boolean(options?.includeSettled);

  const emptyResult: AuthoritativeDebtResult = {
    totalFinancialDebt: 0,
    totalBaseDebt: 0,
    totalOverdueDebt: 0,
    pendingQazaCount: 0,
    completedQazaCount: 0,
    settledFinancialCount: 0,
    unpaidFinancialCount: 0,
    items: [],
  };

  if (!records || typeof records !== 'object') {
    return emptyResult;
  }

  // Normalize input records into an array of { date, prayers }
  const normalizedRecords: Array<{ date: string; prayers: Partial<Record<PrayerId, RawPrayerInput>> }> = [];

  if (Array.isArray(records)) {
    for (const rec of records) {
      if (!rec || typeof rec !== 'object') continue;
      const date = rec.date;
      if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && rec.prayers && typeof rec.prayers === 'object') {
        normalizedRecords.push({ date, prayers: rec.prayers });
      }
    }
  } else {
    for (const [key, val] of Object.entries(records)) {
      if (!val || typeof val !== 'object') continue;
      const date = (typeof val.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val.date))
        ? val.date
        : (/^\d{4}-\d{2}-\d{2}$/.test(key) ? key : '');
      if (date && val.prayers && typeof val.prayers === 'object') {
        normalizedRecords.push({ date, prayers: val.prayers });
      }
    }
  }

  // Sort records descending by date (newest first)
  normalizedRecords.sort((a, b) => b.date.localeCompare(a.date));

  let totalFinancialDebt = 0;
  let totalBaseDebt = 0;
  let totalOverdueDebt = 0;
  let pendingQazaCount = 0;
  let completedQazaCount = 0;
  let settledFinancialCount = 0;
  let unpaidFinancialCount = 0;
  const items: PayableQazaItem[] = [];

  for (const rec of normalizedRecords) {
    const daysPassed = calculateDaysPassed(rec.date, refDateStr);
    const isOverdueThreshold = isOverduePrayer(daysPassed);

    for (const prayerId of PRAYER_ORDER) {
      const prayer = rec.prayers[prayerId];
      if (!prayer || typeof prayer !== 'object' || !prayer.status) continue;

      const status = prayer.status;
      // Only MISSED and MADE_UP prayers accrue fines or represent Qaza obligations
      if (status !== 'MISSED' && status !== 'MADE_UP') {
        continue;
      }

      const isPaid = prayer.isPaid === true;
      const isQazaCompleted = status === 'MADE_UP';
      const isOverdue = status === 'MISSED' && isOverdueThreshold;

      if (status === 'MISSED') {
        pendingQazaCount++;
      } else if (status === 'MADE_UP') {
        completedQazaCount++;
      }

      if (isPaid) {
        settledFinancialCount++;
      } else {
        unpaidFinancialCount++;
      }

      let baseAmount = 0;
      let overdueAmount = 0;
      let totalAmount = 0;
      let overdueReason = '';

      if (isPaid) {
        baseAmount = 0;
        overdueAmount = 0;
        totalAmount = 0;
        overdueReason = 'Settled (isPaid)';
      } else if (status === 'MISSED') {
        baseAmount = BASE_PLEDGE_AMOUNT;
        overdueAmount = isOverdue ? OVERDUE_PENALTY_AMOUNT : 0;
        totalAmount = baseAmount + overdueAmount;
        overdueReason = isOverdue
          ? `${daysPassed} days passed (exceeds 7-day grace period)`
          : `${daysPassed} days passed (within 7-day grace period)`;

        totalBaseDebt += baseAmount;
        totalOverdueDebt += overdueAmount;
        totalFinancialDebt += totalAmount;
      } else if (status === 'MADE_UP') {
        baseAmount = BASE_PLEDGE_AMOUNT;
        overdueAmount = 0;
        totalAmount = baseAmount;
        overdueReason = 'Qaza completed; overdue penalty permanently waived';

        totalBaseDebt += baseAmount;
        totalFinancialDebt += totalAmount;
      }

      const item: PayableQazaItem = {
        date: rec.date,
        prayerId,
        status,
        isQazaCompleted,
        isPaid,
        baseAmount,
        overdueAmount,
        totalAmount,
        amount: totalAmount,
        isOverdue,
        daysPassed,
        overdueReason,
        paidAmount: prayer.paidAmount,
        paidAt: prayer.paidAt,
      };

      if (!isPaid || includeSettled) {
        items.push(item);
      }
    }
  }

  return {
    totalFinancialDebt,
    totalBaseDebt,
    totalOverdueDebt,
    pendingQazaCount,
    completedQazaCount,
    settledFinancialCount,
    unpaidFinancialCount,
    items,
  };
}

/**
 * Backward-compatible helper: calculates total accountability fine for a daily prayer record.
 * Delegates directly to the authoritative calculation engine.
 */
export function calculateAccountabilityFines(
  recordDateStr: string,
  prayers?: Partial<Record<PrayerId, { status: PrayerStatus; isPaid?: boolean }>> | null,
  referenceDate?: string | Date | number
): number {
  if (!prayers || typeof prayers !== 'object') return 0;
  const debt = calculateAuthoritativeDebt(
    [{ date: recordDateStr, prayers: prayers as Record<PrayerId, SinglePrayerEntry> }],
    { referenceDate }
  );
  return debt.totalFinancialDebt;
}

/**
 * Backward-compatible helper: calculates ledger result for a history dictionary.
 * Delegates directly to the authoritative calculation engine.
 */
export function calculateAccountabilityLedger(
  history: Record<string, PrayerHistoryRecord> | null | undefined,
  nowTime?: number | string | Date
): AccountabilityLedgerResult {
  const debt = calculateAuthoritativeDebt(history, { referenceDate: nowTime });
  return {
    totalAmount: debt.totalFinancialDebt,
    totalFinancialDebt: debt.totalFinancialDebt,
    pendingQazaCount: debt.pendingQazaCount,
    unpaidCount: debt.unpaidFinancialCount,
    missedCount: debt.pendingQazaCount,
    madeUpCount: debt.completedQazaCount,
    items: debt.items,
  };
}
