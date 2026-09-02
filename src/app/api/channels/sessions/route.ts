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
  recordDeliveryAcks,
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
    // ⚠ `operatorOnline` IS ADDITIVE AND RIDES BESIDE THE ROWS (2026-08-23,
    // F-294): the caller's own `agent_presence` freshness, so the MCP render can
    // tell an idle-but-alive agent from a desktop that died. An older client
    // ignores the key; an older SERVER omits it, which the render reads as
    // "not reported" and hedges exactly as it did before.
    const { sessions, operatorOnline } = await listSessionStates(
      ctx,
      query.channelId
    );
    return NextResponse.json({ sessions, operatorOnline });
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
    // ⚠ **THE WAKE ACK RIDES THIS LANE (2026-09-02, A9) AND IS SEQUENCED AFTER
    // THE PROJECTION, DELIBERATELY.** The session set is what an entire tool
    // reads (`op="read_sessions"`); a receipt is a convenience beside it. If the
    // ack write throws, the projection has already landed and the caller sees a
    // 500 it will retry — which re-sends both, and the ack is idempotent by
    // rank (`service-writes-delivery.ts › weakerOrEqual`). The other order would
    // lose the projection to a failure in the lesser half.
    // ⚠ `acks` is OPTIONAL on the body: every installed desktop posts without it.
    const result = await reportSessionStates(ctx, input.sessions);
    const acks = await recordDeliveryAcks(ctx, input.acks ?? []);
    return NextResponse.json({ ...result, ...acks });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost);
