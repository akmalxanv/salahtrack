import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDayEvents,
  dueEvents,
  localTimeToInstant,
  formatLocalTime,
  type DayTimings,
} from '../../src/lib/telegram/schedule.ts';
import { escapeHtml, mentionHtml } from '../../src/lib/telegram/api.ts';
import { generateLinkCode, hashLinkCode, isWellFormedLinkCode, buildDeepLink } from '../../src/lib/telegram/link.ts';
import { parseCommand, normalizeInviteCode } from '../../src/lib/telegram/commands.ts';
import { botText } from '../../src/lib/telegram/messages.ts';

// Tashkent, UTC+5. 2026-11-27 is a Friday.
const TZ = 5;
const timings: DayTimings = {
  fajr: '06:05',
  sunrise: '07:30',
  dhuhr: '12:15',
  asr: '15:05',
  maghrib: '16:55',
  isha: '18:20',
  midnight: '00:10',
};
const at = (date: string, hhmm: string) => localTimeToInstant(date, hhmm, TZ);
const ids = (now: number, date = '2026-11-27') => dueEvents(buildDayEvents(date, timings, TZ), now).map((e) => e.id);

describe('telegram schedule', () => {
  it('converts local wall time to UTC using the offset', () => {
    assert.equal(new Date(at('2026-11-27', '06:05')).toISOString(), '2026-11-27T01:05:00.000Z');
    assert.equal(formatLocalTime(at('2026-11-27', '23:59'), TZ), '23:59');
  });

  it('fires the prayer-start event inside its window only', () => {
    assert.deepEqual(ids(at('2026-11-27', '15:04')), []);
    assert.deepEqual(ids(at('2026-11-27', '15:05')), ['start:asr']);
    assert.deepEqual(ids(at('2026-11-27', '15:19')), ['start:asr']);
    assert.deepEqual(ids(at('2026-11-27', '15:20')), []); // window closed: no stale message
  });

  it('nudges 30 minutes before the prayer ends', () => {
    assert.deepEqual(ids(at('2026-11-27', '16:25')), ['nudge:asr']);
    assert.deepEqual(ids(at('2026-11-27', '07:00')), ['nudge:fajr']);
  });

  it('anchors the Isha nudge to Islamic midnight, crossing local midnight', () => {
    const events = buildDayEvents('2026-11-27', timings, TZ);
    const isha = events.find((e) => e.id === 'nudge:isha');
    assert.ok(isha);
    assert.equal(formatLocalTime(isha.at, TZ), '23:40');
    // Midnight after the day boundary must roll to the next day
    const late = buildDayEvents('2026-11-27', { ...timings, midnight: '00:40' }, TZ).find((e) => e.id === 'nudge:isha');
    assert.equal(new Date(late!.at).toISOString(), '2026-11-27T19:10:00.000Z'); // 00:10 local on the 28th
  });

  it('falls back to Isha + 2h30 when midnight is unknown', () => {
    const isha = buildDayEvents('2026-11-27', { ...timings, midnight: undefined }, TZ).find((e) => e.id === 'nudge:isha');
    assert.equal(formatLocalTime(isha!.at, TZ), '20:20');
  });

  it('never nudges sooner than 15 min after start for short windows', () => {
    const tight = buildDayEvents('2026-11-27', { ...timings, maghrib: '16:55', isha: '17:20' }, TZ);
    const nudge = tight.find((e) => e.id === 'nudge:maghrib');
    assert.equal(formatLocalTime(nudge!.at, TZ), '17:10');
  });

  it('schedules the daily summary every day and the weekly board only on Friday', () => {
    assert.ok(ids(at('2026-11-27', '21:30')).includes('summary'));
    assert.ok(ids(at('2026-11-27', '10:05')).includes('weekly'));
    const thursday = dueEvents(buildDayEvents('2026-11-26', timings, TZ), at('2026-11-26', '10:05'));
    assert.equal(thursday.some((e) => e.id === 'weekly'), false);
  });
});

describe('telegram html safety', () => {
  it('escapes user-controlled names', () => {
    assert.equal(escapeHtml('<b>A & B</b>'), '&lt;b&gt;A &amp; B&lt;/b&gt;');
    assert.equal(mentionHtml(42, '<script>'), '<a href="tg://user?id=42">&lt;script&gt;</a>');
  });

  it('debt summary formats amounts and includes the disclaimer', () => {
    const html = botText.debtSummary('en', [{ mention: 'A', debt: 30000, pendingQaza: 2 }], 30000);
    assert.match(html, /30,000 UZS · 2 qaza/);
    assert.match(html, /not a religious ruling/);
  });
});

describe('telegram link codes', () => {
  it('generates url-safe 32-char codes and stores only a hash', () => {
    const { code, hash } = generateLinkCode();
    assert.ok(isWellFormedLinkCode(code));
    assert.equal(hash, hashLinkCode(code));
    assert.notEqual(hash, code);
    assert.equal(isWellFormedLinkCode('short'), false);
    assert.equal(isWellFormedLinkCode({ $gt: '' }), false); // NoSQL operator injection
  });

  it('builds deep links only for a valid bot username', () => {
    assert.equal(buildDeepLink('abc', 'SalahTrackBot'), 'https://t.me/SalahTrackBot?start=abc');
    assert.equal(buildDeepLink('abc', 'bad/name'), null);
    assert.equal(buildDeepLink('abc', ''), null);
  });
});

describe('telegram command parsing', () => {
  it('parses commands, arguments and bot mentions', () => {
    assert.deepEqual(parseCommand('/connect AB12CD', 'SalahBot'), { name: 'connect', arg: 'AB12CD' });
    assert.deepEqual(parseCommand('/times@SalahBot', 'SalahBot'), { name: 'times', arg: '' });
    assert.equal(parseCommand('/times@OtherBot', 'SalahBot'), null);
    assert.equal(parseCommand('hello', 'SalahBot'), null);
  });
});

describe('telegram invite codes', () => {
  it('accepts the stored XXXX-XXXX format in any case, with or without hyphen', () => {
    assert.equal(normalizeInviteCode('DJCV-4WGF'), 'DJCV-4WGF');
    assert.equal(normalizeInviteCode(' djcv-4wgf '), 'DJCV-4WGF');
    assert.equal(normalizeInviteCode('DJCV4WGF'), 'DJCV-4WGF');
  });

  it('rejects malformed codes', () => {
    assert.equal(normalizeInviteCode('DJCV-4WG'), null);
    assert.equal(normalizeInviteCode('DJCV--4WGF'), null);
    assert.equal(normalizeInviteCode('{"$gt":""}'), null);
  });
});
