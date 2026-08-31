import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  buildChannelContext,
  listRecentAgentDirections,
} from "@/features/channels/server/service";

/**
 * THE ORCHESTRATOR'S OWN RECENT DIRECTIONS — what `dopl_channel(op="read_directions")`
 * renders.
 *
 * ⚠ **A SIBLING ROUTE, NOT A MODE ON THE ROOT GET, AND THE TWO ANSWER DIFFERENT
 * QUESTIONS.** The root `GET /agent-directions` is the DESKTOP's backstop: "what
 * does this machine still owe an answer on", non-terminal rows only, expired
 * dropped. This one is the ORCHESTRATOR's: "what did I ask, and what came back",
 * which must include the terminal rows because **the `reply` is the whole point**.
 * Collapsing them behind a query flag would put two audiences and two row filters
 * behind one signature.
 *
 * 🔒 **SAME FENCE, UNCHANGED.** `operator_user_id = ctx.userId` lives in the SQL
 * predicate (`repository-directions.ts › listRecentAgentDirections`); `channel` and
 * `agent` are optional NARROWINGS on top of it and never a way around it. That
 * matters more here than on any other read in this lane, because these rows carry
 * the private turns' answers.
 *
 * ⚠ THE FILTERS ARE PASSED THROUGH UNVALIDATED AND THAT IS SAFE BY CONSTRUCTION:
 * they only ever ADD `.eq()` predicates to a query already fenced on the operator,
 * so the worst a junk value achieves is an empty list.
 */
async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    const url = new URL(request.url);
    const directions = await listRecentAgentDirections(ctx, {
      channelId: url.searchParams.get("channel") ?? undefined,
      agentId: url.searchParams.get("agent") ?? undefined,
    });
    return NextResponse.json({ directions });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
