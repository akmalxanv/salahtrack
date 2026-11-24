/**
 * Trilingual (uz / ru / en) texts for the Telegram bot.
 *
 * These are bot chat messages, not app UI, so they live beside the bot rather than in
 * src/locales/translations.ts. Every function returns Telegram-HTML: any user-supplied
 * value (names, group titles) must arrive already escaped or go through escapeHtml().
 */
import type { PrayerId } from '../../types/prayer.ts';
import { formatPrayerName, formatCurrency } from '../formatters.ts';
import { escapeHtml } from './api.ts';

export type BotLang = 'uz' | 'ru' | 'en';

export function sanitizeBotLang(value: unknown): BotLang {
  return value === 'ru' || value === 'en' || value === 'uz' ? value : 'uz';
}

export interface DebtLine {
  mention: string; // pre-rendered HTML mention
  debt: number; // UZS
  pendingQaza: number;
}

export interface LeaderLine {
  mention: string;
  onTimePct: number;
  completed: number;
  streak: number;
}

const DISCLAIMER: Record<BotLang, string> = {
  uz: "Bu shaxsiy intizom vositasi, diniy hukm emas.",
  ru: 'Это инструмент личной дисциплины, а не религиозное постановление.',
  en: 'This is a personal discipline tool, not a religious ruling.',
};

export const botText = {
  prayerStarted(lang: BotLang, prayer: PrayerId, time: string, city?: string): string {
    const name = `<b>${escapeHtml(formatPrayerName(prayer, lang))}</b>`;
    const where = city ? ` (${escapeHtml(city)})` : '';
    return {
      uz: `🕌 ${name} vaqti kirdi — ${time}${where}.\nNamozni o'qib, ilovada belgilashni unutmang.`,
      ru: `🕌 Наступило время намаза ${name} — ${time}${where}.\nНе забудьте отметить намаз в приложении.`,
      en: `🕌 ${name} time has started — ${time}${where}.\nDon't forget to mark it in the app.`,
    }[lang];
  },

  nudge(lang: BotLang, prayer: PrayerId, endsAt: string, mentions: string[]): string {
    const name = `<b>${escapeHtml(formatPrayerName(prayer, lang))}</b>`;
    const list = mentions.join(', ');
    return {
      uz: `⏰ ${name} vaqti ${endsAt} da tugaydi.\nHali belgilamaganlar: ${list}`,
      ru: `⏰ Время ${name} заканчивается в ${endsAt}.\nЕщё не отметили: ${list}`,
      en: `⏰ ${name} ends at ${endsAt}.\nNot marked yet: ${list}`,
    }[lang];
  },

  debtSummary(lang: BotLang, lines: DebtLine[], total: number): string {
    if (lines.length === 0) {
      return {
        uz: "📊 Kunlik hisobot: hech kimda qarz yo'q. Barakalla! 🤲",
        ru: '📊 Ежедневный отчёт: ни у кого нет долгов. Отлично! 🤲',
        en: '📊 Daily report: nobody has any debt. Well done! 🤲',
      }[lang];
    }
    const header = {
      uz: '📊 <b>Kunlik qarzlar hisoboti</b>',
      ru: '📊 <b>Ежедневный отчёт о долгах</b>',
      en: '📊 <b>Daily debt report</b>',
    }[lang];
    const qazaWord = { uz: 'qazo', ru: 'каза', en: 'qaza' }[lang];
    const body = lines
      .map((l, i) => `${i + 1}. ${l.mention} — ${formatCurrency(l.debt, lang)}${l.pendingQaza > 0 ? ` · ${l.pendingQaza} ${qazaWord}` : ''}`)
      .join('\n');
    const totalLabel = { uz: 'Jami', ru: 'Итого', en: 'Total' }[lang];
    return `${header}\n\n${body}\n\n<b>${totalLabel}:</b> ${formatCurrency(total, lang)}\n<i>${DISCLAIMER[lang]}</i>`;
  },

  weeklyLeaderboard(lang: BotLang, lines: LeaderLine[], from: string, to: string): string {
    const header = {
      uz: `🏆 <b>Haftalik reyting</b> (${from} — ${to})`,
      ru: `🏆 <b>Рейтинг недели</b> (${from} — ${to})`,
      en: `🏆 <b>Weekly leaderboard</b> (${from} — ${to})`,
    }[lang];
    if (lines.length === 0) {
      return `${header}\n\n${{ uz: "Ma'lumot yo'q.", ru: 'Нет данных.', en: 'No data yet.' }[lang]}`;
    }
    const medals = ['🥇', '🥈', '🥉'];
    const labels = {
      uz: { onTime: "o'z vaqtida", streak: 'ketma-ket kun' },
      ru: { onTime: 'вовремя', streak: 'дней подряд' },
      en: { onTime: 'on time', streak: 'day streak' },
    }[lang];
    const body = lines
      .map((l, i) => `${medals[i] ?? `${i + 1}.`} ${l.mention} — ${l.onTimePct}% ${labels.onTime} · ${l.completed}/35 · 🔥 ${l.streak} ${labels.streak}`)
      .join('\n');
    return `${header}\n\n${body}`;
  },

  todayTimes(lang: BotLang, city: string, date: string, times: Record<PrayerId, string>): string {
    const header = {
      uz: `🕌 <b>Namoz vaqtlari</b> — ${escapeHtml(city)}, ${date}`,
      ru: `🕌 <b>Время намаза</b> — ${escapeHtml(city)}, ${date}`,
      en: `🕌 <b>Prayer times</b> — ${escapeHtml(city)}, ${date}`,
    }[lang];
    const rows = (Object.keys(times) as PrayerId[])
      .map((p) => `${escapeHtml(formatPrayerName(p, lang))}: <b>${times[p]}</b>`)
      .join('\n');
    return `${header}\n\n${rows}`;
  },

  help(lang: BotLang): string {
    return {
      uz: [
        '<b>SalahTrack bot</b>',
        '',
        '1. Ilovada: Hisob → Telegram → «Ulash» tugmasini bosing.',
        "2. Guruh egasi guruhda: <code>/connect TAKLIF_KODI</code>",
        '',
        '/times — bugungi namoz vaqtlari',
        '/debts — hozirgi qarzlar hisoboti',
        '/lang uz|ru|en — bot tili (guruh admini)',
        '/disconnect — guruhni uzish (guruh admini)',
      ],
      ru: [
        '<b>SalahTrack бот</b>',
        '',
        '1. В приложении: Аккаунт → Telegram → «Подключить».',
        '2. Владелец группы пишет в чате: <code>/connect КОД_ПРИГЛАШЕНИЯ</code>',
        '',
        '/times — время намаза на сегодня',
        '/debts — текущий отчёт о долгах',
        '/lang uz|ru|en — язык бота (админ группы)',
        '/disconnect — отключить группу (админ группы)',
      ],
      en: [
        '<b>SalahTrack bot</b>',
        '',
        '1. In the app: Account → Telegram → "Connect".',
        '2. The group owner sends in the chat: <code>/connect INVITE_CODE</code>',
        '',
        "/times — today's prayer times",
        '/debts — current debt report',
        '/lang uz|ru|en — bot language (group admin)',
        '/disconnect — disconnect the group (group admin)',
      ],
    }[lang].join('\n');
  },

  linked(lang: BotLang, name: string): string {
    return {
      uz: `✅ Telegram SalahTrack hisobingizga ulandi: <b>${escapeHtml(name)}</b>.\nEndi guruh eslatmalarida sizni belgilay olaman. Ulanish orqali guruhingizda namoz holati va qarzlaringiz ko'rsatilishiga rozilik bildirasiz.`,
      ru: `✅ Telegram привязан к аккаунту SalahTrack: <b>${escapeHtml(name)}</b>.\nТеперь я смогу упоминать вас в напоминаниях. Привязывая аккаунт, вы соглашаетесь, что статус намазов и долги видны вашей группе.`,
      en: `✅ Telegram linked to your SalahTrack account: <b>${escapeHtml(name)}</b>.\nI can now mention you in group reminders. By linking, you agree that your prayer status and debts are visible to your group.`,
    }[lang];
  },

  linkInvalid(lang: BotLang): string {
    return {
      uz: "❌ Havola yaroqsiz yoki muddati o'tgan. Ilovada yangi havola oling.",
      ru: '❌ Ссылка недействительна или устарела. Получите новую в приложении.',
      en: '❌ This link is invalid or expired. Get a new one in the app.',
    }[lang];
  },

  privateStart(lang: BotLang): string {
    return {
      uz: "Assalomu alaykum! Hisobingizni ulash uchun ilovadagi Hisob → Telegram bo'limidagi havoladan foydalaning.",
      ru: 'Ассаляму алейкум! Чтобы привязать аккаунт, используйте ссылку в приложении: Аккаунт → Telegram.',
      en: 'Assalamu alaikum! To link your account, use the link in the app: Account → Telegram.',
    }[lang];
  },

  mustLinkFirst(lang: BotLang): string {
    return {
      uz: '⚠️ Avval Telegramingizni ilovadagi SalahTrack hisobingizga ulang (Hisob → Telegram).',
      ru: '⚠️ Сначала привяжите Telegram к аккаунту SalahTrack в приложении (Аккаунт → Telegram).',
      en: '⚠️ First link your Telegram to your SalahTrack account in the app (Account → Telegram).',
    }[lang];
  },

  connectUsage(lang: BotLang): string {
    return {
      uz: 'Foydalanish: <code>/connect TAKLIF_KODI</code> (guruh taklif kodi ilovadagi Guruhlar sahifasida).',
      ru: 'Использование: <code>/connect КОД_ПРИГЛАШЕНИЯ</code> (код есть на странице групп в приложении).',
      en: 'Usage: <code>/connect INVITE_CODE</code> (find the invite code on the Groups page in the app).',
    }[lang];
  },

  connectDenied(lang: BotLang): string {
    return {
      uz: '❌ Guruh topilmadi yoki siz uning egasi/admini emassiz.',
      ru: '❌ Группа не найдена, или вы не её владелец/админ.',
      en: "❌ Group not found, or you are not its owner/admin.",
    }[lang];
  },

  chatTaken(lang: BotLang): string {
    return {
      uz: '❌ Bu chat allaqachon boshqa SalahTrack guruhiga ulangan. Avval /disconnect qiling.',
      ru: '❌ Этот чат уже привязан к другой группе SalahTrack. Сначала выполните /disconnect.',
      en: '❌ This chat is already connected to another SalahTrack group. Run /disconnect first.',
    }[lang];
  },

  connected(lang: BotLang, groupName: string, city: string): string {
    return {
      uz: `✅ Chat <b>${escapeHtml(groupName)}</b> guruhiga ulandi. Namoz vaqtlari: ${escapeHtml(city)}.\nA'zolar ilovada Telegramni ulashsa, eslatmalarda belgilanadi.`,
      ru: `✅ Чат привязан к группе <b>${escapeHtml(groupName)}</b>. Время намаза: ${escapeHtml(city)}.\nУчастники, привязавшие Telegram в приложении, будут упоминаться в напоминаниях.`,
      en: `✅ This chat is now connected to <b>${escapeHtml(groupName)}</b>. Prayer times: ${escapeHtml(city)}.\nMembers who link Telegram in the app will be mentioned in reminders.`,
    }[lang];
  },

  disconnected(lang: BotLang): string {
    return {
      uz: "✅ Guruh uzildi. Endi bu chatga xabar yubormayman.",
      ru: '✅ Группа отключена. Я больше не буду писать в этот чат.',
      en: "✅ Disconnected. I won't post to this chat anymore.",
    }[lang];
  },

  notConnected(lang: BotLang): string {
    return {
      uz: 'Bu chat hech qaysi SalahTrack guruhiga ulanmagan. /help',
      ru: 'Этот чат не привязан ни к одной группе SalahTrack. /help',
      en: 'This chat is not connected to a SalahTrack group. /help',
    }[lang];
  },

  adminOnly(lang: BotLang): string {
    return {
      uz: '❌ Bu buyruq faqat guruh egasi yoki admini uchun.',
      ru: '❌ Эта команда только для владельца или админа группы.',
      en: '❌ Only the group owner or an admin can do this.',
    }[lang];
  },

  langChanged(lang: BotLang): string {
    return { uz: "✅ Bot tili: o'zbekcha.", ru: '✅ Язык бота: русский.', en: '✅ Bot language: English.' }[lang];
  },

  timesUnavailable(lang: BotLang): string {
    return {
      uz: "⚠️ Namoz vaqtlarini olishning imkoni bo'lmadi (fatvo.uz). Keyinroq urinib ko'ring.",
      ru: '⚠️ Не удалось получить время намаза (fatvo.uz). Попробуйте позже.',
      en: '⚠️ Could not load prayer times (fatvo.uz). Please try again later.',
    }[lang];
  },
};

/** Command menu shown in Telegram, per language (registered by the bot on startup). */
export const BOT_COMMANDS: Record<BotLang, [string, string][]> = {
  uz: [
    ['times', 'Bugungi namoz vaqtlari'],
    ['debts', 'Qarzlar hisoboti'],
    ['connect', 'Guruhni ulash: /connect TAKLIF_KODI'],
    ['disconnect', 'Guruhni uzish'],
    ['lang', 'Bot tili: /lang uz|ru|en'],
    ['help', 'Yordam'],
  ],
  ru: [
    ['times', 'Время намаза на сегодня'],
    ['debts', 'Отчёт о долгах'],
    ['connect', 'Привязать группу: /connect КОД'],
    ['disconnect', 'Отключить группу'],
    ['lang', 'Язык бота: /lang uz|ru|en'],
    ['help', 'Помощь'],
  ],
  en: [
    ['times', "Today's prayer times"],
    ['debts', 'Debt report'],
    ['connect', 'Connect group: /connect INVITE_CODE'],
    ['disconnect', 'Disconnect group'],
    ['lang', 'Bot language: /lang uz|ru|en'],
    ['help', 'Help'],
  ],
};
