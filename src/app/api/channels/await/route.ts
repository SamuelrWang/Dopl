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
 * Workspace-wide long-poll: holds on `seq > since` across every channel the caller is a
 * MEMBER of. Loop + M2 access invariant: `service-await-workspace.ts › awaitWorkspaceMessages`.
 *
 * ⚠ No `[channelId]`, so the fence is the re-proved MEMBERSHIP SET — the `IN (…)` of
 * every query the hold issues.
 * ⚠ Narrower than `op="read"`: unjoined public channels are not watched
 * (`repository-await-workspace.ts › listMemberChannelRefs`).
 * ⚠ Same budgets as the per-channel hold; the MCP layer chains holds on one cursor.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** ⚠ From a `finally`, like the per-channel route, so thrown holds are counted. */
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

/** ⚠ At return time only, never in the hold loop; fail-soft (see the per-channel route). */
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
    // ⚠ Deadline set before the first membership proof (counts toward `maxDuration`).
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
      // ⚠ Reported so a zero-channel caller doesn't re-arm forever on an empty page.
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

// ⚠ Guest floor; results bounded by the membership fence (INVARIANTS §4A, §2B).
export const GET = withWorkspaceAuth(handleGet, { minRole: "guest" });
