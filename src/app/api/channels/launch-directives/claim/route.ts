import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import { LaunchClaimSchema } from "@/features/channels/schema";
import {
  buildChannelContext,
  claimLaunchDirective,
} from "@/features/channels/server/service";

/**
 * **THE DESKTOP LANE — CLAIM.** One of the operator's machines takes a pending
 * directive, single-winner.
 *
 * ── WHY THIS IS **NOT** `sessionOnly`, WRITTEN OUT BECAUSE NARROWING THIS SET IS
 *    THE EXACT MOVE `write-gate-coverage.test.ts` EXISTS TO CATCH ───────────────
 * `sessionOnly` means "a cookie session, never an agent/device token". **The
 * caller here IS a device token** — the desktop main process, which holds a
 * 90-day agent credential and has no cookie and no browser. Gating this to a
 * session would make the claim unreachable by the only client that can ever make
 * it, i.e. it would not harden the feature, it would delete it.
 *
 * ⚠ **SO THE BOUND IS SCOPE, NOT CREDENTIAL TYPE, AND IT HAS TO BE STATED
 * SOMEWHERE A REVIEWER WILL LOOK.** The claim moves ONLY a row whose
 * `operator_user_id` equals `ctx.userId` — enforced in the SQL predicate itself
 * (`repository-launch.ts › claimLaunchDirective`), not in a branch above it. So
 * the worst a stolen or misused device token can do is claim ITS OWN operator's
 * directives, which is the thing that token is for. It cannot enumerate (the
 * body is one uuid and a foreign id answers 404, indistinguishable from absent),
 * cannot start an agent (claiming is a status flip; the launch happens on the
 * machine), and cannot un-decide anything.
 *
 * ⚠ THE COMPARISON THAT MAKES THIS CONSISTENT: `channels/consent/[id]` IS
 * `sessionOnly` because a contained session reading its own bearer off disk could
 * self-approve its own outbound reply — the human is the point of that gate. Here
 * there is no human decision to bypass: the operator's consent is the desktop's
 * LOCAL TOGGLE, expressed by the machine refusing with `no-bridge`.
 *
 * ⚠ 409 IS A NORMAL OUTCOME, NOT A FAULT. Several of an operator's machines see
 * the same INSERT frame and all try; exactly one wins the CAS and the rest get
 * `LAUNCH_DIRECTIVE_NOT_CLAIMABLE`. A loser must STAND DOWN — never retry, never
 * log it as an error.
 */
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, LaunchClaimSchema);
    const ctx = buildChannelContext(auth);
    const directive = await claimLaunchDirective(ctx, input.directiveId);
    return NextResponse.json({ directive });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const POST = withWorkspaceAuth(handlePost);
