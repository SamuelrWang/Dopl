import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import { DirectionDecideSchema } from "@/features/channels/schema";
import {
  buildChannelContext,
  decideAgentDirection,
} from "@/features/channels/server/service";

/**
 * Desktop lane — DECIDE: the machine reports the outcome and, on delivery, the
 * directed turn's final text.
 *
 * 🔒 The one route private-lane text enters the server by: only the directed turn's
 * final text goes back off-machine — never narration, thinking, tool calls, other
 * turns, or operator input. The desktop enforces capture; this route bounds/stores.
 * ⚠ NOT `sessionOnly` (device-token caller); fenced on `operator_user_id` in SQL.
 * ⚠ A CAS: only an undecided row moves; a retry 409s rather than flipping outcome.
 * ⚠ `reply` optional on `delivered`: `null` = not reported, never "said nothing".
 */
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, DirectionDecideSchema);
    const ctx = buildChannelContext(auth);
    const direction = await decideAgentDirection(
      ctx,
      input.directionId,
      input.status === "delivered"
        ? { status: "delivered", reply: input.reply }
        : { status: "refused", refusalReason: input.refusalReason }
    );
    return NextResponse.json({ direction });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const POST = withWorkspaceAuth(handlePost);
