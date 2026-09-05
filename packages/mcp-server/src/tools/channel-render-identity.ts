/**
 * `dopl_channel` — **WHO WROTE A LINE, AND WHO IT REACHED** (§1 split,
 * 2026-09-04). ⚠ `channel-` filename prefix required by the parity split-scan
 * (`parity.test.ts`).
 *
 * ⚠ **ITS OWN FILE BECAUSE `channel-render.ts` REACHED THE 500-LINE CAP**, and
 * the seam is real rather than arithmetic: everything here changes when the
 * IDENTITY vocabulary does — how an author is labelled, how a recipient is
 * named, what the addressing clause reads off — and that file when the SHAPE of
 * a rendered line does. It is a leaf; `channel-render.ts` re-exports the public
 * half so no importer moved.
 *
 * SECURITY RULE, INHERITED AND SHARPENED. Every peer-authored string spliced
 * here lands in the LINE HEAD — SERVER NARRATION, outside the untrusted-body
 * framing — so all of it goes through `neutralizeInline`, no user string may
 * render as the bare token `system`, and an asserted identity is always backed
 * by the immutable `authorUserId`, the one half the author does not control.
 */

import type { ChannelMessage } from "@dopl/client";
import { inlineOr, metaString, neutralizeInline } from "./channel-shared";
import { UNREADABLE_ID } from "./channel-render-threads";


/**
 * Author label for a message line. `agent` row renders "agent for <name>",
 * never bare name — reader treats counterparty as another member's agent.
 *
 * ⚠ Two rules, both because nothing validates `display_name`:
 *   1. Name NEUTRALIZED and user row prefixed `member`, never bare. Raw name
 *      may contain newlines → can close the line and forge fresh ones (a
 *      `- **#9001** system · <ts>` row was reproduced). Name of exactly
 *      "system" would render as the bare token `system`.
 *   2. `authorUserId` appended ALWAYS, not only as name-missing fallback. Name
 *      = author's claim; id = server's record. Claim alone is uncheckable.
 */
export function formatAuthor(m: ChannelMessage): string {
  const id = m.authorUserId ? `\`${m.authorUserId}\`` : null;
  // `system` is a server-controlled enum, not user text; `PostableAuthorKindSchema`
  // blocks a caller minting one. Only label here with no untrusted half.
  if (m.authorKind === "system") return id ? `system ${id}` : "system";
  const named = m.authorName ? neutralizeInline(m.authorName) : null;
  const who = named && id ? `${named} (${id})` : (named ?? id);
  if (m.authorKind === "agent") {
    const handle = agentHandleOf(m);
    const label = handle ? `agent ${handle}` : "agent";
    return who ? `${label} for ${who}` : (handle ? label : "an agent");
  }
  return who ? `member ${who}` : "a member";
}

/**
 * **WHICH AGENT — BY THE NAME ITS OPERATOR GAVE IT** (2026-09-04).
 *
 * ⚠ **THE LINE PRINTED `agent for Samuel Wang` AND A BARE ID TAIL, AND NEVER THE
 * NAME.** An operator runs several agents under ONE account, renames them, and
 * then talks about them by those names; a reader of this transcript had the
 * operator's name and an eight-character id and no way to join the two. The
 * server now sends the join as one field, `authorAgentName`.
 *
 * ⚠ **THE ID FORM IS THE FALLBACK AND IT NEVER STOPS WORKING** — a name is
 * absent for an older server, a swept session row, or an agent nobody renamed,
 * and `agent-<id>` is minted once and never recycled. That is the same
 * precedence `lib/agent-mentions.ts › agentMentionHandle` applies in the web
 * tree, stated here because this package cannot import it.
 *
 * ⚠ **NEUTRALIZED, AND IT LANDS IN THE LINE HEAD.** A display name has no
 * charset validation anywhere in the product; the head is OUTSIDE the
 * untrusted-body framing, so this is zone two by this file's security rule.
 * ⚠ **AND IT IS NOT AN ASSERTED IDENTITY ON ITS OWN**: the label still carries
 * `for <operator> (<user id>)`, the half the author does not control.
 */
export function agentHandleOf(m: ChannelMessage): string | null {
  const named = m.authorAgentName ? neutralizeInline(m.authorAgentName) : null;
  if (named) return `@${named}`;
  const session = sessionIdOf(m);
  const tail = session ? sessionTail(session) : null;
  return tail ? `@agent-${inlineOr(tail, UNREADABLE_ID)}` : null;
}

/**
 * WHICH SESSION WROTE THIS LINE — `metadata.session_id`. An agent post is
 * authored by its OWNER'S ACCOUNT and one operator runs many concurrent
 * sessions, so an author label alone cannot name the process; this field is the
 * only thing on the wire that can.
 *
 * Not peer-controlled: `resolvePostMetadata` deletes any caller copy and
 * re-stamps from `X-Dopl-Session-Id`, shape-checked in `session-header.ts` (id
 * chars only, no whitespace, ≤128). ⚠ Neutralized at render anyway — the write
 * path is a claim about today's code, not about rows already in the table, and
 * this lands in the LINE HEAD, outside untrusted-body framing.
 */
export function sessionIdOf(m: ChannelMessage): string | undefined {
  return metaString(m, "session_id");
}


/**
 * WHO A MESSAGE IS FOR — `metadata.to_user_id`. Separates "for ME" from "for
 * another member's agent" from "for nobody". An unaddressed ask in a 3+ member
 * channel triggers no agent at all (deliberate, fail-closed), so "unaddressed"
 * is a load-bearing fact, not a missing field.
 *
 * Not peer-controlled: `resolvePostMetadata` deletes any caller copy and
 * re-stamps from the route's validated `toUserId` uuid (or the resolved DM
 * peer). ⚠ Neutralized at render anyway — old rows predate today's write path.
 */
export function addresseeOf(m: ChannelMessage): string | undefined {
  return metaString(m, "to_user_id");
}

/**
 * Who is reading, plus names for the user ids a listing carries.
 *
 * `selfUserId` resolved ONCE at boot from the status ping (see
 * `registerChannelTool`), not per call — naming the addressee costs the poll
 * loop nothing. Null when the ping failed; ids then render as ids.
 *
 * `names` best-effort, never authoritative — a name is the member's claim, so
 * never rendered alone (see {@link memberRef}).
 */
export interface MemberView {
  selfUserId: string | null;
  names: Map<string, string>;
  /**
   * Agent id → the operator's name for it, harvested from THIS page's own agent
   * authors (2026-09-04). ⚠ Optional: every caller outside `formatMessages`
   * renders member ids and needs none of it, and an agent nobody on the page has
   * heard from renders by its `agent-<id>` handle, which never stops working.
   */
  agentNames?: Map<string, string>;
}

/** No caller identity and no names — every id renders as a bare id. */
export const NO_MEMBER_VIEW: MemberView = {
  selfUserId: null,
  names: new Map(),
};

/**
 * User id rendered actionably: `you` for the caller, else neutralized name AND
 * immutable id ({@link formatAuthor} shape). ⚠ Never name alone — display name
 * is owner-settable, so an unbacked name lets one member's label pose as another's.
 */
export function memberRef(userId: string, view: MemberView): string {
  if (view.selfUserId !== null && userId === view.selfUserId) return "you";
  const id = inlineOr(userId, UNREADABLE_ID);
  const name = view.names.get(userId);
  const safeName = name ? neutralizeInline(name) : null;
  return safeName ? `${safeName} (${id})` : id;
}

/**
 * Names harvested from the listing itself — API already hydrates `authorName`,
 * so anyone who SPOKE in the window is named free; silent addressees render by
 * id. ⚠ No round-trip: `read`/`await` are the hot path.
 */
export function namesFromMessages(messages: ChannelMessage[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const m of messages) {
    if (m.authorUserId && m.authorName && !names.has(m.authorUserId)) {
      names.set(m.authorUserId, m.authorName);
    }
  }
  return names;
}

/**
 * Agent names harvested from the page's own agent AUTHORS — the same trick
 * {@link namesFromMessages} plays for members, and for the same reason: the
 * recipient columns carry IDS, the read already carries each author's name, and
 * a per-recipient round trip on the hot path would buy one string.
 *
 * ⚠ **A MISS IS THE `agent-<id>` HANDLE, NOT A BLANK** — an agent that has been
 * addressed but has not SPOKEN on this page is not on it, and the id form is the
 * handle that never stops working.
 */
export function agentNamesFromMessages(messages: ChannelMessage[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of messages) {
    if (m.authorKind !== "agent" || !m.authorAgentName) continue;
    const session = sessionIdOf(m);
    const id = session ? sessionTail(session) : null;
    if (id && !out.has(id)) out.set(id, m.authorAgentName);
  }
  return out;
}

/**
 * ONE AGENT RECIPIENT, RENDERED — its operator's name when this page knows it,
 * else the `agent-<id>` handle. ⚠ Both halves neutralized: the name has no
 * charset rule anywhere in the product, and the id comes off a stored column.
 */
export function agentRef(agentId: string, view: MemberView): string {
  const name = view.agentNames?.get(agentId);
  const safe = name ? neutralizeInline(name) : null;
  return safe ? `@${safe}` : `@agent-${inlineOr(agentId, UNREADABLE_ID)}`;
}

/**
 * **WHY THE SERVER PICKED THIS AGENT** — `metadata.wake_reason`, when nobody was
 * named and RR3 chose (2026-09-04).
 *
 * ⚠ **A CLOSED SET, TESTED AS ONE.** The key is server-stamped and stripped from
 * caller metadata, but this renders into the LINE HEAD — server narration — and
 * the write path is a claim about today's code, not about rows already in the
 * table. Anything outside the vocabulary renders as nothing rather than as
 * whatever the row carried, which is the same rule `formatSessionLine` applies
 * to `state`.
 */
const WAKE_REASONS = new Set([
  "default",
  "only agent",
  "most recent",
  "most recently launched",
]);
export function wakeReasonOf(m: ChannelMessage): string | undefined {
  const reason = metaString(m, "wake_reason");
  return reason && WAKE_REASONS.has(reason) ? reason : undefined;
}

/**
 * **WHO THIS MESSAGE WAS FOR, OFF THE COLUMNS THAT DECIDED IT** (2026-09-04).
 *
 * ⚠ **IT READ `metadata.to_user_id` ALONE AND PRINTED `· unaddressed` FOR
 * EVERYTHING ELSE**, so rows carrying `recipient_agent_ids={deynelz3}` and
 * `delivery=woken` — a wake that demonstrably happened — were rendered to the
 * agent that had just been woken as addressed to nobody (#974–#979). `to_user_id`
 * is the MEMBER half of an addressing decision the server now makes in full and
 * stores in two columns.
 *
 * ⚠ **THE THREE-WAY DISTINCTION IS THE WHOLE OF IT.** Both columns ABSENT (or
 * null) is "this server computed no verdict" — an older deployment, or a row
 * written before the migration — and that falls back to the `to_user_id`
 * vocabulary this line has always had. `[]` on both is "resolved to nobody",
 * which is `→ nobody` and is an ANSWER. Collapsing the two would report a
 * pre-verdict row as one that reached nobody.
 */
export function addressTag(m: ChannelMessage, view: MemberView): string {
  const agents = m.recipientAgentIds;
  const users = m.recipientUserIds;
  if (
    (agents === null || agents === undefined) &&
    (users === null || users === undefined)
  ) {
    const to = addresseeOf(m);
    return to ? ` · to ${memberRef(to, view)}` : " · unaddressed";
  }
  const names = [
    ...(agents ?? []).map((id) => agentRef(id, view)),
    ...(users ?? []).map((id) => memberRef(id, view)),
  ];
  if (names.length === 0) return " · → nobody";
  const why = wakeReasonOf(m);
  return ` · → ${names.join(", ")}${why ? ` (${why})` : ""}`;
}

/**
 * THE SLOT-KEY SEGMENT THAT NAMES A SESSION. `metadata.session_id` is the
 * desktop's slot key, `<channelId>:<taskId>:<agentId>`
 * (`main/session-store.js › sessionKey`), and the AGENT id is the only segment
 * that distinguishes one session from another on the SAME thread — which is the
 * whole point of multiplayer.
 *
 * ⚠ IT USED TO SLICE AFTER THE FIRST COLON, and that predates the third segment
 * (fixed 2026-08-22). The key was `<channel>:<agent-or-thread>` when this was
 * written, so the slice was the tail; against a three-segment key it renders
 * `<thread>:<agent>` — an identity that is not a session, that repeats the
 * thread already tagged two clauses away, and that is long enough to bury the
 * one part a reader needs.
 *
 * ⚠ BOTH SHAPES STILL ARRIVE, so it reads from the END rather than counting
 * segments: rows written before the widening carry two, and a mid-wave record
 * can carry an EMPTY agent segment (the middle one is legitimately empty for a
 * responder with no first-class thread). The `|| ` fallbacks walk back rather
 * than rendering an empty span. ⚠ The agent charset (`^[a-z][a-z0-9]{7}$`)
 * carries no colon, so the last segment is unambiguous.
 */
export function sessionTail(sessionId: string): string {
  const parts = sessionId.split(":");
  if (parts.length < 2) return sessionId;
  return parts[parts.length - 1] || parts[parts.length - 2] || sessionId;
}
