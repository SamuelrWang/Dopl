import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  buildChannelContext,
  heartbeatPresence,
} from "@/features/channels/server/service";
import { PresenceHeartbeatSchema } from "@/features/channels/schema";

// Desktop heartbeat: upserts (user_id, workspace_id) with a fresh last_seen_at. Viewer floor;
// always keyed to ctx.userId.
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, PresenceHeartbeatSchema);
    const ctx = buildChannelContext(auth);
    const presence = await heartbeatPresence(ctx, input.status);
    return NextResponse.json({ presence });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

// ⚠ `minRole: "guest"` — a guest is present in its channel and thus mentionable
// (INVARIANTS §4A, §2B; Samuel's Q2 ruling: guests appear in presence). The
// channel-membership fence bounds the heartbeat to the caller's own channels.
export const POST = withWorkspaceAuth(handlePost, { minRole: "guest" });
