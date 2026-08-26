import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson, parseQuery } from "@/shared/api/parse-json";
import { requireChannelId, toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  buildChannelContext,
  postMessage,
  readMessages,
} from "@/features/channels/server/service";
import {
  ChannelMessageCreateSchema,
  MessageReadQuerySchema,
} from "@/features/channels/schema";

async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    // `thread` is a FILTER on metadata.taskId, not a lookup: an id nothing carries returns [].
    // The await path deliberately has no counterpart.
    const query = parseQuery(request.nextUrl.searchParams, MessageReadQuerySchema, [
      "since",
      "limit",
      "thread",
    ]);
    const ctx = buildChannelContext(auth);
    const messages = await readMessages(ctx, requireChannelId(auth.params), query);
    return NextResponse.json({ messages });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, ChannelMessageCreateSchema);
    const ctx = buildChannelContext(auth);
    // ⚠ The envelope carried a second key, `threadClosed`, until thread closing was removed
    // (wiring plan Phase 4, 2026-08-18). Its shape is the rule worth keeping: a notice about
    // THIS POST rather than a field of the message rides in the ENVELOPE, never inside
    // `message`, because a READ of the same row could never carry it.
    const message = await postMessage(ctx, requireChannelId(auth.params), input);
    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

// ⚠ BOTH at `minRole: "guest"` — a guest reads AND posts in its channel
// (INVARIANTS §4A, §2B). The true gate is the channel-membership fence:
// `loadVisibleChannel` hides the transcript from a non-member, and
// `service-writes.ts › postMessage` refuses `!membership` with
// `ChannelForbiddenError`. The workspace floor is only a tripwire.
export const GET = withWorkspaceAuth(handleGet, { minRole: "guest" });
export const POST = withWorkspaceAuth(handlePost, { minRole: "guest" });
