import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import {
  requireAgentId,
  requireChannelId,
  toChannelErrorResponse,
} from "@/shared/api/channel-route";
import {
  buildChannelContext,
  disengageAgent,
  renameAgent,
  setAgentStatus,
} from "@/features/channels/server/service";
import { ChannelAgentUpdateSchema } from "@/features/channels/schema";

// PATCH an agent: rename it, move it along its lifecycle, or DISENGAGE it.
// `rename` / `set_status` are OWNER-ONLY — an agent is a member's process on a
// member's machine, so a teammate renaming or parking it would be reaching into
// that machine. `disengage` is the owner OR the human who engaged it: ending an
// agent's standing attention to your own messages is not the same act as
// parking someone else's process. The service enforces all three; a caller
// without the right gets 403 CHANNEL_AGENT_FORBIDDEN and an id that names no
// agent of this channel gets 404.
async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, ChannelAgentUpdateSchema);
    const ctx = buildChannelContext(auth);
    const channelId = requireChannelId(auth.params);
    const agentId = requireAgentId(auth.params);
    switch (input.op) {
      case "rename":
        return NextResponse.json({
          agent: await renameAgent(ctx, channelId, agentId, input.name),
        });
      case "set_status":
        return NextResponse.json({
          agent: await setAgentStatus(ctx, channelId, agentId, input.status),
        });
      case "disengage":
        return NextResponse.json({
          agent: await disengageAgent(ctx, channelId, agentId),
        });
    }
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "member" });
