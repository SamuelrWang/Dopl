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
import { type MemberView } from "./channel-render-identity";
export { addresseeOf, formatAuthor, memberRef, sessionIdOf, NO_MEMBER_VIEW, type MemberView, } from "./channel-render-identity";
import { type ResponseFormat } from "./response-size";
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
export declare function formatMessages(messages: ChannelMessage[], ref: string, selfUserId?: string | null, format?: ResponseFormat): string[];
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
 * One rendered roster line for `op="rooms" action="members"`.
 *
 * ⚠ NOT {@link memberRef}: that collapses the caller to "you". The roster is
 * where the caller needs its own NAME and ID beside everyone else's, so the id
 * is always printed and the caller is marked instead.
 *
 * `displayName` and the `email` fallback are member-typed, no charset rule —
 * both neutralized, same rule as {@link formatAuthor}.
 *
 * ⚠ EMAIL IS ENTITLEMENT-SCOPED. An agent can list every PUBLIC channel
 * (`repository.ts` ORs `visibility.eq.public`) and `op="rooms" action="members"` each, so
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
