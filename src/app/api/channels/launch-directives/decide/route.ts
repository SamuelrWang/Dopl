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

/** Desktop lane: the machine reports `launched` (with the agent id), `done` (an end, rename or
 *  re-posture that landed) or `refused` (a closed word). One route for every kind.
 *  Not `sessionOnly`: the caller is a device token. The UPDATE is scoped to
 *  `operator_user_id = ctx.userId` and a decision is final (see `decideLaunchDirective`). */
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, LaunchDecideSchema);
    const ctx = buildChannelContext(auth);
    // Passed through, never re-built per arm: a hand-copied arm drops validated fields (F-708).
    const { directiveId, ...decision } = input;
    const directive = await decideLaunchDirective(ctx, directiveId, decision);
    return NextResponse.json({ directive });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const POST = withWorkspaceAuth(handlePost);
