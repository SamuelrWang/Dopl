import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { requireChannelId, toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  buildChannelContext,
  createAgent,
  listAgents,
} from "@/features/channels/server/service";
import { ChannelAgentCreateSchema } from "@/features/channels/schema";

// Channel agents: GET lists the roster (anyone who can read the room — a peer
// has to see a handle before they can @-address it); POST summons one
// (`/new-agent`, channel members only, caller becomes the owner). Both are
// agent-reachable over the MCP device token — NOT sessionOnly — and the service
// enforces the channel-scoped authorization.
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    const agents = await listAgents(ctx, requireChannelId(auth.params));
    return NextResponse.json({ agents });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, ChannelAgentCreateSchema);
    const ctx = buildChannelContext(auth);
    const agent = await createAgent(
      ctx,
      requireChannelId(auth.params),
      input
    );
    return NextResponse.json({ agent }, { status: 201 });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });
