import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseQuery } from "@/shared/api/parse-json";
import { requireChannelId, toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  awaitNewMessages,
  buildChannelContext,
  listSessionStates,
  resolveReadableChannelId,
  type AwaitHoldCounters,
} from "@/features/channels/server/service";
import { AwaitQuerySchema } from "@/features/channels/schema";
import { DEFAULT_AWAIT_TIMEOUT_MS } from "@/features/channels/constants";
import type { ChannelContext } from "@/features/channels/server/service-shared";
import type { OwnSessionsReport } from "@/features/channels/server/session-state-service";

/**
 * Long-poll for new messages. Validates access up front, then holds on `seq > since` (~1.5s
 * ticks, capped by `timeoutMs` <= 50s); on nothing it answers `{ messages: [], timedOut: true }`
 * so the caller re-polls with the same cursor. Hold loop + existence-check tick + access-recheck
 * cadence live in `service-await.ts › awaitNewMessages`.
 * ⚠ A mid-hold soft-delete or membership revocation ends the hold with a 404 and NEVER returns
 * messages.
 *
 * ⚠ THE RESPONSE CARRIES A THIRD KEY SINCE 2026-08-22: `sessions`, the caller's OWN agent
 * sessions. ADDITIVE — an older client reads `{messages, timedOut}` and ignores it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One line per hold so queries-per-hold is measurable in production. `DOPL_AWAIT_DIAG=0` silences.
 * ⚠ Must run from a `finally`, not inside the `try`: a hold ended by a mid-hold revocation or
 * soft-delete (`ChannelNotFoundError` → 404) would emit nothing, leaving the metric covering only
 * clean finishes — the wrong half of the population during an egress incident. The counts come
 * from an object the loop mutates so they survive the throw.
 */
function logHold(
  channelId: string,
  started: number,
  counters: AwaitHoldCounters,
  outcome: "hit" | "timeout" | "error"
): void {
  if (process.env.DOPL_AWAIT_DIAG === "0") return;
  console.log(
    `[await-hold] channel=${channelId ? channelId.slice(0, 8) : "-"}` +
      ` polls=${counters.polls} revalidations=${counters.revalidations}` +
      ` outcome=${outcome} ms=${Date.now() - started}`
  );
}

/**
 * THE CALLER'S OWN SESSIONS, READ **AT RETURN TIME AND NOWHERE ELSE**.
 *
 * ⚠ **NEVER MOVE THIS INSIDE `awaitNewMessages`.** That loop is the feature's one structurally
 * growing egress consumer — the teaching tells every agent with an open exchange to keep an await
 * armed continuously — and its whole design is that a held tick costs ONE existence probe on ONE
 * column. A session read per tick would multiply the hottest query path in the tree by the number
 * of armed listeners, to answer a question nobody asked until the hold ended. One read per
 * RETURNED hold is one read per ~3.5 minutes per listener at worst, and zero extra reads during
 * the wait.
 *
 * ⚠ WHY IT IS WORTH ONE READ AT ALL: an orchestrator's loop was `await` → `read_sessions` →
 * decide, two round trips per cycle. This makes it one. That is the entire justification, and it
 * evaporates if the read moves anywhere it can fire more than once per hold.
 *
 * ⚠ FAIL-SOFT, AND `undefined` IS THE HONEST ANSWER. A messages payload has already been earned
 * by the time this runs; throwing here would turn a successful hold into a 500 and make the
 * caller re-arm for messages it had. So a failure OMITS the key, which the client contract reads
 * as "not reported" — distinct from `[]`, which is a claim that the machine reports nothing.
 * ⚠ NOT swallowed silently: one line, same lane as the hold diagnostic.
 *
 * ⚠ WORKSPACE-WIDE, not narrowed to this channel. The caller is orchestrating agents, and an
 * agent it launched into a sibling channel is exactly what it needs to see without a second call.
 * The read is own-scoped either way (`ctx.userId`), which is what licenses the telemetry.
 */
async function ownSessionsAtReturn(
  ctx: ChannelContext
): Promise<OwnSessionsReport | undefined> {
  try {
    return await listSessionStates(ctx);
  } catch (err) {
    console.log(
      `[await-hold] sessions-read-failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return undefined;
  }
}

async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  const started = Date.now();
  const counters: AwaitHoldCounters = { polls: 0, revalidations: 0 };
  // Set once the ref resolves; an earlier failure has no channel to name.
  let channelId = "";
  let outcome: "hit" | "timeout" | "error" = "error";
  try {
    const { since, timeoutMs, excludeAuthor } = parseQuery(
      request.nextUrl.searchParams,
      AwaitQuerySchema,
      ["since", "timeoutMs", "excludeAuthor"]
    );
    // ⚠ Deadline struck BEFORE the ref resolves: the hold must stay bounded under `maxDuration`
    // including that lookup.
    const deadline = Date.now() + (timeoutMs ?? DEFAULT_AWAIT_TIMEOUT_MS);

    const ctx = buildChannelContext(auth);
    channelId = await resolveReadableChannelId(ctx, requireChannelId(auth.params));

    const result = await awaitNewMessages(ctx, channelId, {
      since,
      deadline,
      excludeAuthor,
      signal: request.signal,
      counters,
    });
    outcome = result.messages.length > 0 ? "hit" : "timeout";
    // ⚠ AFTER the hold, never during it — see `ownSessionsAtReturn`.
    const report = await ownSessionsAtReturn(ctx);
    return NextResponse.json({
      messages: result.messages,
      timedOut: result.messages.length === 0,
      // ⚠ The keys are OMITTED rather than sent as `null` when the read failed:
      // `undefined` serializes away, and "absent" is the shape the client
      // contract defines as "not reported".
      // ⚠ BOTH KEYS COME FROM THE SAME READ AND GO OR STAY TOGETHER (F-294).
      // Sending `operatorOnline: false` from a FAILED read would tell an
      // orchestrator its machine is gone on the strength of our own outage.
      ...(report === undefined
        ? {}
        : { sessions: report.sessions, operatorOnline: report.operatorOnline }),
    });
  } catch (err) {
    return toChannelErrorResponse(err);
  } finally {
    logHold(channelId, started, counters, outcome);
  }
}

// ⚠ `minRole: "guest"` — a guest long-polls its own channel for new activity
// (INVARIANTS §4A, §2B); the channel-membership fence is the true gate.
export const GET = withWorkspaceAuth(handleGet, { minRole: "guest" });
