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
 * Named-agent ATTRIBUTION roster — READ ONLY. Named agents are gone; this GET survives for one
 * consumer: the transcript resolving a stored `metadata.author_agent_id` to the handle it
 * rendered under. ⚠ Delete only when historical attribution stops mattering — the messages
 * outlive the feature.
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

export const GET = withWorkspaceAuth(handleGet);
