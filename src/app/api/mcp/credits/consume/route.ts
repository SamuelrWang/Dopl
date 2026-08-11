import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import {
  consumeMcpCredits,
  creditPeriodFor,
  type CreditConsumeResult,
} from "@/features/billing/server/credits-service";

/**
 * POST /api/mcp/credits/consume — charge ONE MCP tool call to a workspace.
 *
 * THE ONLY CALLER IS OUR OWN REGISTRAR. `packages/mcp-server/src/registrar.ts`
 * calls it through `@dopl/client › consumeCredits` at the two terminal paths of
 * the per-tool-call wrapper, which is the only exactly-once seam there is.
 *
 * WHY IT IS NOT `sessionOnly`: every MCP caller is an OAuth agent token, so a
 * session gate would refuse the only caller. `writeScopeExempt: true` because a
 * READ-ONLY session still consumes — the cost is the tool call, not the write —
 * and gating on `dopl.write` would make read-only agents free.
 *
 * `allowed: false` still answers 200, not 402: the caller is the MCP layer,
 * which owns the refusal wording and renders it as a tool result. A 402 here
 * would have to be caught and unwrapped by the same code that already has to
 * read `allowed`.
 */
export const POST = withWorkspaceAuth(
  async (_request, { workspaceId }) => {
    try {
      return NextResponse.json(await consumeMcpCredits(workspaceId));
    } catch (err) {
      // ── FAIL OPEN. DECIDED, NOT INHERITED. ────────────────────────────
      // A credits gate that fails CLOSED on a DB blip bricks every agent in
      // the product: the registrar refuses the tool call, and the operator
      // sees "out of credits" for a workspace that is not. The only thing
      // this gate is allowed to hard-block on is a counter that really is
      // exhausted; infrastructure failures allow the call and are logged.
      // (Contrast `shared/auth/mcp-session.ts › checkAndRecordRateLimitSubject`,
      // which fails CLOSED — abuse limiting and billing want opposite defaults.)
      console.error(
        `[credits] consume failed for workspace ${workspaceId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return NextResponse.json(failOpen());
    }
  },
  { writeScopeExempt: true }
);

/**
 * The degraded answer. `allowed: true` is the load-bearing field; the counters
 * are zeroed and `degraded` says so, because nothing was measured — reporting
 * a made-up `used` would put a wrong number on the settings meter.
 */
function failOpen(): CreditConsumeResult & { degraded: true } {
  return {
    // No row was read and no verdict was resolved, so the window is the one a
    // workspace with no subscription state gets: the UTC calendar month.
    ...creditPeriodFor(null, "free"),
    allowed: true,
    used: 0,
    limit: 0,
    remaining: 0,
    upgradeUrl: "",
    degraded: true,
  };
}
