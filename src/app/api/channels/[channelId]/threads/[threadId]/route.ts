import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import {
  requireChannelId,
  requireThreadId,
  toChannelErrorResponse,
  channelWorkspace,
} from "@/shared/api/channel-route";
import {
  buildChannelContext,
  deleteThread,
  getChannelThread,
  setThreadMode,
} from "@/features/channels/server/service";
import { ThreadUpdateSchema } from "@/features/channels/schema";

// GET one thread by id. ⚠ A thread not in this channel collapses to 404 so the id cannot be probed.
// NOT sessionOnly — reachable over the MCP device token like the other thread reads.
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    const thread = await getChannelThread(
      ctx,
      requireChannelId(auth.params),
      requireThreadId(auth.params)
    );
    return NextResponse.json({ thread });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

// PATCH: set mode (creator only). NOT sessionOnly — the service enforces per-op authorization.
// Threads do not close; a stale `{op:"close"}` is refused by `ThreadUpdateSchema`.
async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, ThreadUpdateSchema);
    const ctx = buildChannelContext(auth);
    const channelId = requireChannelId(auth.params);
    const threadId = requireThreadId(auth.params);
    return NextResponse.json({
      thread: await setThreadMode(ctx, channelId, threadId, input.mode),
    });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

// DELETE: hard-delete the thread and its dependents (creator or channel manager);
// auth + cascade order live in `service-threads-delete.ts › deleteThread`.
// ⚠ Not a close — threads have no finished state (INVARIANTS §5).
async function handleDelete(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    await deleteThread(
      ctx,
      requireChannelId(auth.params),
      requireThreadId(auth.params)
    );
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

// ⚠ GET at guest (INVARIANTS §4A, §2B; channel fence is the true gate).
export const GET = withWorkspaceAuth(handleGet, { workspaceFromParams: channelWorkspace, minRole: "guest" });
export const PATCH = withWorkspaceAuth(handlePatch, { workspaceFromParams: channelWorkspace, minRole: "member" });
// ⚠ `sessionOnly` (pinned by `write-gate-coverage.test.ts`): permanently deletes a
// shared transcript, and "no destructive ops over MCP" is standing. No
// `dopl_channel` op may reach this.
export const DELETE = withWorkspaceAuth(handleDelete, {
  workspaceFromParams: channelWorkspace,
  minRole: "member",
  sessionOnly: true,
});
