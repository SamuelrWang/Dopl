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
  recordSessionTokenSpend,
  reportSessionStates,
} from "@/features/channels/server/service";

// GET the caller's own live sessions, optionally `?channelId=<uuid>`. Own-scoped on
// ctx.userId (RLS backs it), so the viewer floor is enough.
// ⚠ `?channelId=` is validated before `.eq()` — a non-uuid would be a cast-error 500.
// ⚠ Only PGRST205 (unapplied table) degrades to empty; other DB failures surface.
async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    // ⚠ `parseQuery` uses `??`: an empty `?channelId=` must 400, never collapse
    // to "no filter" (every session in the workspace).
    const query = parseQuery(request.nextUrl.searchParams, SessionStateQuerySchema, [
      "channelId",
    ]);
    const ctx = buildChannelContext(auth);
    // `operatorOnline` (additive, F-294): own `agent_presence` freshness, so the
    // MCP render can tell an idle agent from a dead desktop. Absent = not reported.
    const { sessions, operatorOnline } = await listSessionStates(
      ctx,
      query.channelId
    );
    return NextResponse.json({ sessions, operatorOnline });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

// POST: the desktop reports its WHOLE live set on state change, never on a timer
// (only caller: `main/session-state-push.js`).
// ⚠ Own-scope: rows keyed on `ctx.userId` + `ctx.workspaceId`, no body field for
// either; admin client runs behind this fence (table REVOKEs `authenticated` writes).
// ⚠ A REPLACE, not an append: omitted rows are deleted.
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, SessionStateReportSchema);
    const ctx = buildChannelContext(auth);
    // ⚠ Order is fixed: projection first, then wake acks (A9), then token ledger.
    // A failure in a lesser half must never cost the projection; retries re-send
    // all and both later writes are idempotent (`weakerOrEqual`, `GREATEST`).
    // `acks` is optional on the body.
    const result = await reportSessionStates(ctx, input.sessions);
    // 🔒 The session set is the ack's fence (review D3): a receipt may only name a
    // session this push just reconciled.
    const acks = await recordDeliveryAcks(ctx, input.acks ?? [], input.sessions);
    // Durable token ledger (Samuel #1326); see `service-token-spend.ts`.
    // ⚠ `spendRecorded` omitted (not 0) when `null` = ledger migration not applied.
    const spendRecorded = await recordSessionTokenSpend(ctx, input.sessions);
    return NextResponse.json({
      ...result,
      ...acks,
      ...(spendRecorded === null ? {} : { spendRecorded }),
    });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost);
