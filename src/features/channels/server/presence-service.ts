import "server-only";
import type { AgentPresenceStatus, PresencePosture } from "../types";
import * as collab from "./repository-collab";
import type { ChannelContext } from "./service-shared";

/** Result of a heartbeat: the stamped time + the label the desktop sent. */
export interface PresenceHeartbeat {
  userId: string;
  workspaceId: string;
  lastSeenAt: string;
  status: string;
}

/**
 * Presence service — the desktop listener upserts a heartbeat every ~30s while
 * running + signed in. The (user_id, workspace_id) row drives the web "agent
 * online / listening" indicators; "online" is derived on read against the 90s
 * window. Always keyed to the caller (ctx.userId).
 *
 * `status` is a closed set (schema enum + a DB CHECK): an unconstrained column
 * is a slot for caller-controlled text that a later UI would render.
 */
export async function heartbeatPresence(
  ctx: ChannelContext,
  status?: AgentPresenceStatus
): Promise<PresenceHeartbeat> {
  const row = await collab.upsertPresence(
    ctx.userId,
    ctx.workspaceId,
    status ?? "listening"
  );
  return {
    userId: row.user_id,
    workspaceId: row.workspace_id,
    lastSeenAt: row.last_seen_at,
    status: row.status,
  };
}

/**
 * THE USER-SCOPED HEARTBEAT — one call, every container (2026-09-08, Samuel's
 * Slack-parity ruling).
 *
 * ⚠ **IT TAKES A `userId`, NOT A {@link ChannelContext}, AND THAT IS THE POINT.**
 * The subject is the PERSON; the container set is whatever `workspace_members`
 * says when the statement runs. A context would carry exactly the one workspace
 * this route deliberately does not have.
 *
 * ⚠ **THE PER-WORKSPACE {@link heartbeatPresence} STAYS AND MUST KEEP WORKING.**
 * An older desktop beats it once per container; a current desktop falls back to
 * it, in parallel, when this one 404s (§13, an older peer is supported).
 */
export async function heartbeatPresenceEverywhere(
  userId: string,
  status: PresencePosture
): Promise<{ workspaceIds: string[]; status: PresencePosture }> {
  const workspaceIds = await collab.upsertPresenceEverywhere(userId, status);
  return { workspaceIds, status };
}
