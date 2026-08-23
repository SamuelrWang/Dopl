import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseQuery } from "@/shared/api/parse-json";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  awaitWorkspaceMessages,
  buildChannelContext,
  listSessionStates,
  type WorkspaceAwaitCounters,
} from "@/features/channels/server/service";
import { AwaitQuerySchema } from "@/features/channels/schema";
import { DEFAULT_AWAIT_TIMEOUT_MS } from "@/features/channels/constants";
import type { ChannelContext } from "@/features/channels/server/service-shared";
import type { OwnSessionsReport } from "@/features/channels/server/session-state-service";

/**
 * WORKSPACE-WIDE long-poll — the `channel`-less await (2026-08-22).
 *
 * Holds on `seq > since` across EVERY channel the caller is a MEMBER of, returning the instant
 * anything lands; on nothing it answers `{ messages: [], timedOut: true }` so the caller re-polls
 * with the same cursor. The hold loop, its membership-proof cadence and the M2 access invariant
 * live in `service-await-workspace.ts › awaitWorkspaceMessages` — read that before touching this.
 *
 * ⚠ **NO `[channelId]` SEGMENT, WHICH IS THE WHOLE POINT AND ALSO THE WHOLE RISK.** There is no
 * channel to resolve and therefore no `resolveReadableChannelId` to fence on; the fence is the
 * MEMBERSHIP SET the service re-proves per its cadence, and it is the `IN (…)` of every query the
 * hold issues. A private channel the caller is not in is never named by any of them.
 *
 * ⚠ It is deliberately NARROWER than `op="read"`: a PUBLIC channel the caller never joined is
 * NOT watched. Rationale in `repository-await-workspace.ts › listMemberChannelRefs`.
 *
 * ⚠ Same budgets as the per-channel hold — `maxDuration` 60, `timeoutMs` capped at 50s by
 * `AwaitQuerySchema` — because the MCP layer assembles a multi-minute hold out of these by
 * re-issuing on the same cursor, and a longer single request is killed mid-flight.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** ⚠ From a `finally`, exactly like the per-channel route's: a hold ended by a throw would
 *  otherwise be missing from the metric, leaving it covering only clean finishes — the wrong
 *  half of the population during an egress incident. */
function logHold(
  started: number,
  counters: WorkspaceAwaitCounters,
  channels: number,
  outcome: "hit" | "timeout" | "error"
): void {
  if (process.env.DOPL_AWAIT_DIAG === "0") return;
  console.log(
    `[await-hold] scope=workspace channels=${channels}` +
      ` polls=${counters.polls} revalidations=${counters.revalidations}` +
      ` outcome=${outcome} ms=${Date.now() - started}`
  );
}

/** ⚠ AT RETURN TIME ONLY — the identical rule the per-channel route states at length. Never
 *  inside the hold loop. Fail-soft: an omitted key reads as "not reported", and a payload
 *  already earned must not become a 500. */
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
  const counters: WorkspaceAwaitCounters = { polls: 0, revalidations: 0 };
  let channelCount = 0;
  let outcome: "hit" | "timeout" | "error" = "error";
  try {
    const { since, timeoutMs, excludeAuthor } = parseQuery(
      request.nextUrl.searchParams,
      AwaitQuerySchema,
      ["since", "timeoutMs", "excludeAuthor"]
    );
    // ⚠ Deadline struck BEFORE the first membership proof, so the hold stays bounded under
    // `maxDuration` including that lookup — the same reason the per-channel route strikes it
    // before resolving its ref.
    const deadline = Date.now() + (timeoutMs ?? DEFAULT_AWAIT_TIMEOUT_MS);

    const ctx = buildChannelContext(auth);
    const result = await awaitWorkspaceMessages(ctx, {
      since,
      deadline,
      excludeAuthor,
      signal: request.signal,
      counters,
    });
    channelCount = result.channelCount;
    outcome = result.messages.length > 0 ? "hit" : "timeout";
    const report = await ownSessionsAtReturn(ctx);
    return NextResponse.json({
      messages: result.messages,
      timedOut: result.messages.length === 0,
      // ⚠ REPORTED, not inferred. A caller who belongs to NO channel would otherwise read an
      // empty page as "nothing happened" and re-arm forever on a hold that can never fire.
      channelCount: result.channelCount,
      // ⚠ Both keys or neither — the per-channel route states why at length.
      ...(report === undefined
        ? {}
        : { sessions: report.sessions, operatorOnline: report.operatorOnline }),
    });
  } catch (err) {
    return toChannelErrorResponse(err);
  } finally {
    logHold(started, counters, channelCount, outcome);
  }
}

export const GET = withWorkspaceAuth(handleGet);
