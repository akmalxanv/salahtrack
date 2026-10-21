import type { PrayerId, PrayerStatus, PrayerHistoryRecord } from '@/types/prayer';

export interface PayableQazaItem {
  date: string;
  prayerId: PrayerId;
  status: PrayerStatus;
  amount: number;
  totalAmount: number;
  baseAmount: number;
  overdueAmount: number;
  isOverdue: boolean;
  daysPassed: number;
}

export interface AccountabilityLedgerResult {
  totalAmount: number;
  unpaidCount: number;
  missedCount: number;
  madeUpCount: number;
  items: PayableQazaItem[];
}

export const BASE_PLEDGE_AMOUNT = 15000;
export const OVERDUE_PENALTY_AMOUNT = 15000;
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export const PRAYER_ORDER: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

/**
 * Calculates accountability fine for a daily prayer record:
 * - MISSED (Qaza): Base fine 15,000 UZS. If older than 7 days, +15,000 UZS overdue penalty (30,000 UZS).
 * - MADE_UP: Base fine 15,000 UZS without overdue penalty.
 * - Settled (isPaid: true) or PRAYED_ON_TIME / PENDING: 0 UZS.
 */
export function calculateAccountabilityFines(
  recordDateStr: string,
  prayers?: Partial<Record<PrayerId, { status: PrayerStatus; isPaid?: boolean }>> | null
): number {
  if (!prayers || typeof prayers !== 'object') return 0;
  let totalFine = 0;
  const now = Date.now();
  const recordDate = new Date(`${recordDateStr}T00:00:00Z`).getTime();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const isOverdue = !isNaN(recordDate) && now - recordDate > sevenDaysMs;

  for (const prayerId of PRAYER_ORDER) {
    const prayer = prayers[prayerId];
    if (!prayer || prayer.isPaid) continue;

    if (prayer.status === 'MISSED') {
      totalFine += BASE_PLEDGE_AMOUNT;
      if (isOverdue) {
        totalFine += OVERDUE_PENALTY_AMOUNT;
      }
    } else if (prayer.status === 'MADE_UP') {
      totalFine += BASE_PLEDGE_AMOUNT;
    }
  }

  return totalFine;
}

/**
 * Single source of truth calculation function for the Qaza Accountability Ledger.
 *
 * Rules:
 * - 7-day grace period: 7 * 24 * 60 * 60 * 1000 ms.
 * - Skips any prayer where isPaid is true.
 * - For status === 'MISSED':
 *     baseAmount: 15,000 UZS
 *     overdueAmount: diffMs > 7 days ? 15,000 UZS : 0
 *     total: baseAmount + overdueAmount
 *     unpaidCount++, missedCount++
 * - For status === 'MADE_UP':
 *     baseAmount: 15,000 UZS
 *     overdueAmount: 0 (capped, no overdue penalty)
 *     total: 15,000 UZS
 *     unpaidCount++, madeUpCount++
 */
export function calculateAccountabilityLedger(
  history: Record<string, PrayerHistoryRecord> | null | undefined,
  nowTime: number = Date.now()
): AccountabilityLedgerResult {
  if (!history || typeof history !== 'object') {
    return {
      totalAmount: 0,
      unpaidCount: 0,
      missedCount: 0,
      madeUpCount: 0,
      items: [],
    };
  }

  let totalAmount = 0;
  let unpaidCount = 0;
  let missedCount = 0;
  let madeUpCount = 0;
  const items: PayableQazaItem[] = [];

  const sortedDates = Object.keys(history).sort((a, b) => b.localeCompare(a));

  for (const date of sortedDates) {
    const record = history[date];
    if (!record || !record.prayers || typeof record.prayers !== 'object') continue;

    const recDate = new Date(`${date}T00:00:00Z`).getTime();
    const diffMs = !isNaN(recDate) ? nowTime - recDate : 0;
    const daysPassed = Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
    const isOverdue = diffMs > SEVEN_DAYS_MS;

    for (const prayerId of PRAYER_ORDER) {
      const prayer = record.prayers[prayerId];
      if (!prayer) continue;
      if (prayer.isPaid) continue;

      if (prayer.status === 'MISSED') {
        const baseAmount = BASE_PLEDGE_AMOUNT;
        const overdueAmount = isOverdue ? OVERDUE_PENALTY_AMOUNT : 0;
        const itemTotal = baseAmount + overdueAmount;

        totalAmount += itemTotal;
        unpaidCount++;
        missedCount++;

        items.push({
          date,
          prayerId,
          status: 'MISSED',
          amount: itemTotal,
          totalAmount: itemTotal,
          baseAmount,
          overdueAmount,
          isOverdue,
          daysPassed,
        });
      } else if (prayer.status === 'MADE_UP') {
        const baseAmount = BASE_PLEDGE_AMOUNT;
        const overdueAmount = 0;
        const itemTotal = baseAmount;

        totalAmount += itemTotal;
        unpaidCount++;
        madeUpCount++;

        items.push({
          date,
          prayerId,
          status: 'MADE_UP',
          amount: itemTotal,
          totalAmount: itemTotal,
          baseAmount,
          overdueAmount,
          isOverdue: false,
          daysPassed,
        });
      }
    }
  }

  return {
    totalAmount,
    unpaidCount,
    missedCount,
    madeUpCount,
    items,
  };
}
