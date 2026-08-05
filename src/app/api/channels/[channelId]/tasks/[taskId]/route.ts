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
  closeTask,
  getChannelTask,
  proposeTaskClose,
  reopenTask,
  setTaskMode,
} from "@/features/channels/server/service";
import { TaskUpdateSchema } from "@/features/channels/schema";

// GET one task by id (get_task, read). Same visibility rule as the transcript;
// a task not in this channel collapses to 404 so the id can't be probed. NOT
// sessionOnly — reachable over the MCP device token like the other task reads.
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

// PATCH a task: close it (creator or target), set its mode (creator only), or
// reopen a closed one (creator or target — web-only, no MCP op). NOT
// sessionOnly — task ops are agent actions invoked over the MCP device token;
// the service enforces the per-op authorization.
async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, TaskUpdateSchema);
    const ctx = buildChannelContext(auth);
    const channelId = requireChannelId(auth.params);
    const taskId = requireTaskId(auth.params);
    switch (input.op) {
      case "close": {
        const { thread, echoSeq } = await closeTask(
          ctx,
          channelId,
          taskId,
          input.outcome,
          input.summary
        );
        // `task` keeps the storage name (the web + @dopl/client both read it).
        // `echoSeq` is additive, mirroring `openingSeq` on thread create: the
        // seq of the lifecycle marker this close posted, so a requester can arm
        // `await` past it instead of guessing (a guess once skipped a peer's
        // deliverable outright). Null when the close landed but the echo did
        // not — a caller must never treat that as "one past the last seq".
        return NextResponse.json({ task: thread, echoSeq });
      }
      // DECISION 2 (2026-08-04) — the AGENT's terminal act. It writes nothing to
      // the task row: the thread stays open and every routing property of it is
      // unchanged. All it posts is a marked, non-terminal `task_progress` the
      // human's surfaces render as a confirmable prompt. `markerSeq` mirrors
      // `echoSeq` above so a proposing agent can arm a wait past its own marker
      // instead of guessing a seq (the guess that once skipped a deliverable).
      case "propose_close": {
        const { thread, markerSeq, outcome } = await proposeTaskClose(
          ctx,
          channelId,
          taskId,
          input.outcome,
          input.summary
        );
        return NextResponse.json({ task: thread, markerSeq, proposedOutcome: outcome });
      }
      case "set_mode":
        return NextResponse.json({
          task: await setTaskMode(ctx, channelId, taskId, input.mode),
        });
      case "reopen":
        return NextResponse.json({
          task: await reopenTask(ctx, channelId, taskId),
        });
    }
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "member" });
