/**
 * **THE CURSOR'S WIRE FORMAT — THE HALF THAT IS NOT A SECRET** (B6-2, 2026-10-12).
 *
 * ⚠ **SPLIT OUT OF `server/cursor-codec.ts` BECAUSE THE SCHEMAS ARE CLIENT CODE.**
 * `schema-reads.ts` has to tell a token from a legacy integer in order to accept
 * both, and it is imported by `hooks/use-channel-messages.ts` — a browser module.
 * The codec carries `import "server-only"` and reads a key, so importing it there
 * would break the client build.
 *
 * So the seam is exactly the secret: **the FORMAT is shared, the KEY and the
 * crypto stay server-side.** Recognising a token needs no key; reading one does.
 *
 * ⚠ **NOTHING HERE DECODES.** A caller that can tell a token apart still cannot
 * learn the seq inside it, which is the whole point of B6 — this module is
 * deliberately unable to leak, not merely trusted not to.
 */

/**
 * Current format and key id. ⚠ A new key means a new prefix, never a silent swap,
 * so a token minted under a retired key is diagnosable rather than merely invalid.
 */
export const CURSOR_PREFIX = "dc1.";

/**
 * **IS THIS A TOKEN OR A LEGACY INTEGER?**
 *
 * ⚠ The prefix makes the discrimination total and LOCAL, which is what lets every
 * accepting surface take both forms without guessing — no length heuristic, no
 * "does it parse as a number" fallback, both of which would misread a future
 * format. An integer cursor is accepted indefinitely (B6 §3: no sunset date until
 * telemetry shows nobody sends one), so this distinction is permanent, not
 * transitional.
 */
export function isCursorToken(value: string): boolean {
  return value.startsWith(CURSOR_PREFIX);
}
