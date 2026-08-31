import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import { DirectionCreateSchema } from "@/features/channels/schema";
import {
  buildChannelContext,
  createAgentDirection,
  listPendingAgentDirections,
} from "@/features/channels/server/service";

/**
 * FILE A PRIVATE DIRECTION — an operator's own external agent steering one of
 * that operator's own running agent sessions (Samuel's ruling, 2026-08-31).
 *
 * ⚠ **THE OPERATOR IS `ctx.userId` AND THERE IS NO BODY FIELD FOR IT.** An agent
 * may direct its own operator's machine and no other; the way that stays true is
 * that no schema and no service signature on this path accepts an operator id.
 * `service-directions.test.ts` asserts the absence rather than trusting review.
 *
 * ⚠ **NOT `sessionOnly`, DELIBERATELY, AND FOR THE LAUNCH LANE'S REASON.** The
 * caller here IS an agent token — an external Claude Desktop / Claude Code session
 * over MCP. Gating this to a cookie session would make the op unreachable by the
 * only caller it exists for. The consent that replaces the session gate is the
 * same shape Samuel already ruled for launching: a LOCAL TOGGLE on the desktop,
 * enforced by the machine that would deliver, which simply ignores the row when it
 * is off. ⚠ That is a real trade and it is stated rather than buried: the server
 * cannot verify the toggle, so the server is not the gate — the desktop is, and
 * the desktop is the only party that can be.
 *
 * ⚠ `minRole` stays at the viewer floor because the CHANNEL fence is the real one:
 * the service requires a MEMBERSHIP ROW, not merely readability, so a public
 * channel the caller never joined is refused.
 *
 * 🔒 **A DIRECTION IS NOT A MESSAGE** and never touches `channel_messages` — the
 * loop brake and transcript purity (INVARIANTS §5), plus the third reason that is
 * this lane's own: it is PRIVATE BY DEFINITION, so the shared transcript is not a
 * trade-off but the feature's negation.
 */
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, DirectionCreateSchema);
    const ctx = buildChannelContext(auth);
    const result = await createAgentDirection(ctx, input);
    // ⚠ 200 WITH `offline: true`, NOT AN ERROR STATUS — the launch lane's rule.
    // Nothing failed: the server looked, the operator's machine is not reporting
    // in, and NO ROW WAS CREATED. A 4xx here would render a fault for the most
    // ordinary outcome there is, a closed laptop.
    return NextResponse.json(result);
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

/**
 * **THE BREAKER-OPEN BACKSTOP READ** — what is still awaiting this operator's
 * machine, in this workspace.
 *
 * ⚠ WHY IT EXISTS: realtime is the delivery path, and a desktop that was asleep,
 * reconnecting, or whose subscription went unhealthy never sees the INSERT frame.
 * The launch lane shipped without this route and its backstop self-disabled on the
 * first 404 (F-273); this one ships with it.
 *
 * ⚠ OPERATOR-SCOPED IN THE SQL PREDICATE rather than a branch above it. This is a
 * LIST, so the fence matters more than on the by-id read — and on THIS lane an
 * unfenced version would hand every device token other operators' private
 * direction bodies.
 *
 * ⚠ RETURNS `pending` AND `claimed`, EXPIRED DROPPED. A machine that claimed and
 * crashed must find its own row again; expiry is applied by the service, where the
 * lazy rule has its one home.
 */
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    const directions = await listPendingAgentDirections(ctx);
    return NextResponse.json({ directions });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost);
