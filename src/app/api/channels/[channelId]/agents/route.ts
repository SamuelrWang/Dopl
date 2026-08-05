import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { requireChannelId, toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  buildChannelContext,
  listAgents,
} from "@/features/channels/server/service";

/**
 * The named-agent ATTRIBUTION roster — READ ONLY, and the last route of the
 * multiplayer surface.
 *
 * `POST` (summon) lived here and `PATCH` / rename / status / disengage lived at
 * `agents/[agentId]`; all of them are gone with named agents (rollback §1),
 * along with the whole lifecycle they drove. This GET survives for exactly one
 * consumer: the transcript resolving a stored `metadata.author_agent_id` to the
 * handle it rendered under. Delete it when historical attribution stops
 * mattering, not before — the messages outlive the feature.
 *
 * Agent-reachable over the MCP device token — NOT sessionOnly — and the service
 * enforces the channel's own visibility rule.
 */
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    const agents = await listAgents(ctx, requireChannelId(auth.params));
    return NextResponse.json({ agents });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
