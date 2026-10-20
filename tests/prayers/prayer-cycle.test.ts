import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseTime,
  timeToMinutes,
  timeStringToMinutes,
  getZonedDateParts,
  getCalendarDate,
  isPostMidnightPreFajr,
  getLiturgicalDate,
  resolvePrayerCycle,
} from '../../src/lib/prayer-cycle.ts';
import { formatLocalizedDate } from '../../src/lib/formatters.ts';
import {
  mirrorDailyPrayersToHistory,
  saveDailyPrayersSync,
  loadPrayersForLiturgicalDate,
  archiveLiturgicalDay,
  STORAGE_KEY_DAILY_PRAYERS,
  STORAGE_KEY_LAST_ACTIVE_DATE,
} from '../../src/lib/storage-sync.ts';
import type { PrayerItem } from '../../src/types/prayer.ts';

describe('Islamic Liturgical Prayer-Cycle Engine', () => {
  describe('1. Time Parsing & Minute Arithmetic', () => {
    it('parses standard HH:mm and single-digit times accurately', () => {
      assert.deepEqual(parseTime('05:15'), { hours: 5, minutes: 15, timeStr: '05:15' });
      assert.deepEqual(parseTime('5:5'), { hours: 5, minutes: 5, timeStr: '05:05' });
      assert.deepEqual(parseTime('00:00'), { hours: 0, minutes: 0, timeStr: '00:00' });
      assert.deepEqual(parseTime('23:59'), { hours: 23, minutes: 59, timeStr: '23:59' });
    });

    it('falls back safely on undefined, malformed, or out-of-range strings', () => {
      assert.deepEqual(parseTime(undefined, '04:47'), { hours: 4, minutes: 47, timeStr: '04:47' });
      assert.deepEqual(parseTime('invalid', '05:00'), { hours: 5, minutes: 0, timeStr: '05:00' });
      assert.deepEqual(parseTime('99:99'), { hours: 5, minutes: 0, timeStr: '05:00' });
    });

    it('converts times to minutes since midnight', () => {
      assert.equal(timeToMinutes(0, 0), 0);
      assert.equal(timeToMinutes(5, 15), 315);
      assert.equal(timeToMinutes(23, 59), 1439);
      assert.equal(timeStringToMinutes('04:47'), 287);
    });
  });

  describe('2. Timezone-Aware Date Extraction', () => {
    it('extracts date and time parts in Asia/Tashkent (UTC+5)', () => {
      // 2026-10-20T21:00:00Z -> In Tashkent (+5), this is 2026-10-21 02:00:00
      const date = new Date('2026-10-20T21:00:00.000Z');
      const parts = getZonedDateParts(date, 'Asia/Tashkent');

      assert.equal(parts.year, 2026);
      assert.equal(parts.month, 10);
      assert.equal(parts.day, 21);
      assert.equal(parts.hour, 2);
      assert.equal(parts.minute, 0);
      assert.equal(parts.dateStr, '2026-10-21');
      assert.equal(parts.timeStr, '02:00');
    });

    it('extracts date and time parts in America/New_York (UTC-4 in daylight time)', () => {
      // 2026-10-20T03:00:00Z -> In NY (EDT UTC-4), this is 2026-10-19 23:00:00
      const date = new Date('2026-10-20T03:00:00.000Z');
      const parts = getZonedDateParts(date, 'America/New_York');

      assert.equal(parts.year, 2026);
      assert.equal(parts.month, 10);
      assert.equal(parts.day, 19);
      assert.equal(parts.hour, 23);
      assert.equal(parts.minute, 0);
      assert.equal(parts.dateStr, '2026-10-19');
    });

    it('returns calendar date string correctly', () => {
      const date = new Date('2026-10-20T21:00:00.000Z');
      assert.equal(getCalendarDate(date, 'Asia/Tashkent'), '2026-10-21');
      assert.equal(getCalendarDate(date, 'UTC'), '2026-10-20');
    });
  });

  describe('3. isPostMidnightPreFajr (Midnight Rollover Detection)', () => {
    it('returns true when current time is between 00:00:00 and Fajr', () => {
      // 02:00 AM Tashkent time, Fajr is 05:15 AM
      const date = new Date('2026-10-20T21:00:00.000Z'); // 02:00 Tashkent
      assert.equal(isPostMidnightPreFajr(date, '05:15', 'Asia/Tashkent'), true);
    });

    it('returns true at exact midnight 00:00:00', () => {
      const date = new Date('2026-10-20T19:00:00.000Z'); // 00:00 Tashkent
      assert.equal(isPostMidnightPreFajr(date, '05:15', 'Asia/Tashkent'), true);
    });

    it('returns false at exact Fajr time', () => {
      const date = new Date('2026-10-21T00:15:00.000Z'); // 05:15 Tashkent
      assert.equal(isPostMidnightPreFajr(date, '05:15', 'Asia/Tashkent'), false);
    });

    it('returns false after Fajr during daytime', () => {
      const date = new Date('2026-10-21T07:00:00.000Z'); // 12:00 Tashkent
      assert.equal(isPostMidnightPreFajr(date, '05:15', 'Asia/Tashkent'), false);
    });

    it('returns false late at night before midnight (e.g. 23:30)', () => {
      const date = new Date('2026-10-20T18:30:00.000Z'); // 23:30 Tashkent
      assert.equal(isPostMidnightPreFajr(date, '05:15', 'Asia/Tashkent'), false);
    });
  });

  describe('4. getLiturgicalDate (Islamic Day Boundaries)', () => {
    it('returns yesterday calendar date during post-midnight pre-Fajr window', () => {
      // 2026-10-21 02:00 AM in Tashkent with Fajr at 05:15 AM
      const date = new Date('2026-10-20T21:00:00.000Z');
      const liturgical = getLiturgicalDate(date, '05:15', 'Asia/Tashkent');
      assert.equal(liturgical, '2026-10-20', 'Must be yesterday date so Isha is logged to the correct day');
    });

    it('rolls over to today calendar date once Fajr arrives', () => {
      // 2026-10-21 05:15 AM in Tashkent
      const date = new Date('2026-10-21T00:15:00.000Z');
      const liturgical = getLiturgicalDate(date, '05:15', 'Asia/Tashkent');
      assert.equal(liturgical, '2026-10-21');
    });

    it('handles month-end rollback across midnight (e.g. Nov 1 02:00 -> Oct 31)', () => {
      // 2026-11-01 02:00 AM in Tashkent
      const date = new Date('2026-10-31T21:00:00.000Z');
      const liturgical = getLiturgicalDate(date, '05:00', 'Asia/Tashkent');
      assert.equal(liturgical, '2026-10-31');
    });

    it('handles leap year rollback across midnight (e.g. Mar 1 2024 02:00 -> Feb 29)', () => {
      // 2024-03-01 02:00 AM in Tashkent (2024 was leap year)
      const date = new Date('2024-02-29T21:00:00.000Z');
      const liturgical = getLiturgicalDate(date, '05:00', 'Asia/Tashkent');
      assert.equal(liturgical, '2024-02-29');
    });

    it('handles new year rollback across midnight (e.g. Jan 1 2026 02:00 -> Dec 31 2025)', () => {
      // 2026-01-01 02:00 AM in Tashkent
      const date = new Date('2025-12-31T21:00:00.000Z');
      const liturgical = getLiturgicalDate(date, '05:00', 'Asia/Tashkent');
      assert.equal(liturgical, '2025-12-31');
    });
  });

  describe('5. resolvePrayerCycle (Comprehensive State Machine)', () => {
    const timings = {
      fajr: { time: '04:47', endTime: '06:19' },
      dhuhr: { time: '12:13', endTime: '16:20' },
      asr: { time: '16:20', endTime: '18:05' },
      maghrib: { time: '18:05', endTime: '19:32' },
      isha: { time: '19:32', endTime: '04:47' },
    };

    it('resolves post-midnight pre-Fajr state (02:00 AM): Isha active, Fajr next', () => {
      // 02:00 AM Tashkent time on 2026-10-21
      const now = new Date('2026-10-20T21:00:00.000Z');
      const cycle = resolvePrayerCycle({ now, timings, timezone: 'Asia/Tashkent' });

      assert.equal(cycle.calendarDate, '2026-10-21');
      assert.equal(cycle.liturgicalDate, '2026-10-20');
      assert.equal(cycle.isPostMidnight, true);
      assert.equal(cycle.activePrayerId, 'isha');
      assert.equal(cycle.nextPrayerId, 'fajr');
      assert.equal(cycle.timeUntilNextMinutes, 167); // 04:47 - 02:00 = 167 mins (2h 47m)
      assert.equal(cycle.hoursUntilNext, 2);
      assert.equal(cycle.minutesUntilNext, 47);
    });

    it('resolves Fajr state (05:30 AM): Fajr active, Dhuhr next', () => {
      // 05:30 AM Tashkent time on 2026-10-21
      const now = new Date('2026-10-21T00:30:00.000Z');
      const cycle = resolvePrayerCycle({ now, timings, timezone: 'Asia/Tashkent' });

      assert.equal(cycle.calendarDate, '2026-10-21');
      assert.equal(cycle.liturgicalDate, '2026-10-21');
      assert.equal(cycle.isPostMidnight, false);
      assert.equal(cycle.activePrayerId, 'fajr');
      assert.equal(cycle.nextPrayerId, 'dhuhr');
      assert.equal(cycle.timeUntilNextMinutes, 403); // 12:13 - 05:30 = 403 mins (6h 43m)
      assert.equal(cycle.hoursUntilNext, 6);
      assert.equal(cycle.minutesUntilNext, 43);
    });

    it('resolves Duha / post-sunrise gap (08:00 AM): active is null, Dhuhr next', () => {
      // 08:00 AM Tashkent time on 2026-10-21 (after 06:19 sunrise)
      const now = new Date('2026-10-21T03:00:00.000Z');
      const cycle = resolvePrayerCycle({ now, timings, timezone: 'Asia/Tashkent' });

      assert.equal(cycle.activePrayerId, null);
      assert.equal(cycle.nextPrayerId, 'dhuhr');
      assert.equal(cycle.timeUntilNextMinutes, 253); // 12:13 - 08:00 = 253 mins (4h 13m)
    });

    it('resolves Dhuhr state (13:00 / 1:00 PM): Dhuhr active, Asr next', () => {
      // 13:00 Tashkent time
      const now = new Date('2026-10-21T08:00:00.000Z');
      const cycle = resolvePrayerCycle({ now, timings, timezone: 'Asia/Tashkent' });

      assert.equal(cycle.activePrayerId, 'dhuhr');
      assert.equal(cycle.nextPrayerId, 'asr');
      assert.equal(cycle.timeUntilNextMinutes, 200); // 16:20 - 13:00 = 200 mins (3h 20m)
    });

    it('resolves Asr state (17:00 / 5:00 PM): Asr active, Maghrib next', () => {
      // 17:00 Tashkent time
      const now = new Date('2026-10-21T12:00:00.000Z');
      const cycle = resolvePrayerCycle({ now, timings, timezone: 'Asia/Tashkent' });

      assert.equal(cycle.activePrayerId, 'asr');
      assert.equal(cycle.nextPrayerId, 'maghrib');
      assert.equal(cycle.timeUntilNextMinutes, 65); // 18:05 - 17:00 = 65 mins (1h 5m)
    });

    it('resolves Maghrib state (18:30 / 6:30 PM): Maghrib active, Isha next', () => {
      // 18:30 Tashkent time
      const now = new Date('2026-10-21T13:30:00.000Z');
      const cycle = resolvePrayerCycle({ now, timings, timezone: 'Asia/Tashkent' });

      assert.equal(cycle.activePrayerId, 'maghrib');
      assert.equal(cycle.nextPrayerId, 'isha');
      assert.equal(cycle.timeUntilNextMinutes, 62); // 19:32 - 18:30 = 62 mins (1h 2m)
    });

    it('resolves Isha night state (22:00 / 10:00 PM): Isha active, Fajr next across midnight', () => {
      // 22:00 Tashkent time
      const now = new Date('2026-10-21T17:00:00.000Z');
      const cycle = resolvePrayerCycle({ now, timings, timezone: 'Asia/Tashkent' });

      assert.equal(cycle.calendarDate, '2026-10-21');
      assert.equal(cycle.liturgicalDate, '2026-10-21');
      assert.equal(cycle.isPostMidnight, false);
      assert.equal(cycle.activePrayerId, 'isha');
      assert.equal(cycle.nextPrayerId, 'fajr');
      // Countdown from 22:00 to 04:47 tomorrow = 2 hours to midnight + 4h 47m = 407 mins (6h 47m)
      assert.equal(cycle.timeUntilNextMinutes, 407);
      assert.equal(cycle.hoursUntilNext, 6);
      assert.equal(cycle.minutesUntilNext, 47);
    });
  });

  describe('6. Timezone-Resilient Date Formatter Verification', () => {
    it('formats "YYYY-MM-DD" string dates without UTC midnight timezone shifting', () => {
      // "2026-10-20" must format to the 20th in all supported languages
      const uzFormatted = formatLocalizedDate('2026-10-20', 'uz');
      assert.equal(uzFormatted, '20-oktabr, 2026-yil');

      const ruFormatted = formatLocalizedDate('2026-10-20', 'ru');
      assert.match(ruFormatted, /20/);
      assert.match(ruFormatted, /2026/);

      const enFormatted = formatLocalizedDate('2026-10-20', 'en');
      assert.equal(enFormatted, 'October 20, 2026');
    });

    it('formats month boundaries cleanly (e.g. 2026-11-01)', () => {
      assert.equal(formatLocalizedDate('2026-11-01', 'uz'), '1-noyabr, 2026-yil');
      assert.equal(formatLocalizedDate('2026-11-01', 'en'), 'November 1, 2026');
    });

    it('handles year transitions cleanly (e.g. 2026-12-31 and 2027-01-01)', () => {
      assert.equal(formatLocalizedDate('2026-12-31', 'uz'), '31-dekabr, 2026-yil');
      assert.equal(formatLocalizedDate('2027-01-01', 'uz'), '1-yanvar, 2027-yil');
    });

    it('safely handles Date objects as well as strings', () => {
      const d = new Date(2026, 9, 20, 15, 30); // Oct 20, 2026 local time
      assert.equal(formatLocalizedDate(d, 'uz'), '20-oktabr, 2026-yil');
      assert.equal(formatLocalizedDate(d, 'en'), 'October 20, 2026');
    });
  });

  describe('7. Local Storage Synchronization & History Mirroring', () => {
    class MockStorage {
      private store: Record<string, string> = {};
      getItem(key: string): string | null {
        return this.store[key] || null;
      }
      setItem(key: string, value: string): void {
        this.store[key] = String(value);
      }
      removeItem(key: string): void {
        delete this.store[key];
      }
      clear(): void {
        this.store = {};
      }
    }

    const mockStorage = new MockStorage();

    const samplePrayers: PrayerItem[] = [
      { id: 'fajr', name: 'Fajr', time: '04:47', endTime: '06:19', status: 'PRAYED_ON_TIME' },
      { id: 'dhuhr', name: 'Dhuhr', time: '12:13', endTime: '16:20', status: 'PRAYED_ON_TIME' },
      { id: 'asr', name: 'Asr', time: '16:20', endTime: '18:05', status: 'PRAYED_LATE' },
      { id: 'maghrib', name: 'Maghrib', time: '18:05', endTime: '19:32', status: 'MISSED' },
      { id: 'isha', name: 'Isha', time: '19:32', endTime: '23:59', status: 'PENDING' },
    ];

    it('mirrors daily prayers into history records under liturgical date', () => {
      // Mock global window & localStorage
      const originalWindow = global.window;
      const originalDoc = global.document;

      global.window = {
        localStorage: mockStorage,
        dispatchEvent: () => true,
        location: { protocol: 'https:' },
      } as unknown as Window & typeof globalThis;

      global.document = {
        cookie: '',
      } as unknown as Document;

      try {
        mockStorage.clear();

        // 1. Mirror daily prayers into history
        const records = mirrorDailyPrayersToHistory('2026-10-20', samplePrayers);
        assert.ok(records['2026-10-20'], 'record for 2026-10-20 must exist');
        assert.equal(records['2026-10-20'].prayers.fajr.status, 'PRAYED_ON_TIME');
        assert.equal(records['2026-10-20'].prayers.asr.status, 'PRAYED_LATE');
        assert.equal(records['2026-10-20'].prayers.maghrib.status, 'MISSED');
        assert.equal(records['2026-10-20'].prayers.isha.status, 'PENDING');

        // 2. Save daily prayers sync (writes array to daily store and sets cookie with envelope)
        saveDailyPrayersSync('2026-10-20', samplePrayers);

        const rawDaily = mockStorage.getItem(STORAGE_KEY_DAILY_PRAYERS);
        assert.ok(rawDaily);
        const parsedDaily = JSON.parse(rawDaily);
        assert.equal(parsedDaily.length, 5);

        const rawActiveDate = mockStorage.getItem(STORAGE_KEY_LAST_ACTIVE_DATE);
        assert.equal(JSON.parse(rawActiveDate!), '2026-10-20');

        // 3. Load prayers for liturgical date
        const loaded = loadPrayersForLiturgicalDate('2026-10-20', samplePrayers);
        assert.equal(loaded[0].status, 'PRAYED_ON_TIME');
        assert.equal(loaded[2].status, 'PRAYED_LATE');

        // 4. Archive day at Fajr rollover
        const archiveResult = archiveLiturgicalDay('2026-10-20', samplePrayers);
        // Maghrib is MISSED, Isha is PENDING -> 2 uncompleted prayers
        assert.equal(archiveResult.uncompletedCount, 2);
      } finally {
        global.window = originalWindow;
        global.document = originalDoc;
      }
    });
  });
});
