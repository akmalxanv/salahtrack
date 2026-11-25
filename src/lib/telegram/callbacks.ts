/**
 * Inline-button payloads (Telegram `callback_data`, max 64 bytes).
 *
 * SECURITY: a modified client can send ANY callback_data, not only what our buttons
 * carry. So the payload is treated as untrusted input: it is parsed strictly here, and
 * it never names a user — the acting user always comes from the verified Telegram
 * sender (callback_query.from.id) mapped through the one-time link.
 *
 * Formats:
 *   s|<view>|<yyyymmdd>|<prayer>|<action>   set a prayer status, then refresh <view>
 *   p|<yyyymmdd>|<prayer>                   pay one qaza fine
 *   pa                                      ask to confirm "pay all"
 *   pa!|<count>|<total>                     pay all, only if the debt still matches what was confirmed
 *   v|<view>[|<page>]                       show / refresh a personal view
 *   md                                      (group button) send me my debts privately
 */
import type { PrayerId, PrayerStatus } from '../../types/prayer.ts';

/** t = today, q = qaza/debts, s = stats, g = group message (reply with a toast only). */
export type CallbackView = 't' | 'q' | 's' | 'g';

/**
 * T = toggle prayed (prayed ↔ pending, like tapping a prayer card on the dashboard)
 * P = prayed, U = made up, M = missed (qaza), R = reset to pending.
 */
export type StatusAction = 'T' | 'P' | 'U' | 'M' | 'R';

export type CallbackAction =
  | { kind: 'status'; view: CallbackView; date: string; prayer: PrayerId; action: StatusAction }
  | { kind: 'pay'; date: string; prayer: PrayerId }
  | { kind: 'payAllAsk' }
  | { kind: 'payAll'; count: number; total: number }
  | { kind: 'view'; view: Exclude<CallbackView, 'g'>; page: number }
  | { kind: 'myDebts' };

const PRAYERS: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const VIEWS: CallbackView[] = ['t', 'q', 's', 'g'];
const ACTIONS: StatusAction[] = ['T', 'P', 'U', 'M', 'R'];

const compactDate = (date: string) => date.replace(/-/g, '');

function expandDate(raw: string | undefined): string | null {
  const m = raw ? /^(\d{4})(\d{2})(\d{2})$/.exec(raw) : null;
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(`${date}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date ? date : null;
}

const asPrayer = (raw: string | undefined): PrayerId | null => (PRAYERS.includes(raw as PrayerId) ? (raw as PrayerId) : null);

function asInt(raw: string | undefined, max: number): number | null {
  if (!raw || !/^\d{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= max ? n : null;
}

export const cb = {
  status: (view: CallbackView, date: string, prayer: PrayerId, action: StatusAction) =>
    `s|${view}|${compactDate(date)}|${prayer}|${action}`,
  pay: (date: string, prayer: PrayerId) => `p|${compactDate(date)}|${prayer}`,
  payAllAsk: () => 'pa',
  payAll: (count: number, total: number) => `pa!|${count}|${total}`,
  view: (view: Exclude<CallbackView, 'g'>, page = 0) => (page > 0 ? `v|${view}|${page}` : `v|${view}`),
  myDebts: () => 'md',
};

export function parseCallbackData(data: string | undefined): CallbackAction | null {
  if (!data || data.length > 64) return null;
  const parts = data.split('|');
  switch (parts[0]) {
    case 's': {
      if (parts.length !== 5) return null;
      const view = parts[1] as CallbackView;
      const date = expandDate(parts[2]);
      const prayer = asPrayer(parts[3]);
      const action = parts[4] as StatusAction;
      if (!VIEWS.includes(view) || !date || !prayer || !ACTIONS.includes(action)) return null;
      return { kind: 'status', view, date, prayer, action };
    }
    case 'p': {
      if (parts.length !== 3) return null;
      const date = expandDate(parts[1]);
      const prayer = asPrayer(parts[2]);
      return date && prayer ? { kind: 'pay', date, prayer } : null;
    }
    case 'pa':
      return parts.length === 1 ? { kind: 'payAllAsk' } : null;
    case 'pa!': {
      if (parts.length !== 3) return null;
      const count = asInt(parts[1], 100000);
      const total = asInt(parts[2], 1e12);
      return count !== null && total !== null ? { kind: 'payAll', count, total } : null;
    }
    case 'v': {
      if (parts.length < 2 || parts.length > 3) return null;
      const view = parts[1];
      if (view !== 't' && view !== 'q' && view !== 's') return null;
      const page = parts.length === 3 ? asInt(parts[2], 1000) : 0;
      return page === null ? null : { kind: 'view', view, page };
    }
    case 'md':
      return parts.length === 1 ? { kind: 'myDebts' } : null;
    default:
      return null;
  }
}

/** The status a button press leads to, given the prayer's current status. */
export function resolveStatusAction(action: StatusAction, current: PrayerStatus | undefined): PrayerStatus {
  const done = current === 'PRAYED_ON_TIME' || current === 'PRAYED' || current === 'PRAYED_LATE';
  switch (action) {
    case 'T':
      return done ? 'PENDING' : 'PRAYED_ON_TIME';
    case 'P':
      return 'PRAYED_ON_TIME';
    case 'U':
      return 'MADE_UP';
    case 'M':
      return 'MISSED';
    case 'R':
      return 'PENDING';
  }
}
