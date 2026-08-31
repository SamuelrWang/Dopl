import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  buildChannelContext,
  getAgentDirection,
} from "@/features/channels/server/service";

/**
 * POLL ONE DIRECTION — what the MCP op's bounded hold reads, and where the
 * `reply` comes back.
 *
 * 🔒 **THIS IS THE ROUTE THE PRIVATE TURN'S ANSWER LEAVES BY, so its fence is the
 * one to check first.** `repository-directions.ts › findAgentDirection` predicates
 * on `operator_user_id` in the SQL itself; a direction belonging to another
 * operator is INVISIBLE (404), never forbidden, so the id cannot be probed and the
 * `reply` cannot be reached by anybody but the person whose agent produced it.
 *
 * ⚠ 404 FOR ALL THREE CAUSES — absent, another operator's, another workspace's.
 * Distinguishing them would rebuild the probe the single error exists to deny.
 */
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    const direction = await getAgentDirection(ctx, auth.params?.directionId ?? "");
    return NextResponse.json({ direction });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
