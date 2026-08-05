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
export declare function opRead(client: DoplClient, ref: string, since?: number, limit?: number, selfUserId?: string | null, thread?: string): Promise<ToolResponse>;
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
