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
 * with the agent instance id (a LAUNCH), `done` (an `end`, `rename` or
 * `set_agent_mode` that landed), or `refused` with one of the closed words.
 *
 * ⚠ **ONE ROUTE FOR EVERY KIND, DELIBERATELY.** A directive's LIFECYCLE does not
 * depend on which verb it carries, so claim, decide, the by-id poll and the
 * pending backstop are all shared; only the CREATE splits, because a launch's
 * body and an end's have nothing in common. A second decide route would be a
 * second place for the finality CAS to be got wrong.
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
 * no way to report a refusal without saying why. ⚠ `done` carries only
 * `set_agent_mode`'s optional posture echo and must not grow an id: an end and a
 * rename already NAME their target in the row, so a second id here would be a field
 * the machine could get wrong about a row it did not write.
 */
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, LaunchDecideSchema);
    const ctx = buildChannelContext(auth);
    // ⚠ PASSED THROUGH, NEVER RE-BUILT PER ARM: a hand-copied arm silently drops a validated
    // field (F2). An absent echo field stays `undefined`, which the service writes as `null` =
    // "not reported" — never the row's request columns.
    const { directiveId, ...decision } = input;
    const directive = await decideLaunchDirective(ctx, directiveId, decision);
    return NextResponse.json({ directive });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const POST = withWorkspaceAuth(handlePost);
