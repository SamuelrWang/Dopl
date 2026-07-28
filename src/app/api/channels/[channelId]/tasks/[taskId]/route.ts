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
  setTaskMode,
} from "@/features/channels/server/service";
import { TaskUpdateSchema } from "@/features/channels/schema";

// PATCH a task: close it (creator or target) OR set its mode (creator only).
// NOT sessionOnly — task ops are agent actions invoked over the MCP device
// token; the service enforces the per-op authorization.
async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, TaskUpdateSchema);
    const ctx = buildChannelContext(auth);
    const channelId = requireChannelId(auth.params);
    const taskId = requireTaskId(auth.params);
    const task =
      input.op === "close"
        ? await closeTask(ctx, channelId, taskId, input.outcome, input.summary)
        : await setTaskMode(ctx, channelId, taskId, input.mode);
    return NextResponse.json({ task });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "member" });
