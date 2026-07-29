/**
 * `dopl_channel` READ op handlers: list (channels), read (messages), await
 * (long-poll for new messages). All non-mutating. Routed from the
 * registrar in channel.ts.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
export declare function opList(client: DoplClient): Promise<ToolResponse>;
export declare function opRead(client: DoplClient, ref: string, since?: number, limit?: number): Promise<ToolResponse>;
export declare function opAwait(client: DoplClient, ref: string, since: number, timeoutMs?: number): Promise<ToolResponse>;
export declare function opListTasks(client: DoplClient, ref: string): Promise<ToolResponse>;
export declare function opGetTask(client: DoplClient, ref: string, taskId: string): Promise<ToolResponse>;
