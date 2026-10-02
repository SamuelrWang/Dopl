import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { requireChannelId, toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  buildChannelContext,
  createTask,
  createTaskFanOut,
  listChannelTasks,
} from "@/features/channels/server/service";
import { withMessageSource } from "@/features/channels/server/message-source";
import {
  isTaskFanOutInput,
  TaskCreatePayloadSchema,
} from "@/features/channels/schema";

// Channel tasks: GET lists, POST creates. NOT sessionOnly — task ops arrive over the MCP device
// token; the service enforces channel-scoped authorization.
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    const { threads, truncated } = await listChannelTasks(
      ctx,
      requireChannelId(auth.params)
    );
    // `tasks` keeps the storage name; `truncated` is load-bearing (INVARIANTS §9).
    return NextResponse.json({ tasks: threads, truncated });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

// ⚠ One POST, two shapes: single create, or fan-out (`toUserIds`, one thread per
// addressee + group id). Same gate, since a fan-out is N ordinary creates
// (INVARIANTS §9). Empty `toUserIds` is refused by `TaskFanOutSchema`.
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, TaskCreatePayloadSchema);
    const ctx = await withMessageSource(buildChannelContext(auth), request);
    if (isTaskFanOutInput(input)) {
      const { threads, groupId } = await createTaskFanOut(
        ctx,
        requireChannelId(auth.params),
        input
      );
      // `tasks` / `openingSeqs` keep the storage name and stay ALIGNED by
      // index — the client patches its optimistic rows against that order.
      return NextResponse.json(
        {
          tasks: threads.map((t) => t.thread),
          openingSeqs: threads.map((t) => t.openingSeq),
          fanoutGroup: groupId,
        },
        { status: 201 }
      );
    }
    const { thread, openingSeq } = await createTask(
      ctx,
      requireChannelId(auth.params),
      input
    );
    // `task` keeps the storage name. `openingSeq` lets a requester arm `await` without
    // a follow-up read. ⚠ Null only when the idempotent short-circuit returned
    // another member's thread.
    return NextResponse.json({ task: thread, openingSeq }, { status: 201 });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

// ⚠ Both at guest (INVARIANTS §4A, §2B; Samuel's Q1 ruling: guests may create
// threads). The service's membership check (`ChannelForbiddenError`) is the gate.
export const GET = withWorkspaceAuth(handleGet, { minRole: "guest" });
export const POST = withWorkspaceAuth(handlePost, { minRole: "guest" });
