import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { requireChannelId, toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  buildChannelContext,
  createTask,
  listChannelTasks,
} from "@/features/channels/server/service";
import { TaskCreateSchema } from "@/features/channels/schema";

// Channel tasks: GET lists, POST creates. NOT sessionOnly — task ops arrive over the MCP device
// token; the service enforces channel-scoped authorization.
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    const { threads, truncated } = await listChannelTasks(
      ctx,
      requireChannelId(auth.params)
    );
    // `tasks` keeps the storage name. `truncated` is ADDITIVE and load-bearing:
    // the list is bounded and threads never leave it, so a caller that cannot
    // tell a clipped page from an exhausted one will present a partial list as
    // the whole one (INVARIANTS §9).
    return NextResponse.json({ tasks: threads, truncated });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, TaskCreateSchema);
    const ctx = buildChannelContext(auth);
    const { thread, openingSeq } = await createTask(
      ctx,
      requireChannelId(auth.params),
      input
    );
    // `task` keeps the storage name (web + @dopl/client read it). `openingSeq` is additive: the
    // seq of the thread's opening message, so a requester arms `await` on the right cursor
    // without a follow-up read. ⚠ Null only when the idempotent short-circuit returned another
    // member's thread.
    return NextResponse.json({ task: thread, openingSeq }, { status: 201 });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });
