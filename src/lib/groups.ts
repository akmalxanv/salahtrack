import crypto from 'node:crypto';

/**
 * Generates an uppercase, unambiguous 8-character invite code (e.g. SLH-9X4K)
 * Excludes easily confusable characters (0, O, 1, I, L)
 */
export function generateInviteCode(): string {
  const chars = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
