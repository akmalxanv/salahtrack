/**
 * Personal bot features: everything a linked user can do on the website's dashboard,
 * qaza page and stats page, done from Telegram with inline buttons.
 *
 * Authorization: the acting SalahTrack user is ALWAYS resolved from the Telegram sender
 * id (set by Telegram, not by the client) through the one-time link. Callback payloads
 * carry only a date / prayer / action and are validated as untrusted input.
 */
import { User } from '../../models/User.ts';
import { PrayerRecord } from '../../models/Prayer.ts';
import {
  loadUserSummary,
  payQazaItems,
  setPrayerStatus,
  MAX_PAY_ITEMS,
} from '../prayer-actions.ts';
import { getDateWithDayOffset } from '../prayer-rollover.ts';
import type { PrayerId, PrayerStatus } from '../../types/prayer.ts';
import {
  answerCallback,
  editMessage,
  sendMessage,
  sendMessageDetailed,
  type InlineKeyboard,
  type TelegramCallbackQuery,
} from './api.ts';
import { parseCallbackData, resolveStatusAction, type CallbackAction } from './callbacks.ts';
import { sanitizeBotLang, type BotLang } from './messages.ts';
import {
  PERSONAL_PRAYERS,
  renderPayAllConfirm,
  renderQaza,
  renderStats,
  renderToday,
  toast,
  type QazaItemView,
} from './personal-text.ts';
import { getUserClock, type UserClock, type UserPrefs } from './user-context.ts';

/** Buttons on group messages act on the presser's own record for that day; stop after this many days. */
export const GROUP_BUTTON_MAX_AGE_DAYS = 2;
const CALLBACK_MIN_INTERVAL_MS = 400;
const lastCallbackAt = new Map<number, number>();

interface LinkedUser {
  _id: { toString(): string };
  name: string;
  preferences?: UserPrefs;
}

export async function findLinkedUserForTelegram(telegramUserId: number | undefined): Promise<LinkedUser | null> {
  if (typeof telegramUserId !== 'number') return null;
  return User.findOne({ 'telegram.userId': telegramUserId }).select('_id name preferences').lean<LinkedUser>();
}

type View = { html: string; keyboard: InlineKeyboard };

export async function buildView(user: LinkedUser, view: 't' | 'q' | 's', page = 0, clock?: UserClock): Promise<View> {
  const lang = sanitizeBotLang(user.preferences?.language);
  const c = clock ?? (await getUserClock(user.preferences));
  const summary = await loadUserSummary(user._id.toString(), { today: c.today, timezone: c.timezone });

  if (view === 't') {
    const statuses: Partial<Record<PrayerId, PrayerStatus>> = {};
    const times: Partial<Record<PrayerId, string>> = {};
    for (const p of PERSONAL_PRAYERS) {
      statuses[p] = summary.today?.[p]?.status ?? 'PENDING';
      if (c.times) times[p] = c.times.timings[p].time;
    }
    return renderToday(lang, {
      date: c.today,
      city: c.city,
      statuses,
      times,
      debt: summary.debt.totalFinancialDebt,
      pendingQaza: summary.debt.pendingQazaCount,
    });
  }
  if (view === 'q') {
    return renderQaza(lang, {
      items: unpaidItems(summary.debt.items),
      totalDebt: summary.debt.totalFinancialDebt,
      pendingQaza: summary.debt.pendingQazaCount,
      page,
    });
  }
  return renderStats(lang, {
    streak: summary.streak,
    weekly: summary.weekly,
    monthly: summary.monthly,
    totalDebt: summary.debt.totalFinancialDebt,
    pendingQaza: summary.debt.pendingQazaCount,
    completedQaza: summary.debt.completedQazaCount,
  });
}

function unpaidItems(items: { date: string; prayerId: PrayerId; status: PrayerStatus; totalAmount: number; isOverdue: boolean; isPaid?: boolean }[]): QazaItemView[] {
  return items
    .filter((it) => !it.isPaid && it.totalAmount > 0)
    .map((it) => ({ date: it.date, prayerId: it.prayerId, status: it.status, amount: it.totalAmount, isOverdue: it.isOverdue }));
}

/** /today, /qaza, /stats in a private chat. */
export async function sendPersonalView(chatId: number, user: LinkedUser, view: 't' | 'q' | 's'): Promise<boolean> {
  const v = await buildView(user, view);
  return sendMessage(chatId, v.html, v.keyboard);
}

/** Private /lang: changes the user's app language (same field as Settings on the website). */
export async function setUserLanguage(user: LinkedUser, lang: BotLang): Promise<void> {
  await User.updateOne({ _id: user._id.toString() }, { $set: { 'preferences.language': lang } });
}

/** Private /unlink: same effect as "Disconnect" on the website's Telegram card. */
export async function unlinkTelegram(user: LinkedUser): Promise<void> {
  await User.updateOne({ _id: user._id.toString() }, { $unset: { telegram: 1, telegramLinkCodeHash: 1, telegramLinkExpires: 1 } });
}

export async function handleCallbackQuery(query: TelegramCallbackQuery): Promise<void> {
  const action = parseCallbackData(query.data);
  const user = await findLinkedUserForTelegram(query.from.id);
  const lang = sanitizeBotLang(user?.preferences?.language);

  if (!action) {
    await answerCallback(query.id);
    return;
  }
  if (!user) {
    await answerCallback(query.id, toast.mustLink(lang), true);
    return;
  }

  // Cheap per-user throttle against button spam (each press hits the database)
  const now = Date.now();
  if (now - (lastCallbackAt.get(query.from.id) ?? 0) < CALLBACK_MIN_INTERVAL_MS) {
    await answerCallback(query.id, toast.tooFast(lang));
    return;
  }
  lastCallbackAt.set(query.from.id, now);
  if (lastCallbackAt.size > 10000) lastCallbackAt.clear();

  try {
    await runAction(query, user, lang, action);
  } catch (err) {
    console.error('[telegram] callback failed:', err);
    await answerCallback(query.id, toast.error(lang));
  }
}

async function runAction(query: TelegramCallbackQuery, user: LinkedUser, lang: BotLang, action: CallbackAction): Promise<void> {
  const msg = query.message;
  const isPrivate = msg?.chat.type === 'private';
  const userId = user._id.toString();

  /** Re-renders the message the button belongs to (private chats only). */
  const refresh = async (view: 't' | 'q' | 's', page = 0, clock?: UserClock) => {
    if (!msg || !isPrivate) return;
    const v = await buildView(user, view, page, clock);
    await editMessage(msg.chat.id, msg.message_id, v.html, v.keyboard);
  };

  switch (action.kind) {
    case 'view': {
      if (!isPrivate) {
        await answerCallback(query.id);
        return;
      }
      await refresh(action.view, action.page);
      await answerCallback(query.id);
      return;
    }

    case 'myDebts': {
      const v = await buildView(user, 'q');
      const outcome = await sendMessageDetailed(query.from.id, v.html, v.keyboard);
      await answerCallback(query.id, outcome === 'ok' ? toast.sentPrivately(lang) : toast.openPrivateFirst(lang), outcome !== 'ok');
      return;
    }

    case 'status': {
      // Status buttons on views only work in a private chat; group buttons are view 'g'
      if ((action.view === 'g') === isPrivate) {
        await answerCallback(query.id);
        return;
      }
      const clock = await getUserClock(user.preferences);
      if (action.view === 'g' && action.date < getDateWithDayOffset(clock.today, -GROUP_BUTTON_MAX_AGE_DAYS)) {
        await answerCallback(query.id, toast.expired(lang), true);
        return;
      }
      const current = await loadCurrentStatus(userId, action.date, action.prayer);
      const next = resolveStatusAction(action.action, current);
      const result = await setPrayerStatus(userId, action.date, action.prayer, next, { today: clock.today, timezone: clock.timezone });
      if (!result.ok) {
        const text = result.code === 'PAID_PRAYER_LOCKED' ? toast.paidLocked(lang) : result.code === 'FUTURE_DATE' ? toast.futureDate(lang) : toast.error(lang);
        await answerCallback(query.id, text, true);
        return;
      }
      await answerCallback(query.id, toast.saved(lang, action.prayer, next));
      if (action.view !== 'g') await refresh(action.view, 0, clock);
      return;
    }

    case 'pay': {
      if (!isPrivate) return answerCallback(query.id);
      const clock = await getUserClock(user.preferences);
      const res = await payQazaItems(userId, [{ date: action.date, prayerId: action.prayer }], { today: clock.today, note: 'Telegram' });
      await answerCallback(query.id, res.paid.length > 0 ? toast.paid(lang, res.paid.length, res.totalAmount) : toast.nothingToPay(lang));
      await refresh('q', 0, clock);
      return;
    }

    case 'payAllAsk':
    case 'payAll': {
      if (!isPrivate || !msg) return answerCallback(query.id);
      const clock = await getUserClock(user.preferences);
      const summary = await loadUserSummary(userId, { today: clock.today, timezone: clock.timezone });
      const items = unpaidItems(summary.debt.items).slice(0, MAX_PAY_ITEMS);
      const total = items.reduce((s, it) => s + it.amount, 0);

      if (items.length === 0) {
        await answerCallback(query.id, toast.nothingToPay(lang));
        await refresh('q', 0, clock);
        return;
      }
      // Pay only what the user saw and confirmed; if anything changed meanwhile, ask again
      if (action.kind === 'payAllAsk' || action.count !== items.length || action.total !== total) {
        const v = renderPayAllConfirm(lang, items.length, total);
        await editMessage(msg.chat.id, msg.message_id, v.html, v.keyboard);
        await answerCallback(query.id, action.kind === 'payAll' ? toast.debtChanged(lang) : undefined);
        return;
      }
      const res = await payQazaItems(userId, items, { today: clock.today, note: 'Telegram' });
      await answerCallback(query.id, toast.paid(lang, res.paid.length, res.totalAmount), true);
      await refresh('q', 0, clock);
      return;
    }
  }
}

async function loadCurrentStatus(userId: string, date: string, prayer: PrayerId): Promise<PrayerStatus | undefined> {
  const rec = await PrayerRecord.findOne({ userId, date }).select('prayers').lean();
  return rec?.prayers?.[prayer]?.status;
}
