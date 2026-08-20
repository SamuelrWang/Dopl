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

export const GET = withWorkspaceAuth(handleGet);
