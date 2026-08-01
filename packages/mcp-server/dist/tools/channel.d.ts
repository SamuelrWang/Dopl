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
 *   - `channel-ops-read.ts`   — list / read / list_threads / get_thread / members
 *   - `channel-ops-await.ts`  — await (the assembled long hold; split off at the
 *                               §2 cap — it is the only op here that loops)
 *   - `channel-ops-open.ts`   — open / invite (the ROOM and who is in it; split
 *                               off at the §2 cap)
 *   - `channel-ops-write.ts`  — post, plus `channel-post-notes.ts` /
 *                               `channel-post-linkage.ts`, which own the
 *                               result lines a post's addressing and threading
 *                               produce
 *   - `channel-ops-threads.ts`— create_thread / close_thread / set_thread_mode
 *   - `channel-ops-agents.ts` — agents / summon_agent / rename_agent /
 *                               set_agent_status / disengage_agent /
 *                               join_thread / leave_thread
 *                               (the MULTIPLAYER ops: who is in the room, and
 *                               which of them is currently ENGAGED)
 *   - `channel-agent-refs.ts` — agent identity: handle→row resolution, how a
 *                               handle is rendered, the participant-set render
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
import { type CallerIdentity } from "./identity";
/**
 * `caller` — the session's ONE identity record (server.ts / `identity.ts`),
 * resolved once at boot. Two fields matter here and they are used for two
 * different things:
 *
 *   - `userId` lets a read render "· to you" instead of a uuid the agent has no
 *     way to match against itself: without it, an agent in a five-member
 *     channel can see a message is addressed to SOMEONE and still not know
 *     whether that someone is itself. It also filters the caller's own posts
 *     out of its own `await` hold.
 *   - `runtime` decides what the wake teaching may CLAIM. The server receives
 *     the discriminating signal (`X-Dopl-Runtime`) and this tool used to be
 *     handed the user id alone, so it promised every caller that a pending
 *     `await` outlives the turn — true for nobody it was told to, and
 *     measurably false for an external session. See `channel-wake-guidance.ts`.
 *     It is an OBSERVATION and gates nothing (`identity.ts`).
 *
 * Resolved at boot rather than fetched per call on purpose — `await` runs a
 * poll loop, and an identity lookup per read would be a round-trip on the
 * hottest path in the tool. Defaults to {@link UNKNOWN_CALLER} (tests call this
 * registrar with two arguments): every id then renders as an id, which is
 * honest, no line claims to know who "you" is, and no line claims a wake.
 */
export declare function registerChannelTool(register: RegisterTool, client: DoplClient, caller?: CallerIdentity): void;
