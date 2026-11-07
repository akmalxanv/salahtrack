import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  getHijriParts,
  getHijriDate,
  formatHijriDateString,
  getHijriMonthDays,
  formatShortGregorianDate,
  toArabicNumerals,
  HIJRI_MONTHS,
} from '../../src/lib/hijri.ts';
import { formatLocalizedHijriDate } from '../../src/lib/formatters.ts';

describe('Hijri Calendar & Lunar Conversion Engine', () => {
  describe('1. Raw Hijri Conversion & Accuracy', () => {
    it('converts known Gregorian dates into expected Hijri components', () => {
      // 2026-11-07 corresponds to 27 Jumada I 1448 AH under Umm al-Qura
      const parts = getHijriParts('2026-11-07', 0);
      assert.strictEqual(parts.year, 1448);
      assert.strictEqual(parts.month, 5);
      assert.strictEqual(parts.day, 27);
    });

    it('accurately applies moon sighting adjustments (-1 and +1 days)', () => {
      const standard = getHijriParts('2026-11-07', 0);
      const minusOne = getHijriParts('2026-11-07', -1);
      const plusOne = getHijriParts('2026-11-07', 1);

      assert.strictEqual(standard.day, 27);
      assert.strictEqual(minusOne.day, 26);
      assert.strictEqual(plusOne.day, 28);
    });

    it('safely handles Date objects and ISO strings without timezone drift', () => {
      const fromStr = getHijriParts('2026-11-07T18:00:00Z', 0);
      const fromDate = getHijriParts(new Date('2026-11-07T12:00:00Z'), 0);

      assert.strictEqual(fromStr.year, fromDate.year);
      assert.strictEqual(fromStr.month, fromDate.month);
      assert.strictEqual(fromStr.day, fromDate.day);
    });
  });

  describe('2. Localization & Arabic Script Formatting', () => {
    it('provides all 12 Arabic and localized month names across uz, ru, and en', () => {
      assert.strictEqual(HIJRI_MONTHS.ar.length, 12);
      assert.strictEqual(HIJRI_MONTHS.uz.length, 12);
      assert.strictEqual(HIJRI_MONTHS.ru.length, 12);
      assert.strictEqual(HIJRI_MONTHS.en.length, 12);

      // Month 9 is Ramadan
      assert.strictEqual(HIJRI_MONTHS.ar[8], 'رَمَضَان');
      assert.strictEqual(HIJRI_MONTHS.uz[8], 'Ramazon');
      assert.strictEqual(HIJRI_MONTHS.ru[8], 'Рамадан');
      assert.strictEqual(HIJRI_MONTHS.en[8], 'Ramadan');
    });

    it('formats localized Hijri strings correctly for all supported languages', () => {
      const testDate = '2026-11-07';

      const uzDate = getHijriDate(testDate, 'uz', 0);
      assert.match(uzDate.formatted, /27-Jumodul avval/);
      assert.match(uzDate.formatted, /1448 hijriy/);

      const ruDate = getHijriDate(testDate, 'ru', 0);
      assert.match(ruDate.formatted, /27 Джумада аль-уля/);
      assert.match(ruDate.formatted, /1448 г\. хиджры/);

      const enDate = getHijriDate(testDate, 'en', 0);
      assert.match(enDate.formatted, /27 Jumada al-Ula/);
      assert.match(enDate.formatted, /1448 AH/);
    });

    it('converts Western numerals to authentic Eastern Arabic numerals', () => {
      assert.strictEqual(toArabicNumerals(1448), '١٤٤٨');
      assert.strictEqual(toArabicNumerals(27), '٢٧');
      assert.strictEqual(toArabicNumerals(0), '٠');
    });

    it('provides authentic Arabic calligraphy string with diacritics', () => {
      const info = getHijriDate('2026-11-07', 'uz', 0);
      assert.strictEqual(info.formattedArabic, '٢٧ جُمَادَى الأُولَى ١٤٤٨ هـ');
    });
  });

  describe('3. Monthly Hijri Grid Generator', () => {
    it('returns exactly 29 or 30 days for any valid Hijri month', () => {
      const days = getHijriMonthDays(1448, 5, 0);
      assert.ok(days.length === 29 || days.length === 30, `Expected 29 or 30 days, got ${days.length}`);

      // Verify sequence of days from 1 to days.length
      days.forEach((day, idx) => {
        assert.strictEqual(day.hijriDay, idx + 1);
        assert.strictEqual(day.hijriMonth, 5);
        assert.strictEqual(day.hijriYear, 1448);
        assert.match(day.gregorianDateStr, /^\d{4}-\d{2}-\d{2}$/);
        assert.ok(day.dayOfWeek >= 0 && day.dayOfWeek <= 6);
      });
    });

    it('preserves continuity across Hijri month boundaries', () => {
      const month5 = getHijriMonthDays(1448, 5, 0);
      const month6 = getHijriMonthDays(1448, 6, 0);

      const lastDayM5 = new Date(month5[month5.length - 1].gregorianDateStr);
      const firstDayM6 = new Date(month6[0].gregorianDateStr);

      // The first day of month 6 should immediately follow the last day of month 5 (1 day diff = 86400000 ms)
      const diffDays = Math.round((firstDayM6.getTime() - lastDayM5.getTime()) / (1000 * 60 * 60 * 24));
      assert.strictEqual(diffDays, 1);
    });
  });

  describe('4. Compact Subtext & Formatters Integration', () => {
    it('formats short Gregorian subtext correctly for compact month cells', () => {
      assert.strictEqual(formatShortGregorianDate('2026-11-07', 'uz'), '7-noy');
      assert.strictEqual(formatShortGregorianDate('2026-11-07', 'ru'), '7 ноя');
      assert.strictEqual(formatShortGregorianDate('2026-11-07', 'en'), '7 Nov');
    });

    it('formatLocalizedHijriDate in formatters.ts supports optional sighting offset', () => {
      const standard = formatLocalizedHijriDate('2026-11-07', 'en', 0);
      const offset = formatLocalizedHijriDate('2026-11-07', 'en', 1);

      assert.match(standard, /27 Jumada al-Ula 1448 AH/);
      assert.match(offset, /28 Jumada al-Ula 1448 AH/);
    });

    it('formatHijriDateString defends against malformed inputs without throwing', () => {
      const result = formatHijriDateString(null as unknown as Date, 'uz');
      assert.ok(typeof result === 'string');
    });
  });
});
