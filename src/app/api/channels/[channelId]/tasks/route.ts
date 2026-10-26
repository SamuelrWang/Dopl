import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson, parseQuery } from "@/shared/api/parse-json";
import { requireChannelId, toChannelErrorResponse, channelWorkspace } from "@/shared/api/channel-route";
import {
  applyTaskAction,
  buildChannelContext,
  listChannelTasks,
  readChannelTask,
} from "@/features/channels/server/service";
import { TaskActionSchema, TaskQuerySchema } from "@/features/channels/schema";

// Channel tasks: GET lists (or reads one with `?task=`), POST applies one action. The service holds
// every gate; there is no DELETE (R10).
async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const query = parseQuery(request.nextUrl.searchParams, TaskQuerySchema, ["task", "status"]);
    const ctx = buildChannelContext(auth);
    const ref = requireChannelId(auth.params);
    if (query.task !== undefined) {
      return NextResponse.json({ task: await readChannelTask(ctx, ref, query.task) });
    }
    // `truncated` is load-bearing (INVARIANTS §9).
    return NextResponse.json(await listChannelTasks(ctx, ref, query.status ?? null));
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, TaskActionSchema);
    const result = await applyTaskAction(
      buildChannelContext(auth),
      requireChannelId(auth.params),
      input
    );
    return NextResponse.json(result, { status: input.action === "create" ? 201 : 200 });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

// Both at guest: the floor is a tripwire; the service admits a guest to reads and notes only (R8).
export const GET = withWorkspaceAuth(handleGet, { workspaceFromParams: channelWorkspace, minRole: "guest" });
export const POST = withWorkspaceAuth(handlePost, { workspaceFromParams: channelWorkspace, minRole: "guest" });
