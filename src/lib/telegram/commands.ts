/**
 * Telegram update router: handles bot commands and chat membership changes.
 *
 * Authorization model:
 *  - Telegram identities come from Telegram itself (long polling over HTTPS with the bot token).
 *  - A Telegram user maps to a SalahTrack user only through a one-time link code.
 *  - Group-changing commands (/connect, /disconnect, /lang) require the linked
 *    SalahTrack user to be owner/admin of that SalahTrack group (checked server-side).
 */
import { connectDB } from '../mongodb.ts';
import { Group } from '../../models/Group.ts';
import { User } from '../../models/User.ts';
import { getZonedDateParts } from '../prayer-cycle.ts';
import type { PrayerId } from '../../types/prayer.ts';
import { sendMessage, deleteMessage, callTelegram, type TelegramUpdate, type TelegramMessage } from './api.ts';
import { botText, sanitizeBotLang, type BotLang } from './messages.ts';
import { hashLinkCode, isWellFormedLinkCode, TELEGRAM_BOT_USERNAME } from './link.ts';
import { buildDebtReport, getGroupTimes } from './notify.ts';
import { PRAYER_IDS } from './schedule.ts';
import { resolveLocation } from './user-context.ts';
import { handleCallbackQuery, sendPersonalView, setUserLanguage, unlinkTelegram } from './personal.ts';

const DEBTS_COOLDOWN_MS = 2 * 60 * 1000;
const lastDebtsReply = new Map<number, number>();

interface ParsedCommand {
  name: string;
  arg: string;
}

export function parseCommand(text: string | undefined, botUsername: string = TELEGRAM_BOT_USERNAME): ParsedCommand | null {
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

function isGroupMember(group: { members: { userId: { toString(): string } }[] }, userId: string): boolean {
  return group.members.some((m) => m.userId.toString() === userId);
}

/** Anonymous admins post as the group itself; Telegram only allows admins to do that. */
function isAnonymousChatAdmin(msg: TelegramMessage): boolean {
  return msg.sender_chat?.id === msg.chat.id;
}

/** Whether the sender is the owner or an admin of this Telegram chat (asks Telegram). */
async function isTelegramChatAdmin(msg: TelegramMessage): Promise<boolean> {
  if (isAnonymousChatAdmin(msg)) return true;
  if (!msg.from) return false;
  const member = await callTelegram<{ status: string }>('getChatMember', { chat_id: msg.chat.id, user_id: msg.from.id });
  return member?.status === 'creator' || member?.status === 'administrator';
}

function isGroupAdmin(group: { members: { userId: { toString(): string }; role: string }[] }, userId: string): boolean {
  return group.members.some((m) => m.userId.toString() === userId && (m.role === 'owner' || m.role === 'admin'));
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
    { returnDocument: 'after' }
  )
    .select('_id name preferences')
    .lean();

  if (!user) {
    await sendMessage(msg.chat.id, botText.linkInvalid(lang));
    return;
  }
  await sendMessage(msg.chat.id, botText.linked(sanitizeBotLang(user.preferences?.language), user.name));
}

/**
 * Invite codes are stored as XXXX-XXXX (see generateInviteCode). Accepts any case,
 * with or without the hyphen, and returns the stored form — or null if malformed.
 */
export function normalizeInviteCode(raw: string): string | null {
  const match = /^([A-Z0-9]{4})-?([A-Z0-9]{4})$/.exec(raw.trim().toUpperCase());
  return match ? `${match[1]}-${match[2]}` : null;
}

async function handleConnect(msg: TelegramMessage, inviteCode: string, lang: BotLang): Promise<void> {
  const chatId = msg.chat.id;
  const user = await findLinkedUser(msg.from?.id);
  if (!user) {
    await sendMessage(chatId, botText.mustLinkFirst(lang));
    return;
  }
  const code = normalizeInviteCode(inviteCode);
  if (!code) {
    await sendMessage(chatId, botText.connectUsage(lang));
    return;
  }

  // The invite code lets anyone join the group: remove it from the chat (works if the bot is admin)
  await deleteMessage(chatId, msg.message_id);

  const group = await Group.findOne({ inviteCode: code }).select('_id name members telegram').lean();
  if (!group) {
    await sendMessage(chatId, botText.connectDenied(lang));
    return;
  }

  // Allowed: an admin of the SalahTrack group, OR an admin of this Telegram chat who is a
  // member of the SalahTrack group. Moving a group that already posts to a DIFFERENT chat
  // stays app-admin-only, so a member cannot redirect everyone's debt reports to their own chat.
  const userId = user._id.toString();
  const appAdmin = isGroupAdmin(group, userId);
  const boundElsewhere = typeof group.telegram?.chatId === 'number' && group.telegram.chatId !== chatId;
  const chatAdminMember = !boundElsewhere && isGroupMember(group, userId) && (await isTelegramChatAdmin(msg));
  if (!appAdmin && !chatAdminMember) {
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
      const appAdmin = linked ? isGroupAdmin(group, linked._id.toString()) : false;
      if (!appAdmin && !(await isTelegramChatAdmin(msg))) {
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
  const chatId = msg.chat.id;
  const linked = await findLinkedUser(msg.from?.id);
  const lang = sanitizeBotLang(linked?.preferences?.language);
  if (cmd.name === 'start' && cmd.arg) {
    await handleLink(msg, cmd.arg, lang);
    return;
  }

  const personal: Record<string, 't' | 'q' | 's'> = { today: 't', qaza: 'q', debts: 'q', stats: 's' };
  if (personal[cmd.name] || cmd.name === 'lang' || cmd.name === 'unlink') {
    if (!linked) {
      await sendMessage(chatId, `${botText.mustLinkFirst(lang)}\n\n${botText.privateStart(lang)}`);
      return;
    }
    if (personal[cmd.name]) {
      await sendPersonalView(chatId, linked, personal[cmd.name]);
      return;
    }
    if (cmd.name === 'unlink') {
      await unlinkTelegram(linked);
      await sendMessage(chatId, botText.unlinked(lang));
      return;
    }
    const next = cmd.arg.toLowerCase();
    if (next !== 'uz' && next !== 'ru' && next !== 'en') {
      await sendMessage(chatId, '/lang uz | ru | en');
      return;
    }
    await setUserLanguage(linked, next);
    await sendMessage(chatId, botText.langChanged(next));
    return;
  }

  if (cmd.name === 'start') {
    if (linked) {
      await sendMessage(chatId, botText.privateHelp(lang));
      await sendPersonalView(chatId, linked, 't');
      return;
    }
    await sendMessage(chatId, `${botText.privateStart(lang)}\n\n${botText.help(lang)}`);
    return;
  }
  await sendMessage(chatId, linked ? botText.privateHelp(lang) : botText.help(lang));
}

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  await connectDB();

  // Inline button pressed (prayer status, payments, view switches)
  if (update.callback_query) {
    if (update.callback_query.from.is_bot) return;
    console.log(`${new Date().toISOString()} callback ${update.callback_query.data?.split('|')[0] ?? '?'} from ${update.callback_query.message?.chat.type ?? '?'} chat`);
    await handleCallbackQuery(update.callback_query);
    return;
  }

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

  // Ignore bots, except Telegram's stand-in sender for anonymous group admins
  if (!msg.from || (msg.from.is_bot && !isAnonymousChatAdmin(msg))) return;
  const cmd = parseCommand(msg.text);
  if (!cmd) return;
  console.log(`${new Date().toISOString()} command /${cmd.name} in ${msg.chat.type} chat ${msg.chat.id}`);

  if (msg.chat.type === 'private') {
    await handlePrivateCommand(msg, cmd);
  } else if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
    await handleGroupCommand(msg, cmd);
  }
}
