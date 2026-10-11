import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { requireChannelId, toChannelErrorResponse, channelWorkspace } from "@/shared/api/channel-route";
import {
  buildChannelContext,
  listAgents,
} from "@/features/channels/server/service";

/**
 * Named-agent ATTRIBUTION roster — READ ONLY: resolves a stored `metadata.author_agent_id` to
 * the handle it rendered under. ⚠ It has NO client caller since the v2 cutover (2026-08-18,
 * F-218; `channels/client/api.ts`'s Agents note). Delete only when historical attribution
 * stops mattering — the messages outlive the feature.
 * NOT sessionOnly; the service enforces the channel's visibility rule.
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

export const GET = withWorkspaceAuth(handleGet, { workspaceFromParams: channelWorkspace });
