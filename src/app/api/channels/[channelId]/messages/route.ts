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
  readTranscript,
} from "@/features/channels/server/service";
import {
  ChannelMessageCreateSchema,
  MessageReadQuerySchema,
} from "@/features/channels/schema";

async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    // `thread` is a FILTER on metadata.taskId, not a lookup: an id nothing carries returns [].
    // The await path deliberately has no counterpart.
    // ⚠ `parseQuery` reads ONLY the keys named here — a param added to the
    // schema and forgotten in this list parses as absent, silently, forever.
    // `before` is the transcript's backward page cursor.
    const query = parseQuery(request.nextUrl.searchParams, MessageReadQuerySchema, [
      "since",
      "before",
      "limit",
      "thread",
    ]);
    const ctx = buildChannelContext(auth);
    // ⚠ **`entries` RIDES BESIDE `messages`, AND IS ABSENT UNLESS THE PAGE
    // ACTUALLY FOLDED** (artifacts #1220 §4, 2026-09-06). `messages` is
    // unchanged and complete, so an artifact-unaware client — an installed
    // desktop, an older web build — renders the run exactly as it did before
    // instead of losing rows to a card it cannot draw. A card-aware renderer
    // reads `entries` when present. `null` here means "nothing on this page is
    // in an artifact", never "this server cannot fold".
    const { messages, entries } = await readTranscript(
      ctx,
      requireChannelId(auth.params),
      query
    );
    return NextResponse.json(entries === null ? { messages } : { messages, entries });
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
