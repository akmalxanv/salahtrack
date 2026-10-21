import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateAccountabilityLedger } from '../../src/lib/accountability.ts';
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
});
