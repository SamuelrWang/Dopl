import "server-only";
import type { SessionStateEntryInput } from "../schema-sessions";
import type { ChannelSessionState } from "../types";
import { mapSessionStateRow, type SessionStateUpsert } from "./collab-dto";
import * as sessionRepo from "./repository-sessions";
import type { ChannelContext } from "./service-shared";

/**
 * SESSION-STATE SERVICE (rollback §3.5, read-session-state).
 *
 * The read half of "what is flint doing?" over MCP. Named agents are gone
 * (rollback §1); a SESSION is the only agent identity there is, and its live
 * state lives in the DESKTOP main process. This service reads the projection
 * the desktop pushes to `channel_sessions` and hands back the
 * {@link ChannelSessionState} shape the MCP op renders — the SAME derivation
 * the pills show (F-142: the server adds no second derivation, it stores and
 * returns).
 *
 * ALWAYS SCOPED TO THE CALLER (`ctx.userId`). A session runs on one member's
 * machine and this op answers about the caller's OWN sessions; the read never
 * reaches another member's, in service authz AND in the table's RLS.
 *
 * DELIVERY. ~~The desktop WRITE is not wired in this phase.~~ **F-147 wired
 * it** ({@link reportSessionStates}, called by `main/session-state-push.js`).
 * It is push-on-state-change (plan §5 option a), never a heartbeat: a handful
 * of writes per session lifetime. An empty answer is still reported honestly
 * as "no live sessions" rather than as a claim about the caller's machine.
 *
 * F-145 — AND THE `[]` IS NOW ACTUALLY WHAT COMES BACK. The migration is
 * unapplied, so the select answered `PGRST205` and the throw became a 500; the
 * repository degrades that ONE code to the empty list (and nothing else — see
 * `repository-sessionRepo.listSessionStates`), which is what makes this paragraph
 * true rather than aspirational.
 *
 * F-147 — THE DELIVERY GAP IS CLOSED. {@link reportSessionStates} is the write,
 * and the desktop's `main/session-state-push.js` is its one caller. The degrade
 * above stays until the migration is applied everywhere; past that point a
 * missing relation is a deployment fault and should be loud.
 */
export async function listSessionStates(
  ctx: ChannelContext,
  channelId?: string
): Promise<ChannelSessionState[]> {
  const rows = await sessionRepo.listSessionStates(
    ctx.userId,
    ctx.workspaceId,
    channelId
  );
  return rows.map(mapSessionStateRow);
}

/** API shape -> column shape. The one place the two vocabularies meet, and the
 *  place `undefined` becomes the `null` the column actually stores: the schema
 *  lets a field be absent, the database has no such value. */
function toUpsert(entry: SessionStateEntryInput): SessionStateUpsert {
  return {
    session_key: entry.sessionKey,
    channel_id: entry.channelId,
    task_id: entry.threadId ?? null,
    name: entry.name,
    state: entry.state,
    channel_name: entry.channelName ?? null,
    thread_title: entry.threadTitle ?? null,
  };
}

/**
 * THE WRITE HALF (F-147, rollback §3.5 / plan §5) — the operator's desktop
 * reporting its whole live session set for one workspace.
 *
 * PUSH ON STATE CHANGE, NOT A HEARTBEAT. The desktop calls this only when
 * `session-summary.js`'s digest actually moves — a handful of times per session
 * lifetime, against `agent_presence`'s 120 writes an hour per listener. That
 * difference is the entire reason this table exists rather than a column on the
 * presence row, and a future "just beat it every 30s" would undo sequencing
 * item 7 before it is measured.
 *
 * SCOPED TO THE CALLER, EXACTLY AS THE READ IS. `ctx.userId` and
 * `ctx.workspaceId` are the only identity the repository sees; the payload
 * carries no user id and no workspace id, so a caller cannot write a row that
 * answers someone else's `read_sessions`. The workspace membership floor is
 * `withWorkspaceAuth`'s (viewer), and the migration's
 * `channel_child_workspace_guard` refuses a channel from another workspace.
 *
 * NO CREDENTIAL BOUND, DELIBERATELY. The rows are the caller's own and only the
 * caller can read them, so narrowing this to a runtime stamp or to a cookie
 * session would refuse a future desktop lane and buy no boundary — the same
 * mistake F-145 warns against for `desktop-session`. The honest statement is
 * F-144's restated posture: the bound is the identity pair plus token custody.
 */
export async function reportSessionStates(
  ctx: ChannelContext,
  sessions: SessionStateEntryInput[]
): Promise<{ stored: number; changed: number; removed: number }> {
  return sessionRepo.replaceSessionStates(
    ctx.userId,
    ctx.workspaceId,
    sessions.map(toUpsert)
  );
}
