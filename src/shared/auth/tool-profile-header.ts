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

/** The role this request's HEADER claims, or undefined. */
export function readToolProfileHeader(request: {
  headers: Headers;
}): string | undefined {
  const raw = request.headers.get(TOOL_PROFILE_HEADER);
  return raw && TOOL_PROFILE_RE.test(raw) ? raw : undefined;
}
