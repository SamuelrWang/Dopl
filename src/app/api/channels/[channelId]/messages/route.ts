import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { parseJson } from "@/shared/api/parse-json";
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
    const params = request.nextUrl.searchParams;
    // `thread` scopes the read to one exchange (metadata.taskId). It is a
    // filter, not a lookup: an id nothing carries returns []. The await path
    // deliberately has no counterpart — a thread-scoped hold is its own design.
    const parsed = MessageReadQuerySchema.safeParse({
      since: params.get("since") ?? undefined,
      limit: params.get("limit") ?? undefined,
      thread: params.get("thread") ?? undefined,
    });
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_FAILED", "Invalid query", parsed.error.issues);
    }
    const ctx = buildChannelContext(auth);
    const messages = await readMessages(ctx, requireChannelId(auth.params), parsed.data);
    return NextResponse.json({ messages });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, ChannelMessageCreateSchema);
    const ctx = buildChannelContext(auth);
    // F6 — `threadClosed` is a notice about THIS POST, not a field of the
    // message, so it rides in the ENVELOPE beside it (the shape `echoSeq` uses
    // on the close route) rather than inside the message object a read would
    // never carry it in. Additive on the wire: an older deployment omits the key
    // and every existing client reads exactly what it read before.
    const { threadClosed, ...message } = await postMessage(
      ctx,
      requireChannelId(auth.params),
      input
    );
    return NextResponse.json(
      threadClosed ? { message, threadClosed: true } : { message },
      { status: 201 }
    );
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });
