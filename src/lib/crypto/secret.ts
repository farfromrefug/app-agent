/**
 * Symmetric encryption for sensitive settings stored in the database (currently
 * the per-team LLM API key). Uses AES-256-GCM with a key derived from a server
 * secret, so the plaintext key never sits in the database and is only decrypted
 * server-side at call time.
 *
 * Key source: LLM_CONFIG_SECRET, falling back to NEXTAUTH_SECRET so self-hosters
 * don't need to set a new env var. The 32-byte AES key is the SHA-256 of that
 * secret.
 *
 * Blob format: `v1:<iv-b64>:<tag-b64>:<ciphertext-b64>`.
 *
 * This module is server-only (it imports node:crypto). Do not import it from
 * client components.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, recommended for GCM

function getKey(): Buffer {
  const secret =
    process.env.LLM_CONFIG_SECRET || process.env.NEXTAUTH_SECRET || '';
  if (!secret) {
    throw new Error(
      'Cannot encrypt/decrypt secrets: set LLM_CONFIG_SECRET or NEXTAUTH_SECRET.'
    );
  }
  // SHA-256 gives a deterministic 32-byte key regardless of the secret length.
  return createHash('sha256').update(secret).digest();
}

/** Encrypt a plaintext string into a versioned, self-describing blob. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/**
 * Decrypt a blob produced by {@link encryptSecret}. Returns the plaintext, or
 * the input unchanged if it is not a recognized blob (tolerates values written
 * before encryption was introduced, so reads never hard-fail).
 */
export function decryptSecret(blob: string): string {
  if (!blob || !blob.startsWith(`${VERSION}:`)) {
    return blob;
  }
  const [, ivB64, tagB64, dataB64] = blob.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    return blob;
  }
  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      getKey(),
      Buffer.from(ivB64, 'base64')
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]);
    return plain.toString('utf8');
  } catch {
    // Wrong key or tampered blob — surface as empty rather than crashing reads.
    return '';
  }
}

/** Whether a stored value looks like an encrypted blob (vs. empty/plaintext). */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(`${VERSION}:`);
}
