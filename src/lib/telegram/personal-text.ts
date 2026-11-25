/**
 * Trilingual texts and keyboards for the bot's personal (private chat) views:
 * today's prayers, qaza / debts, and stats. Pure functions: no I/O, unit-tested.
 */
import type { PrayerId, PrayerStatus } from '../../types/prayer.ts';
import { formatCurrency, formatPrayerName } from '../formatters.ts';
import { escapeHtml, type InlineKeyboard } from './api.ts';
import { cb } from './callbacks.ts';
import type { BotLang } from './messages.ts';

export const PERSONAL_PRAYERS: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
export const QAZA_PAGE_SIZE = 6;

type L = Record<BotLang, string>;
const pick = (lang: BotLang, t: L) => t[lang];

const DISCLAIMER: L = {
  uz: 'Bu shaxsiy intizom vositasi, diniy hukm emas.',
  ru: 'Это инструмент личной дисциплины, а не религиозное постановление.',
  en: 'This is a personal discipline tool, not a religious ruling.',
};

export function statusIcon(status: PrayerStatus | undefined): string {
  switch (status) {
    case 'PRAYED_ON_TIME':
    case 'PRAYED':
    case 'PRAYED_LATE':
      return '✅';
    case 'MISSED':
      return '❌';
    case 'MADE_UP':
      return '🔁';
    default:
      return '⏳';
  }
}

export function statusLabel(lang: BotLang, status: PrayerStatus | undefined): string {
  switch (status) {
    case 'PRAYED_ON_TIME':
    case 'PRAYED':
    case 'PRAYED_LATE':
      return pick(lang, { uz: "o'qildi", ru: 'совершён', en: 'prayed' });
    case 'MISSED':
      return pick(lang, { uz: 'qazo', ru: 'каза', en: 'qaza' });
    case 'MADE_UP':
      return pick(lang, { uz: 'qazosi o\'qildi', ru: 'восполнен', en: 'made up' });
    default:
      return pick(lang, { uz: 'belgilanmagan', ru: 'не отмечен', en: 'not marked' });
  }
}

const isDone = (s: PrayerStatus | undefined) => s === 'PRAYED_ON_TIME' || s === 'PRAYED' || s === 'PRAYED_LATE';

export interface TodayViewInput {
  date: string;
  city?: string;
  statuses: Partial<Record<PrayerId, PrayerStatus>>;
  times?: Partial<Record<PrayerId, string>>;
  debt: number;
  pendingQaza: number;
}

export function renderToday(lang: BotLang, v: TodayViewInput): { html: string; keyboard: InlineKeyboard } {
  const where = v.city ? ` · ${escapeHtml(v.city)}` : '';
  const header = pick(lang, { uz: '🕌 <b>Bugungi namozlar</b>', ru: '🕌 <b>Намазы на сегодня</b>', en: "🕌 <b>Today's prayers</b>" });
  const rows = PERSONAL_PRAYERS.map((p) => {
    const st = v.statuses[p];
    const time = v.times?.[p] ? ` <code>${v.times[p]}</code>` : '';
    return `${statusIcon(st)} ${escapeHtml(formatPrayerName(p, lang))}${time} — ${statusLabel(lang, st)}`;
  });
  const footer = pick(lang, {
    uz: `Qazo: <b>${v.pendingQaza}</b> · Qarz: <b>${formatCurrency(v.debt, lang)}</b>`,
    ru: `Каза: <b>${v.pendingQaza}</b> · Долг: <b>${formatCurrency(v.debt, lang)}</b>`,
    en: `Qaza: <b>${v.pendingQaza}</b> · Debt: <b>${formatCurrency(v.debt, lang)}</b>`,
  });
  const legend = pick(lang, {
    uz: "Tugmalar: ✅ o'qidim · 🔁 qazosini o'qidim · ❌ qazo. Qayta bossangiz bekor bo'ladi.",
    ru: 'Кнопки: ✅ совершил · 🔁 восполнил · ❌ каза. Повторное нажатие отменяет.',
    en: 'Buttons: ✅ prayed · 🔁 made up · ❌ qaza. Tap again to undo.',
  });
  const html = `${header} — ${v.date}${where}\n\n${rows.join('\n')}\n\n${footer}\n<i>${legend}</i>`;

  const keyboard: InlineKeyboard = PERSONAL_PRAYERS.map((p) => {
    const st = v.statuses[p];
    const mark = (active: boolean, text: string) => (active ? `• ${text} •` : text);
    return [
      { text: mark(isDone(st), `✅ ${formatPrayerName(p, lang)}`), callback_data: cb.status('t', v.date, p, 'T') },
      { text: mark(st === 'MADE_UP', '🔁'), callback_data: cb.status('t', v.date, p, st === 'MADE_UP' ? 'R' : 'U') },
      { text: mark(st === 'MISSED', '❌'), callback_data: cb.status('t', v.date, p, st === 'MISSED' ? 'R' : 'M') },
    ];
  });
  keyboard.push(navRow(lang, 't'));
  return { html, keyboard };
}

function navRow(lang: BotLang, current: 't' | 'q' | 's'): InlineKeyboard[number] {
  const labels = {
    t: pick(lang, { uz: '🕌 Bugun', ru: '🕌 Сегодня', en: '🕌 Today' }),
    q: pick(lang, { uz: '💳 Qarzlar', ru: '💳 Долги', en: '💳 Debts' }),
    s: pick(lang, { uz: '📊 Statistika', ru: '📊 Статистика', en: '📊 Stats' }),
  };
  const refresh = pick(lang, { uz: '🔄 Yangilash', ru: '🔄 Обновить', en: '🔄 Refresh' });
  return (['t', 'q', 's'] as const).map((v) => ({ text: v === current ? refresh : labels[v], callback_data: cb.view(v) }));
}

export interface QazaItemView {
  date: string;
  prayerId: PrayerId;
  status: PrayerStatus;
  amount: number;
  isOverdue: boolean;
}

export interface QazaViewInput {
  items: QazaItemView[]; // unpaid fines, any order
  totalDebt: number;
  pendingQaza: number;
  page: number;
}

/** Oldest first: those are overdue or closest to becoming overdue. */
export function sortQazaItems(items: QazaItemView[]): QazaItemView[] {
  const order = (p: PrayerId) => PERSONAL_PRAYERS.indexOf(p);
  return [...items].sort((a, b) => a.date.localeCompare(b.date) || order(a.prayerId) - order(b.prayerId));
}

export function renderQaza(lang: BotLang, v: QazaViewInput): { html: string; keyboard: InlineKeyboard } {
  const header = pick(lang, { uz: '💳 <b>Qazo va qarzlar</b>', ru: '💳 <b>Каза и долги</b>', en: '💳 <b>Qaza & debts</b>' });
  const summary = pick(lang, {
    uz: `Qarz: <b>${formatCurrency(v.totalDebt, lang)}</b> · O'qilmagan qazo: <b>${v.pendingQaza}</b>`,
    ru: `Долг: <b>${formatCurrency(v.totalDebt, lang)}</b> · Невосполненная каза: <b>${v.pendingQaza}</b>`,
    en: `Debt: <b>${formatCurrency(v.totalDebt, lang)}</b> · Qaza to make up: <b>${v.pendingQaza}</b>`,
  });

  const items = sortQazaItems(v.items);
  if (items.length === 0) {
    const none = pick(lang, {
      uz: "To'lanmagan qarz yo'q. Barakalla! 🤲",
      ru: 'Неоплаченных долгов нет. Отлично! 🤲',
      en: 'No unpaid fines. Well done! 🤲',
    });
    return { html: `${header}\n\n${summary}\n\n${none}`, keyboard: [navRow(lang, 'q')] };
  }

  const pages = Math.max(1, Math.ceil(items.length / QAZA_PAGE_SIZE));
  const page = Math.min(Math.max(0, v.page), pages - 1);
  const start = page * QAZA_PAGE_SIZE;
  const slice = items.slice(start, start + QAZA_PAGE_SIZE);
  const overdueWord = pick(lang, { uz: "muddati o'tgan", ru: 'просрочено', en: 'overdue' });

  const lines = slice.map((it, i) => {
    const n = start + i + 1;
    const overdue = it.isOverdue ? ` · <i>${overdueWord}</i>` : '';
    return `${n}. ${it.date} ${escapeHtml(formatPrayerName(it.prayerId, lang))} — ${statusIcon(it.status)} ${statusLabel(lang, it.status)} · ${formatCurrency(it.amount, lang)}${overdue}`;
  });
  const pageInfo = pages > 1 ? `\n${page + 1}/${pages}` : '';
  const html = `${header}\n\n${summary}\n\n${lines.join('\n')}${pageInfo}\n\n<i>${DISCLAIMER[lang]}</i>`;

  const payWord = pick(lang, { uz: "To'lash", ru: 'Оплатить', en: 'Pay' });
  const madeUpWord = pick(lang, { uz: "O'qidim", ru: 'Восполнил', en: 'Made up' });
  const keyboard: InlineKeyboard = slice.map((it, i) => {
    const n = start + i + 1;
    const row = [{ text: `💰 ${n}. ${payWord}`, callback_data: cb.pay(it.date, it.prayerId) }];
    if (it.status === 'MISSED') row.push({ text: `🔁 ${n}. ${madeUpWord}`, callback_data: cb.status('q', it.date, it.prayerId, 'U') });
    return row;
  });

  if (pages > 1) {
    const nav = [];
    if (page > 0) nav.push({ text: '◀️', callback_data: cb.view('q', page - 1) });
    if (page < pages - 1) nav.push({ text: '▶️', callback_data: cb.view('q', page + 1) });
    keyboard.push(nav);
  }
  const total = items.reduce((s, it) => s + it.amount, 0);
  keyboard.push([
    {
      text: pick(lang, {
        uz: `💰 Hammasini to'lash (${items.length} · ${formatCurrency(total, lang)})`,
        ru: `💰 Оплатить всё (${items.length} · ${formatCurrency(total, lang)})`,
        en: `💰 Pay all (${items.length} · ${formatCurrency(total, lang)})`,
      }),
      callback_data: cb.payAllAsk(),
    },
  ]);
  keyboard.push(navRow(lang, 'q'));
  return { html, keyboard };
}

export function renderPayAllConfirm(lang: BotLang, count: number, total: number): { html: string; keyboard: InlineKeyboard } {
  const html = pick(lang, {
    uz: `💰 <b>${count}</b> ta qarzni <b>${formatCurrency(total, lang)}</b> ga to'langan deb belgilaysizmi?\n\nBu faqat ilovadagi hisobni yangilaydi — pulni (sadaqani) o'zingiz berasiz.`,
    ru: `💰 Отметить <b>${count}</b> долгов на <b>${formatCurrency(total, lang)}</b> как оплаченные?\n\nЭто только обновляет учёт в приложении — сами деньги (садака) вы отдаёте самостоятельно.`,
    en: `💰 Mark <b>${count}</b> fines totalling <b>${formatCurrency(total, lang)}</b> as paid?\n\nThis only updates your record in the app — you give the money (sadaqah) yourself.`,
  });
  return {
    html,
    keyboard: [
      [
        { text: pick(lang, { uz: "✅ Ha, to'ladim", ru: '✅ Да, оплатил', en: '✅ Yes, paid' }), callback_data: cb.payAll(count, total) },
        { text: pick(lang, { uz: '↩️ Bekor qilish', ru: '↩️ Отмена', en: '↩️ Cancel' }), callback_data: cb.view('q') },
      ],
    ],
  };
}

export interface StatsViewInput {
  streak: { current: number; best: number };
  weekly: { completed: number; percentage: number };
  monthly: { completed: number; percentage: number };
  totalDebt: number;
  pendingQaza: number;
  completedQaza: number;
}

export function renderStats(lang: BotLang, v: StatsViewInput): { html: string; keyboard: InlineKeyboard } {
  const t = {
    uz: ['📊 <b>Statistika</b>', 'Ketma-ket kunlar', 'eng yaxshi', '7 kun', '30 kun', 'Qarz', "O'qilmagan qazo", "O'qilgan qazo"],
    ru: ['📊 <b>Статистика</b>', 'Дней подряд', 'рекорд', '7 дней', '30 дней', 'Долг', 'Невосполненная каза', 'Восполнено'],
    en: ['📊 <b>Stats</b>', 'Streak', 'best', '7 days', '30 days', 'Debt', 'Qaza to make up', 'Qaza made up'],
  }[lang];
  const html = [
    t[0],
    '',
    `🔥 ${t[1]}: <b>${v.streak.current}</b> (${t[2]}: ${v.streak.best})`,
    `📅 ${t[3]}: <b>${v.weekly.completed}/35</b> (${v.weekly.percentage}%)`,
    `🗓 ${t[4]}: <b>${v.monthly.completed}/150</b> (${v.monthly.percentage}%)`,
    `💳 ${t[5]}: <b>${formatCurrency(v.totalDebt, lang)}</b>`,
    `❌ ${t[6]}: <b>${v.pendingQaza}</b> · 🔁 ${t[7]}: <b>${v.completedQaza}</b>`,
  ].join('\n');
  return { html, keyboard: [navRow(lang, 's')] };
}

/** Short toast texts shown after a button press. */
export const toast = {
  saved: (lang: BotLang, prayer: PrayerId, status: PrayerStatus) =>
    `${statusIcon(status)} ${formatPrayerName(prayer, lang)}: ${statusLabel(lang, status)}`,
  paid: (lang: BotLang, count: number, amount: number) =>
    pick(lang, {
      uz: `✅ To'landi: ${count} ta · ${formatCurrency(amount, lang)}`,
      ru: `✅ Оплачено: ${count} · ${formatCurrency(amount, lang)}`,
      en: `✅ Paid: ${count} · ${formatCurrency(amount, lang)}`,
    }),
  nothingToPay: (lang: BotLang) =>
    pick(lang, { uz: "Bu qarz allaqachon to'langan.", ru: 'Этот долг уже оплачен.', en: 'This fine is already paid.' }),
  debtChanged: (lang: BotLang) =>
    pick(lang, {
      uz: "Qarz o'zgardi — yangi summani tasdiqlang.",
      ru: 'Долг изменился — подтвердите новую сумму.',
      en: 'Your debt changed — please confirm the new amount.',
    }),
  paidLocked: (lang: BotLang) =>
    pick(lang, {
      uz: "To'langan qazoni faqat «qazosi o'qildi» ga o'zgartirish mumkin.",
      ru: 'Оплаченную казу можно изменить только на «восполнен».',
      en: 'A paid qaza can only be changed to "made up".',
    }),
  futureDate: (lang: BotLang) =>
    pick(lang, { uz: "Kelajakdagi kunni belgilab bo'lmaydi.", ru: 'Нельзя отмечать будущие дни.', en: 'You cannot mark future days.' }),
  expired: (lang: BotLang) =>
    pick(lang, {
      uz: "Bu tugma eskirgan. Shaxsiy chatda /today dan foydalaning.",
      ru: 'Эта кнопка устарела. Используйте /today в личном чате.',
      en: 'This button has expired. Use /today in a private chat with me.',
    }),
  mustLink: (lang: BotLang) =>
    pick(lang, {
      uz: "Avval Telegramni ilovada ulang: Hisob → Telegram.",
      ru: 'Сначала привяжите Telegram в приложении: Аккаунт → Telegram.',
      en: 'Link your Telegram in the app first: Account → Telegram.',
    }),
  tooFast: (lang: BotLang) => pick(lang, { uz: 'Biroz sekinroq 🙂', ru: 'Чуть помедленнее 🙂', en: 'Slow down a little 🙂' }),
  error: (lang: BotLang) =>
    pick(lang, { uz: "Xatolik yuz berdi, qayta urinib ko'ring.", ru: 'Произошла ошибка, попробуйте ещё раз.', en: 'Something went wrong, please try again.' }),
  sentPrivately: (lang: BotLang) =>
    pick(lang, { uz: 'Shaxsiy chatga yubordim.', ru: 'Отправил вам в личные сообщения.', en: 'Sent to you in a private chat.' }),
  openPrivateFirst: (lang: BotLang) =>
    pick(lang, {
      uz: 'Avval botga shaxsiy chatda /start yozing.',
      ru: 'Сначала напишите боту /start в личном чате.',
      en: 'Send /start to me in a private chat first.',
    }),
};
