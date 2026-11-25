/**
 * Telegram group notifier: turns due schedule events into messages.
 *
 * Called by the bot process (bot/index.ts) every minute. For each SalahTrack group that has
 * a connected Telegram chat it:
 *   1. loads fatvo.uz times for the group's location (yesterday + today),
 *   2. picks the events that are due (see schedule.ts),
 *   3. atomically claims each event in TelegramNotification (unique key) so overlapping
 *      cron runs never double-post, then renders and sends it.
 *
 * Privacy: only members who linked their Telegram (an explicit opt-in, see the consent
 * text in the bot's link confirmation) appear in nudges, debt reports and leaderboards.
 */
import mongoose from 'mongoose';
import { connectDB } from '../mongodb.ts';
import { Group, type IGroup } from '../../models/Group.ts';
import { User } from '../../models/User.ts';
import { PrayerRecord } from '../../models/Prayer.ts';
import { TelegramNotification } from '../../models/TelegramNotification.ts';
import { getPrayerTimesForLocation, type PrayerTimesPayload } from '../../app/api/prayer-times/route.ts';
import { calculateAuthoritativeDebt } from '../accountability.ts';
import { calculateStreakFromHistory } from '../streak.ts';
import { getZonedDateParts, getLiturgicalDate } from '../prayer-cycle.ts';
import { ensureUserRolledOver, getDateWithDayOffset } from '../prayer-rollover.ts';
import type { PrayerId } from '../../types/prayer.ts';
import { sendMessageDetailed, mentionHtml, type InlineKeyboard } from './api.ts';
import { cb } from './callbacks.ts';
import { botText, groupButtons, sanitizeBotLang, type BotLang, type DebtLine, type LeaderLine } from './messages.ts';
import { buildDayEvents, dueEvents, PRAYER_IDS, type DayTimings, type ScheduledEvent } from './schedule.ts';

type LeanGroup = Pick<IGroup, '_id' | 'name' | 'members' | 'telegram'>;

interface LinkedMember {
  userId: mongoose.Types.ObjectId;
  name: string;
  mention: string;
}

const COMPLETED = new Set(['PRAYED_ON_TIME', 'PRAYED', 'PRAYED_LATE']);
const ON_TIME = new Set(['PRAYED_ON_TIME', 'PRAYED']);

export async function getLinkedMembers(group: LeanGroup): Promise<LinkedMember[]> {
  const ids = (group.members || []).map((m) => m.userId);
  if (ids.length === 0) return [];
  const users = await User.find({ _id: { $in: ids }, 'telegram.userId': { $exists: true } })
    .select('_id name telegram')
    .lean();
  return users
    .filter((u) => typeof u.telegram?.userId === 'number')
    .map((u) => ({
      userId: u._id,
      name: u.name,
      mention: mentionHtml(u.telegram!.userId, u.name),
    }));
}

export async function getGroupTimes(group: LeanGroup, date: string): Promise<PrayerTimesPayload | null> {
  const tg = group.telegram;
  if (!tg) return null;
  return getPrayerTimesForLocation({
    lat: tg.latitude,
    lng: tg.longitude,
    timezone: tg.timezone,
    date,
    lang: sanitizeBotLang(tg.language),
    cityName: tg.city,
  });
}

function toDayTimings(p: PrayerTimesPayload): DayTimings {
  return {
    fajr: p.timings.fajr.time,
    sunrise: p.extras?.sunrise ?? p.timings.fajr.endTime,
    dhuhr: p.timings.dhuhr.time,
    asr: p.timings.asr.time,
    maghrib: p.timings.maghrib.time,
    isha: p.timings.isha.time,
    midnight: p.extras?.midnight,
  };
}

/** Members whose prayer for `date` is still unmarked (no record, or PENDING). */
async function findUnmarked(members: LinkedMember[], date: string, prayer: PrayerId): Promise<LinkedMember[]> {
  if (members.length === 0) return [];
  const records = await PrayerRecord.find({ userId: { $in: members.map((m) => m.userId) }, date })
    .select('userId prayers')
    .lean();
  const statusByUser = new Map(records.map((r) => [r.userId.toString(), r.prayers?.[prayer]?.status]));
  return members.filter((m) => {
    const status = statusByUser.get(m.userId.toString());
    return !status || status === 'PENDING';
  });
}

/** Debt report for the group's linked members (also used by the /debts command). */
export async function buildDebtReport(group: LeanGroup, lang: BotLang): Promise<string> {
  const members = await getLinkedMembers(group);
  const timezone = group.telegram?.timezone;

  // Same lazy rollover the app's dashboard runs on load: past unmarked prayers become MISSED and
  // whole days with no record at all (member didn't open the app) are filled with 5 MISSED prayers,
  // so the report matches what each member sees in the app.
  const today = await getGroupTimes(group, getZonedDateParts(new Date(), timezone).dateStr);
  const liturgicalDate = getLiturgicalDate(new Date(), today?.timings.fajr.time, timezone);
  for (const m of members) {
    await ensureUserRolledOver(m.userId, liturgicalDate, { timezone, fillGapDays: true }).catch((err) =>
      console.error('[telegram] rollover failed for member', err)
    );
  }

  const records = await PrayerRecord.find({
    userId: { $in: members.map((m) => m.userId) },
    $or: PRAYER_IDS.map((p) => ({ [`prayers.${p}.status`]: { $in: ['MISSED', 'MADE_UP'] } })),
  })
    .select('userId date prayers')
    .lean();

  const byUser = new Map<string, typeof records>();
  for (const r of records) {
    const key = r.userId.toString();
    byUser.set(key, [...(byUser.get(key) ?? []), r]);
  }

  const lines: DebtLine[] = [];
  let total = 0;
  for (const m of members) {
    const result = calculateAuthoritativeDebt(byUser.get(m.userId.toString()) ?? [], { timezone });
    if (result.totalFinancialDebt > 0 || result.pendingQazaCount > 0) {
      lines.push({ mention: m.mention, debt: result.totalFinancialDebt, pendingQaza: result.pendingQazaCount });
      total += result.totalFinancialDebt;
    }
  }
  lines.sort((a, b) => b.debt - a.debt || b.pendingQaza - a.pendingQaza);
  return botText.debtSummary(lang, lines, total);
}

/** Leaderboard over the 7 days ending on `endDate` (inclusive). */
export async function buildWeeklyLeaderboard(group: LeanGroup, lang: BotLang, endDate: string): Promise<string> {
  const members = await getLinkedMembers(group);
  const startDate = getDateWithDayOffset(endDate, -6);
  const streakStart = getDateWithDayOffset(endDate, -60);

  const records = await PrayerRecord.find({
    userId: { $in: members.map((m) => m.userId) },
    date: { $gte: streakStart, $lte: endDate },
  })
    .select('userId date prayers')
    .lean();

  const lines: LeaderLine[] = members.map((m) => {
    const uid = m.userId.toString();
    let completed = 0;
    let onTime = 0;
    const dayMap = new Map<string, number>();
    for (const r of records) {
      if (r.userId.toString() !== uid) continue;
      let dayCompleted = 0;
      for (const p of PRAYER_IDS) {
        const st = r.prayers?.[p]?.status;
        if (st && COMPLETED.has(st)) dayCompleted++;
        if (r.date >= startDate) {
          if (st && COMPLETED.has(st)) completed++;
          if (st && ON_TIME.has(st)) onTime++;
        }
      }
      dayMap.set(r.date, dayCompleted === 5 ? 5 : 0);
    }
    return {
      mention: m.mention,
      completed,
      onTimePct: Math.round((onTime / 35) * 100),
      streak: calculateStreakFromHistory(dayMap, endDate).current,
    };
  });

  lines.sort((a, b) => b.completed - a.completed || b.onTimePct - a.onTimePct || b.streak - a.streak);
  return botText.weeklyLeaderboard(lang, lines, startDate, endDate);
}

interface RenderedEvent {
  html: string;
  keyboard?: InlineKeyboard;
}

/**
 * Inline buttons on announcements. "I prayed" marks the PRESSER's own prayer for that
 * day (resolved from their Telegram id), so one shared message works for every member.
 */
export function eventKeyboard(event: ScheduledEvent, date: string, lang: BotLang): InlineKeyboard | undefined {
  switch (event.kind) {
    case 'start':
    case 'nudge':
      return [[{ text: groupButtons.prayed(lang), callback_data: cb.status('g', date, event.prayer, 'P') }]];
    case 'summary':
      return [[{ text: groupButtons.myDebts(lang), callback_data: cb.myDebts() }]];
    default:
      return undefined;
  }
}

async function renderEvent(group: LeanGroup, event: ScheduledEvent, date: string, lang: BotLang): Promise<RenderedEvent | null> {
  const keyboard = eventKeyboard(event, date, lang);
  switch (event.kind) {
    case 'start':
      return { html: botText.prayerStarted(lang, event.prayer, event.time, group.telegram?.city), keyboard };
    case 'nudge': {
      const unmarked = await findUnmarked(await getLinkedMembers(group), date, event.prayer);
      if (unmarked.length === 0) return null; // everyone marked — stay quiet
      return { html: botText.nudge(lang, event.prayer, event.endsAt, unmarked.map((m) => m.mention)), keyboard };
    }
    case 'summary':
      return { html: await buildDebtReport(group, lang), keyboard };
    case 'weekly':
      // Friday morning: report the 7 complete days ending yesterday
      return { html: await buildWeeklyLeaderboard(group, lang, getDateWithDayOffset(date, -1)) };
  }
}

/** Atomically claims a notification key; false if another run already claimed it. */
async function claim(key: string, groupId: mongoose.Types.ObjectId): Promise<boolean> {
  try {
    await TelegramNotification.create({ key, groupId });
    return true;
  } catch (err) {
    if ((err as { code?: number })?.code === 11000) return false;
    throw err;
  }
}

async function release(key: string): Promise<void> {
  await TelegramNotification.deleteOne({ key }).catch(() => {});
}

export interface TickResult {
  groups: number;
  sent: number;
  failed: number;
}

export async function runTelegramTick(now: number = Date.now()): Promise<TickResult> {
  await connectDB();
  const groups = await Group.find({ 'telegram.chatId': { $exists: true } })
    .select('_id name members telegram')
    .lean();

  const result: TickResult = { groups: groups.length, sent: 0, failed: 0 };

  for (const group of groups) {
    const tg = group.telegram!;
    const lang = sanitizeBotLang(tg.language);
    const today = getZonedDateParts(new Date(now), tg.timezone).dateStr;

    for (const date of [getDateWithDayOffset(today, -1), today]) {
      const times = await getGroupTimes(group, date);
      if (!times) continue; // fatvo.uz down: skip rather than guess times

      for (const event of dueEvents(buildDayEvents(date, toDayTimings(times), times.tzOffset), now)) {
        const key = `${group._id.toString()}:${date}:${event.id}`;
        if (!(await claim(key, group._id))) continue;
        try {
          const rendered = await renderEvent(group, event, date, lang);
          if (!rendered) continue; // nothing to say; keep the claim
          const outcome = await sendMessageDetailed(tg.chatId, rendered.html, rendered.keyboard);
          if (outcome === 'ok') {
            result.sent++;
          } else {
            result.failed++;
            // Retry on the next tick only when Telegram definitely rejected the message.
            // On a timeout it may have been delivered, and a duplicate is worse than a miss.
            if (outcome === 'rejected') await release(key);
          }
        } catch (err) {
          console.error(`[telegram] event ${key} failed:`, err);
          result.failed++;
          await release(key);
        }
      }
    }
  }
  return result;
}
