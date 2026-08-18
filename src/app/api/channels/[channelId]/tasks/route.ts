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
    // `tasks` keeps the storage name. `truncated` is ADDITIVE and load-bearing:
    // the list is bounded and threads never leave it, so a caller that cannot
    // tell a clipped page from an exhausted one will present a partial list as
    // the whole one (INVARIANTS §9).
    return NextResponse.json({ tasks: threads, truncated });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

// ⚠ ONE POST, TWO SHAPES — the single-target create and the REQUEST FAN-OUT
// (`toUserIds`), which raises one thread per addressee and answers with all of
// them plus the group id their card is drawn from. Same route, same gate: a
// fan-out is N ordinary creates by the same caller, so giving it its own
// endpoint would give one resource two auth wrappers and two error mappings
// (INVARIANTS §9). `toUserIds: []` is refused by the schema, not here — see
// `TaskFanOutSchema`.
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, TaskCreatePayloadSchema);
    const ctx = buildChannelContext(auth);
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
    // `task` keeps the storage name (web + @dopl/client read it). `openingSeq` is additive: the
    // seq of the thread's opening message, so a requester arms `await` on the right cursor
    // without a follow-up read. ⚠ Null only when the idempotent short-circuit returned another
    // member's thread.
    return NextResponse.json({ task: thread, openingSeq }, { status: 201 });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });
