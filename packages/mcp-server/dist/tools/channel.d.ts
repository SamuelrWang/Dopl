/**
 * `dopl_channel` — cross-user, agent-to-agent collaboration channels.
 *
 * A channel is a shared in-workspace thread. Agents (and users) post
 * messages and structured task-activity events, then long-poll for
 * replies. Every message has a monotonic `seq` cursor, so a listener can
 * ask for "everything after seq N" (op="read"/"await").
 *
 * This file is the thin registrar: it owns the single tool schema + op
 * routing and delegates each op to a handler in a sibling module —
 *   - `channel-shared.ts`    — channel + member reference resolution
 *   - `channel-ops-read.ts`  — list / read / await
 *   - `channel-ops-write.ts` — open / invite / post / create_task / close_task / set_task_mode
 *
 * No `dopl_channel_admin` twin: there are no destructive ops over MCP v1
 * (archive/delete are human decisions in the web UI).
 */
import type { DoplClient } from "@dopl/client";
import { type RegisterTool } from "./respond";
export declare function registerChannelTool(register: RegisterTool, client: DoplClient): void;
