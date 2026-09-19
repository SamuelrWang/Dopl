/**
 * **`@desktop` — THE OPERATOR'S OUTSIDE SESSIONS, AS ONE BUILT-IN ADDRESS**
 * (2026-09-18, Samuel's ruling on the external-session group tag).
 *
 * An OUTSIDE SESSION is any MCP client on the operator's device token that this
 * product did not spawn: a Claude Code run, Codex, Cursor, a scheduled routine,
 * a script. `docs/specs/external-session-handles.md` is the options paper; this
 * is the variant of its Option B that was chosen, with the lie designed out.
 *
 * ⚠ **IT IS AN ADDRESS, NOT A PRESENCE.** Option B's objection was that a
 * standing handle can claim a reach into an empty room. That is answered by
 * never claiming one: `@desktop` wakes nothing, starts nothing, and its
 * `delivery=` word is {@link DESKTOP_DELIVERY} — a statement that the post is in
 * the room, which is true whether or not anything is holding. Nothing here may
 * ever grow a `woken`.
 *
 * ⚠ **ONE HANDLE PER OPERATOR, RESOLVED TO THE CALLER'S OWN.** `to="@desktop"`
 * from an agent means ITS operator's outside sessions, which is the same
 * own-scope rule `service-writes-metadata-recipient.ts › liveAgentHandles`
 * already applies to agent handles. A room with two members has two `@desktop`s
 * and they never collide, because the resolution never reads the room.
 *
 * ⚠ **THE STORED KEY IS NOT A ROUTING COLUMN, AND THAT IS THE WHOLE SAFETY
 * ARGUMENT.** {@link DESKTOP_TO_METADATA_KEY} is metadata; `recipient_user_ids`
 * and `metadata.to_user_id` are what machines route on
 * (`main/session-dispatch.js › serverNamesMember`, `main/targeting.js ›
 * classify`). So "addressing `@desktop` wakes no desktop-run agent and does not
 * ping the operator as a person" is true BY CONSTRUCTION rather than by a branch
 * somebody can forget — no desktop change was needed to make it hold, and an
 * older desktop honours it for the same reason.
 */

/**
 * The reserved handle, bare (no `@`). ⚠ **RESERVED AT THE SERVER DOORS FIRST.**
 * `main/agent-name-unique.js` suffixing a launch to `desktop-1` is the cosmetic
 * half; the half that must not be forgotten is passing this into
 * `buildAgentMentionIndex`'s reserved set at BOTH agent doors, which is what
 * makes it impossible for a stored agent name to ever answer to this token —
 * whatever some machine wrote before the rule existed.
 */
export const DESKTOP_GROUP_HANDLE = "desktop";

/**
 * Server-owned metadata key: the user id whose outside sessions were addressed.
 *
 * ⚠ **IT CARRIES THE OPERATOR ID, NOT `true`.** A boolean would be unreadable
 * from a second member's transcript ("whose desktop?") and unindexable for
 * `dopl_status`, which asks `metadata->>to_desktop = <me>` exactly as the member
 * lane asks it of `to_user_id`.
 *
 * ⚠ **RESERVED.** Stripped from caller metadata unconditionally and re-stamped
 * only from the resolver's answer — same discipline as `to_user_id`. A caller
 * able to set it could put its words on somebody else's status board.
 */
export const DESKTOP_TO_METADATA_KEY = "to_desktop";

/**
 * Server-owned metadata key: this post was written by an OUTSIDE SESSION.
 *
 * ⚠ **A PROJECTION SOURCE, NOT AN `author_kind`.** The column's set is closed at
 * three and gated by `scripts/check-message-kind-drift.ts`, which reads the
 * `CHECK` out of `20260725120000_channels.sql` alone and fails on any later
 * migration that re-constrains a `kind` column. So the outside-session fact
 * rides metadata and is projected onto the DTO as `authorView`; the column stays
 * `agent`. ⚠ The happy consequence is the tolerance the wave needed anyway: an
 * absent flag is an old row or an older server, and it renders exactly as it
 * rendered yesterday.
 */
export const EXTERNAL_SESSION_METADATA_KEY = "external_session";

/**
 * The `delivery=` word for a post addressed to `@desktop`.
 *
 * ⚠ **`posted`, NEVER `held` AND NEVER `woken`.** Samuel's ruling allows `held`
 * only if the server can cheaply know a hold is live right now. It cannot: a
 * hold is `dopl_channel(op="read", wait_ms=…)`, a long poll that registers
 * nothing server-side (that projection row is what Option A would have bought,
 * and Option A is not what was chosen). So the honest word is the one that is
 * true either way — the message is in the room, and the outside session sees it
 * on its next look whenever that is.
 */
export const DESKTOP_DELIVERY = "posted";

/** The `wake_verdict` word. ⚠ Its own value so a reader can tell it from `none`. */
export const DESKTOP_VERDICT = "desktop";

/**
 * Does this already-stripped handle name the desktop group?
 *
 * ⚠ **IT TAKES THE STRIPPED HANDLE**, like `resolveAgentHandle` — `mentions.ts ›
 * mentionHandleOf` owns trailing punctuation and markup, and a second strip rule
 * here would be the two-parsers defect that family exists to avoid.
 */
export function isDesktopGroupHandle(handle: string | null): boolean {
  return handle !== null && handle.trim().toLowerCase() === DESKTOP_GROUP_HANDLE;
}

/**
 * **WAS THIS POST WRITTEN BY AN OUTSIDE SESSION?** — the ONE statement of the
 * discriminator, so the write path and any later reader cannot disagree.
 *
 * TWO MARKS, AND ONLY THE FIRST IS UNFORGEABLE:
 *   - `authorKind === "agent"` — derived from the CREDENTIAL in
 *     `service-writes.ts`, never from the body, and it may only ESCALATE
 *     (F-580). A human composer on either surface fails this and is never
 *     labelled.
 *   - no `desktop-session` runtime stamp. `ctx.runtime` is already re-narrowed
 *     through `shared/auth/runtime-header.ts › narrowRuntime`, so this reads the
 *     server's own value rather than the raw header.
 *
 * ⚠ **FAILURE MODES, STATED RATHER THAN HEDGED — IT LABELS, AND IT GATES
 * NOTHING:**
 *   1. An OLDER DESKTOP BUILD stamps no runtime, so its sessions label as
 *      outside sessions. This is the same blind spot
 *      `packages/mcp-server/src/tools/channel-wake-guidance.ts` already records
 *      ("absence is `unstamped` … never 'external'"), and the cost is a wrong
 *      label on a line, never a delivery.
 *   2. A SCRIPT ON THE DEVICE TOKEN that sends `X-Dopl-Runtime: desktop-session`
 *      escapes the label. The header is caller-supplied and documented as a
 *      routing hint that grants nothing. The unforgeable second mark is
 *      `mcp_tokens.container_id` — only the desktop's container minter sets it,
 *      and `packages/mcp-server/src/tools/identity.ts › isDesktopRun` ORs both —
 *      but `ChannelContext` does not carry it today. **F-739.**
 *   3. A row written before this key existed has no flag and reads as `agent`.
 *      Intended: that is yesterday's rendering, unchanged.
 */
export function isExternalSessionAuthor(
  authorKind: string,
  runtime: string | null | undefined
): boolean {
  return authorKind === "agent" && runtime !== "desktop-session";
}
