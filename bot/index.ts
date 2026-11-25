/**
 * SalahTrack Telegram bot — standalone long-running process (runs on our own server).
 *
 * Why a separate process instead of Vercel routes:
 *  - Long polling (getUpdates) needs no public URL/HTTPS and no webhook secret.
 *  - A local timer replaces the external cron pinger.
 *
 * It shares MongoDB (MONGODB_URI) with the website: the website writes one-time link
 * codes, this process reads them; both read prayer records and groups.
 *
 * Run:  node bot/index.ts        (Node 24 strips TypeScript types natively)
 * Env:  MONGODB_URI, TELEGRAM_BOT_TOKEN
 *
 * Only ONE process may poll per bot token: Telegram answers a second poller with 409.
 */
import mongoose from 'mongoose';
import { connectDB } from '../src/lib/mongodb.ts';
import type { TelegramUpdate } from '../src/lib/telegram/api.ts';
import { handleTelegramUpdate } from '../src/lib/telegram/commands.ts';
import { runTelegramTick } from '../src/lib/telegram/notify.ts';
import { BOT_COMMANDS } from '../src/lib/telegram/messages.ts';

const TICK_INTERVAL_MS = 60 * 1000;
const POLL_TIMEOUT_SEC = 30;

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token || !process.env.MONGODB_URI) {
  console.error('TELEGRAM_BOT_TOKEN and MONGODB_URI must be set');
  process.exit(1);
}

let stopping = false;
let pollAbort: AbortController | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args);

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

async function getUpdates(offset: number): Promise<TelegramResponse<TelegramUpdate[]>> {
  pollAbort = new AbortController();
  const timer = setTimeout(() => pollAbort?.abort(), (POLL_TIMEOUT_SEC + 15) * 1000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offset, timeout: POLL_TIMEOUT_SEC, allowed_updates: ['message', 'my_chat_member', 'callback_query'] }),
      signal: pollAbort.signal,
    });
    return (await res.json()) as TelegramResponse<TelegramUpdate[]>;
  } finally {
    clearTimeout(timer);
  }
}

async function pollLoop(): Promise<void> {
  let offset = 0;
  while (!stopping) {
    try {
      const data = await getUpdates(offset);
      if (!data.ok) {
        // 429 flood control / 409 another poller: wait instead of hammering Telegram
        const waitSec = data.parameters?.retry_after ?? 10;
        log(`getUpdates failed: ${data.error_code} ${data.description} — retry in ${waitSec}s`);
        await sleep(waitSec * 1000);
        continue;
      }
      for (const update of data.result ?? []) {
        offset = update.update_id + 1;
        try {
          await handleTelegramUpdate(update);
        } catch (err) {
          console.error(`update ${update.update_id} failed:`, err);
        }
      }
    } catch (err) {
      if (stopping) break;
      log('poll error:', err instanceof Error ? err.message : err);
      await sleep(5000);
    }
  }
}

let tickRunning = false;
async function tick(): Promise<void> {
  if (tickRunning) return; // never overlap: a slow tick (fatvo.uz timeout) just skips one beat
  tickRunning = true;
  try {
    const result = await runTelegramTick();
    if (result.sent || result.failed) log(`tick: groups=${result.groups} sent=${result.sent} failed=${result.failed}`);
  } catch (err) {
    console.error('tick failed:', err);
  } finally {
    tickRunning = false;
  }
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log(`${signal} received, shutting down`);
  pollAbort?.abort();
  await mongoose.disconnect().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

/**
 * Startup call that obeys flood control: on 429 it waits `retry_after` before trying
 * again. Calling during a flood penalty extends it, so never retry early.
 */
async function startupCall<T>(method: string, body: Record<string, unknown>): Promise<T | null> {
  for (let attempt = 0; attempt < 20 && !stopping; attempt++) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as TelegramResponse<T>;
      if (data.ok) return data.result ?? null;
      if (data.error_code !== 429) {
        log(`${method} failed: ${data.error_code} ${data.description}`);
        return null;
      }
      const waitSec = data.parameters?.retry_after ?? 30;
      log(`${method}: rate limited, waiting ${waitSec}s`);
      await sleep((waitSec + 1) * 1000);
    } catch (err) {
      log(`${method} error:`, err instanceof Error ? err.message : err);
      await sleep(5000);
    }
  }
  return null;
}

await connectDB();
log('connected to MongoDB');
const me = await startupCall<{ username: string }>('getMe', {});
log(`bot @${me?.username ?? '?'}`);

// Polling and webhooks are mutually exclusive: make sure no webhook is registered
await startupCall('deleteWebhook', {});
for (const [language_code, menus] of Object.entries(BOT_COMMANDS)) {
  for (const [kind, commands] of Object.entries(menus)) {
    await startupCall('setMyCommands', {
      commands: commands.map(([command, description]) => ({ command, description })),
      scope: { type: kind === 'private' ? 'all_private_chats' : 'all_group_chats' },
      ...(language_code === 'uz' ? {} : { language_code }),
    });
  }
}

setInterval(() => void tick(), TICK_INTERVAL_MS);
void tick();
await pollLoop();
