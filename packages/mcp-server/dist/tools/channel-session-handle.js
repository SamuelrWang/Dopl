"use strict";
/**
 * THE ADDRESSABLE HANDLE OF ONE AGENT SESSION, AND THE SENTENCE THAT HAS TO
 * TRAVEL WITH IT.
 *
 * ⚠ ITS OWN FILE at the §2 500-line cap (2026-08-31) — `channel-session-render.ts`
 * was at 455 and this is ~70 lines of prose. The seam is also a real one:
 * that file answers "what STATE is this session in", this one answers "what may
 * I DO about it", and the second question changes when the WAKE RULES change,
 * which is a different clock entirely.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (parity.test.ts) and by the removed-vocabulary source scan
 * (channel-law.test.ts), which reads every non-test `channel-*.ts` here.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.addressableHandle = addressableHandle;
/**
 * THE AGENT-INSTANCE ID CHARSET — ⚠ HAND-COPIED from
 * `dopl-desktop-app/main/agent-id.js` and from `schema-launch.ts ›
 * LaunchDecideSchema.agentId`, which carry the identical anchored pattern. There
 * is no shared source tree between this package and either of those, the same
 * arrangement `channel-addressing.ts › GROUP_CHANNEL_MIN_MEMBERS` lives under.
 *
 * ⚠ IT IS A RECOGNISER, NOT A VALIDATOR, and the difference is the whole reason
 * this exists (2026-08-31). `channel_sessions.name` is filled by
 * `main/session-summary.js › nameOf`, which answers `s.agentId` and nothing
 * else — so on any current desktop the row's `name` IS the addressable id. But
 * the column's own CHECK is the WIDER `^[a-z][a-z0-9-]{1,30}$` (it predates the
 * multiplayer wave, when the field held pool handles like `flint`), and an OLDER
 * desktop is a supported peer (INVARIANTS §13). So a name that does not match
 * this pattern is a legacy handle, and the render must say it cannot address it
 * rather than printing an `@agent-flint` that reaches nobody.
 */
const AGENT_ID_RE = /^[a-z][a-z0-9]{7}$/;
/**
 * THE ADDRESSABLE HANDLE for one session row, or `null` when the row's name is
 * not an agent id this build can address.
 *
 * ⚠ **THE `agent-` PREFIXED FORM, AND ONLY THAT FORM.** The desktop parser takes
 * both `@<id>` and `@agent-<id>` (`main/session-dispatch.js › mentionedAgentIds`,
 * F-350's regex), and the web's own picker inserts the prefixed one
 * (`lib/agent-mentions.ts › agentMentionHandle`). Publishing the bare form here
 * while the renderer tints the prefixed one is exactly the tint-says-tagged /
 * stamp-says-nobody split F-266 cost a wave to close, one namespace over — so
 * this surface names ONE form and it is the one the product writes everywhere
 * else.
 *
 * ⚠ **A CUSTOM NAME IS NEVER A HANDLE HERE.** An operator may rename an agent
 * ("Research Bot" → the `@research-bot` slug door), but that rename lives in
 * `main/agent-names.js`, on ONE machine, keyed by an id minted on that machine.
 * No server holds it and this projection never carries it. So the id form is the
 * only handle an MCP caller can know, and the copy says so rather than letting a
 * caller infer that a name it saw in the Dopl app would work from here.
 */
function addressableHandle(name) {
    return AGENT_ID_RE.test(name) ? `@agent-${name}` : null;
}
/**
 * ⚠ `SESSION_HANDLE_NOTE` USED TO LIVE HERE — ~1.1k characters on how a handle is
 * spent, rendered under EVERY `read_sessions` page, to a reader that calls that
 * op in a loop. It moved to `channel-doctrine.ts`'s YOUR OWN AGENTS section
 * (T10, 2026-09-02), reached with `dopl_channel(op="rooms", action="help")` or the
 * `dopl://doctrine/channels` resource. **The text was not softened: THE THREE
 * LIMITS travelled with it verbatim**, and `channel-law.test.ts` pins them there.
 *
 * Why it existed at all is still the reason it must stay somewhere. THE PRODUCT
 * PUBLISHED AN ADDRESS AND NOT ITS RULE: an external orchestrator asked for an
 * agent, was handed an id, wrote `@<id>` into five posts exactly as
 * `launch_agent`'s result told it to, and woke nothing — the loop fence refused
 * every agent-authored message, its own included, and nothing warned. Two of
 * Samuel's rulings (both 2026-08-31) shaped the copy that answers it: the
 * SAME-ACCOUNT CARVE (an agent-authored message under the OPERATOR'S OWN user id
 * may @-wake that operator's dormant agents, so an MCP caller CAN spend this
 * handle; a peer's agent stays unreachable and an unaddressed post still starts
 * nobody), and A LAUNCH WITH A GOAL RUNS (so the common case needs no wake, and
 * the copy says that FIRST).
 *
 * ⚠ Two constraints on that text, wherever it lives: it DESCRIBES THE FENCE AND
 * MUST NOT READ AS A WORKAROUND FOR IT, and it MAY NOT PROMISE DELIVERY — the
 * wake is decided on the operator's desktop, over ids minted there, and no
 * server sees the outcome.
 *
 * {@link addressableHandle} stays here: it is the ID DOOR, and the reason this
 * file is separate from `channel-session-render.ts` is unchanged — that file
 * answers "what STATE is this session in", this one "what may I DO about it".
 */
