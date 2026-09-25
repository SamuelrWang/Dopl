import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { sessionChannelId } from "@/shared/auth/session-header";
import {
  consumeMcpCredits,
  type CreditConsumeResult,
} from "@/features/billing/server/credits-service";
import { creditPeriodFor } from "@/features/billing/server/credits-meter";
import {
  clearUnmetered,
  recordUnmetered,
} from "@/features/billing/server/credits-unmetered";
import {
  logMcpCall,
  readMcpCallTally,
} from "@/features/analytics/server/mcp-tool-calls";

/**
 * POST /api/mcp/credits/consume — charge ONE MCP tool call to a workspace. The ONLY caller is
 * `packages/mcp-server/src/registrar.ts` via `@dopl/client › consumeCredits`, at the two terminal
 * paths of the per-tool-call wrapper (the only exactly-once seam).
 *
 * ⚠ NOT `sessionOnly`: every MCP caller is an OAuth agent token, so a session gate refuses the
 * only caller. `writeScopeExempt: true` because a READ-ONLY session still consumes — the cost is
 * the tool call, not the write — and gating on `dopl.write` makes read-only agents free.
 *
 * 🔒 ⚠ `minRole: "guest"` — THE ONE NON-CHANNEL ENTRY IN THE GUEST-ALLOWED SET, AND IT IS A
 * METER, NOT A CAPABILITY (2026-08-26, Samuel: "charge MCP calls from a guest to the user";
 * closes F-325). At the wrapper's `viewer` default this route 403'd every guest-scoped call, and
 * `packages/mcp-server/src/registrar.ts › createCreditedRunner › charge` fails OPEN on any throw —
 * so a 403 was not a refusal, it was a FREE TOOL CALL plus a log line. Lowering the floor grants a
 * guest nothing except the ability to be BILLED: the only effect of a successful call is that
 * somebody's counter goes UP, and by `credits-service.ts › resolveBillingTarget` that somebody is
 * the container's OWNER — their PERSONAL WALLET since 2026-09-07, the owner's standard workspace
 * before it; the ruling about WHO pays is unchanged, only the counter moved. **Raising this floor
 * back does not close anything — it re-opens the free lane.** Pinned by `app/api/channels/guest-route-floor.test.ts` (set A/B) and, behaviourally,
 * by `route-guest-floor.test.ts` beside this file — which drives the REAL wrapper, where
 * `route.test.ts` mocks it away to reach the plan arithmetic.
 *
 * `allowed: false` answers 200, not 402: the MCP layer owns the refusal wording and renders it as
 * a tool result, and it already has to read `allowed`.
 */
export const POST = withWorkspaceAuth(
  async (request, { workspaceId, workspaceKind, userId, sessionId }) => {
    // The MCP call this charge pays for, tallied beside it — never awaited, never thrown.
    void readMcpCallTally(request).then(
      (call) => call && logMcpCall(workspaceId, userId, call)
    );
    try {
      // ⚠ THE KIND PICKS THE WALLET. A standard workspace charges the CALLER'S
      // OWN SEAT; a `kind='link'` or `kind='home'` container has no plan and
      // charges the container OWNER's PERSONAL wallet, whoever made the call
      // (`credits-service.ts › resolveBillingTarget`, INVARIANTS §4A).
      // ⚠ `userId` is REQUIRED by that call since 2026-09-07 — both wallets are
      // keyed on a person, so there is no wallet to move without one.
      // 🔒 **AND THE CHANNEL PICKS THE CONTAINER SINCE 2026-09-13 (rule B).**
      // `sessionId` is the desktop's slot key for the calling session, already
      // read once by the wrapper (`shared/auth/session-header.ts`); its
      // `<channelId>:<tail>` head is the channel whose container is charged.
      // ⚠ **THIS IS THE ONE HOP, AND IT NEEDED NO NEW WIRE**: the MCP server's
      // loopback client stamps `X-Dopl-Session-Id` on every request it makes
      // (`src/app/api/mcp/route.ts` → `DoplClient({ sessionId })` →
      // `packages/dopl-client/src/transport.ts`), so the consume POST already
      // carried it. ⚠ NO SESSION ⇒ NO CHANNEL ⇒ the resource's container pays,
      // which is what a Claude Desktop / Claude Code connection looks like.
      const result = await consumeMcpCredits(workspaceId, {
        userId,
        workspaceKind,
        channelId: sessionChannelId(sessionId),
      });
      // ⚠ **THE RECOVERY EDGE, AND IT IS THE ANSWER ITSELF RATHER THAN A
      // PROBE.** A consume that returned — degraded posture included — is this
      // process measuring again, so the `unmeteredSince` stamp the surfaces
      // render comes down on the next real call and not on a timer nobody
      // armed (`credits-unmetered.ts › clearUnmetered`).
      clearUnmetered();
      return NextResponse.json(result);
    } catch (err) {
      // ⚠ FAIL OPEN, DECIDED NOT INHERITED. Failing closed on a DB blip bricks every agent:
      // the registrar refuses the call and the operator sees "out of credits" for a workspace
      // that is not. Only a genuinely exhausted counter may hard-block.
      // (Contrast `shared/auth/mcp-session.ts › checkAndRecordRateLimitSubject`, which fails
      // CLOSED — abuse limiting and billing want opposite defaults.)
      // ⚠ **ONE LINE PER PROCESS PER REASON, NOT ONE PER CALL (2026-09-14).**
      // The superseded `console.error` here fired on EVERY call: under the
      // deploy-ordering outage this branch exists for (a `PGRST202` from a
      // migration that has not applied yet) that is a line per tool call per
      // agent, which buries itself. `credits-unmetered.ts` also makes the state
      // READABLE — `GET /api/billing/status › credits.unmeteredSince` — because
      // until now nothing web-side showed a fail-open at all and both meters
      // printed a `0` nobody could tell from a measured one.
      recordUnmetered(
        "consume_failed",
        `workspace ${workspaceId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return NextResponse.json(failOpen());
    }
  },
  { writeScopeExempt: true, minRole: "guest" }
);

/** Degraded answer. `allowed: true` is load-bearing; counters are zeroed and `degraded` says so,
 *  because nothing was measured — a made-up `used` puts a wrong number on the settings meter. */
function failOpen(): CreditConsumeResult & { degraded: true } {
  return {
    // No row read, no verdict — the window a workspace with no subscription state gets.
    ...creditPeriodFor(null, "free"),
    // ⚠ NO COUNTER WAS EVEN CHOSEN, let alone read. `null` is the honest wallet
    // and the client mirror falls back to it on a pre-field cached row.
    wallet: null,
    allowed: true,
    used: 0,
    limit: 0,
    remaining: 0,
    upgradeUrl: "",
    // ⚠ `0`, BYTE FOR BYTE WITH `credits-meter.ts › unmetered` (2026-09-14,
    // F-668). Nothing was measured, so there is no offer to size.
    upgradeCredits: 0,
    degraded: true,
  };
}
