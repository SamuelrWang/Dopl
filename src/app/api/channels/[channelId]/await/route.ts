import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { requireChannelId, toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  awaitNewMessages,
  buildChannelContext,
  resolveReadableChannelId,
  type AwaitHoldCounters,
} from "@/features/channels/server/service";
import { AwaitQuerySchema } from "@/features/channels/schema";
import { DEFAULT_AWAIT_TIMEOUT_MS } from "@/features/channels/constants";

/**
 * Long-poll for new messages. Validates channel access up front, then holds
 * on `seq > since` (~1.5s ticks, capped by `timeoutMs` <= 50s) and returns as
 * soon as anything arrives — else `{ messages: [], timedOut: true }` so the
 * caller re-polls with the same cursor. The hold loop, its existence-check
 * tick and its access-recheck cadence live in `service-await.ts`
 * (`awaitNewMessages`); a mid-hold soft-delete or membership revocation ends
 * the hold with a 404 and never returns messages.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One line per hold so the Q8 egress diet is measurable in production
 * (queries-per-hold is the whole point of the change). Set
 * `DOPL_AWAIT_DIAG=0` to silence it.
 *
 * FIX L6 — EVERY hold logs, including one that ends badly. This used to sit
 * inside the `try` after `awaitNewMessages` returned, so a hold ended by a
 * mid-hold revocation or soft-delete (a `ChannelNotFoundError` → 404) emitted
 * nothing at all: the metric covered only the holds that finished cleanly,
 * which is the wrong half of the population to be watching during an egress
 * incident. It now runs from a `finally` and names the OUTCOME, and the counts
 * come from an object the loop mutates, so they survive the throw.
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

async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  const started = Date.now();
  const counters: AwaitHoldCounters = { polls: 0, revalidations: 0 };
  // Set once the ref resolves; a failure before that has no channel to name.
  let channelId = "";
  let outcome: "hit" | "timeout" | "error" = "error";
  try {
    const search = request.nextUrl.searchParams;
    const parsed = AwaitQuerySchema.safeParse({
      since: search.get("since") ?? undefined,
      timeoutMs: search.get("timeoutMs") ?? undefined,
    });
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_FAILED", "Invalid query", parsed.error.issues);
    }
    const { since, timeoutMs } = parsed.data;
    // Deadline is struck BEFORE the ref resolves, as it always has been: the
    // hold must stay bounded under `maxDuration` including that lookup.
    const deadline = Date.now() + (timeoutMs ?? DEFAULT_AWAIT_TIMEOUT_MS);

    const ctx = buildChannelContext(auth);
    channelId = await resolveReadableChannelId(ctx, requireChannelId(auth.params));

    const result = await awaitNewMessages(ctx, channelId, {
      since,
      deadline,
      signal: request.signal,
      counters,
    });
    outcome = result.messages.length > 0 ? "hit" : "timeout";
    return NextResponse.json({
      messages: result.messages,
      timedOut: result.messages.length === 0,
    });
  } catch (err) {
    return toChannelErrorResponse(err);
  } finally {
    logHold(channelId, started, counters, outcome);
  }
}

export const GET = withWorkspaceAuth(handleGet);
