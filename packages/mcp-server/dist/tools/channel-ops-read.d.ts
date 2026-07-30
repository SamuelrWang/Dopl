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
export declare function opList(client: DoplClient): Promise<ToolResponse>;
export declare function opRead(client: DoplClient, ref: string, since?: number, limit?: number): Promise<ToolResponse>;
export declare function opAwait(client: DoplClient, ref: string, since: number, timeoutMs?: number): Promise<ToolResponse>;
export declare function opListThreads(client: DoplClient, ref: string): Promise<ToolResponse>;
export declare function opGetThread(client: DoplClient, ref: string, threadId: string): Promise<ToolResponse>;
