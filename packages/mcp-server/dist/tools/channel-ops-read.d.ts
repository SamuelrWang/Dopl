/**
 * `dopl_channel` READ op handlers: list (channels), read (messages), await
 * (long-poll for new messages), list_threads / get_thread. All non-mutating.
 * Routed from the registrar in channel.ts.
 *
 * BOUNDARY: the wire/storage name `task` == the domain name `thread` — the
 * `thread` op param still resolves against `channel_tasks` rows and the
 * `/tasks` routes underneath `@dopl/client`.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
/**
 * The hold, parsed from `DOPL_AWAIT_HOLD_MS` (integer milliseconds), clamped to
 * [{@link AWAIT_HOLD_FLOOR_MS}, {@link AWAIT_HOLD_CAP_MS}]. Anything unparseable
 * — unset, blank, non-numeric, a float, a negative — falls back to the cap.
 *
 * WHY AN ENV KNOB: this package ships as committed `dist/`, so shortening the
 * hold during an incident (a platform timeout regression, a function-duration
 * bill spike) would otherwise mean a rebuild + redeploy of the whole app. One
 * env flip is the smaller lever.
 */
export declare function resolveAwaitHoldMs(raw: string | undefined): number;
export declare function opList(client: DoplClient): Promise<ToolResponse>;
export declare function opRead(client: DoplClient, ref: string, since?: number, limit?: number): Promise<ToolResponse>;
/**
 * LONG-HOLD await. One call holds up to `timeoutMs` (capped at
 * {@link AWAIT_HOLD_MS}) by re-issuing the ~50s inner long-poll with the same
 * `since` cursor until messages land or the budget runs out. Returning the
 * moment anything arrives is what keeps a reply fast; holding past ~2 minutes
 * when nothing does is what makes the pending call a wake primitive.
 *
 * Three results, never a thrown error once the hold is underway: new messages,
 * a timed-out note that tells the caller to re-arm (with a stop condition), or
 * — when the hold ended far under what was asked for — a CUT SHORT note that
 * tells the caller NOT to re-arm and to report it instead.
 */
export declare function opAwait(client: DoplClient, ref: string, since: number, timeoutMs?: number): Promise<ToolResponse>;
export declare function opListThreads(client: DoplClient, ref: string): Promise<ToolResponse>;
export declare function opGetThread(client: DoplClient, ref: string, threadId: string): Promise<ToolResponse>;
