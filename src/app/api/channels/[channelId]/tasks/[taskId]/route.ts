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
  deleteTask,
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

// DELETE: hard-delete the thread and everything hanging off it — creator, or
// someone who can manage the channel. 204, no body: there is nothing left to
// return. The service (`service-tasks-delete.ts › deleteTask`) owns the
// authorization and the cascade's ordering.
//
// ⚠ THIS IS NOT A CLOSE. Threads still have no finished state (INVARIANTS §5);
// this is how one stops existing. Nothing here writes `status`.
async function handleDelete(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    await deleteTask(
      ctx,
      requireChannelId(auth.params),
      requireTaskId(auth.params)
    );
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "member" });
// ⚠ `sessionOnly` — pinned by `src/shared/auth/write-gate-coverage.test.ts`, and
// PER-METHOD, so the GET and the PATCH above are untouched. An agent token
// (`dopl_at_*`) is refused: this deletes a SHARED transcript permanently, with no
// dialog on the agent's side to gate it, and "no destructive ops over MCP" is the
// standing rule the MCP surface is built on. There is no `dopl_channel` op that
// reaches this and there must not be one.
export const DELETE = withWorkspaceAuth(handleDelete, {
  minRole: "member",
  sessionOnly: true,
});
