import "server-only";
import type { SessionStateEntryInput } from "../schema-sessions";
import type { ChannelSessionState, ChannelSessionStateOwn } from "../types";
import {
  mapOwnSessionStateRow,
  mapPeerSessionStateRow,
  type SessionStateUpsert,
} from "./collab-dto";
import * as collab from "./repository-collab";
import * as sessionRepo from "./repository-sessions";
import type { ChannelContext } from "./service-shared";
import { loadVisibleChannel } from "./service-shared";

/**
 * The own-scoped read's answer: the rows plus presence, because rows are pushed on change and a quiet
 * row cannot tell idle from crashed (F-294). Presence is per (user, workspace), never per machine.
 */
export interface OwnSessionsReport {
  sessions: ChannelSessionStateOwn[];
  /** `false` covers no row, no stamp and an unreadable stamp; "not reported" is the wire key being absent. */
  operatorOnline: boolean;
}

/**
 * The caller's own sessions (`ctx.userId`). Both reads here run on the RLS-bypassing admin client, so
 * the own/peer mapper split in this file is what keeps telemetry operator-only.
 */
export async function listSessionStates(
  ctx: ChannelContext,
  channelId?: string
): Promise<OwnSessionsReport> {
  // Concurrent: serialized, the presence lookup would add a round trip to the await route.
  const [rows, presence] = await Promise.all([
    sessionRepo.listSessionStates(ctx.userId, ctx.workspaceId, channelId),
    collab.presenceForUser(ctx.userId, ctx.workspaceId),
  ]);
  return {
    // The own mapper is licensed by the `ctx.userId` fence above, not by this function's name.
    sessions: rows.map(mapOwnSessionStateRow),
    // A boolean, not the stamp: the server owns the freshness window.
    operatorOnline: presence?.online === true,
  };
}

/**
 * Every member's sessions in one channel, fenced by `loadVisibleChannel` (public non-members too). The
 * read is `select("*")`: only {@link mapPeerSessionStateRow} stands between the wide row and a peer.
 */
export async function listChannelSessions(
  ctx: ChannelContext,
  ref: string
): Promise<Array<ChannelSessionState & { userId: string }>> {
  const { channel } = await loadVisibleChannel(ctx, ref);
  const rows = await sessionRepo.listChannelSessionStates(
    ctx.workspaceId,
    channel.id
  );
  // `userId` rides for the owner's avatar — an identity the roster already publishes.
  return rows.map((row) => ({
    ...mapPeerSessionStateRow(row),
    userId: row.user_id,
  }));
}

/** API shape → column shape. Absent becomes `null` (unknown), never `0` / `false`: a default would
 *  manufacture a measurement nobody took. */
function toUpsert(entry: SessionStateEntryInput): SessionStateUpsert {
  return {
    session_key: entry.sessionKey,
    channel_id: entry.channelId,
    task_id: entry.threadId ?? null,
    name: entry.name,
    state: entry.state,
    channel_name: entry.channelName ?? null,
    thread_title: entry.threadTitle ?? null,
    detail: entry.detail ?? null,
    tool_label: entry.toolLabel ?? null,
    model: entry.model ?? null,
    context_used: entry.contextUsed ?? null,
    context_window: entry.contextWindow ?? null,
    tokens_spent: entry.tokensSpent ?? null,
    started_at: entry.startedAt ?? null,
    last_activity_at: entry.lastActivityAt ?? null,
    identity_name: entry.identityName ?? null,
    turns: entry.turns ?? null,
    tokens_delta: entry.tokensDelta ?? null,
    stale: entry.stale ?? null,
    denied_calls: entry.deniedCalls ?? null,
    last_denied_tool: entry.lastDeniedTool ?? null,
    last_wake_seq: entry.lastWakeSeq ?? null,
    last_wake_at: entry.lastWakeAt ?? null,
    display_name: entry.displayName ?? null,
    // A request, resolved in the reconcile (`session-colors.ts › resolveReportedColors`); `null` = first free key.
    color: entry.color ?? null,
  };
}

/**
 * The desktop's whole live set for one workspace, pushed on state change (not a heartbeat). Scoped to
 * `ctx.userId` / `ctx.workspaceId` — the payload carries neither, so a caller cannot write someone
 * else's rows; `channel_child_workspace_guard` refuses a channel from another workspace.
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
