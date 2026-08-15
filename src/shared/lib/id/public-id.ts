import "server-only";
import { randomBytes } from "node:crypto";
import { PUBLIC_ID_LENGTH } from "./constants";

export { PUBLIC_ID_LENGTH };

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * 12-char lowercase base36 opaque ID (~62 bits). Routing handle for workspaces,
 * knowledge bases, skills.
 *
 * ⚠ LOWERCASE ONLY: `src/proxy.ts` force-lowercases any URL containing
 * uppercase, so a mixed-case ID survives the redirect but misses the
 * case-sensitive DB lookup and 404s canonical URLs. 36^12 ≈ 4.7e18 leaves ample
 * headroom (~5e-6 collision at 10M rows).
 *
 * ⚠ Not a cryptographic token — modulo bias on 256 → 36 is < 5.5% per byte.
 */
export function generatePublicId(): string {
  const bytes = randomBytes(PUBLIC_ID_LENGTH);
  let out = "";
  for (let i = 0; i < PUBLIC_ID_LENGTH; i++) {
    out += ALPHABET[bytes[i] % 36];
  }
  return out;
}
