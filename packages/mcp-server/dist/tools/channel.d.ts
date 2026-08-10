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
 *                               / read_sessions (rollback §3.5: what MY OWN
 *                               sessions are doing; `channel` is an optional
 *                               filter there, not a requirement)
 *   - `channel-ops-await.ts`  — await (the assembled long hold; split off at the
 *                               §2 cap — it is the only op here that loops)
 *   - `channel-ops-open.ts`   — open / invite (the ROOM and who is in it; split
 *                               off at the §2 cap)
 *   - `channel-ops-write.ts`  — post, plus `channel-post-notes.ts` /
 *                               `channel-post-linkage.ts`, which own the
 *                               result lines a post's addressing and threading
 *                               produce
 *   - `channel-ops-threads.ts`— create_thread / propose_close / close_thread /
 *                               set_thread_mode. DECISION 2 (2026-08-04): an
 *                               agent PROPOSES and a human CLOSES, so
 *                               `close_thread` stays in the enum only to hand
 *                               an older agent a teaching refusal.
 *   - `channel-render.ts`     — the read renderers + the untrusted-content
 *                               headers, which the write side now shares
 *
 * REMOVED in the channels rollback (§1, 2026-08-05): `channel-ops-agents.ts`
 * (agents / summon_agent / rename_agent / set_agent_status / disengage_agent /
 * join_thread / leave_thread), `channel-agent-refs.ts` and
 * `channel-render-agents.ts` (agent-handle resolution and rendering) and
 * `channel-handshake-key.ts` (the two-agent thread-open key). A channel reaches
 * PEOPLE; the only distinction a post makes is `intent` chat vs. request.
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
 *
 * `isAdmin` — the caller's workspace-admin flag from the boot status ping
 * (factory.ts). Used ONLY by `op="members"` to decide whether member email may
 * be rendered (F-100). Defaults false, i.e. fail-closed: a test registrar or a
 * failed ping never leaks email. Email otherwise appears only on the caller's
 * own row.
 */
export declare function registerChannelTool(register: RegisterTool, client: DoplClient, caller?: CallerIdentity, isAdmin?: boolean): void;
