/**
 * One-time Telegram link codes.
 *
 * Flow: the signed-in user asks the app for a code → we store only its SHA-256 hash
 * with a 15-minute expiry → the app shows a deep link t.me/<bot>?start=<code> → the
 * bot receives "/start <code>", hashes it and finds the user. Storing the hash means a
 * database leak does not expose usable codes (same pattern as password reset tokens).
 */
import { createHash, randomBytes } from 'node:crypto';

export const LINK_CODE_TTL_MS = 15 * 60 * 1000;

/** Public @username of the SalahTrack bot (not a secret; the token stays server-side). */
export const TELEGRAM_BOT_USERNAME = 'namozlarimrobot';

/** 24 random bytes → 32 base64url chars; Telegram start params allow [A-Za-z0-9_-]{1,64}. */
export function generateLinkCode(): { code: string; hash: string } {
  const code = randomBytes(24).toString('base64url');
  return { code, hash: hashLinkCode(code) };
}

export function hashLinkCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export function isWellFormedLinkCode(code: unknown): code is string {
  return typeof code === 'string' && /^[A-Za-z0-9_-]{32}$/.test(code);
}

export function buildDeepLink(code: string, botUsername: string = TELEGRAM_BOT_USERNAME): string | null {
  if (!botUsername || !/^[A-Za-z0-9_]{5,32}$/.test(botUsername)) return null;
  return `https://t.me/${botUsername}?start=${code}`;
}
