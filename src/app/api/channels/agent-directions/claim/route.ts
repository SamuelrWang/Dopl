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
 * **THE DESKTOP LANE — CLAIM.** One of the operator's machines takes a pending
 * direction, single-winner.
 *
 * ── WHY THIS IS **NOT** `sessionOnly` ──────────────────────────────────────────
 * `sessionOnly` means "a cookie session, never an agent/device token". **The
 * caller here IS a device token** — the desktop main process, which holds a 90-day
 * agent credential and has no cookie and no browser. Gating this to a session
 * would make the claim unreachable by the only client that can ever make it: it
 * would not harden the feature, it would delete it. The launch lane's claim route
 * carries the same argument at length.
 *
 * ⚠ **SO THE BOUND IS SCOPE, NOT CREDENTIAL TYPE.** The claim moves ONLY a row
 * whose `operator_user_id` equals `ctx.userId`, enforced in the SQL predicate
 * itself. The worst a misused device token can do is claim ITS OWN operator's
 * directions — which is what that token is for. It cannot enumerate (the body is
 * one uuid and a foreign id answers 404, indistinguishable from absent) and it
 * cannot deliver anything: claiming is a status flip, and the delivery happens
 * inside the machine's own session registry.
 *
 * ⚠ 409 IS A NORMAL OUTCOME, NOT A FAULT. Several of an operator's machines see
 * the same INSERT frame and all try; exactly one wins the CAS and the rest get
 * `CHANNEL_DIRECTION_NOT_CLAIMABLE`. A loser must STAND DOWN — never retry, never
 * log it as an error. On this lane the cost of getting that wrong is higher than
 * on the launch lane: two winners would deliver the same direction into the same
 * agent twice, and it would answer twice.
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
