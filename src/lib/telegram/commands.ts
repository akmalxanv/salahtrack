/**
 * Telegram update router: handles bot commands and chat membership changes.
 *
 * Authorization model:
 *  - Telegram identities are trusted only after the webhook secret check (route.ts).
 *  - A Telegram user maps to a SalahTrack user only through a one-time link code.
 *  - Group-changing commands (/connect, /disconnect, /lang) require the linked
 *    SalahTrack user to be owner/admin of that SalahTrack group (checked server-side).
 */
import { connectDB } from '../mongodb.ts';
import { Group } from '../../models/Group.ts';
import { User } from '../../models/User.ts';
import { findCityByCoordinates, findCityByNameOrId } from '../cities.ts';
import { getTimezoneOffsetHours } from '../../app/api/prayer-times/route.ts';
import { getZonedDateParts } from '../prayer-cycle.ts';
import type { PrayerId } from '../../types/prayer.ts';
import { sendMessage, deleteMessage, type TelegramUpdate, type TelegramMessage } from './api.ts';
import { botText, sanitizeBotLang, type BotLang } from './messages.ts';
import { hashLinkCode, isWellFormedLinkCode } from './link.ts';
import { buildDebtReport, getGroupTimes } from './notify.ts';
import { PRAYER_IDS } from './schedule.ts';

const DEFAULT_LOCATION = { city: 'Tashkent', lat: 41.2995, lng: 69.2401, timezone: 'Asia/Tashkent' };
const DEBTS_COOLDOWN_MS = 2 * 60 * 1000;
const lastDebtsReply = new Map<number, number>();

interface ParsedCommand {
  name: string;
  arg: string;
}

export function parseCommand(text: string | undefined, botUsername = process.env.TELEGRAM_BOT_USERNAME): ParsedCommand | null {
  if (!text) return null;
  const match = /^\/([a-z_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!match) return null;
  // In groups with several bots, ignore commands addressed to another bot
  if (match[2] && botUsername && match[2].toLowerCase() !== botUsername.toLowerCase()) return null;
  return { name: match[1].toLowerCase(), arg: (match[3] ?? '').trim() };
}

async function findLinkedUser(telegramUserId: number | undefined) {
  if (typeof telegramUserId !== 'number') return null;
  return User.findOne({ 'telegram.userId': telegramUserId }).select('_id name preferences').lean();
}

function isGroupAdmin(group: { members: { userId: { toString(): string }; role: string }[] }, userId: string): boolean {
  return group.members.some((m) => m.userId.toString() === userId && (m.role === 'owner' || m.role === 'admin'));
}

function resolveLocation(prefs: { city?: string; latitude?: number; longitude?: number; timezone?: string } | undefined) {
  const lat = prefs?.latitude;
  const lng = prefs?.longitude;
  if (typeof lat === 'number' && typeof lng === 'number' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    const known = findCityByCoordinates(lat, lng);
    const tz = known?.timezone ?? prefs?.timezone;
    const timezone = tz && getTimezoneOffsetHours(tz, new Date()) !== null ? tz : DEFAULT_LOCATION.timezone;
    return { city: known?.name ?? prefs?.city ?? '', lat, lng, timezone };
  }
  const preset = prefs?.city ? findCityByNameOrId(prefs.city) : undefined;
  if (preset) {
    return {
      city: preset.name,
      lat: preset.coordinates.lat,
      lng: preset.coordinates.lng,
      timezone: preset.timezone ?? DEFAULT_LOCATION.timezone,
    };
  }
  return DEFAULT_LOCATION;
}

async function handleLink(msg: TelegramMessage, code: string, lang: BotLang): Promise<void> {
  const from = msg.from!;
  if (!isWellFormedLinkCode(code)) {
    await sendMessage(msg.chat.id, botText.linkInvalid(lang));
    return;
  }
  const codeFilter = { telegramLinkCodeHash: hashLinkCode(code), telegramLinkExpires: { $gt: new Date() } };
  const target = await User.findOne(codeFilter).select('_id').lean();
  if (!target) {
    await sendMessage(msg.chat.id, botText.linkInvalid(lang));
    return;
  }

  // One Telegram account ↔ one SalahTrack user: detach it from any previous user first
  await User.updateMany({ 'telegram.userId': from.id, _id: { $ne: target._id } }, { $unset: { telegram: 1 } });

  // Consume the code atomically (the filter re-checks hash + expiry, so a code works once)
  const user = await User.findOneAndUpdate(
    { _id: target._id, ...codeFilter },
    {
      $set: {
        telegram: {
          userId: from.id,
          username: from.username?.slice(0, 64),
          firstName: from.first_name?.slice(0, 128),
          linkedAt: new Date(),
        },
      },
      $unset: { telegramLinkCodeHash: 1, telegramLinkExpires: 1 },
    },
    { new: true }
  )
    .select('_id name preferences')
    .lean();

  if (!user) {
    await sendMessage(msg.chat.id, botText.linkInvalid(lang));
    return;
  }
  await sendMessage(msg.chat.id, botText.linked(sanitizeBotLang(user.preferences?.language), user.name));
}

async function handleConnect(msg: TelegramMessage, inviteCode: string, lang: BotLang): Promise<void> {
  const chatId = msg.chat.id;
  const user = await findLinkedUser(msg.from?.id);
  if (!user) {
    await sendMessage(chatId, botText.mustLinkFirst(lang));
    return;
  }
  const code = inviteCode.toUpperCase();
  if (!/^[A-Z0-9]{4,16}$/.test(code)) {
    await sendMessage(chatId, botText.connectUsage(lang));
    return;
  }

  // The invite code lets anyone join the group: remove it from the chat (works if the bot is admin)
  await deleteMessage(chatId, msg.message_id);

  const group = await Group.findOne({ inviteCode: code }).select('_id name members').lean();
  if (!group || !isGroupAdmin(group, user._id.toString())) {
    await sendMessage(chatId, botText.connectDenied(lang));
    return;
  }

  const existing = await Group.findOne({ 'telegram.chatId': chatId }).select('_id').lean();
  if (existing && existing._id.toString() !== group._id.toString()) {
    await sendMessage(chatId, botText.chatTaken(lang));
    return;
  }

  const loc = resolveLocation(user.preferences);
  const groupLang = sanitizeBotLang(user.preferences?.language);
  const bound = await Group.updateOne(
    { _id: group._id },
    {
      $set: {
        telegram: {
          chatId,
          title: msg.chat.title?.slice(0, 128),
          connectedBy: user._id,
          connectedAt: new Date(),
          language: groupLang,
          city: loc.city,
          latitude: loc.lat,
          longitude: loc.lng,
          timezone: loc.timezone,
        },
      },
    }
  ).catch((err: { code?: number }) => {
    // Unique index on telegram.chatId: another group claimed this chat concurrently
    if (err?.code === 11000) return null;
    throw err;
  });
  if (!bound) {
    await sendMessage(chatId, botText.chatTaken(lang));
    return;
  }
  await sendMessage(chatId, botText.connected(groupLang, group.name, loc.city || `${loc.lat.toFixed(2)}, ${loc.lng.toFixed(2)}`));
}

async function handleGroupCommand(msg: TelegramMessage, cmd: ParsedCommand): Promise<void> {
  const chatId = msg.chat.id;
  const group = await Group.findOne({ 'telegram.chatId': chatId }).select('_id name members telegram').lean();
  const linked = await findLinkedUser(msg.from?.id);
  const lang = sanitizeBotLang(group?.telegram?.language ?? linked?.preferences?.language);

  switch (cmd.name) {
    case 'start':
    case 'help':
      await sendMessage(chatId, botText.help(lang));
      return;
    case 'connect':
      if (!cmd.arg) {
        await sendMessage(chatId, botText.connectUsage(lang));
        return;
      }
      await handleConnect(msg, cmd.arg, lang);
      return;
  }

  if (!group) {
    if (['times', 'debts', 'lang', 'disconnect'].includes(cmd.name)) {
      await sendMessage(chatId, botText.notConnected(lang));
    }
    return;
  }

  switch (cmd.name) {
    case 'times': {
      const date = getZonedDateParts(new Date(), group.telegram!.timezone).dateStr;
      const payload = await getGroupTimes(group, date);
      if (!payload) {
        await sendMessage(chatId, botText.timesUnavailable(lang));
        return;
      }
      const times = Object.fromEntries(PRAYER_IDS.map((p) => [p, payload.timings[p].time])) as Record<PrayerId, string>;
      await sendMessage(chatId, botText.todayTimes(lang, group.telegram!.city || payload.city, date, times));
      return;
    }
    case 'debts': {
      const last = lastDebtsReply.get(chatId) ?? 0;
      if (Date.now() - last < DEBTS_COOLDOWN_MS) return; // anti-spam: silently ignore
      lastDebtsReply.set(chatId, Date.now());
      await sendMessage(chatId, await buildDebtReport(group, lang));
      return;
    }
    case 'lang':
    case 'disconnect': {
      if (!linked || !isGroupAdmin(group, linked._id.toString())) {
        await sendMessage(chatId, botText.adminOnly(lang));
        return;
      }
      if (cmd.name === 'disconnect') {
        await Group.updateOne({ _id: group._id }, { $unset: { telegram: 1 } });
        await sendMessage(chatId, botText.disconnected(lang));
        return;
      }
      const next = cmd.arg.toLowerCase();
      if (next !== 'uz' && next !== 'ru' && next !== 'en') {
        await sendMessage(chatId, '/lang uz | ru | en');
        return;
      }
      await Group.updateOne({ _id: group._id }, { $set: { 'telegram.language': next } });
      await sendMessage(chatId, botText.langChanged(next));
      return;
    }
  }
}

async function handlePrivateCommand(msg: TelegramMessage, cmd: ParsedCommand): Promise<void> {
  const linked = await findLinkedUser(msg.from?.id);
  const lang = sanitizeBotLang(linked?.preferences?.language);
  if (cmd.name === 'start' && cmd.arg) {
    await handleLink(msg, cmd.arg, lang);
    return;
  }
  if (cmd.name === 'start') {
    await sendMessage(msg.chat.id, `${botText.privateStart(lang)}\n\n${botText.help(lang)}`);
    return;
  }
  await sendMessage(msg.chat.id, botText.help(lang));
}

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  await connectDB();

  // Bot removed from a group → stop posting there
  const member = update.my_chat_member;
  if (member && (member.new_chat_member.status === 'left' || member.new_chat_member.status === 'kicked')) {
    await Group.updateOne({ 'telegram.chatId': member.chat.id }, { $unset: { telegram: 1 } });
    return;
  }

  const msg = update.message;
  if (!msg) return;

  // Group upgraded to supergroup → chat id changes
  if (typeof msg.migrate_to_chat_id === 'number') {
    await Group.updateOne({ 'telegram.chatId': msg.chat.id }, { $set: { 'telegram.chatId': msg.migrate_to_chat_id } });
    return;
  }

  if (!msg.from || msg.from.is_bot) return;
  const cmd = parseCommand(msg.text);
  if (!cmd) return;

  if (msg.chat.type === 'private') {
    await handlePrivateCommand(msg, cmd);
  } else if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
    await handleGroupCommand(msg, cmd);
  }
}
