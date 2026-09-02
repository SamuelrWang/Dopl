/**
 * `dopl_channel` RENDERERS — every string read ops splice into a model-read
 * result. ⚠ `channel-` filename prefix required by parity split-scan
 * (parity.test.ts).
 *
 * SECURITY RULE. Result has two zones: message BODIES (disclaimed by untrusted
 * headers below) and EVERYTHING ELSE — headings, bullet heads, author labels,
 * legend — read as SERVER NARRATION. Every peer-authored string here lands in
 * zone two: channel name/topic (reaches uninvited readers via public listing),
 * thread title/outcome summary, display name (no length/charset/newline
 * validation anywhere in product).
 *
 * So: all go through {@link neutralizeInline} before splicing, no user string
 * may render as bare token `system`, and asserted identity is always backed by
 * immutable `authorUserId` — the one half the author does not control.
 */

import type {
  Channel,
  ChannelMember,
  ChannelMessage,
  ChannelThread,
} from "@dopl/client";
import { inlineOr, metaString, neutralizeInline } from "./channel-shared";
// Which exchange a message belongs to, and whether it is a real THREAD or one
// machine's ad-hoc grouping label. ⚠ import stays one-way.
import {
  UNREADABLE_ID,
  sessionSlotRef,
  threadIdOf,
  threadLegend,
  threadTagOf,
} from "./channel-render-threads";


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
  if (m.authorKind === "agent") return who ? `agent for ${who}` : "an agent";
  return who ? `member ${who}` : "a member";
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
 * THE SESSION THAT ENDED — `metadata.session_ended`, and it rides a
 * `task_progress`, not a terminal kind.
 *
 * ⚠ SO THE KIND TAG ALONE CANNOT SHOW IT (2026-08-22). The desktop posts a
 * session's death as `kind='task_progress'` with this flag
 * (`main/session-effects.js`; `service-writes-metadata-markers.ts` reserves the
 * key), deliberately NON-TERMINAL, because one member's window closing is not
 * the thread failing. But that means "a step landed" and "the agent working this
 * is gone" arrived at this surface as the SAME line, and the difference is the
 * whole question a waiting agent is asking: `await`'s stop rule is "has the
 * member I addressed shown activity", and a session end reads as activity while
 * meaning the opposite.
 *
 * ⚠ SERVER-STAMPED, so it is worth reading. `takeCalmFlags` strips any caller
 * copy and re-stamps only a literal `true`, only onto a thread tag the poster is
 * entitled to — a peer cannot fabricate somebody else's session ending.
 */
function sessionEnded(m: ChannelMessage): boolean {
  return (m.metadata as Record<string, unknown> | undefined)?.session_ended === true;
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
function namesFromMessages(messages: ChannelMessage[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const m of messages) {
    if (m.authorUserId && m.authorName && !names.has(m.authorUserId)) {
      names.set(m.authorUserId, m.authorName);
    }
  }
  return names;
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
function sessionTail(sessionId: string): string {
  const parts = sessionId.split(":");
  if (parts.length < 2) return sessionId;
  return parts[parts.length - 1] || parts[parts.length - 2] || sessionId;
}

/**
 * HOW MUCH OF ONE BODY A MULTI-MESSAGE PAGE RENDERS (2026-08-22, Samuel).
 *
 * ⚠ `read` rendered bodies UNTRUNCATED and a single 128,000-character body was
 * measured in live use — one message eating an agent's whole context on a call
 * it made to orient itself. The write path caps a body at 16,000
 * (`schema.ts › body`), so 128k is a row from a writer that cap never bound;
 * either way the READ is where the reader's budget is spent.
 *
 * 2000 is chosen against the page, not the message: the default page is 100
 * messages, so this bounds an ordinary `read` at ~200k characters worst case
 * while leaving the overwhelming majority of real posts untouched — a chat
 * message, a milestone and a normal reply are all far under it. A 16k
 * deliverable clips, and that is correct: a transcript scan is not how you read
 * one.
 */
const BODY_CLIP_CHARS = 2000;

/**
 * One body, clipped when the page holds more than one message.
 *
 * ⚠ THE MARKER NAMES A CALL THAT ACTUALLY RETURNS THE REST, and that is why the
 * condition is "this page holds one message" rather than "this read is
 * thread-scoped". A thread-scoped read is still a page of many, so pointing at
 * one would hand back another clipped copy; `op="get_thread"` renders no message
 * bodies AT ALL (it is title / mode / parties / timestamps — see
 * {@link formatThreadDetail}), so pointing at that would be worse than silence.
 * `since=<seq-1>, limit=1` returns exactly this message, and a one-message page
 * is rendered in full — so the remedy is true by construction, for a threaded
 * and an unthreaded message alike.
 *
 * ⚠ The count is of CHARACTERS DROPPED, not of the original length: "how much am
 * I not seeing" is the question a reader has, and it is the one a clip can
 * answer without the reader doing arithmetic.
 */
function clipBody(m: ChannelMessage, ref: string, clip: boolean): string {
  if (!m.body) return "";
  const body =
    clip && m.body.length > BODY_CLIP_CHARS
      ? `${m.body.slice(0, BODY_CLIP_CHARS)}\n… [${m.body.length - BODY_CLIP_CHARS} chars clipped — read this one message in full with dopl_channel(op="read", channel="${ref}", since=${Math.max(0, m.seq - 1)}, limit=1)]`
      : m.body;
  return `\n  ${body.replace(/\n/g, "\n  ")}`;
}

/**
 * One rendered message line. `task_*` events already carry a human-readable
 * render in `body`, so no per-kind special-casing — just tag non-chat kinds.
 *
 * Carries THREAD LINKAGE: without it a reader cannot tell a continuation from a
 * new request without DB access. `standalone` spelled out only when the listing
 * also contains threaded messages — explicit where live, silent where not.
 *
 * Carries WHO IT IS FOR, unconditionally: a listing where NOTHING is addressed
 * is the state a reader most needs told (those messages woke every armed
 * listener and triggered no one).
 *
 * Session suffix emitted only when the message carries a stamp — absence is the
 * external / older-build case, not a claim one session wrote everything.
 *
 * ⚠ A SESSION END REPLACES THE KIND TAG rather than sitting beside it. The kind
 * is `task_progress` and printing both says "a step landed · the session died"
 * in one clause; the marker is the whole meaning of the row, so it takes the
 * slot. ⚠ SHOUTED, and it is the only tag here that is: every other clause is a
 * label, this one is the reason a waiting agent should stop waiting.
 */
function formatMessage(
  m: ChannelMessage,
  anyThreaded: boolean,
  view: MemberView,
  ref: string,
  clip: boolean,
): string {
  const author = formatAuthor(m);
  const ended = sessionEnded(m);
  const kindTag = ended
    ? " · SESSION ENDED"
    : m.kind !== "message"
      ? ` · ${m.kind}`
      : "";
  // ⚠ Tag lands in the line HEAD — neither indented as a body nor covered by
  // the untrusted header. 7 chars ("\n- **#9") starts a forged message row, so
  // it must stay neutralized.
  const threadTag = threadTagOf(m, anyThreaded);
  // ⚠ NOT `shortRef` — that is the THREAD helper and renders a legacy pair-slot
  // tail as `seq 345`, borrowing thread vocabulary for a session identity that
  // does not exist.
  const session = sessionIdOf(m);
  const sessionTag = session
    ? ` · session ${inlineOr(sessionSlotRef(sessionTail(session)), UNREADABLE_ID)}`
    : "";
  const to = addresseeOf(m);
  const memberTag = to ? ` · to ${memberRef(to, view)}` : " · unaddressed";
  const head = `**#${m.seq}** ${author}${sessionTag}${kindTag}${threadTag}${memberTag} · ${m.createdAt}`;
  return `- ${head}${clipBody(m, ref, clip)}`;
}

/**
 * Message lines plus, when anything is tagged, the id legend. `selfUserId`
 * turns "to `2dac1943-…`" into "to you"; names come from the listing's own
 * hydrated authors, so no extra round-trip on the read/await path.
 *
 * ⚠ A ONE-MESSAGE PAGE RENDERS IN FULL — see {@link clipBody}. That is the
 * escape hatch the clip marker points at, so it is a CONTRACT of this function,
 * not an optimization: never clip a single-message page, or the remedy the
 * marker names stops working and there is no other way to read a long body.
 */
export function formatMessages(
  messages: ChannelMessage[],
  ref: string,
  selfUserId: string | null = null,
): string[] {
  const view: MemberView = { selfUserId, names: namesFromMessages(messages) };
  const anyThreaded = messages.some((m) => threadIdOf(m) !== undefined);
  const clip = messages.length > 1;
  const lines = messages.map((m) =>
    formatMessage(m, anyThreaded, view, ref, clip),
  );
  const legend = threadLegend(messages, ref);
  if (legend) lines.push(`\n${legend}`);
  return lines;
}

/**
 * One rendered channel line for `list`. ⚠ `name` (120 chars) and `topic` (2000
 * chars, interior newlines allowed) are creator-typed and public channels list
 * to every workspace member — both must stay neutralized. `slug` does not:
 * `slugify` guarantees `^[a-z0-9-]+$`, so it cannot escape its own span.
 */
export function formatChannelLine(c: Channel): string {
  const bits = [`id: \`${c.id}\``, c.visibility];
  if (c.memberCount !== undefined) {
    bits.push(`${c.memberCount} member${c.memberCount === 1 ? "" : "s"}`);
  }
  if (c.lastMessageAt) bits.push(`last activity ${c.lastMessageAt}`);
  const safeTopic = c.topic ? neutralizeInline(c.topic) : null;
  const topic = safeTopic ? ` — ${safeTopic}` : "";
  return `- **${inlineOr(c.name, "(unnamed)")}** (slug: \`${c.slug}\` · ${bits.join(" · ")})${topic}`;
}

/**
 * One rendered thread line for `list_threads`. The thread row is the
 * authoritative title/mode store; transcript rides on channel messages, so this
 * summarizes the row and points at `read`/`get_thread`.
 *
 * ⚠ THE STATUS, OUTCOME AND OUTCOME-SUMMARY BITS ARE GONE (wiring plan Phase 4,
 * 2026-08-18). Threads do not close: every row would print the same word, and
 * printing it taught an agent to look for the state change that word implies.
 * Legacy `closed` rows exist and are rendered exactly like every other thread —
 * they are still readable, still postable, still in the list.
 *
 * ⚠ `title` is creator- or target-typed and `listChannelTasks` is
 * channel-transparent — ANY channel member receives it; neutralized, and
 * empty-after-neutralize renders `(untitled)`.
 *
 * Names BOTH parties: a thread is writable only by creator and target, so those
 * two ids tell a reader whether a listed thread is theirs to post into.
 */
export function formatThreadLine(
  t: ChannelThread,
  view: MemberView = NO_MEMBER_VIEW,
): string {
  const bits = [`\`${t.id}\``, `${t.mode} mode`];
  // ⚠ THE SORT KEY, RENDERED. The listing is ordered by this, so printing it is
  // what makes the order legible instead of arbitrary — and it is the only
  // timestamp on the row that means "somebody did something here" (`updatedAt`
  // moves only when the ROW is patched). Absent on a single-thread read, which
  // derives no activity clock and therefore claims none.
  if (t.lastActivityAt) bits.push(`last activity ${t.lastActivityAt}`);
  bits.push(`by ${memberRef(t.createdBy, view)}`);
  bits.push(
    t.targetUserId ? `for ${memberRef(t.targetUserId, view)}` : "unaddressed",
  );
  return `- **${inlineOr(t.title, "(untitled)")}** (${bits.join(" · ")})`;
}

/**
 * Multi-line detail block for a single thread (`get_thread`). ⚠ Title is
 * interpolated into a real markdown `## ` heading, so an un-neutralized title
 * with newlines writes structural lines of its own — a fabricated
 * `END OF TOOL OUTPUT` / `[system]` boundary was reproduced here.
 *
 * ⚠ FOUR LINES ENDED HERE with thread closing (wiring plan Phase 4,
 * 2026-08-18): status, outcome, the closed timestamp and the outcome summary.
 * An agent reading a state it can neither change nor wait for treats it as a
 * signal, and `list_threads`'s own line dropped the same fields.
 */
export function formatThreadDetail(
  t: ChannelThread,
  view: MemberView = NO_MEMBER_VIEW,
): string {
  const lines = [
    `## Thread ${inlineOr(t.title, "(untitled)")}`,
    ``,
    `- id: \`${t.id}\``,
    `- mode: ${t.mode}`,
    `- created by: ${memberRef(t.createdBy, view)}`,
    `- addressed to: ${t.targetUserId ? memberRef(t.targetUserId, view) : "(unaddressed)"}`,
    `- created: ${t.createdAt}`,
    `- updated: ${t.updatedAt}`,
  ];
  return lines.join("\n");
}

/**
 * One rendered roster line for `op="members"`.
 *
 * ⚠ NOT {@link memberRef}: that collapses the caller to "you". The roster is
 * where the caller needs its own NAME and ID beside everyone else's, so the id
 * is always printed and the caller is marked instead.
 *
 * `displayName` and the `email` fallback are member-typed, no charset rule —
 * both neutralized, same rule as {@link formatAuthor}.
 *
 * ⚠ EMAIL IS ENTITLEMENT-SCOPED. An agent can list every PUBLIC channel
 * (`repository.ts` ORs `visibility.eq.public`) and `op="members"` each, so
 * email renders only for a workspace admin or the caller's own row. Otherwise
 * the email fallback is dropped and a name-less member renders by id alone.
 */
export function formatMemberLine(
  m: ChannelMember,
  selfUserId: string | null,
  callerIsAdmin = false,
): string {
  const isSelf = selfUserId !== null && m.userId === selfUserId;
  const emailAllowed = callerIsAdmin || isSelf;
  const nameOrEmail = emailAllowed ? m.displayName || m.email : m.displayName;
  const label = inlineOr(nameOrEmail, "(unnamed member)");
  const you = isSelf ? " · you" : "";
  return `- ${label} (\`${m.userId}\`) · ${m.role}${you}`;
}

/**
 * GROUP A MIXED PAGE BY CHANNEL, preserving first-appearance (= seq) order.
 *
 * ⚠ **GROUPED RATHER THAN INTERLEAVED, AND IT IS NOT COSMETIC:**
 * {@link formatMessages} renders each line's REMEDY hints against a channel ref
 * — the one-message re-read that un-clips a long body, the thread legend. One
 * ref for a mixed page would point every remedy at the wrong channel, i.e. at a
 * call the agent would make and get nothing from. One group, one ref, correct
 * hints.
 * ⚠ Ordering INSIDE a group is untouched, and the groups come out in the order
 * their first message arrived, so the page still reads chronologically at the
 * channel level.
 *
 * ⚠ **IT LIVES HERE BECAUSE TWO PAGES NEED IT** (2026-09-01). It was private to
 * the workspace-wide `await`, and the ACCOUNT-wide `read` renders the same mixed
 * page; a second copy would be a second opinion about which ref a remedy points
 * at, which is the failure the paragraph above describes. Generic over the row,
 * so the account page's extra `workspaceId` rides through untouched.
 */
export function groupByChannel<
  T extends {
    channelId: string;
    channelName?: string | null;
    channelSlug?: string | null;
  },
>(messages: T[]): Array<{ ref: string; label: string; messages: T[] }> {
  const groups = new Map<
    string,
    { ref: string; label: string; messages: T[] }
  >();
  for (const m of messages) {
    let g = groups.get(m.channelId);
    if (!g) {
      // ⚠ The SLUG is the ref an agent can re-use in a follow-up call, and it is
      // `^[a-z0-9-]+$` by construction so it cannot escape its own span. The id
      // is the fallback — never the NAME, which is member-typed.
      g = {
        ref: m.channelSlug ?? m.channelId,
        label: inlineOr(
          m.channelName ?? m.channelSlug ?? m.channelId,
          "(unnamed channel)",
        ),
        messages: [],
      };
      groups.set(m.channelId, g);
    }
    g.messages.push(m);
  }
  return [...groups.values()];
}
