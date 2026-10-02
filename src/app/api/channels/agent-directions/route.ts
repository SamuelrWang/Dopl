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
 * File a private direction: an operator's external agent steering one of that
 * operator's own running sessions (Samuel's ruling, 2026-08-31).
 *
 * ⚠ The operator is `ctx.userId`; no schema or service signature on this path
 * accepts an operator id (asserted in `service-directions.test.ts`).
 * ⚠ Deliberately NOT `sessionOnly`: the caller IS an agent token. The gate is the
 * desktop's local toggle (it ignores rows when off) — the server cannot verify it.
 * ⚠ Viewer floor; the real fence is the service's membership-row requirement.
 * 🔒 A direction is not a message and never touches `channel_messages` (INVARIANTS
 * §5) — it is private by definition.
 */
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, DirectionCreateSchema);
    const ctx = buildChannelContext(auth);
    const result = await createAgentDirection(ctx, input);
    // ⚠ Offline machine → 200 with `offline: true` and no row, not a 4xx: a closed
    // laptop is not a fault (the launch lane's rule).
    return NextResponse.json(result);
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

/**
 * Breaker-open backstop read: directions still awaiting this operator's machine.
 * Exists because a sleeping/reconnecting desktop misses realtime INSERTs (F-273).
 * ⚠ Operator-scoped in the SQL predicate — unfenced, any device token would read
 * other operators' private direction bodies.
 * ⚠ Returns `pending` + `claimed` (a crashed claimer must find its row); expiry is
 * applied in the service.
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
