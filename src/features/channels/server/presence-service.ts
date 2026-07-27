import "server-only";
import type { AgentPresenceStatus } from "../types";
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
 * Presence service — the desktop listener upserts a heartbeat every ~30s
 * while running + signed in. The row (user_id, workspace_id) is what drives
 * the web "agent online / listening" indicators; "online" is derived on read
 * against the 90s window. Always keyed to the caller (ctx.userId).
 *
 * `status` is a closed set (schema enum + a DB CHECK), not free text: it is a
 * write-mostly column today, and an unconstrained one is a slot for arbitrary
 * caller-controlled text that a later UI would render.
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
