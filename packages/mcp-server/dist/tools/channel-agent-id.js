"use strict";
/**
 * THE AGENT INSTANCE ID, NORMALIZED — **the one parser three ops share**.
 *
 * ⚠ **EXTRACTED FROM `channel-ops-direct.ts` ON 2026-09-01**, when `end_agent` and
 * `rename_agent` landed and became its second and third callers. It is four
 * characters of logic and that is exactly why it had to move: a copy would be
 * four characters that agree today, and the day one of them stops accepting the
 * pasted `@agent-` form is the day a caller is 400'd for doing what the
 * neighbouring op taught it.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.bareAgentId = bareAgentId;
exports.isAgentId = isAgentId;
/**
 * THE BARE INSTANCE ID, from whichever form the caller pasted.
 *
 * ⚠ **BOTH FORMS ARE ACCEPTED BECAUSE `read_sessions` PRINTS THE HANDLE, NOT THE
 * ID.** Every surface that shows an agent over MCP shows `@agent-<id>`, so that is
 * what a model copies — and the column CHECK and the create schema both want the
 * bare eight characters. Refusing the pasted form would be a 400 for doing exactly
 * what the neighbouring op taught, which is the invisible-failure shape this
 * surface refuses everywhere else.
 * ⚠ IT STRIPS, IT DOES NOT VALIDATE. A value that is not an agent id after this
 * is refused by the create schema and, failing that, reaches a machine that
 * answers `no-session` — both honest, and neither is this function's job.
 */
function bareAgentId(raw) {
    return String(raw || "").trim().replace(/^@/, "").replace(/^agent-/, "");
}
/**
 * THE AGENT-ID GRAMMAR — `dopl-desktop-app/main/agent-id.js › AGENT_ID_RE`'s,
 * the same one `schema-ping.ts` and `schema-direction.ts` hand-mirror and the
 * same one the `channel_pings` / `channel_launch_directives` column CHECKs
 * enforce. ⚠ **RESTATED HERE FOR THE REASON THE WHOLE FILE EXISTS**: this
 * package cannot import from `src/`, and the alternative is a fourth copy in
 * whichever op needs it next.
 *
 * ⚠ **IT IS WHAT MAKES ONE `recipient` FIELD UNAMBIGUOUS** (C5): anchored at
 * eight characters starting with a letter, it cannot match a user id (a
 * 36-character uuid) or an email (which always carries an `@` that is never in
 * first position), so the three destinations a ping can have do not overlap and
 * need no precedence rule.
 */
const AGENT_ID_RE = /^[a-z][a-z0-9]{7}$/;
/** Whether a value is an agent INSTANCE id. ⚠ Feed it {@link bareAgentId}'s
 *  output — the handle `read_sessions` prints is not itself an id. */
function isAgentId(value) {
    return AGENT_ID_RE.test(value);
}
