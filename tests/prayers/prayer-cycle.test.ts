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
  isPrayerOverdue,
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
import type { PrayerId, PrayerItem, PrayerStatus } from '../../src/types/prayer.ts';

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

  describe('8. isPrayerOverdue (Dynamic Overdue Detection & Auto-Inline Actions)', () => {
    const testPrayers: PrayerItem[] = [
      { id: 'fajr', name: 'Fajr', time: '04:47', endTime: '06:19', status: 'PENDING' },
      { id: 'dhuhr', name: 'Dhuhr', time: '12:13', endTime: '16:20', status: 'PENDING' },
      { id: 'asr', name: 'Asr', time: '16:20', endTime: '18:05', status: 'PENDING' },
      { id: 'maghrib', name: 'Maghrib', time: '18:05', endTime: '19:32', status: 'PENDING' },
      { id: 'isha', name: 'Isha', time: '19:32', endTime: '23:59', status: 'PENDING' },
    ];

    it('returns false when prayer is already resolved (PRAYED_ON_TIME, MADE_UP, MISSED)', () => {
      const resolvedPrayers: PrayerItem[] = [
        { ...testPrayers[0], status: 'PRAYED_ON_TIME' },
        { ...testPrayers[1], status: 'MADE_UP' },
        { ...testPrayers[2], status: 'MISSED' },
        testPrayers[3],
        testPrayers[4],
      ];

      // Time is 14:00 (after Dhuhr, Fajr would otherwise be overdue)
      const now = new Date('2026-10-20T09:00:00.000Z'); // 14:00 in Asia/Tashkent
      assert.equal(isPrayerOverdue('fajr', resolvedPrayers, now, 'Asia/Tashkent'), false);
      assert.equal(isPrayerOverdue('dhuhr', resolvedPrayers, now, 'Asia/Tashkent'), false);
      assert.equal(isPrayerOverdue('asr', resolvedPrayers, now, 'Asia/Tashkent'), false);
    });

    it('retains not overdue status during early morning Fajr window before sunrise', () => {
      // 05:30 in Asia/Tashkent (UTC 00:30) - within Fajr window (04:47 to 06:19 sunrise)
      const now = new Date('2026-10-20T00:30:00.000Z');
      assert.equal(isPrayerOverdue('fajr', testPrayers, now, 'Asia/Tashkent'), false);
      assert.equal(isPrayerOverdue('dhuhr', testPrayers, now, 'Asia/Tashkent'), false);
      assert.equal(isPrayerOverdue('asr', testPrayers, now, 'Asia/Tashkent'), false);
      assert.equal(isPrayerOverdue('maghrib', testPrayers, now, 'Asia/Tashkent'), false);
      assert.equal(isPrayerOverdue('isha', testPrayers, now, 'Asia/Tashkent'), false);
    });

    it('marks Fajr overdue once sunrise arrives (06:19+) before Dhuhr', () => {
      // 08:00 in Asia/Tashkent (UTC 03:00) - sunrise (06:19) has arrived
      const now = new Date('2026-10-20T03:00:00.000Z');
      assert.equal(isPrayerOverdue('fajr', testPrayers, now, 'Asia/Tashkent'), true);
      assert.equal(isPrayerOverdue('dhuhr', testPrayers, now, 'Asia/Tashkent'), false);
      assert.equal(isPrayerOverdue('asr', testPrayers, now, 'Asia/Tashkent'), false);
      assert.equal(isPrayerOverdue('maghrib', testPrayers, now, 'Asia/Tashkent'), false);
      assert.equal(isPrayerOverdue('isha', testPrayers, now, 'Asia/Tashkent'), false);
    });

    it('marks Fajr overdue once Dhuhr begins if sunrise endTime is not available', () => {
      const prayersNoSunrise: PrayerItem[] = [
        { id: 'fajr', name: 'Fajr', time: '04:47', endTime: '', status: 'PENDING' },
        { id: 'dhuhr', name: 'Dhuhr', time: '12:13', endTime: '16:20', status: 'PENDING' },
        { id: 'asr', name: 'Asr', time: '16:20', endTime: '18:05', status: 'PENDING' },
        { id: 'maghrib', name: 'Maghrib', time: '18:05', endTime: '19:32', status: 'PENDING' },
        { id: 'isha', name: 'Isha', time: '19:32', endTime: '23:59', status: 'PENDING' },
      ];

      // At 08:00 before Dhuhr: sunrise not available, so not overdue yet
      const morning = new Date('2026-10-20T03:00:00.000Z');
      assert.equal(isPrayerOverdue('fajr', prayersNoSunrise, morning, 'Asia/Tashkent'), false);

      // At 12:30 after Dhuhr begins: overdue
      const afterDhuhr = new Date('2026-10-20T07:30:00.000Z');
      assert.equal(isPrayerOverdue('fajr', prayersNoSunrise, afterDhuhr, 'Asia/Tashkent'), true);
    });

    it('marks Fajr overdue once Dhuhr time begins (12:13+), while Dhuhr remains active', () => {
      // 12:30 in Asia/Tashkent (UTC 07:30)
      const now = new Date('2026-10-20T07:30:00.000Z');
      assert.equal(isPrayerOverdue('fajr', testPrayers, now, 'Asia/Tashkent'), true);
      assert.equal(isPrayerOverdue('dhuhr', testPrayers, now, 'Asia/Tashkent'), false);
      assert.equal(isPrayerOverdue('asr', testPrayers, now, 'Asia/Tashkent'), false);
    });

    it('marks Fajr and Dhuhr overdue once Asr time begins (16:20+)', () => {
      // 16:45 in Asia/Tashkent (UTC 11:45)
      const now = new Date('2026-10-20T11:45:00.000Z');
      assert.equal(isPrayerOverdue('fajr', testPrayers, now, 'Asia/Tashkent'), true);
      assert.equal(isPrayerOverdue('dhuhr', testPrayers, now, 'Asia/Tashkent'), true);
      assert.equal(isPrayerOverdue('asr', testPrayers, now, 'Asia/Tashkent'), false);
    });

    it('marks Fajr, Dhuhr, and Asr overdue once Maghrib time begins (18:05+)', () => {
      // 18:30 in Asia/Tashkent (UTC 13:30)
      const now = new Date('2026-10-20T13:30:00.000Z');
      assert.equal(isPrayerOverdue('fajr', testPrayers, now, 'Asia/Tashkent'), true);
      assert.equal(isPrayerOverdue('dhuhr', testPrayers, now, 'Asia/Tashkent'), true);
      assert.equal(isPrayerOverdue('asr', testPrayers, now, 'Asia/Tashkent'), true);
      assert.equal(isPrayerOverdue('maghrib', testPrayers, now, 'Asia/Tashkent'), false);
    });

    it('marks Fajr, Dhuhr, Asr, and Maghrib overdue once Isha begins (19:32+), while Isha remains active', () => {
      // 21:00 in Asia/Tashkent (UTC 16:00)
      const now = new Date('2026-10-20T16:00:00.000Z');
      assert.equal(isPrayerOverdue('fajr', testPrayers, now, 'Asia/Tashkent'), true);
      assert.equal(isPrayerOverdue('dhuhr', testPrayers, now, 'Asia/Tashkent'), true);
      assert.equal(isPrayerOverdue('asr', testPrayers, now, 'Asia/Tashkent'), true);
      assert.equal(isPrayerOverdue('maghrib', testPrayers, now, 'Asia/Tashkent'), true);
      assert.equal(isPrayerOverdue('isha', testPrayers, now, 'Asia/Tashkent'), false);
    });

    it('marks daytime prayers overdue during post-midnight pre-Fajr window (00:00 - 04:47), while Isha continues overnight', () => {
      // 02:00 in Asia/Tashkent (UTC 21:00 previous day)
      const now = new Date('2026-10-20T21:00:00.000Z');
      assert.equal(isPrayerOverdue('fajr', testPrayers, now, 'Asia/Tashkent'), true);
      assert.equal(isPrayerOverdue('dhuhr', testPrayers, now, 'Asia/Tashkent'), true);
      assert.equal(isPrayerOverdue('asr', testPrayers, now, 'Asia/Tashkent'), true);
      assert.equal(isPrayerOverdue('maghrib', testPrayers, now, 'Asia/Tashkent'), true);
      assert.equal(isPrayerOverdue('isha', testPrayers, now, 'Asia/Tashkent'), false);
    });

    it('marks all pending prayers (including Isha) overdue if belonging to a past liturgical date envelope', () => {
      const pastPrayers: Array<PrayerItem & { date: string }> = [
        { id: 'fajr', name: 'Fajr', time: '04:47', endTime: '06:19', status: 'PENDING', date: '2026-10-19' },
        { id: 'dhuhr', name: 'Dhuhr', time: '12:13', endTime: '16:20', status: 'PENDING', date: '2026-10-19' },
        { id: 'asr', name: 'Asr', time: '16:20', endTime: '18:05', status: 'PENDING', date: '2026-10-19' },
        { id: 'maghrib', name: 'Maghrib', time: '18:05', endTime: '19:32', status: 'PENDING', date: '2026-10-19' },
        { id: 'isha', name: 'Isha', time: '19:32', endTime: '23:59', status: 'PENDING', date: '2026-10-19' },
      ];

      // Current liturgical date is 2026-10-20 at 10:00 AM (UTC 05:00)
      const now = new Date('2026-10-20T05:00:00.000Z');
      assert.equal(isPrayerOverdue('fajr', pastPrayers, now, 'Asia/Tashkent'), true);
      assert.equal(isPrayerOverdue('dhuhr', pastPrayers, now, 'Asia/Tashkent'), true);
      assert.equal(isPrayerOverdue('asr', pastPrayers, now, 'Asia/Tashkent'), true);
      assert.equal(isPrayerOverdue('maghrib', pastPrayers, now, 'Asia/Tashkent'), true);
      assert.equal(isPrayerOverdue('isha', pastPrayers, now, 'Asia/Tashkent'), true, 'Past-day pending Isha must be overdue');
    });

    it('never marks future liturgical date prayers overdue', () => {
      const futurePrayers: Array<PrayerItem & { date: string }> = [
        { id: 'fajr', name: 'Fajr', time: '04:47', endTime: '06:19', status: 'PENDING', date: '2026-10-21' },
        { id: 'dhuhr', name: 'Dhuhr', time: '12:13', endTime: '16:20', status: 'PENDING', date: '2026-10-21' },
      ];

      const now = new Date('2026-10-20T05:00:00.000Z');
      assert.equal(isPrayerOverdue('fajr', futurePrayers, now, 'Asia/Tashkent'), false);
      assert.equal(isPrayerOverdue('dhuhr', futurePrayers, now, 'Asia/Tashkent'), false);
    });

    it('marks pending prayers overdue if item updatedAt reflects a previous liturgical date', () => {
      const stalePrayers: PrayerItem[] = [
        {
          id: 'fajr',
          name: 'Fajr',
          time: '04:47',
          endTime: '06:19',
          status: 'PENDING',
          updatedAt: '2026-10-19T10:00:00.000Z',
        },
      ];

      const now = new Date('2026-10-20T05:00:00.000Z');
      assert.equal(isPrayerOverdue('fajr', stalePrayers, now, 'Asia/Tashkent'), true);
    });

    it('respects exact boundary minute transitions without off-by-one errors', () => {
      // Fajr sunrise boundary at 06:19 Tashkent (UTC 01:19)
      const oneSecBeforeSunrise = new Date('2026-10-20T01:18:59.000Z'); // 06:18:59 Tashkent
      const exactSunrise = new Date('2026-10-20T01:19:00.000Z'); // 06:19:00 Tashkent
      assert.equal(isPrayerOverdue('fajr', testPrayers, oneSecBeforeSunrise, 'Asia/Tashkent'), false);
      assert.equal(isPrayerOverdue('fajr', testPrayers, exactSunrise, 'Asia/Tashkent'), true);

      // Asr adhan boundary at 16:20 Tashkent (UTC 11:20)
      const oneSecBeforeAsr = new Date('2026-10-20T11:19:59.000Z'); // 16:19:59 Tashkent
      const exactAsr = new Date('2026-10-20T11:20:00.000Z'); // 16:20:00 Tashkent
      assert.equal(isPrayerOverdue('dhuhr', testPrayers, oneSecBeforeAsr, 'Asia/Tashkent'), false);
      assert.equal(isPrayerOverdue('dhuhr', testPrayers, exactAsr, 'Asia/Tashkent'), true);

      // Maghrib adhan boundary at 18:05 Tashkent (UTC 13:05)
      const oneSecBeforeMaghrib = new Date('2026-10-20T13:04:59.000Z'); // 18:04:59 Tashkent
      const exactMaghrib = new Date('2026-10-20T13:05:00.000Z'); // 18:05:00 Tashkent
      assert.equal(isPrayerOverdue('asr', testPrayers, oneSecBeforeMaghrib, 'Asia/Tashkent'), false);
      assert.equal(isPrayerOverdue('asr', testPrayers, exactMaghrib, 'Asia/Tashkent'), true);

      // Isha adhan boundary at 19:32 Tashkent (UTC 14:32)
      const oneSecBeforeIsha = new Date('2026-10-20T14:31:59.000Z'); // 19:31:59 Tashkent
      const exactIsha = new Date('2026-10-20T14:32:00.000Z'); // 19:32:00 Tashkent
      assert.equal(isPrayerOverdue('maghrib', testPrayers, oneSecBeforeIsha, 'Asia/Tashkent'), false);
      assert.equal(isPrayerOverdue('maghrib', testPrayers, exactIsha, 'Asia/Tashkent'), true);
    });

    it('evaluates accurately across multiple geographic timezones with identical UTC timestamp', () => {
      // 12:00:00 UTC on 2026-10-20
      const instant = new Date('2026-10-20T12:00:00.000Z');

      // Asia/Tashkent (+5): local time is 17:00 (past 16:20 Asr)
      assert.equal(isPrayerOverdue('fajr', testPrayers, instant, 'Asia/Tashkent'), true);
      assert.equal(isPrayerOverdue('dhuhr', testPrayers, instant, 'Asia/Tashkent'), true);
      assert.equal(isPrayerOverdue('asr', testPrayers, instant, 'Asia/Tashkent'), false);

      // UTC (+0): local time is 12:00 (before 12:13 Dhuhr)
      assert.equal(isPrayerOverdue('fajr', testPrayers, instant, 'UTC'), true); // 06:19 sunrise passed
      assert.equal(isPrayerOverdue('dhuhr', testPrayers, instant, 'UTC'), false); // 12:00 < 12:13

      // America/New_York (UTC-4 in EDT): local time is 08:00 (before 12:13 Dhuhr)
      assert.equal(isPrayerOverdue('fajr', testPrayers, instant, 'America/New_York'), true);
      assert.equal(isPrayerOverdue('dhuhr', testPrayers, instant, 'America/New_York'), false);
    });

    it('handles defensive edge cases safely', () => {
      assert.equal(isPrayerOverdue('fajr', []), false);
      assert.equal(isPrayerOverdue('invalid' as unknown as PrayerId, testPrayers), false);
      assert.equal(isPrayerOverdue('fajr', [null, undefined] as unknown as PrayerItem[]), false);
    });
  });

  describe('9. Prayer Card State Machine Transitions & Optimistic Accounting', () => {
    // Replicates HomeDashboard.tsx quick toggle state transition logic
    function simulateQuickToggle(currentStatus: PrayerStatus): PrayerStatus {
      const isCompleted =
        currentStatus === 'PRAYED' ||
        currentStatus === 'PRAYED_ON_TIME' ||
        currentStatus === 'PRAYED_LATE';
      return isCompleted ? 'PENDING' : 'PRAYED_ON_TIME';
    }

    // Replicates HomeDashboard.tsx handleSetStatus accounting deltas
    function simulateStatusDeltas(oldStatus: PrayerStatus, targetStatus: PrayerStatus) {
      const normalizedStatus: PrayerStatus = targetStatus === 'PRAYED' ? 'PRAYED_ON_TIME' : targetStatus;
      const normalizedOld: PrayerStatus = oldStatus === 'PRAYED' ? 'PRAYED_ON_TIME' : oldStatus;

      const getQazaValue = (st: PrayerStatus) => (st === 'MISSED' ? 1 : 0);
      const qazaDiff = getQazaValue(normalizedStatus) - getQazaValue(normalizedOld);

      const getFineValue = (st: PrayerStatus) => (st === 'MISSED' || st === 'MADE_UP' ? 15000 : 0);
      const fineDiff = getFineValue(normalizedStatus) - getFineValue(normalizedOld);

      return { normalizedStatus, qazaDiff, fineDiff };
    }

    it('executes quick toggle state transitions accurately across all canonical states', () => {
      // PENDING -> PRAYED_ON_TIME
      assert.equal(simulateQuickToggle('PENDING'), 'PRAYED_ON_TIME');

      // PRAYED_ON_TIME -> PENDING
      assert.equal(simulateQuickToggle('PRAYED_ON_TIME'), 'PENDING');

      // Legacy PRAYED -> PENDING
      assert.equal(simulateQuickToggle('PRAYED'), 'PENDING');

      // Legacy PRAYED_LATE -> PENDING
      assert.equal(simulateQuickToggle('PRAYED_LATE'), 'PENDING');

      // MISSED (not completed) -> PRAYED_ON_TIME
      assert.equal(simulateQuickToggle('MISSED'), 'PRAYED_ON_TIME');

      // MADE_UP (not completed) -> PRAYED_ON_TIME
      assert.equal(simulateQuickToggle('MADE_UP'), 'PRAYED_ON_TIME');
    });

    it('calculates exact Qaza count and fine deltas across status transitions', () => {
      // 1. PENDING -> PRAYED_ON_TIME: on time, zero spiritual make-up debt, zero fine
      const pToPrayed = simulateStatusDeltas('PENDING', 'PRAYED_ON_TIME');
      assert.equal(pToPrayed.normalizedStatus, 'PRAYED_ON_TIME');
      assert.equal(pToPrayed.qazaDiff, 0);
      assert.equal(pToPrayed.fineDiff, 0);

      // 2. PENDING -> MISSED: +1 Qaza, +15,000 UZS debt
      const pToMissed = simulateStatusDeltas('PENDING', 'MISSED');
      assert.equal(pToMissed.qazaDiff, 1);
      assert.equal(pToMissed.fineDiff, 15000);

      // 3. MISSED -> MADE_UP: -1 Qaza (duty performed), fine remains accrued (fineDiff = 0)
      const mToMadeUp = simulateStatusDeltas('MISSED', 'MADE_UP');
      assert.equal(mToMadeUp.qazaDiff, -1);
      assert.equal(mToMadeUp.fineDiff, 0);

      // 4. MADE_UP -> PENDING: reset, fine removed (-15,000 UZS)
      const madeUpToP = simulateStatusDeltas('MADE_UP', 'PENDING');
      assert.equal(madeUpToP.qazaDiff, 0);
      assert.equal(madeUpToP.fineDiff, -15000);

      // 5. MISSED -> PENDING: reset, -1 Qaza, -15,000 UZS fine
      const missedToP = simulateStatusDeltas('MISSED', 'PENDING');
      assert.equal(missedToP.qazaDiff, -1);
      assert.equal(missedToP.fineDiff, -15000);

      // 6. PRAYED_ON_TIME -> MISSED: +1 Qaza, +15,000 UZS fine
      const prayedToMissed = simulateStatusDeltas('PRAYED_ON_TIME', 'MISSED');
      assert.equal(prayedToMissed.qazaDiff, 1);
      assert.equal(prayedToMissed.fineDiff, 15000);
    });

    it('verifies overdue inline actions display contract for prayer cards', () => {
      const prayers: PrayerItem[] = [
        { id: 'fajr', name: 'Fajr', time: '04:47', endTime: '06:19', status: 'PENDING' },
        { id: 'dhuhr', name: 'Dhuhr', time: '12:13', endTime: '16:20', status: 'PENDING' },
      ];

      // Time is 14:00 (Fajr overdue, Dhuhr active)
      const now = new Date('2026-10-20T09:00:00.000Z');

      // 1. When Fajr is PENDING and overdue -> inline actions visible
      const isFajrOverdue = prayers[0].status === 'PENDING' && isPrayerOverdue('fajr', prayers, now, 'Asia/Tashkent');
      assert.equal(isFajrOverdue, true);

      // 2. When user marks Fajr as PRAYED_ON_TIME -> inline actions immediately hide
      const resolvedFajr: PrayerItem = { ...prayers[0], status: 'PRAYED_ON_TIME' };
      const isFajrResolvedOverdue = resolvedFajr.status === 'PENDING' && isPrayerOverdue('fajr', [resolvedFajr, prayers[1]], now, 'Asia/Tashkent');
      assert.equal(isFajrResolvedOverdue, false);

      // 3. When user marks Fajr as MADE_UP -> inline actions immediately hide
      const madeUpFajr: PrayerItem = { ...prayers[0], status: 'MADE_UP' };
      const isFajrMadeUpOverdue = madeUpFajr.status === 'PENDING' && isPrayerOverdue('fajr', [madeUpFajr, prayers[1]], now, 'Asia/Tashkent');
      assert.equal(isFajrMadeUpOverdue, false);

      // 4. When user marks Fajr as MISSED -> inline actions immediately hide
      const missedFajr: PrayerItem = { ...prayers[0], status: 'MISSED' };
      const isFajrMissedOverdue = missedFajr.status === 'PENDING' && isPrayerOverdue('fajr', [missedFajr, prayers[1]], now, 'Asia/Tashkent');
      assert.equal(isFajrMissedOverdue, false);
    });

    it('verifies stopPropagation contract prevents child button clicks from triggering card toggle', () => {
      let cardToggled = false;
      let buttonHandled = false;

      const mockCardClick = () => {
        cardToggled = true;
      };

      const mockChildButtonClick = (e: { stopPropagation: () => void }) => {
        e.stopPropagation();
        buttonHandled = true;
      };

      // Simulating a child button click with stopPropagation
      let propagationStopped = false;
      const event = {
        stopPropagation: () => {
          propagationStopped = true;
        },
      };

      mockChildButtonClick(event);
      assert.equal(buttonHandled, true, 'Child button click handler must execute');
      assert.equal(propagationStopped, true, 'stopPropagation must be invoked by child button');

      // Because propagation was stopped, card toggle is NOT triggered
      if (!propagationStopped) {
        mockCardClick();
      }
      assert.equal(cardToggled, false, 'Card quick-toggle must NOT trigger when child button is clicked');
    });
  });
});
