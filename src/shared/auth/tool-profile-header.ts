/**
 * `X-Dopl-Tool-Profile` — the CONTAINMENT PROFILE a connection is running
 * under, so the MCP server can offer it fewer tools than the whole surface.
 *
 * The desktop already computes that profile for every session it spawns
 * (`dopl-desktop-app/main/tool-profiles.js`) and enforces it locally through
 * `disallowedTools` + the permission gate. What it could not do was tell the
 * SERVER, so a session that will never be allowed to call a single Dopl tool
 * still paid for every tool's description and input schema on connection. This
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
 * in ONE place — `packages/mcp-server/src/gating.ts › TOOL_PROFILES` — which is
 * also where an unplaceable value falls to the narrowest profile. Listing the
 * names here too would be a second declaration of the same set (the hand-mirror
 * class this repo gates elsewhere), and a profile added on one side alone would
 * be drift rather than a build failure.
 */

export const TOOL_PROFILE_HEADER = "x-dopl-tool-profile";

/**
 * A profile name: lowercase, short, `_`-separated. ⚠ Narrow on purpose — the
 * value crosses into a table lookup, so it is bounded before it becomes a key,
 * and a near-miss is a bug to notice rather than a value to rescue (no trimming,
 * no case folding).
 */
const TOOL_PROFILE_RE = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * What a PRESENT but unreadable header resolves to.
 *
 * ⚠ IT IS NOT A PROFILE NAME AND CANNOT BECOME ONE: {@link TOOL_PROFILE_RE}
 * requires a leading letter, so the empty string is outside the vocabulary by
 * construction and `gating.ts › offeredToolsFor` answers it with the NARROWEST
 * profile — while still telling that function a header WAS sent, which
 * `undefined` (no header at all) does not.
 */
export const UNREADABLE_TOOL_PROFILE = "";

/**
 * The profile this request's HEADER reports — `undefined` ONLY when no header
 * was sent, which is the one answer that means "no narrowing".
 *
 * ⚠ **PRESENT-AND-UNREADABLE MUST NOT COLLAPSE INTO ABSENT** (2026-09-02).
 * `Headers.get` joins repeated fields with `", "`; the joined string fails
 * {@link TOOL_PROFILE_RE}; and returning `undefined` for it meant "no header" —
 * the WIDEST answer. So a second copy of this header, from a proxy that appends
 * rather than replaces, silently removed the narrowing instead of being refused
 * by it. Every unreadable value now answers {@link UNREADABLE_TOOL_PROFILE},
 * which the server narrows to its floor.
 *
 * ⚠ **REPEATED FIELDS: IDENTICAL IS ONE CLAIM, DIFFERING IS NONE.** A proxy
 * re-sending the same value asked for exactly the narrowing the sender did, and
 * it keeps it. Two DIFFERENT values are two claims and this layer cannot tell
 * which is the caller's, so it reports neither and the server takes its floor.
 *
 * ⚠ Still no trimming and no case folding on the value itself: the segment
 * BEFORE the joiner carries no leading space, and the trim below is only how
 * repeated fields are COMPARED, never what is returned.
 */
export function readToolProfileHeader(request: {
  headers: Headers;
}): string | undefined {
  const raw = request.headers.get(TOOL_PROFILE_HEADER);
  if (raw === null) return undefined;
  const [first, ...rest] = raw.split(",");
  if (rest.some((field) => field.trim() !== first)) {
    return UNREADABLE_TOOL_PROFILE;
  }
  return TOOL_PROFILE_RE.test(first) ? first : UNREADABLE_TOOL_PROFILE;
}
