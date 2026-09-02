import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseQuery } from "@/shared/api/parse-json";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  awaitPings,
  buildChannelContext,
  type PingAwaitCounters,
} from "@/features/channels/server/service";
import { PingAwaitQuerySchema } from "@/features/channels/schema";
import { DEFAULT_AWAIT_TIMEOUT_MS } from "@/features/channels/constants";

/**
 * THE HELD PING READ — **ONE cheap request an external session can hold open
 * instead of polling N channels** (2026-09-01, `docs/specs/needs-you-ping.md`).
 *
 * Holds on `seq > since` across every ping addressed to the caller, returning the
 * instant one lands; on nothing it answers `{ pings: [], timedOut: true }` so the
 * caller re-arms on the SAME cursor. The loop and its tick shape live in
 * `service-pings-await.ts › awaitPings` — read that before touching this.
 *
 * ⚠ **NO CHANNEL SEGMENT, AND UNLIKE `/api/channels/await` THAT IS NOT A RISK
 * HERE.** The workspace message await has to re-prove a MEMBERSHIP SET because
 * its rows belong to rooms; this hold's fence is `recipient_user_id = ctx.userId`,
 * which IS the SQL predicate on every query it issues. There is no wider set to
 * narrow and therefore no proof cadence to get wrong — a row this route can read
 * is by construction one addressed to the caller.
 *
 * ⚠ **SAME BUDGETS AS THE MESSAGE HOLDS, AND THEY ARE A CHAIN, NOT A PREFERENCE.**
 * `maxDuration` 60 sits over the client's 55s network timeout over the 50s
 * `timeoutMs` ceiling `PingAwaitQuerySchema` enforces. The MCP layer assembles a
 * multi-minute hold by RE-ISSUING on the same cursor; one longer request is killed
 * mid-flight instead.
 *
 * ⚠ **`since` IS A PING `seq`, NEVER A MESSAGE ONE.** The two cursor spaces are
 * separate by construction, so a caller that crosses them holds against a
 * plausible, wrong cursor rather than getting an error.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** ⚠ From a `finally`, exactly like both message holds': a hold ended by a throw
 *  would otherwise be missing from the metric, leaving it covering only clean
 *  finishes — the wrong half of the population during an egress incident. */
function logHold(
  started: number,
  counters: PingAwaitCounters,
  outcome: "hit" | "timeout" | "error"
): void {
  if (process.env.DOPL_AWAIT_DIAG === "0") return;
  console.log(
    `[await-hold] scope=pings polls=${counters.polls}` +
      ` outcome=${outcome} ms=${Date.now() - started}`
  );
}

async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  const started = Date.now();
  const counters: PingAwaitCounters = { polls: 0 };
  let outcome: "hit" | "timeout" | "error" = "error";
  try {
    const { since, timeoutMs } = parseQuery(
      request.nextUrl.searchParams,
      PingAwaitQuerySchema,
      ["since", "timeoutMs"]
    );
    // ⚠ Struck BEFORE any database work, so the hold stays bounded under
    // `maxDuration` including the first read — both message holds strike theirs
    // before resolving their fence for the same reason.
    const deadline = Date.now() + (timeoutMs ?? DEFAULT_AWAIT_TIMEOUT_MS);

    const ctx = buildChannelContext(auth);
    const result = await awaitPings(ctx, {
      since,
      deadline,
      signal: request.signal,
      counters,
    });
    outcome = result.pings.length > 0 ? "hit" : "timeout";
    return NextResponse.json({
      pings: result.pings,
      // ⚠ DERIVED FROM EMPTINESS, never tracked separately — the contract both
      // message holds keep. Two sources for one fact is how they come to disagree.
      timedOut: result.pings.length === 0,
    });
  } catch (err) {
    return toChannelErrorResponse(err);
  } finally {
    logHold(started, counters, outcome);
  }
}

export const GET = withWorkspaceAuth(handleGet);
