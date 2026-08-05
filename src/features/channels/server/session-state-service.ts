import "server-only";
import type { ChannelSessionState } from "../types";
import { mapSessionStateRow } from "./collab-dto";
import * as collab from "./repository-collab";
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
 * DELIVERY GAP (flagged, F-144). The desktop WRITE — pushing a row on each
 * state change — is not wired in this phase, so this returns `[]` live until it
 * lands. The op reports that honestly ("no live sessions") rather than
 * fabricating state. The chosen delivery is push-on-state-change (plan §5
 * option a), not a heartbeat: a handful of writes per session lifetime.
 */
export async function listSessionStates(
  ctx: ChannelContext,
  channelId?: string
): Promise<ChannelSessionState[]> {
  const rows = await collab.listSessionStates(
    ctx.userId,
    ctx.workspaceId,
    channelId
  );
  return rows.map(mapSessionStateRow);
}
