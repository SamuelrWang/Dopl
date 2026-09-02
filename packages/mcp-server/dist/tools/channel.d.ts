/**
 * `dopl_channel` — cross-user, agent-to-agent collaboration channels.
 *
 * A CHANNEL (or DM) holds many THREADS. A THREAD is one shared exchange
 * between two members; a SESSION is one member's agent run working it. Agents
 * (and users) post messages and structured activity events, then long-poll
 * for replies. Every message has a monotonic `seq` cursor, so a listener can
 * ask for "everything after seq N" (op="read"/"await").
 *
 * Thin registrar: owns the single tool schema + op routing, delegating to
 *   - `channel-shared.ts`     — ref resolution + the ONE neutralizer every
 *                               peer-authored string must pass through
 *   - `channel-ops-read.ts`   — list / read / list_threads / get_thread /
 *                               members / read_sessions
 *   - `channel-ops-await.ts`  — await (the only looping op)
 *   - `channel-ops-open.ts`   — open / invite
 *   - `channel-ops-write.ts`  — post (+ `channel-post-notes.ts` /
 *                               `channel-post-linkage.ts` for its result lines)
 *   - `channel-ops-threads.ts`— create_thread / set_thread_mode
 *   - `channel-render.ts`     — read renderers + untrusted-content headers,
 *                               shared with the write side
 *
 * ⚠ A channel reaches PEOPLE. There is no agent-handle addressing; the only
 * distinction a post makes is `intent` chat vs. request.
 *
 * ⚠ BOUNDARY: wire/storage name `task` == domain name `thread`. Ops and params
 * say `thread`; `channel_tasks`, `metadata.taskId`, `task_*` kinds and the
 * `/tasks` routes keep the storage name.
 *
 * ⚠ No `dopl_channel_admin` twin — no destructive ops over MCP (archive/delete
 * are human decisions in the web UI).
 */
import type { DoplClient } from "@dopl/client";
import { type RegisterTool } from "./respond";
import { type CallerIdentity } from "./identity";
import type { WorkspaceDirectory } from "../workspace-directory.js";
/**
 * `caller` — the session's ONE identity record (`identity.ts`), resolved once
 * at boot:
 *   - `userId` renders "· to you" instead of a uuid the agent cannot match
 *     against itself, and filters the caller's own posts out of its `await`.
 *   - `runtime` decides what the wake teaching may CLAIM (from
 *     `X-Dopl-Runtime`). ⚠ An OBSERVATION that gates nothing — without it the
 *     tool promises every caller that a pending `await` outlives the turn,
 *     which is measurably false for an external session.
 *
 * ⚠ Resolved at boot, never per call: `await` runs a poll loop, so an identity
 * lookup per read is a round-trip on the hottest path. Defaults to
 * {@link UNKNOWN_CALLER} — ids render as ids, no line claims to know "you", no
 * line claims a wake.
 *
 * `isAdmin` — workspace-admin flag from the boot status ping. ⚠ Used ONLY by
 * `op="members"` to gate member EMAIL, and defaults false (fail-closed): a test
 * registrar or a failed ping never leaks email.
 */
export declare function registerChannelTool(register: RegisterTool, client: DoplClient, caller: CallerIdentity | undefined, isAdmin: boolean | undefined, directory: WorkspaceDirectory): void;
