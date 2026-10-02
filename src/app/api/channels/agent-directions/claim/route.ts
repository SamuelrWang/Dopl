import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import { DirectionClaimSchema } from "@/features/channels/schema";
import {
  buildChannelContext,
  claimAgentDirection,
} from "@/features/channels/server/service";

/**
 * Desktop lane — CLAIM: one of the operator's machines takes a pending direction,
 * single-winner.
 *
 * ⚠ NOT `sessionOnly`: the caller IS the desktop's device token (argument at length
 * in `launch-directives/claim/route.ts`).
 * 🔒 Bound by scope: only rows with `operator_user_id = ctx.userId` move, in the SQL
 * predicate; a foreign id 404s like absent; claiming is a status flip.
 *
 * ⚠ 409 `CHANNEL_DIRECTION_NOT_CLAIMABLE` is normal (lost CAS): stand down, never
 * retry — two winners would deliver (and answer) twice.
 */
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, DirectionClaimSchema);
    const ctx = buildChannelContext(auth);
    const direction = await claimAgentDirection(ctx, input.directionId);
    return NextResponse.json({ direction });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const POST = withWorkspaceAuth(handlePost);
