/**
 * `X-Dopl-Tool-Profile` — the ROLE a connection says it is running as, so the
 * MCP server can offer it fewer tools than the whole surface.
 *
 * The desktop already computes a containment profile for every session it
 * spawns (`dopl-desktop-app/main/tool-profiles.js`) and enforces it locally
 * through `disallowedTools` + the permission gate. What it could not do was tell
 * the SERVER, so a `dopl_only` courier that will only ever call `dopl_channel`
 * still pays for every tool's description and input schema on connection. This
 * header is that one word.
 *
 * ⚠ IT MAY ONLY NARROW, AND IT IS A HINT, NOT AN AUTHORIZATION SIGNAL — the same
 * discipline as {@link ../auth/runtime-header.ts} and the session-id stamp, for
 * the same reason: anything holding the credential can set any value, so it
 * PROVES nothing. Nothing may be GRANTED on it. What refuses a call is the
 * credential, the desktop's deny list and `gating.ts › opRefusal`; this only
 * decides what is OFFERED.
 *
 * ⚠ SHAPE-CHECKED, NOT ENUMERATED, AND THAT IS DELIBERATE. The VOCABULARY lives
 * in ONE place — `packages/mcp-server/src/gating.ts › TOOL_PROFILE_TOOLS` — and
 * an unrecognized role there resolves to "no narrowing", which is the same
 * answer as an absent header. Listing the role names here too would be a second
 * declaration of the same set (the hand-mirror class this repo gates elsewhere)
 * whose only effect would be to turn a role this server has not heard of into a
 * silently dropped one, and a role added on either side alone into drift.
 */

export const TOOL_PROFILE_HEADER = "x-dopl-tool-profile";

/**
 * A role name: lowercase, short, `_`-separated. ⚠ Narrow on purpose — the value
 * crosses into a table lookup, so it is bounded before it becomes a key, and a
 * near-miss is a bug to notice rather than a value to rescue (no trimming, no
 * case folding).
 */
const TOOL_PROFILE_RE = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * The role this request's HEADER claims, or undefined.
 *
 * ⚠ **DUPLICATE HEADERS FOLD TO `"a, b"` AND THAT USED TO UN-NARROW THE
 * REQUEST** (2026-09-02). `Headers.get` joins repeated fields with `", "`, the
 * joined string fails {@link TOOL_PROFILE_RE}, and `undefined` here means "no
 * narrowing" — the WIDEST answer. So a second copy of this header, from a proxy
 * that appends rather than replaces or from anything that can add one, silently
 * removed the narrowing instead of being refused by it.
 *
 * ⚠ **THE FIRST VALUE WINS, WHICH IS THE ONLY ONE THAT CAN BE THE CALLER'S.**
 * Header order is insertion order, so an appended copy is second; taking the
 * first preserves the narrowing a legitimate duplicate (a proxy re-sending the
 * same value) asked for, and gives an appended one no effect at all. The
 * narrowest-profile alternative is not available here — this module deliberately
 * knows no role names (`gating.ts › TOOL_PROFILE_TOOLS` is the one declaration),
 * and inventing a floor would be a second one.
 *
 * ⚠ Still no trimming and no case folding on the value itself: `.split(",", 1)`
 * takes the segment BEFORE the joiner, which carries no leading space.
 */
export function readToolProfileHeader(request: {
  headers: Headers;
}): string | undefined {
  const raw = request.headers.get(TOOL_PROFILE_HEADER);
  if (raw === null) return undefined;
  const first = raw.split(",", 1)[0];
  return TOOL_PROFILE_RE.test(first) ? first : undefined;
}
