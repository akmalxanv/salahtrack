import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidCalendarDate,
  getMaxAllowedDate,
  MIN_ALLOWED_DATE,
  sanitizeNotes,
  calculateFines,
} from '../src/app/api/prayers/route.ts';
import {
  sanitizeTimezone,
  getZonedDateParts,
  DEFAULT_TIMEZONE,
  DEFAULT_FAJR_TIME,
  parseTime,
} from '../src/lib/prayer-cycle.ts';
import {
  formatLocalizedDate,
  formatLocalizedHijriDate,
  formatNumber,
  formatPrayerName,
} from '../src/lib/formatters.ts';
import {
  MAX_COOKIE_BYTE_LENGTH,
} from '../src/lib/storage-sync.ts';

describe('Prayer Security & Robustness Audit Test Suite', () => {
  describe('1. Calendar Date Validation & Bounds Checking', () => {
    it('accepts strictly valid Gregorian dates', () => {
      assert.strictEqual(isValidCalendarDate('2026-10-20'), true);
      assert.strictEqual(isValidCalendarDate('2024-02-29'), true); // 2024 is a leap year
      assert.strictEqual(isValidCalendarDate('2000-01-01'), true);
    });

    it('rejects invalid calendar dates and non-existent days', () => {
      assert.strictEqual(isValidCalendarDate('2026-02-31'), false); // February 31st does not exist
      assert.strictEqual(isValidCalendarDate('2023-02-29'), false); // 2023 is not a leap year
      assert.strictEqual(isValidCalendarDate('2026-04-31'), false); // April has 30 days
      assert.strictEqual(isValidCalendarDate('2026-13-01'), false); // Month 13 is invalid
      assert.strictEqual(isValidCalendarDate('2026-00-10'), false); // Month 00 is invalid
      assert.strictEqual(isValidCalendarDate('2026-10-00'), false); // Day 00 is invalid
      assert.strictEqual(isValidCalendarDate('invalid-date'), false);
      assert.strictEqual(isValidCalendarDate(''), false);
      assert.strictEqual(isValidCalendarDate(null as unknown as string), false);
    });

    it('rejects SQL/NoSQL operator payloads submitted as dates', () => {
      assert.strictEqual(isValidCalendarDate('{"$gt": ""}'), false);
      assert.strictEqual(isValidCalendarDate('2026-10-20; DROP TABLE prayers;'), false);
      assert.strictEqual(isValidCalendarDate('../../../etc/passwd'), false);
    });

    it('enforces maximum future date threshold', () => {
      const maxDate = getMaxAllowedDate();
      assert.match(maxDate, /^\d{4}-\d{2}-\d{2}$/);
      // Dates 2 days ahead of now must strictly exceed maxDate
      const farFuture = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().split('T')[0];
      assert.strictEqual(farFuture > maxDate, true);
    });

    it('enforces minimum historical epoch threshold', () => {
      assert.strictEqual(MIN_ALLOWED_DATE, '1970-01-01');
      assert.strictEqual('1969-12-31' < MIN_ALLOWED_DATE, true);
      assert.strictEqual('2026-10-20' >= MIN_ALLOWED_DATE, true);
    });
  });

  describe('2. Notes Sanitization & Length Enforcement', () => {
    it('truncates notes exceeding 200 characters', () => {
      const longNote = 'A'.repeat(300);
      const sanitized = sanitizeNotes(longNote);
      assert.strictEqual(sanitized?.length, 200);
      assert.strictEqual(sanitized, 'A'.repeat(200));
    });

    it('strips non-printable ASCII control characters (null bytes, bell, escape)', () => {
      const dirtyNote = 'Fajr prayed\x00 with congregation\x07 at the mosque\x1B';
      const sanitized = sanitizeNotes(dirtyNote);
      assert.strictEqual(sanitized, 'Fajr prayed with congregation at the mosque');
      assert.strictEqual(sanitized?.includes('\x00'), false);
      assert.strictEqual(sanitized?.includes('\x07'), false);
      assert.strictEqual(sanitized?.includes('\x1B'), false);
    });

    it('handles non-string payloads safely without throwing', () => {
      assert.strictEqual(sanitizeNotes(null), undefined);
      assert.strictEqual(sanitizeNotes(undefined), undefined);
      assert.strictEqual(sanitizeNotes(12345), undefined);
      assert.strictEqual(sanitizeNotes({ $gt: '' }), undefined);
    });
  });

  describe('3. Fine Calculation Defensive Logic', () => {
    it('calculates standard 15,000 UZS base fine for missed prayers', () => {
      const today = new Date().toISOString().split('T')[0];
      const fine = calculateFines(today, {
        fajr: { status: 'MISSED' },
        dhuhr: { status: 'PRAYED_ON_TIME' },
        asr: { status: 'PENDING' },
        maghrib: { status: 'PENDING' },
        isha: { status: 'PENDING' },
      });
      assert.strictEqual(fine, 15000);
    });

    it('applies overdue fine (+15,000 UZS) for prayers missed > 7 days ago', () => {
      const overdueDate = '2026-01-01'; // Over 7 days ago
      const fine = calculateFines(overdueDate, {
        fajr: { status: 'MISSED' },
        dhuhr: { status: 'MISSED' },
        asr: { status: 'PRAYED_ON_TIME' },
        maghrib: { status: 'PENDING' },
        isha: { status: 'PENDING' },
      });
      // 2 missed prayers * 30,000 UZS = 60,000 UZS
      assert.strictEqual(fine, 60000);
    });

    it('defends against malformed, null, or empty prayers object', () => {
      assert.strictEqual(calculateFines('2026-10-20', null as unknown as Record<string, never>), 0);
      assert.strictEqual(calculateFines('2026-10-20', undefined as unknown as Record<string, never>), 0);
      assert.strictEqual(calculateFines('invalid-date', { fajr: { status: 'MISSED' } }), 0);
    });
  });

  describe('4. Timezone Validation & Prototype Pollution Defense', () => {
    it('sanitizes valid IANA timezones', () => {
      assert.strictEqual(sanitizeTimezone('Asia/Tashkent'), 'Asia/Tashkent');
      assert.strictEqual(sanitizeTimezone('UTC'), 'UTC');
      assert.strictEqual(sanitizeTimezone('America/New_York'), 'America/New_York');
    });

    it('neutralizes prototype pollution property names in timezones', () => {
      assert.strictEqual(sanitizeTimezone('__proto__'), DEFAULT_TIMEZONE);
      assert.strictEqual(sanitizeTimezone('constructor'), DEFAULT_TIMEZONE);
      assert.strictEqual(sanitizeTimezone('prototype'), DEFAULT_TIMEZONE);
      assert.strictEqual(sanitizeTimezone(''), DEFAULT_TIMEZONE);
      assert.strictEqual(sanitizeTimezone(null), DEFAULT_TIMEZONE);
      assert.strictEqual(sanitizeTimezone('A'.repeat(100)), DEFAULT_TIMEZONE);
    });

    it('getZonedDateParts recovers gracefully from invalid dates and null inputs', () => {
      const partsFromInvalid = getZonedDateParts(new Date('invalid'));
      assert.strictEqual(typeof partsFromInvalid.year, 'number');
      assert.strictEqual(isNaN(partsFromInvalid.year), false);
      assert.match(partsFromInvalid.dateStr, /^\d{4}-\d{2}-\d{2}$/);

      const partsFromNull = getZonedDateParts(null as unknown as Date);
      assert.strictEqual(typeof partsFromNull.year, 'number');
      assert.strictEqual(isNaN(partsFromNull.year), false);
    });
  });

  describe('5. Formatting Engine Resilience & Prototype Safety', () => {
    it('formatLocalizedDate safely handles null, undefined, and malformed inputs', () => {
      assert.strictEqual(formatLocalizedDate(null as unknown as Date), '');
      assert.strictEqual(formatLocalizedDate(undefined as unknown as Date), '');
      assert.strictEqual(formatLocalizedDate('invalid-date-string'), '');
      assert.strictEqual(formatLocalizedDate(new Date('invalid')), '');
    });

    it('formatLocalizedDate formats valid dates correctly across locales', () => {
      const uz = formatLocalizedDate('2026-10-20', 'uz');
      assert.match(uz, /20-oktabr, 2026-yil/);

      const en = formatLocalizedDate('2026-10-20', 'en');
      assert.match(en, /October 20, 2026/);
    });

    it('formatLocalizedHijriDate safely handles null and invalid inputs without throwing', () => {
      assert.strictEqual(formatLocalizedHijriDate(null as unknown as Date), '');
      assert.strictEqual(formatLocalizedHijriDate('invalid'), '');
    });

    it('formatNumber and formatPrayerName defend against prototype lookups', () => {
      assert.strictEqual(formatNumber(15000, 'toString' as unknown as 'uz'), '15,000');
      assert.strictEqual(formatPrayerName('fajr', 'toString' as unknown as 'uz'), 'Bomdod');
    });
  });

  describe('6. Client Storage & Cookie Security Boundaries', () => {
    it('enforces maximum cookie byte limit of 2048 bytes to prevent HTTP 431 errors', () => {
      assert.strictEqual(MAX_COOKIE_BYTE_LENGTH, 2048);
    });

    it('parseTime safely parses valid and malformed time inputs', () => {
      assert.deepStrictEqual(parseTime('04:47'), { hours: 4, minutes: 47, timeStr: '04:47' });
      assert.deepStrictEqual(parseTime('invalid'), { hours: 4, minutes: 47, timeStr: DEFAULT_FAJR_TIME });
      assert.deepStrictEqual(parseTime('25:99'), { hours: 5, minutes: 0, timeStr: '05:00' });
    });
  });
});
