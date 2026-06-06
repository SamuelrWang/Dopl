// No `import "server-only"` — matches the sibling server modules
// (supabase/admin, auth/api-keys) which rely on env-throw, and keeps
// this importable from one-off tsx scripts (the backfill). It still
// fails safe: without API_KEY_ENCRYPTION_KEY (never NEXT_PUBLIC_) every
// call throws, so no secret can leak to a client bundle.
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * Reversible encryption for API-key plaintext at rest (AES-256-GCM).
 *
 * Auth NEVER uses this — `validateApiKey` is a one-way SHA-256 hash
 * lookup. This exists only so the owner can REVEAL their key and so the
 * setup snippets can be auto-filled after creation.
 *
 * Storage format: a single base64 string packing `iv(12) ‖ tag(16) ‖
 * ciphertext`, stored in `api_keys.encrypted_key`. Self-framing, so one
 * TEXT column is enough.
 *
 * Requires `API_KEY_ENCRYPTION_KEY` — 32 bytes, hex (64 chars) or base64.
 * Generate one with: `openssl rand -hex 32`.
 */

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

let cachedKey: Buffer | null = null;

function decodeSecret(raw: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  return Buffer.from(raw, "base64");
}

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.API_KEY_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "API_KEY_ENCRYPTION_KEY is not set — required to encrypt and reveal API keys. Generate one with `openssl rand -hex 32`."
    );
  }
  const key = decodeSecret(raw);
  if (key.length !== 32) {
    throw new Error(
      `API_KEY_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). Use a 64-char hex or base64 value.`
    );
  }
  cachedKey = key;
  return key;
}

/** True when the encryption secret is configured (for graceful UI fallback). */
export function isApiKeyEncryptionConfigured(): boolean {
  return Boolean(process.env.API_KEY_ENCRYPTION_KEY);
}

/** Encrypt plaintext → packed base64 (`iv ‖ tag ‖ ciphertext`). */
export function encryptKey(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/** Decrypt a packed base64 blob produced by `encryptKey`. */
export function decryptKey(packed: string): string {
  const buf = Buffer.from(packed, "base64");
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
