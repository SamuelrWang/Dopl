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
  resolveReadableChannelId,
  type AwaitHoldCounters,
} from "@/features/channels/server/service";
import { AwaitQuerySchema } from "@/features/channels/schema";
import { DEFAULT_AWAIT_TIMEOUT_MS } from "@/features/channels/constants";

/**
 * Long-poll for new messages. Validates access up front, then holds on `seq > since` (~1.5s
 * ticks, capped by `timeoutMs` <= 50s); on nothing it answers `{ messages: [], timedOut: true }`
 * so the caller re-polls with the same cursor. Hold loop + existence-check tick + access-recheck
 * cadence live in `service-await.ts › awaitNewMessages`.
 * ⚠ A mid-hold soft-delete or membership revocation ends the hold with a 404 and NEVER returns
 * messages.
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
