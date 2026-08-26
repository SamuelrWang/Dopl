import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { requireChannelId, toChannelErrorResponse } from "@/shared/api/channel-route";
import { buildChannelContext } from "@/features/channels/server/service";
import { listChannelSessions } from "@/features/channels/server/session-state-service";

/**
 * EVERY member's agent-session STATE in one channel — the Agents tab's peer
 * cards (Samuel, 2026-08-20). READ ONLY; the write stays the desktop's own
 * push (`POST /api/channels/sessions`). The service's fence is
 * `loadVisibleChannel` — the same rule every channel read uses — and the rows
 * carry the state projection alone (name / state / thread / owner), which is
 * what makes a channel-wide read acceptable where the transcript never is.
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
 * ⚠ `minRole: "guest"` (2026-08-26). `channel-surface-data.ts ›
 * useChannelSurfaceData` mounts `useAgentsPanel → useChannelAgentSessions` for
 * EVERY host of the per-channel surface, guest web lane included, and it POLLS
 * (`PEER_SESSIONS_POLL_MS`) plus rides the message doorbell — so at the viewer
 * default this was a 403 on a loop for every guest.
 *
 * The floor is LOWERED rather than the mount being suppressed, because seeing
 * that the operator's agent is working is the guest lane's whole proposition
 * (§4A: "chat to the operator's agent, run none of your own"). What a guest may
 * NOT do is unchanged and lives elsewhere: launching is `capabilities.
 * selfManagement:false` in the UI and `/channels/[channelId]/launch-directives`
 * at the viewer floor on the server. This route is READ ONLY, the payload is the
 * state projection alone (name / state / thread / owner) and never transcript,
 * and its fence is `loadVisibleChannel` — the same one every guest-allowed
 * channel read already passes.
 */
export const GET = withWorkspaceAuth(handleGet, { minRole: "guest" });
