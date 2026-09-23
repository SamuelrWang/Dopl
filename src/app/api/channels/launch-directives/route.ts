import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import { LaunchCreateSchema } from "@/features/channels/schema";
import {
  buildChannelContext,
  createLaunchDirective,
  listPendingLaunchDirectives,
} from "@/features/channels/server/service";

/** File a launch directive: an operator's own agent asks that operator's own desktop to start an agent.
 *  The operator is `ctx.userId`; there is no body field for it.
 *  Not `sessionOnly`: the caller is an agent token over MCP, and the consent is the desktop's local
 *  toggle (the machine refuses `no-bridge` when it is off), which the server cannot see.
 *  `minRole` stays at the viewer floor because the service requires channel membership.
 *  A directive is not a message and never touches `channel_messages`. */
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, LaunchCreateSchema);
    const ctx = buildChannelContext(auth);
    // Passed through whole: a hand-enumerated field list dropped validated fields (F-708).
    const result = await createLaunchDirective(ctx, input);
    // `offline: true` is a 200: nothing failed and no row was created (a closed laptop).
    return NextResponse.json(result);
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

/** Breaker-open backstop (F-273): this operator's pending and claimed directives, for a desktop that
 *  missed the realtime INSERT. Operator-scoped in the SQL predicate. The envelope is `{ directives }`,
 *  which `main/launch-directives.js › pollWorkspace` reads. */
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    const directives = await listPendingLaunchDirectives(ctx);
    return NextResponse.json({ directives });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost);
