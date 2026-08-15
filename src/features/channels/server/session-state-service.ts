import "server-only";
import type { SessionStateEntryInput } from "../schema-sessions";
import type { ChannelSessionState } from "../types";
import { mapSessionStateRow, type SessionStateUpsert } from "./collab-dto";
import * as sessionRepo from "./repository-sessions";
import type { ChannelContext } from "./service-shared";

/**
 * SESSION-STATE SERVICE — the read half of "what is flint doing?" over MCP. A
 * SESSION is the only agent identity there is, and its live state lives in the
 * DESKTOP main process. This reads the projection the desktop pushes to
 * `channel_sessions` and returns the {@link ChannelSessionState} shape the MCP
 * op renders. ⚠ The SAME derivation the pills show — the server stores and
 * returns, and adds no second derivation.
 *
 * ⚠ ALWAYS SCOPED TO THE CALLER (`ctx.userId`): a session runs on one member's
 * machine, and the read never reaches another member's — in service authz AND
 * in the table's RLS.
 *
 * Delivery is PUSH ON STATE CHANGE ({@link reportSessionStates}, called by
 * `main/session-state-push.js`), never a heartbeat. An empty answer is reported
 * honestly as "no live sessions", never as a claim about the caller's machine —
 * see `listSessionStates` for the one PostgREST code degraded to `[]`.
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

/** API shape → column shape. ⚠ The one place the two vocabularies meet, and
 *  where `undefined` becomes the `null` the column stores — the schema lets a
 *  field be absent, the database has no such value. */
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
 * THE WRITE HALF — the operator's desktop reporting its whole live session set
 * for one workspace.
 *
 * ⚠ PUSH ON STATE CHANGE, NOT A HEARTBEAT: called only when
 * `session-summary.js`'s digest actually moves — a handful of writes per session
 * lifetime, against `agent_presence`'s 120/hour per listener. That difference is
 * the entire reason this table exists rather than a column on the presence row.
 *
 * ⚠ SCOPED TO THE CALLER, exactly as the read is. `ctx.userId` /
 * `ctx.workspaceId` are the only identity the repository sees; the payload
 * carries neither, so a caller cannot write a row answering someone else's
 * `read_sessions`. Membership floor is `withWorkspaceAuth`'s (viewer), and
 * `channel_child_workspace_guard` refuses a channel from another workspace.
 *
 * ⚠ NO CREDENTIAL BOUND, deliberately: the rows are the caller's own and only
 * the caller reads them, so narrowing to a runtime stamp or cookie session
 * refuses a future desktop lane and buys no boundary. The bound is the identity
 * pair plus token custody.
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
