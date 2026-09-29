import { createHash, randomBytes } from "node:crypto";
import { PAIRING_CODE_ALPHABET, PAIRING_CODE_LENGTH } from "./pairing-code";

/**
 * Glasses credentials. Only the SHA-256 hex of a credential is ever stored; the
 * plaintext goes to its owner once. Prefixes make a leaked value recognizable
 * and keep the families apart from Dopl's own `dopl_at_` tokens.
 */

export function hashCredential(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function mintCredential(prefix: string): string {
  return prefix + randomBytes(32).toString("base64url");
}

export const mintDeviceToken = () => mintCredential("glsdt_");
export const mintPollSecret = () => mintCredential("glsps_");

/** One symbol per byte from `pairing-code.ts`'s alphabet. */
export function generatePairingCode(bytes: Uint8Array = randomBytes(PAIRING_CODE_LENGTH)): string {
  let code = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) code += PAIRING_CODE_ALPHABET[bytes[i] & 31];
  return code;
}
