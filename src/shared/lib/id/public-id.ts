import "server-only";
import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export const PUBLIC_ID_LENGTH = 12;

/**
 * Generate a 12-character lowercase base36 opaque ID (~62 bits of entropy).
 * Used as the routing handle for workspaces, knowledge bases, skills.
 *
 * Lowercase only because [src/proxy.ts] force-lowercases any URL
 * containing uppercase characters (audit fix S-8). Mixed-case IDs
 * would survive the redirect but miss the case-sensitive DB lookup,
 * 404ing canonical URLs after a single roundtrip. 36^12 ≈ 4.7e18 is
 * still ample headroom — collision probability at 10M rows is ~5e-6.
 *
 * Modulo bias on 256 → 36 is < 5.5% per byte. For routing IDs that's
 * fine; we are not generating cryptographic tokens.
 */
export function generatePublicId(): string {
  const bytes = randomBytes(PUBLIC_ID_LENGTH);
  let out = "";
  for (let i = 0; i < PUBLIC_ID_LENGTH; i++) {
    out += ALPHABET[bytes[i] % 36];
  }
  return out;
}
