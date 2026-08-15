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

// PATCH: close (creator or target), set mode (creator only), or reopen (creator or target — no
// MCP op, but the route stays agent-reachable and `reopenTask`'s echo is built for that lane).
// NOT sessionOnly — the service enforces per-op authorization.
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
        // `task` keeps the storage name (web + @dopl/client read it). `echoSeq` is additive: the
        // seq of the lifecycle marker this close posted, so a requester arms `await` past it
        // rather than guessing (a guess once skipped a peer's deliverable).
        // ⚠ Null means the close landed but the echo did not — never "one past the last seq".
        return NextResponse.json({ task: thread, echoSeq });
      }
      // ⚠ The AGENT's terminal act writes NOTHING to the task row — the thread stays open and
      // every routing property is unchanged. It posts a marked, non-terminal `task_progress` the
      // human's surfaces render as a confirmable prompt. `markerSeq` mirrors `echoSeq` above.
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
      // ⚠ Reopen must ECHO: `channel_tasks` is in neither realtime table set, so a silent reopen
      // leaves the OTHER member's card, chip and sidebar dot reading "closed" until an unrelated
      // message lands. The echo rides the `channel_messages` doorbell both clients subscribe to.
      // `echoSeq` is null when the reopen landed but the marker did not, or when the thread was
      // already open and this call wrote nothing.
      case "reopen": {
        const { thread, echoSeq } = await reopenTask(ctx, channelId, taskId);
        return NextResponse.json({ task: thread, echoSeq });
      }
    }
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "member" });
