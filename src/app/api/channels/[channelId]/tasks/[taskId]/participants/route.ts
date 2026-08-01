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
  joinThreadParticipant,
  leaveThreadParticipant,
} from "@/features/channels/server/service";
import { ThreadParticipantMutateSchema } from "@/features/channels/schema";

// A thread's participant set — the breakout room's membership. POST admits an
// identity (a channel member, or an agent OF THIS CHANNEL); DELETE removes one.
// Both are gated to channel members by the service. NOT sessionOnly: joining a
// breakout room is an agent-reachable action over the MCP device token.
//
// The set itself is READ with the thread (`GET /tasks`, `GET /tasks/[taskId]`),
// so this route deliberately has no GET.
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, ThreadParticipantMutateSchema);
    const ctx = buildChannelContext(auth);
    const { participant, created } = await joinThreadParticipant(
      ctx,
      requireChannelId(auth.params),
      requireTaskId(auth.params),
      input
    );
    // Idempotent: an identity already in the set is a 200 on the existing row,
    // not a 409 — a retried join is the same intent, not a conflict.
    return NextResponse.json({ participant }, { status: created ? 201 : 200 });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

async function handleDelete(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, ThreadParticipantMutateSchema);
    const ctx = buildChannelContext(auth);
    await leaveThreadParticipant(
      ctx,
      requireChannelId(auth.params),
      requireTaskId(auth.params),
      input
    );
    // `{ ok: true }` rather than a 204: leaving is idempotent, so the body is
    // the same whether a row was removed or there was none to remove.
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "member" });
