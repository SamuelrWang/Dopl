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
 * **THE DESKTOP LANE — DECIDE.** The machine reports what happened, and, on a
 * delivery, hands back the directed turn's final text.
 *
 * 🔒 **THIS IS THE ONE ROUTE PRIVATE-LANE TEXT ENTERS THE SERVER BY, AND THE RULE
 * GOVERNING IT IS NOT NEGOTIABLE:** a direction that arrived from off-machine gets
 * an answer that goes back off-machine, and NOTHING ELSE in the private lane ever
 * does — not the narration ring, not thinking frames, not tool calls, not any
 * other turn, and never anything the OPERATOR typed into their own panel. The
 * desktop is what enforces that (it captures exactly one turn's final text); this
 * route bounds and stores what it sends.
 *
 * ⚠ NOT `sessionOnly`, for the claim route's reason — the caller is a device
 * token by construction. The fence is `operator_user_id` in the SQL predicate, so
 * a machine can only write back to its own operator's rows.
 *
 * ⚠ **A DECIDE IS A CAS TOO.** Only a row that has not already been decided may
 * move, so a machine that lost the claim race cannot overwrite the winner's
 * result, and a retried decide answers 409 rather than flipping a `delivered` to a
 * `refused`.
 *
 * ⚠ `reply` IS OPTIONAL ON A `delivered`, deliberately: an empty final text and a
 * desktop older than the capture are both honest deliveries. `null` means NOT
 * REPORTED, never "the agent said nothing", and the MCP render says which it
 * cannot tell.
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
