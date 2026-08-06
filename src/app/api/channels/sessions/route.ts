import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { parseJson } from "@/shared/api/parse-json";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  SessionStateQuerySchema,
  SessionStateReportSchema,
} from "@/features/channels/schema";
import {
  buildChannelContext,
  listSessionStates,
  reportSessionStates,
} from "@/features/channels/server/service";

// READ-SESSION-STATE (rollback §3.5). GET the CALLER'S OWN live sessions —
// "what is flint doing?" answered over MCP — optionally narrowed to one channel
// with `?channelId=<uuid>`. Read-only and own-scoped (the service keys on
// ctx.userId, RLS backs it), so any signed-in workspace member may call it
// (viewer floor).
//
// F-147 — THE WRITE HALF IS HERE NOW (`POST`, below), where F-144 left a
// flagged delivery gap, so `read_sessions` answers live rather than honestly
// empty. Same wrapper, same own-scope, opposite direction.
//
// F-145, two fixes on one handler:
//  1. `?channelId=` IS VALIDATED. It used to go straight into `.eq()`, so a
//     non-uuid became a Postgres cast error and a 500 for what is plainly a
//     malformed request. A 400 naming the field is the honest answer, and it is
//     the same safeParse the consent inbox's identical param already did.
//  2. The empty answer is REAL. `channel_sessions` is unapplied, so this read
//     answered PGRST205 and the route returned INTERNAL_ERROR — while the
//     comment above claimed "[] until the push lands". The repository degrades
//     that ONE code (`repository-collab.listSessionStates`); every other DB
//     failure still reaches the caller as a failure.
async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const parsed = SessionStateQuerySchema.safeParse({
      channelId: request.nextUrl.searchParams.get("channelId") || undefined,
    });
    if (!parsed.success) {
      throw new HttpError(
        400,
        "VALIDATION_FAILED",
        "Invalid query",
        parsed.error.issues
      );
    }
    const ctx = buildChannelContext(auth);
    const sessions = await listSessionStates(ctx, parsed.data.channelId);
    return NextResponse.json({ sessions });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

// WRITE-SESSION-STATE (F-147, rollback §3.5 + plan §5). The operator's desktop
// reports its WHOLE live set for the workspace named by `X-Workspace-Id`, on
// state change and never on a timer — `session-summary.js`'s digest is the
// trigger, and `main/session-state-push.js` is the only caller.
//
// SAME AUTH DISCIPLINE AS THE READ, and the same own-scope. `withWorkspaceAuth`
// is the membership floor (viewer); the service keys every row on `ctx.userId`
// and `ctx.workspaceId`, and the body has no field for either, so a caller can
// only ever replace ITS OWN set. The table REVOKEs writes from `authenticated`,
// so the statement runs on the admin client behind this fence.
//
// IT IS A REPLACE, NOT AN APPEND: anything the report omits is deleted, which is
// what keeps rows from accumulating (plan §5 — this table is the cheap opposite
// of `agent_presence`, and a store that only ever grew would give that back).
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, SessionStateReportSchema);
    const ctx = buildChannelContext(auth);
    const result = await reportSessionStates(ctx, input.sessions);
    return NextResponse.json(result);
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost);
