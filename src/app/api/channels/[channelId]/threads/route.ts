import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { requireChannelId, toChannelErrorResponse, channelWorkspace } from "@/shared/api/channel-route";
import {
  buildChannelContext,
  createThread,
  createThreadFanOut,
  listChannelThreads,
} from "@/features/channels/server/service";
import { withMessageSource } from "@/features/channels/server/message-source";
import {
  isThreadFanOutInput,
  ThreadCreatePayloadSchema,
} from "@/features/channels/schema";

// Channel threads: GET lists, POST creates. NOT sessionOnly — thread ops arrive over the MCP device
// token; the service enforces channel-scoped authorization.
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    const { threads, truncated } = await listChannelThreads(
      ctx,
      requireChannelId(auth.params)
    );
    // `truncated` is load-bearing (INVARIANTS §9).
    return NextResponse.json({ threads, truncated });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

// ⚠ One POST, two shapes: single create, or fan-out (`toUserIds`, one thread per
// addressee + group id). Same gate, since a fan-out is N ordinary creates
// (INVARIANTS §9). Empty `toUserIds` is refused by `ThreadFanOutSchema`.
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, ThreadCreatePayloadSchema);
    const ctx = await withMessageSource(buildChannelContext(auth), request);
    if (isThreadFanOutInput(input)) {
      const { threads, groupId } = await createThreadFanOut(
        ctx,
        requireChannelId(auth.params),
        input
      );
      // `threads` / `openingSeqs` stay ALIGNED by index — the client patches its optimistic rows against that order.
      return NextResponse.json(
        {
          threads: threads.map((t) => t.thread),
          openingSeqs: threads.map((t) => t.openingSeq),
          fanoutGroup: groupId,
        },
        { status: 201 }
      );
    }
    const { thread, openingSeq } = await createThread(
      ctx,
      requireChannelId(auth.params),
      input
    );
    // `openingSeq` lets a requester arm `await` without a follow-up read. ⚠ Null only when the idempotent short-circuit returned
    // another member's thread.
    return NextResponse.json({ thread, openingSeq }, { status: 201 });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

// ⚠ Both at guest (INVARIANTS §4A, §2B; Samuel's Q1 ruling: guests may create
// threads). The service's membership check (`ChannelForbiddenError`) is the gate.
export const GET = withWorkspaceAuth(handleGet, { workspaceFromParams: channelWorkspace, minRole: "guest" });
export const POST = withWorkspaceAuth(handlePost, { workspaceFromParams: channelWorkspace, minRole: "guest" });
