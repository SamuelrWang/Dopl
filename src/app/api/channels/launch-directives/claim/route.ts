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
 * Desktop lane — CLAIM: one of the operator's machines takes a pending directive,
 * single-winner.
 *
 * ⚠ NOT `sessionOnly` (the set `write-gate-coverage.test.ts` guards): the caller IS
 * the desktop's device token, so a session gate would delete the feature.
 * 🔒 The bound is scope, not credential type: only rows with `operator_user_id =
 * ctx.userId` move, in the SQL predicate (`repository-launch.ts › claimLaunchDirective`).
 * A foreign id 404s like absent; claiming is a status flip, not a launch.
 * Contrast `channels/consent/[id]` (sessionOnly — a human decision to protect); here
 * consent is the desktop's local toggle (`no-bridge`).
 *
 * ⚠ 409 `LAUNCH_DIRECTIVE_NOT_CLAIMABLE` is normal (lost CAS): stand down, never
 * retry or log as an error.
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
