import { createHash, randomBytes } from "node:crypto";

/**
 * Glasses credentials. Only the SHA-256 hex of a credential is ever stored; the
 * plaintext goes to its owner once. Prefixes make a leaked value recognizable
 * and keep the families apart from Dopl's own `dopl_at_` tokens.
 */

export const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIRING_CODE_LENGTH = 6;
const PAIRING_CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

export function hashCredential(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function mintCredential(prefix: string): string {
  return prefix + randomBytes(32).toString("base64url");
}

export const mintDeviceToken = () => mintCredential("glsdt_");
export const mintPollSecret = () => mintCredential("glsps_");

/** A-Z and 2-9 without I, O, 0, 1: 32 symbols, read aloud safely, and a masked byte stays unbiased. */
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
