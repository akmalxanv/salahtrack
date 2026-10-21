import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateAccountabilityLedger, calculateAuthoritativeDebt } from '../../src/lib/accountability.ts';
import type { PrayerHistoryRecord } from '../../src/types/prayer.ts';

describe('Accountability Ledger Single Source of Truth Engine', () => {
  const FIXED_NOW = new Date('2026-10-21T12:00:00Z').getTime();

  it('handles null, undefined, and empty history gracefully', () => {
    const resNull = calculateAccountabilityLedger(null, FIXED_NOW);
    assert.equal(resNull.totalAmount, 0);
    assert.equal(resNull.unpaidCount, 0);
    assert.equal(resNull.missedCount, 0);
    assert.equal(resNull.madeUpCount, 0);
    assert.deepEqual(resNull.items, []);

    const resEmpty = calculateAccountabilityLedger({}, FIXED_NOW);
    assert.equal(resEmpty.totalAmount, 0);
    assert.equal(resEmpty.unpaidCount, 0);
  });

  it('skips prayers that are already marked as isPaid', () => {
    const history: Record<string, PrayerHistoryRecord> = {
      '2026-10-20': {
        date: '2026-10-20',
        finesAccrued: 0,
        prayers: {
          fajr: { status: 'MISSED', isPaid: true, paidAmount: 15000 },
          dhuhr: { status: 'MADE_UP', isPaid: true, paidAmount: 15000 },
          asr: { status: 'PRAYED_ON_TIME' },
          maghrib: { status: 'PRAYED_ON_TIME' },
          isha: { status: 'PRAYED_ON_TIME' },
        },
      },
    };

    const res = calculateAccountabilityLedger(history, FIXED_NOW);
    assert.equal(res.totalAmount, 0);
    assert.equal(res.unpaidCount, 0);
    assert.equal(res.items.length, 0);
  });

  it('calculates base 15,000 UZS for recent MISSED prayers within 7-day grace period', () => {
    // 2 days ago
    const history: Record<string, PrayerHistoryRecord> = {
      '2026-10-19': {
        date: '2026-10-19',
        finesAccrued: 15000,
        prayers: {
          fajr: { status: 'MISSED' },
          dhuhr: { status: 'PRAYED_ON_TIME' },
          asr: { status: 'PRAYED_ON_TIME' },
          maghrib: { status: 'PRAYED_ON_TIME' },
          isha: { status: 'PRAYED_ON_TIME' },
        },
      },
    };

    const res = calculateAccountabilityLedger(history, FIXED_NOW);
    assert.equal(res.totalAmount, 15000);
    assert.equal(res.unpaidCount, 1);
    assert.equal(res.missedCount, 1);
    assert.equal(res.madeUpCount, 0);
    assert.equal(res.items.length, 1);
    assert.equal(res.items[0].baseAmount, 15000);
    assert.equal(res.items[0].overdueAmount, 0);
    assert.equal(res.items[0].amount, 15000);
    assert.equal(res.items[0].totalAmount, 15000);
    assert.equal(res.items[0].isOverdue, false);
  });

  it('calculates base 15,000 UZS + overdue 15,000 UZS (total 30,000 UZS) for MISSED prayers older than 7 days', () => {
    // 10 days ago (2026-10-11)
    const history: Record<string, PrayerHistoryRecord> = {
      '2026-10-11': {
        date: '2026-10-11',
        finesAccrued: 30000,
        prayers: {
          fajr: { status: 'MISSED' },
          dhuhr: { status: 'PRAYED_ON_TIME' },
          asr: { status: 'PRAYED_ON_TIME' },
          maghrib: { status: 'PRAYED_ON_TIME' },
          isha: { status: 'PRAYED_ON_TIME' },
        },
      },
    };

    const res = calculateAccountabilityLedger(history, FIXED_NOW);
    assert.equal(res.totalAmount, 30000);
    assert.equal(res.unpaidCount, 1);
    assert.equal(res.missedCount, 1);
    assert.equal(res.madeUpCount, 0);
    assert.equal(res.items[0].baseAmount, 15000);
    assert.equal(res.items[0].overdueAmount, 15000);
    assert.equal(res.items[0].amount, 30000);
    assert.equal(res.items[0].totalAmount, 30000);
    assert.equal(res.items[0].isOverdue, true);
  });

  it('permanently caps MADE_UP prayers at 15,000 UZS with 0 overdue penalty even after 7 days', () => {
    // 20 days ago (2026-10-01)
    const history: Record<string, PrayerHistoryRecord> = {
      '2026-10-01': {
        date: '2026-10-01',
        finesAccrued: 15000,
        prayers: {
          fajr: { status: 'MADE_UP' },
          dhuhr: { status: 'PRAYED_ON_TIME' },
          asr: { status: 'PRAYED_ON_TIME' },
          maghrib: { status: 'PRAYED_ON_TIME' },
          isha: { status: 'PRAYED_ON_TIME' },
        },
      },
    };

    const res = calculateAccountabilityLedger(history, FIXED_NOW);
    assert.equal(res.totalAmount, 15000);
    assert.equal(res.unpaidCount, 1);
    assert.equal(res.missedCount, 0);
    assert.equal(res.madeUpCount, 1);
    assert.equal(res.items[0].baseAmount, 15000);
    assert.equal(res.items[0].overdueAmount, 0);
    assert.equal(res.items[0].amount, 15000);
    assert.equal(res.items[0].totalAmount, 15000);
    assert.equal(res.items[0].isOverdue, false);
  });

  it('ignores non-actionable prayer statuses (PRAYED_ON_TIME, PRAYED_LATE, PENDING)', () => {
    const history: Record<string, PrayerHistoryRecord> = {
      '2026-10-20': {
        date: '2026-10-20',
        finesAccrued: 0,
        prayers: {
          fajr: { status: 'PRAYED_ON_TIME' },
          dhuhr: { status: 'PRAYED_LATE' },
          asr: { status: 'PENDING' },
          maghrib: { status: 'PRAYED' },
          isha: { status: 'PENDING' },
        },
      },
    };

    const res = calculateAccountabilityLedger(history, FIXED_NOW);
    assert.equal(res.totalAmount, 0);
    assert.equal(res.unpaidCount, 0);
    assert.equal(res.items.length, 0);
  });

  it('aggregates multi-day history sorted in descending date order', () => {
    const history: Record<string, PrayerHistoryRecord> = {
      '2026-10-10': {
        date: '2026-10-10', // overdue missed: 30,000 UZS
        finesAccrued: 30000,
        prayers: {
          fajr: { status: 'MISSED' },
          dhuhr: { status: 'PRAYED_ON_TIME' },
          asr: { status: 'PRAYED_ON_TIME' },
          maghrib: { status: 'PRAYED_ON_TIME' },
          isha: { status: 'PRAYED_ON_TIME' },
        },
      },
      '2026-10-19': {
        date: '2026-10-19', // recent missed: 15,000 UZS + made up: 15,000 UZS
        finesAccrued: 30000,
        prayers: {
          fajr: { status: 'MISSED' },
          dhuhr: { status: 'MADE_UP' },
          asr: { status: 'PRAYED_ON_TIME' },
          maghrib: { status: 'PRAYED_ON_TIME' },
          isha: { status: 'PRAYED_ON_TIME' },
        },
      },
    };

    const res = calculateAccountabilityLedger(history, FIXED_NOW);
    assert.equal(res.totalAmount, 60000); // 30,000 + 15,000 + 15,000
    assert.equal(res.unpaidCount, 3);
    assert.equal(res.missedCount, 2);
    assert.equal(res.madeUpCount, 1);
    assert.equal(res.items.length, 3);

    // Items are ordered with newer dates first
    assert.equal(res.items[0].date, '2026-10-19');
    assert.equal(res.items[1].date, '2026-10-19');
    assert.equal(res.items[2].date, '2026-10-10');
  });

  describe('Authoritative Single Source of Truth Engine: calculateAuthoritativeDebt', () => {
    it('strictly evaluates the 7-day grace period: day 7 is within grace period, day 8 is overdue', () => {
      const refDate = '2026-10-21';

      // Record on 2026-10-14 (exactly 7 days passed)
      // Record on 2026-10-13 (8 days passed)
      const records = [
        {
          date: '2026-10-14',
          prayers: {
            fajr: { status: 'MISSED' as const },
          },
        },
        {
          date: '2026-10-13',
          prayers: {
            dhuhr: { status: 'MISSED' as const },
          },
        },
      ];

      const res = calculateAuthoritativeDebt(records, { referenceDate: refDate });
      assert.equal(res.items.length, 2);

      // Day 7 item (2026-10-14): within grace period
      const day7Item = res.items.find((it) => it.date === '2026-10-14')!;
      assert.ok(day7Item);
      assert.equal(day7Item.daysPassed, 7);
      assert.equal(day7Item.isOverdue, false, 'Day 7 must NOT be overdue (within grace period)');
      assert.equal(day7Item.baseAmount, 15000);
      assert.equal(day7Item.overdueAmount, 0);
      assert.equal(day7Item.totalAmount, 15000);
      assert.match(day7Item.overdueReason || '', /within 7-day grace period/i);

      // Day 8 item (2026-10-13): overdue
      const day8Item = res.items.find((it) => it.date === '2026-10-13')!;
      assert.ok(day8Item);
      assert.equal(day8Item.daysPassed, 8);
      assert.equal(day8Item.isOverdue, true, 'Day 8 must be overdue');
      assert.equal(day8Item.baseAmount, 15000);
      assert.equal(day8Item.overdueAmount, 15000);
      assert.equal(day8Item.totalAmount, 30000);
      assert.match(day8Item.overdueReason || '', /exceeds 7-day grace period/i);

      assert.equal(res.totalBaseDebt, 30000);
      assert.equal(res.totalOverdueDebt, 15000);
      assert.equal(res.totalFinancialDebt, 45000);
      assert.equal(res.pendingQazaCount, 2);
    });

    it('strictly separates spiritual Qaza count (status: MISSED) from financial debt (isPaid)', () => {
      const refDate = '2026-10-21';

      // 2 MISSED prayers on recent date (1 paid, 1 unpaid)
      // 1 MADE_UP prayer (unpaid)
      const records = [
        {
          date: '2026-10-20',
          prayers: {
            fajr: { status: 'MISSED' as const, isPaid: true, paidAmount: 15000 },
            dhuhr: { status: 'MISSED' as const, isPaid: false },
            asr: { status: 'MADE_UP' as const, isPaid: false },
          },
        },
      ];

      const res = calculateAuthoritativeDebt(records, { referenceDate: refDate });

      // Spiritual Qaza obligation: 2 missed prayers still need to be made up spiritually!
      assert.equal(res.pendingQazaCount, 2, 'Pending Qaza count must reflect all MISSED prayers regardless of payment');
      assert.equal(res.completedQazaCount, 1, 'Completed Qaza count reflects MADE_UP prayers');

      // Financial debt: only the unpaid items (dhuhr 15k + asr 15k = 30k)
      assert.equal(res.totalFinancialDebt, 30000);
      assert.equal(res.totalBaseDebt, 30000);
      assert.equal(res.totalOverdueDebt, 0);
      assert.equal(res.settledFinancialCount, 1);
      assert.equal(res.unpaidFinancialCount, 2);

      // Unpaid items by default
      assert.equal(res.items.length, 2);
      assert.ok(res.items.every((it) => it.isPaid === false));
    });

    it('permanently caps overdue fine at 0 UZS for MADE_UP status regardless of elapsed days', () => {
      const records = [
        {
          date: '2026-01-01', // hundreds of days ago
          prayers: {
            maghrib: { status: 'MADE_UP' as const, isPaid: false },
          },
        },
      ];

      const res = calculateAuthoritativeDebt(records, { referenceDate: '2026-10-21' });
      assert.equal(res.items.length, 1);
      assert.equal(res.items[0].isOverdue, false);
      assert.equal(res.items[0].baseAmount, 15000);
      assert.equal(res.items[0].overdueAmount, 0);
      assert.equal(res.items[0].totalAmount, 15000);
      assert.equal(res.totalFinancialDebt, 15000);
      assert.equal(res.pendingQazaCount, 0);
      assert.equal(res.completedQazaCount, 1);
    });

    it('includes settled items with 0 totalAmount when includeSettled: true is requested', () => {
      const records = [
        {
          date: '2026-10-18',
          prayers: {
            fajr: { status: 'MISSED' as const, isPaid: true, paidAmount: 15000 },
            dhuhr: { status: 'MISSED' as const, isPaid: false },
          },
        },
      ];

      const res = calculateAuthoritativeDebt(records, {
        referenceDate: '2026-10-21',
        includeSettled: true,
      });

      assert.equal(res.items.length, 2);

      const paidItem = res.items.find((it) => it.prayerId === 'fajr')!;
      assert.equal(paidItem.isPaid, true);
      assert.equal(paidItem.totalAmount, 0);
      assert.equal(paidItem.baseAmount, 0);
      assert.equal(paidItem.overdueAmount, 0);
      assert.equal(paidItem.isQazaCompleted, false);

      const unpaidItem = res.items.find((it) => it.prayerId === 'dhuhr')!;
      assert.equal(unpaidItem.isPaid, false);
      assert.equal(unpaidItem.totalAmount, 15000);
      assert.equal(unpaidItem.isQazaCompleted, false);
    });

    it('accepts both array format and date-keyed dictionary format interchangeably', () => {
      const dateKeyed = {
        '2026-10-19': {
          date: '2026-10-19',
          prayers: { fajr: { status: 'MISSED' as const } },
        },
      };

      const arrayFormat = [
        {
          date: '2026-10-19',
          prayers: { fajr: { status: 'MISSED' as const } },
        },
      ];

      const resDict = calculateAuthoritativeDebt(dateKeyed, { referenceDate: '2026-10-21' });
      const resArr = calculateAuthoritativeDebt(arrayFormat, { referenceDate: '2026-10-21' });

      assert.deepEqual(resDict, resArr);
      assert.equal(resDict.totalFinancialDebt, 15000);
      assert.equal(resDict.pendingQazaCount, 1);
    });
  });
});
