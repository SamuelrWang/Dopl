import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import { LaunchDecideSchema } from "@/features/channels/schema";
import {
  buildChannelContext,
  decideLaunchDirective,
} from "@/features/channels/server/service";

/**
 * **THE DESKTOP LANE — DECIDE.** The machine reports what it did: `launched`
 * with the agent instance id, or `refused` with one of the six words.
 *
 * ⚠ NOT `sessionOnly`, for the identical reason the claim route is not — the
 * caller is a device token by construction. Read that file's docblock; the
 * argument is stated once, there.
 *
 * ⚠ SCOPED THE SAME WAY: the UPDATE matches `operator_user_id = ctx.userId`, so
 * a machine can only report on its own operator's directives.
 *
 * ⚠ **A DECISION IS FINAL, ENFORCED AS A CAS.** The UPDATE also matches
 * `status IN ('pending','claimed')`, so a retried or duplicated decide answers
 * 409 rather than flipping a `launched` into a `refused`. That matters because
 * the requester may already have read the first outcome and started addressing
 * `@<agentId>`.
 *
 * ⚠ **AN EXPIRED DIRECTIVE MAY STILL BE DECIDED.** If the machine really started
 * an agent, `launched` is the truthful record however late it is — refusing the
 * write would leave a running agent no directive accounts for. Expiry governs
 * whether a NEW claim may begin, not whether a finished one may be reported.
 *
 * ⚠ THE SHAPE IS A DISCRIMINATED UNION: `launched` requires `agentId`, `refused`
 * requires `refusalReason`, and the column CHECK says the same at rest. There is
 * no way to report a refusal without saying why.
 */
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, LaunchDecideSchema);
    const ctx = buildChannelContext(auth);
    const directive = await decideLaunchDirective(
      ctx,
      input.directiveId,
      input.status === "launched"
        ? { status: "launched", agentId: input.agentId }
        : { status: "refused", refusalReason: input.refusalReason }
    );
    return NextResponse.json({ directive });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const POST = withWorkspaceAuth(handlePost);
