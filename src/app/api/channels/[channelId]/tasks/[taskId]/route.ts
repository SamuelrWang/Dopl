import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import {
  requireChannelId,
  requireTaskId,
  toChannelErrorResponse,
} from "@/shared/api/channel-route";
import {
  buildChannelContext,
  getChannelTask,
  setTaskMode,
} from "@/features/channels/server/service";
import { TaskUpdateSchema } from "@/features/channels/schema";

// GET one task by id. ⚠ A task not in this channel collapses to 404 so the id cannot be probed.
// NOT sessionOnly — reachable over the MCP device token like the other task reads.
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    const task = await getChannelTask(
      ctx,
      requireChannelId(auth.params),
      requireTaskId(auth.params)
    );
    return NextResponse.json({ task });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

// PATCH: set mode (creator only). NOT sessionOnly — the service enforces per-op authorization.
//
// ⚠ THE CLOSE / PROPOSE_CLOSE / REOPEN ARMS ARE GONE (wiring plan Phase 4, 2026-08-18) along with
// `service-tasks-lifecycle.ts` and `service-tasks-propose.ts`. Threads do not close, so this
// handler has exactly one op left and the switch is a single case rather than a lookup. A stale
// caller sending `{op:"close"}` is refused by `TaskUpdateSchema`'s discriminator, before here.
async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, TaskUpdateSchema);
    const ctx = buildChannelContext(auth);
    const channelId = requireChannelId(auth.params);
    const taskId = requireTaskId(auth.params);
    // `task` keeps the storage name — web + @dopl/client both read that key.
    return NextResponse.json({
      task: await setTaskMode(ctx, channelId, taskId, input.mode),
    });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "member" });
