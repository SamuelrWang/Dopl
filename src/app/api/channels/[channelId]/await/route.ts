import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseQuery } from "@/shared/api/parse-json";
import { requireChannelId, toChannelErrorResponse, channelWorkspace } from "@/shared/api/channel-route";
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
 * Long-poll for `seq > since` (≤50s); on nothing, `{ messages: [], timedOut: true }`.
 * Hold loop lives in `service-await.ts › awaitNewMessages`.
 * ⚠ A mid-hold soft-delete or revocation ends the hold with a 404, never messages.
 * ⚠ `sessions` (the caller's own) is an additive key; older clients ignore it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One line per hold (queries-per-hold metric); `DOPL_AWAIT_DIAG=0` silences.
 * ⚠ Runs from `finally` so 404-ended holds are counted too; counters are a mutated
 * object so they survive the throw.
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
 * The caller's own sessions, read at return time only — saves orchestrators a
 * `read_sessions` round trip per cycle.
 * ⚠ Never move this inside `awaitNewMessages`: a held tick must stay one existence
 * probe; a per-tick read multiplies the hottest query path by armed listeners.
 * ⚠ Fail-soft: a failure omits the key ("not reported", distinct from `[]`) rather
 * than 500ing a hold that already earned its messages; logged, not swallowed.
 * ⚠ Workspace-wide on purpose (sibling-channel agents); own-scoped on `ctx.userId`.
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
    // ⚠ Deadline set before the ref resolves so the lookup counts toward `maxDuration`.
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
      // ⚠ Omitted (not `null`) on a failed read — "absent" = "not reported". Both
      // keys go or stay together (F-294): a failed read must not claim offline.
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
export const GET = withWorkspaceAuth(handleGet, { workspaceFromParams: channelWorkspace, minRole: "guest" });
