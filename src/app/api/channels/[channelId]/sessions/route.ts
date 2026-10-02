import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { requireChannelId, toChannelErrorResponse } from "@/shared/api/channel-route";
import { buildChannelContext } from "@/features/channels/server/service";
import { listChannelSessions } from "@/features/channels/server/session-state-service";

/**
 * Every member's agent-session STATE in one channel — the Agents tab's peer cards
 * (Samuel, 2026-08-20). Read only; fenced by `loadVisibleChannel`. Rows carry the
 * state projection alone (name/state/thread/owner), never transcript.
 */
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    const sessions = await listChannelSessions(ctx, requireChannelId(auth.params));
    return NextResponse.json({ sessions });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

/**
 * ⚠ Guest floor: `useChannelAgentSessions` polls on every surface host, guests
 * included, and seeing the operator's agent work is the guest lane's point (§4A).
 * Launching stays blocked elsewhere (UI `selfManagement:false`; launch-directives
 * at viewer floor).
 */
export const GET = withWorkspaceAuth(handleGet, { minRole: "guest" });
