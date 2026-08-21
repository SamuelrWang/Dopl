import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson, parseQuery } from "@/shared/api/parse-json";
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

// READ-SESSION-STATE. GET the CALLER'S OWN live sessions ("what is flint doing?" over MCP),
// optionally narrowed with `?channelId=<uuid>`. Read-only and own-scoped (the service keys on
// ctx.userId, RLS backs it), so any signed-in workspace member may call it (viewer floor).
//
// ⚠ `?channelId=` IS VALIDATED before it reaches `.eq()` — a non-uuid becomes a Postgres cast
// error and a 500 for what is plainly a malformed request. Same safeParse as the consent inbox.
// ⚠ The empty answer is REAL: `repository-sessions.listSessionStates` degrades ONE code
// (PGRST205, the unapplied `channel_sessions` table); every other DB failure still reaches the
// caller as a failure.
async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    // ⚠ `parseQuery` uses `??`, and this route is WHY it is stated as a rule. It
    // read `|| undefined`, so `?channelId=` collapsed to "no filter" and answered
    // with every session in the workspace instead of 400ing like its twin on
    // `/channels/consent`. An empty string is a value the caller sent.
    const query = parseQuery(request.nextUrl.searchParams, SessionStateQuerySchema, [
      "channelId",
    ]);
    const ctx = buildChannelContext(auth);
    const sessions = await listSessionStates(ctx, query.channelId);
    return NextResponse.json({ sessions });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

// WRITE-SESSION-STATE. The operator's desktop reports its WHOLE live set for the workspace named
// by `X-Workspace-Id`, on state change and never on a timer — `session-summary.js`'s digest is
// the trigger and `main/session-state-push.js` is the only caller.
//
// ⚠ Own-scope: the service keys every row on `ctx.userId` + `ctx.workspaceId` and the body has no
// field for either, so a caller can only replace ITS OWN set. The table REVOKEs writes from
// `authenticated`, so the statement runs on the admin client behind this fence.
//
// ⚠ IT IS A REPLACE, NOT AN APPEND: anything the report omits is deleted, which is what keeps
// rows from accumulating.
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
