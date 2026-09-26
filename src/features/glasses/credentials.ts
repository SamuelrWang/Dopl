import { createHash, randomBytes } from "node:crypto";

/**
 * Glasses credentials: minting and hashing. Only the SHA-256 hex of a
 * credential is ever stored; the plaintext is returned to its owner once.
 * Prefixes make a leaked value recognizable and keep the families apart from
 * Dopl's own `dopl_at_` tokens.
 */

export const DEVICE_TOKEN_PREFIX = "glsdt_";
export const HEY_EVEN_KEY_PREFIX = "glshe_";
export const POLL_SECRET_PREFIX = "glsps_";

/** Pairing-code alphabet: A-Z and 2-9 without I, O, 0, 1 — 32 symbols, read aloud safely. */
export const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PAIRING_CODE_LENGTH = 6;
const PAIRING_CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

export function hashCredential(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function mint(prefix: string): string {
  return prefix + randomBytes(32).toString("base64url");
}

export const mintDeviceToken = () => mint(DEVICE_TOKEN_PREFIX);
export const mintHeyEvenKey = () => mint(HEY_EVEN_KEY_PREFIX);
export const mintPollSecret = () => mint(POLL_SECRET_PREFIX);

/** 32 symbols = 5 bits, so masking a random byte is unbiased. */
export function generatePairingCode(bytes: Uint8Array = randomBytes(PAIRING_CODE_LENGTH)): string {
  let code = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) code += PAIRING_CODE_ALPHABET[bytes[i] & 31];
  return code;
}

/** Uppercase and drop spaces/dashes; null unless it is a well-formed code. */
export function normalizePairingCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/[\s-]/g, "");
  return PAIRING_CODE_RE.test(code) ? code : null;
}

/** The bearer value of an `Authorization` header, or null. */
export function bearerOf(request: Request): string | null {
  const value = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return value ? value : null;
}
