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
import type { Channel, ChannelMember, ChannelMessage, ChannelThread } from "@dopl/client";
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
export declare function formatAuthor(m: ChannelMessage): string;
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
export declare function sessionIdOf(m: ChannelMessage): string | undefined;
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
export declare function addresseeOf(m: ChannelMessage): string | undefined;
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
export declare const NO_MEMBER_VIEW: MemberView;
/**
 * User id rendered actionably: `you` for the caller, else neutralized name AND
 * immutable id ({@link formatAuthor} shape). ⚠ Never name alone — display name
 * is owner-settable, so an unbacked name lets one member's label pose as another's.
 */
export declare function memberRef(userId: string, view: MemberView): string;
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
export declare function formatMessages(messages: ChannelMessage[], ref: string, selfUserId?: string | null): string[];
/**
 * One rendered channel line for `list`. ⚠ `name` (120 chars) and `topic` (2000
 * chars, interior newlines allowed) are creator-typed and public channels list
 * to every workspace member — both must stay neutralized. `slug` does not:
 * `slugify` guarantees `^[a-z0-9-]+$`, so it cannot escape its own span.
 */
export declare function formatChannelLine(c: Channel): string;
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
export declare function formatThreadLine(t: ChannelThread, view?: MemberView): string;
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
export declare function formatThreadDetail(t: ChannelThread, view?: MemberView): string;
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
export declare function formatMemberLine(m: ChannelMember, selfUserId: string | null, callerIsAdmin?: boolean): string;
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
export declare function groupByChannel<T extends {
    channelId: string;
    channelName?: string | null;
    channelSlug?: string | null;
}>(messages: T[]): Array<{
    ref: string;
    label: string;
    messages: T[];
}>;
