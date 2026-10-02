import * as argon2 from 'argon2';
import type { HashOptions } from 'argon2';

/**
 * Argon2id Configuration Options
 * Aligned with OWASP and AGENTS.md recommendations:
 * - Variant: Argon2id (hybrid data-dependent/data-independent resistance against GPU/ASIC and side-channel attacks)
 * - Memory Cost: 19 MiB (19456 KiB)
 * - Time Cost: 2 iterations
 * - Parallelism: 1 thread
 */
export const ARGON2_CONFIG: HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB in KiB
  timeCost: 2,       // 2 iterations
  parallelism: 1,    // 1 lane / thread
};

/**
 * Maximum password length to mitigate Denial of Service (DoS) / ReDoS via overly large payloads
 */
export const MAX_PASSWORD_LENGTH = 128;

/**
 * Hashes a plaintext password using the Argon2id adaptive hashing algorithm.
 *
 * @param plainText The plaintext password to hash.
 * @returns A Promise resolving to the Argon2id encoded hash string.
 * @throws Error if the password is empty, invalid, or exceeds the maximum length.
 */
export async function hashPassword(plainText: string): Promise<string> {
  if (typeof plainText !== 'string' || plainText.length === 0) {
    throw new Error('Password must be a non-empty string');
  }

  if (plainText.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Password must not exceed ${MAX_PASSWORD_LENGTH} characters`);
  }

  return argon2.hash(plainText, ARGON2_CONFIG);
}

/**
 * Verifies a plaintext password against a stored Argon2id hash in constant time.
 *
 * @param plainText The candidate plaintext password submitted by the user.
 * @param hash The stored Argon2id hash from the database.
 * @returns A Promise resolving to true if the password matches, or false otherwise.
 */
export async function verifyPassword(plainText: string, hash: string): Promise<boolean> {
  if (
    typeof plainText !== 'string' ||
    typeof hash !== 'string' ||
    plainText.length === 0 ||
    hash.length === 0
  ) {
    return false;
  }

  if (plainText.length > MAX_PASSWORD_LENGTH) {
    return false;
  }

  try {
    return await argon2.verify(hash, plainText);
  } catch {
    // If the hash is malformed, corrupted, or verification fails internally, return false
    // without leaking error details or stack traces to callers
    return false;
  }
}
