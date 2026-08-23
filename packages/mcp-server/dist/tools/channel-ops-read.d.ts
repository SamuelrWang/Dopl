/**
 * `dopl_channel` READ op handlers: list, read, list_threads / get_thread,
 * members. All non-mutating, all ONE round-trip rendered. `await` lives in
 * `channel-ops-await.ts` (the only looping op).
 *
 * ⚠ BOUNDARY: wire/storage name `task` == domain name `thread` — the `thread`
 * op param resolves against `channel_tasks` rows and `/tasks` routes under
 * `@dopl/client`.
 *
 * Every STRING these ops emit lives in `channel-render.ts`, where the
 * peer-authored-text discipline is documented and enforced. This file is
 * control flow.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
export declare function opList(client: DoplClient): Promise<ToolResponse>;
/**
 * Read a channel's transcript, optionally SCOPED TO ONE THREAD.
 *
 * ⚠ `thread` is a FILTER, not a lookup: route keeps rows whose
 * `metadata.taskId` equals it, an id nothing carries returns `[]` not 404, and
 * any non-empty string is legal (transcripts still carry legacy
 * `task-<channelId>-<seq>` ids). Blank/whitespace treated as unset rather than
 * sent, so `thread=""` reads the channel instead of 400ing on the route's `min(1)`.
 *
 * ⚠ `await` has no thread parameter — a filtered hold would miss messages an
 * agent must follow. Never suggest a thread-scoped wait here; the agent ends up
 * armed on a call that cannot exist.
 *
 * ⚠ NEITHER SEQ IS A CURSOR, so this hint offers NO number to await from. A safe
 * `since` is the highest seq below which the reader has seen EVERYTHING
 * channel-wide; a thread-scoped read deliberately filtered rows out and
 * establishes no such bound. `await` is `gt("seq", since)`, so a LARGER `since`
 * returns FEWER messages: awaiting from the channel-wide max drops every row in
 * `(threadMax, channelMax]` permanently, since the cursor only moves forward.
 *
 * ⚠ SO A SCOPED READ PRINTS NO SEQ AT ALL (2026-08-22, Samuel's ruling). It used
 * to print `Highest seq shown: <n>` and then spend four sentences telling the
 * reader not to use `<n>` — a footgun wrapped in prose is still a footgun, and
 * the number is what survives a skim. The two options were "omit it" and "return
 * an explicitly safe `nextSince`"; the second is not available here, because the
 * only safe value is the caller's OWN prior channel-wide cursor and this op
 * cannot see it. Omitting is therefore not a lesser fix: there is no number this
 * read is entitled to hand back. ⚠ The message lines above still carry each
 * message's own `**#seq**`, so nothing is hidden — what is withheld is the
 * SUMMARY line that reads like a cursor.
 */
export declare function opRead(client: DoplClient, ref: string, since?: number, limit?: number, selfUserId?: string | null, thread?: string): Promise<ToolResponse>;
/**
 * READ-SESSION-STATE — the caller's OWN live sessions: handle, reduced state
 * (working / idle / ended — desktop `session-summary.js` vocabulary;
 * deliberately no "thinking", which needs streaming and streaming is off), and
 * thread. `ref` narrows to one channel; omitted = all in active workspace.
 *
 * ⚠ OWN-SCOPED is the whole security model: server read keys on the caller's
 * user id, RLS backs it, a peer's sessions never come back. Channel names and
 * thread titles are still counterparty-influenced, so they go through the same
 * inline-neutralizer under listing framing.
 *
 * Writer is `main/session-state-push.js` → `POST /api/channels/sessions`, fired
 * when the pill projection's digest moves (NOT a heartbeat).
 *
 * ⚠ The empty answer means "no live sessions being reported", never "you have
 * no sessions" — an asleep, signed-out, or older-build machine reports nothing.
 */
export declare function opReadSessions(client: DoplClient, ref?: string): Promise<ToolResponse>;
export declare function opListThreads(client: DoplClient, ref: string, selfUserId?: string | null): Promise<ToolResponse>;
export declare function opGetThread(client: DoplClient, ref: string, threadId: string, selfUserId?: string | null): Promise<ToolResponse>;
/**
 * The channel ROSTER. Read-only; the private per-member preference (agent tool
 * profile) is scrubbed server-side for everyone but the caller and not rendered.
 *
 * ⚠ `callerIsAdmin` gates member EMAIL — a public channel is enumerable by an
 * agent that was never invited, so `formatMemberLine` shows email only for a
 * workspace admin or the caller's own row.
 */
export declare function opMembers(client: DoplClient, ref: string, selfUserId?: string | null, callerIsAdmin?: boolean): Promise<ToolResponse>;
