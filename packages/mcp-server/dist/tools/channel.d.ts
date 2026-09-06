/**
 * `dopl_channel` — cross-user, agent-to-agent collaboration channels.
 *
 * A CHANNEL (or DM) holds many THREADS. A THREAD is one shared exchange
 * between two members; a SESSION is one member's agent run working it. Agents
 * (and users) send messages and structured activity events, then read for
 * replies. Every message has a monotonic `seq` cursor, so a listener can ask
 * for "everything after seq N" (`op="read"`, `since=`).
 *
 * ⚠ **SIX OPS** — `send` · `read` · `status` · `manage` · `rooms` · `artifact`.
 * Five of them since 2026-09-02 (v2 wave B slice B8, Samuel's ruling B9), down
 * from twenty-three: the other twenty-two names parsed for one release and
 * answered ONE line naming their replacement, and slice B16 closed that window,
 * so the enum is exactly as wide at runtime as in the published schema and a
 * retired name is refused by `channel-schema.ts › unknownOpRefusal`. ⚠ `artifact`
 * joined on 2026-09-06 (design #1220 §5, accepted #1222) — the collapse was
 * about twenty-three names for the work of five, not a promise never to grow;
 * this one folds EXISTING messages into a card and belongs to no other op.
 *
 * Thin registrar: owns the single tool schema + op routing, delegating to
 *   - `channel-shared.ts`        — ref resolution + the ONE neutralizer every
 *                                  peer-authored string must pass through
 *   - `channel-ops-write.ts`     — the send lane (+ `channel-post-linkage.ts`
 *                                  and `channel-facts.ts` for its result line)
 *   - `channel-ops-threads.ts`   — thread="new"
 *   - `channel-ops-escalate.ts`  — kind="decision"
 *   - `channel-ops-read.ts` / `channel-ops-account.ts` / `channel-ops-hold*.ts`
 *                                — the page, the account-wide page, the hold
 *   - `channel-ops-status.ts`    — sessions + the direction mailbox
 *   - `channel-dispatch-agents.ts` — op="manage"
 *   - `channel-dispatch-rooms.ts`  — op="rooms"
 *   - `channel-ops-artifact.ts`    — op="artifact" (dispatch AND render, for
 *                                    the reason in its own header)
 *   - `channel-render.ts`        — read renderers + untrusted-content headers
 *
 * ⚠ A channel reaches PEOPLE. `to` names ONE party — a member, or one of the
 * caller's OWN agents — and the server resolves it; with one the message is a
 * REQUEST, without one it is chat and reaches nobody.
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
 *     against itself, and filters the caller's own messages out of its hold.
 *   - `runtime` decides what the wake teaching may CLAIM (from
 *     `X-Dopl-Runtime`). ⚠ An OBSERVATION that gates nothing — without it the
 *     tool promises every caller that a pending hold outlives the turn, which
 *     is measurably false for an external session.
 *
 * ⚠ Resolved at boot, never per call: a hold runs a poll loop, so an identity
 * lookup per read is a round-trip on the hottest path. Defaults to
 * {@link UNKNOWN_CALLER} — ids render as ids, no line claims to know "you", no
 * line claims a wake.
 *
 * `isAdmin` — workspace-admin flag from the boot status ping. ⚠ Used ONLY by
 * `op="rooms" action="members"` to gate member EMAIL, and defaults false
 * (fail-closed): a test registrar or a failed ping never leaks email.
 */
export declare function registerChannelTool(register: RegisterTool, client: DoplClient, caller: CallerIdentity | undefined, isAdmin: boolean | undefined, directory: WorkspaceDirectory): void;
