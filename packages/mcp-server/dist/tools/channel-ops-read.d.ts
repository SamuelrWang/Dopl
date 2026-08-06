/**
 * `dopl_channel` READ op handlers: list (channels), read (messages),
 * list_threads / get_thread, members. All non-mutating, and all of them ONE
 * round-trip rendered.
 *
 * `await` used to live here and now has its own module,
 * `channel-ops-await.ts` — split at the §2 500-line cap when `read` gained its
 * `thread` filter, on the seam this file had already drawn twice
 * (`channel-await-budget.ts` took the clocks, `channel-wake-guidance.ts` the
 * wake claims). It is the only op here that loops, and nothing in it was shared
 * with these beyond the renderers.
 *
 * BOUNDARY: the wire/storage name `task` == the domain name `thread` — the
 * `thread` op param still resolves against `channel_tasks` rows and the
 * `/tasks` routes underneath `@dopl/client`.
 *
 * Every STRING these ops emit — the author labels, the thread renders, the
 * channel lines, and the untrusted-content headers that frame them — lives in
 * `channel-render.ts`. That split is where the peer-authored-text discipline is
 * documented and enforced (Q1); this file is control flow.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
export declare function opList(client: DoplClient): Promise<ToolResponse>;
/**
 * Read a channel's transcript, optionally SCOPED TO ONE THREAD.
 *
 * `thread` is a FILTER, not a lookup, and every string below is written from
 * that fact: the route keeps only the rows whose `metadata.taskId` equals it,
 * an id nothing carries returns `[]` rather than a 404, and any non-empty
 * string is legal — a thread id is a `channel_tasks` uuid today, but the
 * transcript still carries legacy `task-<channelId>-<seq>` ids and those are
 * the exchanges hardest to reconstruct by hand. Blank/whitespace is treated as
 * unset rather than sent, so a caller that passes `thread=""` gets the channel
 * read it meant instead of a 400 from the route's `min(1)`.
 *
 * WHAT THE FILTERED RESULT MAY NOT SAY: `await` has no thread parameter and
 * never will have one silently (a filtered hold would miss the messages an
 * agent must follow — see `channel-ops-await.ts`). So the seq this reports is
 * this THREAD's high-water mark, not the channel's, and the watch hint it hands
 * back is a plain channel-wide await. Suggesting a thread-scoped wait here is
 * how an agent ends up armed on a call that cannot exist.
 *
 * P1-8 (2026-08-04) SHIPPED THE FIX BACKWARDS, AND P1-8b (2026-08-05) UNDOES IT.
 *
 * The original complaint was real: the line said "Highest seq shown: N", warned
 * that N is thread-local, then interpolated that same N into `since=N`, so an
 * agent that had only ever read this thread never saw the messages sitting below
 * N in other exchanges. P1-8 concluded the CHANNEL-wide max M was the right
 * number and shipped that. It is the wrong direction, and it makes the loss
 * strictly worse.
 *
 * `await` is `gt("seq", since)`. A LARGER `since` returns FEWER messages. The
 * rows in `(N, M]` are precisely the other exchanges' messages this reader has
 * NOT seen: awaiting from N DELIVERS them, awaiting from M DROPS them — forever,
 * because the cursor only moves forward. P1-8 therefore caused the exact message
 * loss its own docblock was written to prevent, and its hint said so out loud
 * ("passing the thread-local N would skip everything between the two"), which is
 * the claim inverted. Caught in production by a counterparty's agent reading the
 * hint against the schema, in the exchange that was testing this feature.
 *
 * THE HONEST ANSWER IS THAT NEITHER NUMBER IS A CURSOR. A safe `since` is the
 * highest seq below which this reader has seen EVERYTHING, channel-wide; a
 * thread-scoped read establishes no such bound and cannot, because it deliberately
 * filtered rows out. So this hint no longer offers a number to await from. It
 * states the thread's high-water mark for display, says plainly that the read did
 * not advance any channel-wide cursor, and points at the two calls that CAN
 * establish one. The real fix is a thread filter on `await` (or an opaque resume
 * token) so "watch MY exchange" becomes expressible instead of approximated —
 * tracked as the elevation this incident argues for.
 */
export declare function opRead(client: DoplClient, ref: string, since?: number, limit?: number, selfUserId?: string | null, thread?: string): Promise<ToolResponse>;
/**
 * READ-SESSION-STATE (rollback §3.5) — "what is flint doing?".
 *
 * Answers the CALLER'S OWN live sessions, each with its handle, its reduced
 * state (working / idle / ended — the desktop's `session-summary.js`
 * vocabulary, and there is deliberately NO "thinking": it needs streaming,
 * which is off), and the thread it is on. `ref` narrows to one channel; omitted,
 * it is every session of the caller's in the active workspace.
 *
 * OWN-SCOPED, and that is the whole security model: a session runs on one
 * member's machine, and the server read keys on the caller's own user id (and
 * RLS backs it), so a peer's sessions never come back. There is nothing to
 * neutralize about WHOSE they are — they are the caller's — but the channel
 * names and thread titles they carry are counterparty-influenced (a peer typed
 * the thread title; a channel the caller joined was named by someone else), so
 * they render through the same inline-neutralizer every other peer string does,
 * under the listing framing.
 *
 * DELIVERY. ~~The desktop WRITE is not wired in this phase, so an operational
 * desktop currently reports nothing.~~ **F-147 WIRED IT** — `main/session-state-push.js`
 * posts the machine's whole live set to `POST /api/channels/sessions` when the
 * pill projection's digest moves (a handful of writes per session lifetime, NOT
 * a heartbeat — plan §5). This op did not change to receive it, which was the
 * point of shipping the read first.
 *
 * THE EMPTY ANSWER STILL MEANS WHAT IT SAID: "no live sessions being reported",
 * never "you have no sessions". A machine that is asleep, signed out, running
 * the retired remote shell, or on a build older than the writer reports nothing
 * — and the honest answer to "what is flint doing?" in that case is silence
 * about the machine, not a claim about the sessions.
 */
export declare function opReadSessions(client: DoplClient, ref?: string): Promise<ToolResponse>;
export declare function opListThreads(client: DoplClient, ref: string, selfUserId?: string | null): Promise<ToolResponse>;
export declare function opGetThread(client: DoplClient, ref: string, threadId: string, selfUserId?: string | null): Promise<ToolResponse>;
/**
 * The channel ROSTER — who is actually in here.
 *
 * The gap this closes: `op="list"` reported "5 members" and NOTHING in the tool
 * said who they were, while `post` and `create_thread` both require addressing a
 * specific member and an unaddressed ask in a 3+ member channel triggers nobody.
 * An agent could see that a channel was a group, could be told to address one
 * member, and had no op that would tell it which members existed.
 *
 * Read-only, and it renders exactly what the roster route returns — the private
 * per-member preferences (notify scope, agent tool profile) are already scrubbed
 * server-side for everyone but the caller, and none of them are rendered here.
 */
export declare function opMembers(client: DoplClient, ref: string, selfUserId?: string | null): Promise<ToolResponse>;
