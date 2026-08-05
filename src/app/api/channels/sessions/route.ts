import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  buildChannelContext,
  listSessionStates,
} from "@/features/channels/server/service";

// READ-SESSION-STATE (rollback §3.5). GET the CALLER'S OWN live sessions —
// "what is flint doing?" answered over MCP — optionally narrowed to one channel
// with `?channelId=<uuid>`. Read-only and own-scoped (the service keys on
// ctx.userId, RLS backs it), so any signed-in workspace member may call it
// (viewer floor). The WRITE half (the desktop pushing rows on state change) is
// a flagged delivery gap and is intentionally not a route here yet — see F-144.
async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    const channelId =
      request.nextUrl.searchParams.get("channelId") ?? undefined;
    const sessions = await listSessionStates(ctx, channelId || undefined);
    return NextResponse.json({ sessions });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
