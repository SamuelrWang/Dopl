/**
 * `dopl_channel` READ op handlers: list (channels), read (messages), await
 * (long-poll for new messages), list_threads / get_thread. All non-mutating.
 * Routed from the registrar in channel.ts.
 *
 * BOUNDARY: the wire/storage name `task` == the domain name `thread` — the
 * `thread` op param still resolves against `channel_tasks` rows and the
 * `/tasks` routes underneath `@dopl/client`.
 *
 * Every clock that bounds the `await` hold — the poll size, the assembled
 * hold, the env lever, and the deadlines they must fit under — lives in
 * `channel-await-budget.ts`. Read that file before retuning any of them.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
export declare function opList(client: DoplClient): Promise<ToolResponse>;
export declare function opRead(client: DoplClient, ref: string, since?: number, limit?: number): Promise<ToolResponse>;
/**
 * LONG-HOLD await. One call holds up to `timeoutMs` (capped at
 * {@link AWAIT_HOLD_MS}) by re-issuing the ~50s inner long-poll with the same
 * `since` cursor until messages land or the budget runs out. Returning the
 * moment anything arrives is what keeps a reply fast; holding past ~2 minutes
 * when nothing does is what makes the pending call a wake primitive.
 *
 * Four results, never a thrown error once the hold is underway: new messages, a
 * timed-out note that tells the caller to re-arm (with a stop condition), a
 * FAILED-MID-HOLD note that names what broke and re-arms on the same cursor,
 * or — when the hold ended far under what was asked for with no error at all —
 * a CUT SHORT note that tells the caller NOT to re-arm and to report it.
 */
export declare function opAwait(client: DoplClient, ref: string, since: number, timeoutMs?: number): Promise<ToolResponse>;
export declare function opListThreads(client: DoplClient, ref: string): Promise<ToolResponse>;
export declare function opGetThread(client: DoplClient, ref: string, threadId: string): Promise<ToolResponse>;
