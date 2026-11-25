import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { cb, parseCallbackData, resolveStatusAction } from '../../src/lib/telegram/callbacks.ts';
import {
  renderToday,
  renderQaza,
  renderPayAllConfirm,
  renderStats,
  sortQazaItems,
  QAZA_PAGE_SIZE,
  type QazaItemView,
} from '../../src/lib/telegram/personal-text.ts';
import { eventKeyboard } from '../../src/lib/telegram/notify.ts';
import { buildDayEvents } from '../../src/lib/telegram/schedule.ts';
import { qazaAmount } from '../../src/lib/prayer-actions.ts';
import type { InlineKeyboard } from '../../src/lib/telegram/api.ts';
import type { BotLang } from '../../src/lib/telegram/messages.ts';

const LANGS: BotLang[] = ['uz', 'ru', 'en'];

/** Every button must fit Telegram's 64-byte limit and round-trip through the strict parser. */
function assertKeyboardValid(keyboard: InlineKeyboard): void {
  for (const row of keyboard) {
    for (const button of row) {
      assert.ok(Buffer.byteLength(button.callback_data) <= 64, `too long: ${button.callback_data}`);
      assert.ok(parseCallbackData(button.callback_data), `unparseable: ${button.callback_data}`);
      assert.ok(button.text.length > 0);
    }
  }
}

describe('telegram callback payloads', () => {
  it('round-trips every kind of payload', () => {
    assert.deepEqual(parseCallbackData(cb.status('t', '2026-11-25', 'fajr', 'T')), {
      kind: 'status',
      view: 't',
      date: '2026-11-25',
      prayer: 'fajr',
      action: 'T',
    });
    assert.deepEqual(parseCallbackData(cb.pay('2026-02-28', 'isha')), { kind: 'pay', date: '2026-02-28', prayer: 'isha' });
    assert.deepEqual(parseCallbackData(cb.payAllAsk()), { kind: 'payAllAsk' });
    assert.deepEqual(parseCallbackData(cb.payAll(12, 195000)), { kind: 'payAll', count: 12, total: 195000 });
    assert.deepEqual(parseCallbackData(cb.view('q', 3)), { kind: 'view', view: 'q', page: 3 });
    assert.deepEqual(parseCallbackData(cb.view('s')), { kind: 'view', view: 's', page: 0 });
    assert.deepEqual(parseCallbackData(cb.myDebts()), { kind: 'myDebts' });
  });

  it('rejects tampered or malformed payloads (clients can send any callback_data)', () => {
    for (const bad of [
      undefined,
      '',
      'x',
      's|t|20261125|fajr', // missing action
      's|t|20261125|fajr|X', // unknown action
      's|z|20261125|fajr|P', // unknown view
      's|t|20260231|fajr|P', // impossible date
      's|t|2026-11-25|fajr|P', // wrong date encoding
      's|t|20261125|tahajjud|P', // unknown prayer
      's|t|20261125|__proto__|P',
      'p|20261125',
      'p|20261125|fajr|extra',
      'pa|1',
      'pa!|-1|100',
      'pa!|1|1e9',
      'pa!|1',
      'v|g', // group view is not a personal view
      'v|q|-1',
      'v|q|abc',
      'md|x',
      `s|t|20261125|fajr|P${'x'.repeat(70)}`,
      '{"$gt":""}',
    ]) {
      assert.equal(parseCallbackData(bad), null, `should reject ${bad}`);
    }
  });

  it('resolves toggle actions like the dashboard buttons', () => {
    assert.equal(resolveStatusAction('T', 'PENDING'), 'PRAYED_ON_TIME');
    assert.equal(resolveStatusAction('T', undefined), 'PRAYED_ON_TIME');
    assert.equal(resolveStatusAction('T', 'MISSED'), 'PRAYED_ON_TIME');
    assert.equal(resolveStatusAction('T', 'PRAYED_ON_TIME'), 'PENDING');
    assert.equal(resolveStatusAction('T', 'PRAYED_LATE'), 'PENDING');
    assert.equal(resolveStatusAction('T', 'PRAYED'), 'PENDING');
    assert.equal(resolveStatusAction('P', 'PRAYED_ON_TIME'), 'PRAYED_ON_TIME'); // group button is idempotent
    assert.equal(resolveStatusAction('U', 'MISSED'), 'MADE_UP');
    assert.equal(resolveStatusAction('M', 'PENDING'), 'MISSED');
    assert.equal(resolveStatusAction('R', 'MISSED'), 'PENDING');
  });
});

describe('telegram personal views', () => {
  const statuses = { fajr: 'PRAYED_ON_TIME', dhuhr: 'MISSED', asr: 'MADE_UP', maghrib: 'PENDING', isha: 'PENDING' } as const;

  it('renders today with one row of buttons per prayer and valid payloads', () => {
    for (const lang of LANGS) {
      const v = renderToday(lang, { date: '2026-11-25', city: 'Toshkent <b>', statuses, debt: 30000, pendingQaza: 1 });
      assert.equal(v.keyboard.length, 6); // 5 prayers + navigation
      assertKeyboardValid(v.keyboard);
      assert.ok(v.html.includes('Toshkent &lt;b&gt;'), 'city must be escaped');
      assert.ok(!v.html.includes('<b>>'));
    }
  });

  it('makes an active status button undo itself', () => {
    const v = renderToday('en', { date: '2026-11-25', statuses, debt: 0, pendingQaza: 0 });
    const dhuhrRow = v.keyboard[1];
    assert.equal(parseCallbackData(dhuhrRow[2].callback_data)?.kind, 'status');
    assert.deepEqual(parseCallbackData(dhuhrRow[2].callback_data), { kind: 'status', view: 't', date: '2026-11-25', prayer: 'dhuhr', action: 'R' });
    assert.deepEqual(parseCallbackData(dhuhrRow[1].callback_data), { kind: 'status', view: 't', date: '2026-11-25', prayer: 'dhuhr', action: 'U' });
    const asrRow = v.keyboard[2];
    assert.deepEqual(parseCallbackData(asrRow[1].callback_data), { kind: 'status', view: 't', date: '2026-11-25', prayer: 'asr', action: 'R' });
  });

  const items: QazaItemView[] = Array.from({ length: QAZA_PAGE_SIZE + 2 }, (_, i) => ({
    date: `2026-11-${String(20 - i).padStart(2, '0')}`,
    prayerId: i % 2 ? 'isha' : 'fajr',
    status: i % 3 ? 'MISSED' : 'MADE_UP',
    amount: 15000,
    isOverdue: false,
  }));

  it('sorts qaza oldest first and pages the list', () => {
    const sorted = sortQazaItems(items);
    assert.equal(sorted[0].date, '2026-11-13');
    const p0 = renderQaza('uz', { items, totalDebt: 120000, pendingQaza: 5, page: 0 });
    const p1 = renderQaza('uz', { items, totalDebt: 120000, pendingQaza: 5, page: 1 });
    const p9 = renderQaza('uz', { items, totalDebt: 120000, pendingQaza: 5, page: 9 }); // clamped
    for (const v of [p0, p1, p9]) assertKeyboardValid(v.keyboard);
    assert.ok(p0.html.includes('1. 2026-11-13'));
    assert.ok(p1.html.includes(`${QAZA_PAGE_SIZE + 1}. `));
    assert.equal(p1.html, p9.html);
    // pay-all button carries no amount (the server recomputes and asks to confirm)
    const payAllRow = p0.keyboard.find((row) => row.some((b) => b.callback_data === 'pa'));
    assert.ok(payAllRow);
  });

  it('offers "made up" only for MISSED items', () => {
    const v = renderQaza('en', { items: items.slice(0, 2), totalDebt: 30000, pendingQaza: 1, page: 0 });
    const madeUp = v.keyboard[0]; // first item (oldest) is index 1 → MISSED
    assert.equal(madeUp.length, 2);
    const other = v.keyboard[1]; // index 0 → MADE_UP
    assert.equal(other.length, 1);
  });

  it('renders the empty state, confirmation and stats in every language', () => {
    for (const lang of LANGS) {
      const empty = renderQaza(lang, { items: [], totalDebt: 0, pendingQaza: 0, page: 0 });
      assertKeyboardValid(empty.keyboard);
      const confirm = renderPayAllConfirm(lang, 3, 45000);
      assertKeyboardValid(confirm.keyboard);
      assert.deepEqual(parseCallbackData(confirm.keyboard[0][0].callback_data), { kind: 'payAll', count: 3, total: 45000 });
      const stats = renderStats(lang, {
        streak: { current: 2, best: 9 },
        weekly: { completed: 30, percentage: 86 },
        monthly: { completed: 120, percentage: 80 },
        totalDebt: 15000,
        pendingQaza: 1,
        completedQaza: 4,
      });
      assertKeyboardValid(stats.keyboard);
      assert.ok(stats.html.includes('9'));
    }
  });
});

describe('telegram group announcement buttons', () => {
  const events = buildDayEvents(
    '2026-11-27',
    { fajr: '06:05', sunrise: '07:30', dhuhr: '12:15', asr: '15:05', maghrib: '16:55', isha: '18:20', midnight: '00:10' },
    5
  );

  it('adds an "I prayed" button to start and nudge messages, and "my debts" to the summary', () => {
    for (const event of events) {
      const kb = eventKeyboard(event, '2026-11-27', 'uz');
      if (event.kind === 'weekly') {
        assert.equal(kb, undefined);
        continue;
      }
      assert.ok(kb);
      assertKeyboardValid(kb);
      const action = parseCallbackData(kb[0][0].callback_data);
      if (event.kind === 'summary') {
        assert.deepEqual(action, { kind: 'myDebts' });
      } else {
        assert.deepEqual(action, { kind: 'status', view: 'g', date: '2026-11-27', prayer: event.prayer, action: 'P' });
      }
    }
  });
});

describe('qaza fine amounts', () => {
  it('matches the payment route: base fine, +penalty after the 7-day grace period for MISSED only', () => {
    assert.deepEqual(qazaAmount('MISSED', '2026-11-18', '2026-11-25'), { amount: 15000, isOverdue: false }); // day 7
    assert.deepEqual(qazaAmount('MISSED', '2026-11-17', '2026-11-25'), { amount: 30000, isOverdue: true }); // day 8
    assert.deepEqual(qazaAmount('MADE_UP', '2026-10-01', '2026-11-25'), { amount: 15000, isOverdue: false });
  });
});
