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
  reopenTask,
  setTaskMode,
} from "@/features/channels/server/service";
import type { ChannelTask } from "@/features/channels/types";
import { TaskUpdateSchema } from "@/features/channels/schema";

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
    let task: ChannelTask;
    switch (input.op) {
      case "close":
        task = await closeTask(ctx, channelId, taskId, input.outcome, input.summary);
        break;
      case "set_mode":
        task = await setTaskMode(ctx, channelId, taskId, input.mode);
        break;
      case "reopen":
        task = await reopenTask(ctx, channelId, taskId);
        break;
    }
    return NextResponse.json({ task });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "member" });
