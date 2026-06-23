import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';

// Local credentials login uses Node's built-in scrypt so the project needs no
// extra hashing dependency. Stored format: "scrypt:<saltHex>:<hashHex>".
// NOTE: keep this format in sync with scripts/create-admin.mjs, which hashes
// passwords the same way without importing this (TS) module.

const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !hash) {
    return false;
  }
  const derived = scryptSync(password, salt, KEY_LENGTH);
  const hashBuf = Buffer.from(hash, 'hex');
  return hashBuf.length === derived.length && timingSafeEqual(hashBuf, derived);
}
