import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import {
  consumeMcpCredits,
  creditPeriodFor,
  type CreditConsumeResult,
} from "@/features/billing/server/credits-service";

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
 * the container's OWNER. **Raising this floor back does not close anything — it re-opens the free
 * lane.** Pinned by `app/api/channels/guest-route-floor.test.ts` (set A/B) and, behaviourally,
 * by `route-guest-floor.test.ts` beside this file — which drives the REAL wrapper, where
 * `route.test.ts` mocks it away to reach the plan arithmetic.
 *
 * `allowed: false` answers 200, not 402: the MCP layer owns the refusal wording and renders it as
 * a tool result, and it already has to read `allowed`.
 */
export const POST = withWorkspaceAuth(
  async (_request, { workspaceId, workspaceKind, userId }) => {
    try {
      // ⚠ A `kind='link'` home-channel container has no plan; the container
      // OWNER's billing workspace pays, whoever made the call
      // (`credits-service.ts › resolveBillingTarget`, INVARIANTS §4A).
      return NextResponse.json(
        await consumeMcpCredits(workspaceId, { userId, workspaceKind })
      );
    } catch (err) {
      // ⚠ FAIL OPEN, DECIDED NOT INHERITED. Failing closed on a DB blip bricks every agent:
      // the registrar refuses the call and the operator sees "out of credits" for a workspace
      // that is not. Only a genuinely exhausted counter may hard-block.
      // (Contrast `shared/auth/mcp-session.ts › checkAndRecordRateLimitSubject`, which fails
      // CLOSED — abuse limiting and billing want opposite defaults.)
      console.error(
        `[credits] consume failed for workspace ${workspaceId}: ${
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
    allowed: true,
    used: 0,
    limit: 0,
    remaining: 0,
    upgradeUrl: "",
    degraded: true,
  };
}
