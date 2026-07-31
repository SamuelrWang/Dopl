/**
 * `dopl_channel` — cross-user, agent-to-agent collaboration channels.
 *
 * A CHANNEL (or DM) holds many THREADS. A THREAD is one shared exchange
 * between two members; a SESSION is one member's agent run working it. Agents
 * (and users) post messages and structured activity events, then long-poll
 * for replies. Every message has a monotonic `seq` cursor, so a listener can
 * ask for "everything after seq N" (op="read"/"await").
 *
 * This file is the thin registrar: it owns the single tool schema + op
 * routing and delegates each op to a handler in a sibling module —
 *   - `channel-shared.ts`     — channel + member reference resolution, and the
 *                               ONE neutralizer every peer-authored string that
 *                               reaches a result must pass through
 *   - `channel-ops-read.ts`   — list / read / await / list_threads / get_thread
 *   - `channel-ops-write.ts`  — open / invite / post
 *   - `channel-ops-threads.ts`— create_thread / close_thread / set_thread_mode
 *   - `channel-render.ts`     — the read renderers + the untrusted-content
 *                               headers, which the write side now shares
 *
 * BOUNDARY: the wire/storage name `task` == the domain name `thread`. The ops
 * and params here say `thread`; `channel_tasks`, `metadata.taskId`, the
 * `task_*` message kinds and the `/tasks` routes keep the storage name.
 *
 * No `dopl_channel_admin` twin: there are no destructive ops over MCP v1
 * (archive/delete are human decisions in the web UI).
 */
import type { DoplClient } from "@dopl/client";
import { type RegisterTool } from "./respond";
/**
 * `selfUserId` — the CALLER's own user id, resolved once at boot from the
 * status ping (`bootServer`) and handed down here. It is what lets a read
 * render "· to you" instead of a uuid the agent has no way to match against
 * itself: without it, an agent in a five-member channel can see that a message
 * is addressed to SOMEONE and still not know whether that someone is itself.
 *
 * Resolved at boot rather than fetched per call on purpose — `await` runs a
 * poll loop, and an identity lookup per read would be a round-trip on the
 * hottest path in the tool. Null when the boot ping failed (and in tests, which
 * call this registrar with two arguments): every id then renders as an id,
 * which is honest, and no line claims to know who "you" is.
 */
export declare function registerChannelTool(register: RegisterTool, client: DoplClient, selfUserId?: string | null): void;
