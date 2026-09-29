/**
 * The pairing code's shape, shared by the server and the Settings client.
 * ⚠ Client-safe: no server-only imports here.
 */

/** A-Z and 2-9 without I, O, 0, 1: 32 symbols, read aloud safely, and a masked byte stays unbiased. */
export const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PAIRING_CODE_LENGTH = 6;
const PAIRING_CODE_RE = new RegExp(`^[${PAIRING_CODE_ALPHABET}]{${PAIRING_CODE_LENGTH}}$`);

/** Uppercase and drop spaces/dashes; null unless it is a well-formed code. */
export function normalizePairingCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/[\s-]/g, "");
  return PAIRING_CODE_RE.test(code) ? code : null;
}

/** Live-typing cleanup: uppercase letters and digits only, capped at the code length. */
export function pairingCodeInput(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, PAIRING_CODE_LENGTH);
}
