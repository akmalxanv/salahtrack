/**
 * Minimal Telegram Bot API client (no third-party SDK: the bot only needs a few methods,
 * and plain fetch keeps it compatible with any serverless runtime).
 *
 * Server-only: reads TELEGRAM_BOT_TOKEN, which must never reach the client bundle.
 */
const TELEGRAM_API = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 8000;

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  migrate_to_chat_id?: number;
}

export interface TelegramChatMemberUpdated {
  chat: TelegramChat;
  from: TelegramUser;
  new_chat_member: { status: string; user: TelegramUser };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  my_chat_member?: TelegramChatMemberUpdated;
}

/**
 * Outcome of a Bot API call:
 *  - ok:        Telegram confirmed the call.
 *  - rejected:  Telegram answered with an error (the call definitely did not take effect).
 *  - unknown:   network error / timeout — the call may or may not have taken effect.
 */
export type TelegramOutcome<T> = { status: 'ok'; result: T } | { status: 'rejected' | 'unknown' };

export async function callTelegramDetailed<T = unknown>(
  method: string,
  payload: Record<string, unknown>
): Promise<TelegramOutcome<T>> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('[telegram] TELEGRAM_BOT_TOKEN is not set');
    return { status: 'rejected' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
    if (res.ok && data?.ok) return { status: 'ok', result: data.result as T };
    // Never log the URL: it contains the bot token
    console.error(`[telegram] ${method} failed: ${res.status} ${data?.description ?? ''}`);
    return { status: data ? 'rejected' : 'unknown' };
  } catch (err) {
    console.error(`[telegram] ${method} error:`, err instanceof Error ? err.message : err);
    return { status: 'unknown' };
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Calls a Bot API method. Returns the `result` field, or null on any failure (logged). */
export async function callTelegram<T = unknown>(method: string, payload: Record<string, unknown>): Promise<T | null> {
  const outcome = await callTelegramDetailed<T>(method, payload);
  return outcome.status === 'ok' ? outcome.result : null;
}

export async function sendMessageDetailed(chatId: number, html: string): Promise<'ok' | 'rejected' | 'unknown'> {
  const outcome = await callTelegramDetailed('sendMessage', {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  });
  return outcome.status;
}

export async function sendMessage(chatId: number, html: string): Promise<boolean> {
  return (await sendMessageDetailed(chatId, html)) === 'ok';
}

export async function deleteMessage(chatId: number, messageId: number): Promise<void> {
  await callTelegram('deleteMessage', { chat_id: chatId, message_id: messageId });
}

/** Escapes text for Telegram HTML parse mode (only &, <, > are special). */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * A mention that notifies the user even when they have no @username.
 * The Telegram user id is numeric, so it cannot inject markup.
 */
export function mentionHtml(telegramUserId: number, displayName: string): string {
  return `<a href="tg://user?id=${Math.trunc(telegramUserId)}">${escapeHtml(displayName)}</a>`;
}
