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
    // ⚠ `parseQuery` reads ONLY the keys named here — a param added to the
    // schema and forgotten in this list parses as absent, silently, forever.
    const query = parseQuery(request.nextUrl.searchParams, MessageReadQuerySchema, [
      "since",
      "before",
      "limit",
      "thread",
      // The UI transcript's ESTIMATED-LINE page budget (2026-09-08). Opt-in:
      // the MCP / desktop reads send none and page by row exactly as before.
      "lineBudget",
    ]);
    const ctx = buildChannelContext(auth);
    // ⚠ **`entries` RIDES BESIDE `messages`, AND IS ABSENT UNLESS THE PAGE
    // ACTUALLY FOLDED** (artifacts #1220 §4, 2026-09-06). `messages` stays
    // complete so an artifact-unaware client renders the run as before; `null`
    // means "nothing on this page is in an artifact", never "cannot fold".
    // ⚠ **`hasMore` IS ALWAYS ON THE WIRE, AND THE CLIENT MUST NOT RE-DERIVE IT**
    // (2026-09-08). A line-budgeted page is SHORT BY DESIGN, so the usual
    // `rows.length === pageSize` test would report a channel of long messages as
    // exhausted on its first page.
    const { messages, entries, hasMore } = await readTranscript(
      ctx,
      requireChannelId(auth.params),
      query
    );
    return NextResponse.json(
      entries === null ? { messages, hasMore } : { messages, entries, hasMore }
    );
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, ChannelMessageCreateSchema);
    const ctx = buildChannelContext(auth);
    // ⚠ The envelope carried `threadClosed` until thread closing was removed
    // (2026-08-18). The rule worth keeping: a notice about THIS POST rides in the
    // ENVELOPE, never inside `message`, since a READ of the row cannot carry it.
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
