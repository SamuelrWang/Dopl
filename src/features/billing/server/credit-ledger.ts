import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * THE CREDIT ATTRIBUTION LEDGER'S WRITER — one row per successful burn.
 *
 * 🔒 **IT IS NOT THE BILLING COUNTER AND IT MAY NOT BEHAVE LIKE ONE.**
 * `workspace_credit_usage` + `consume_workspace_credits` remain the sole
 * authority on whether a call is allowed and how much of the allowance is gone.
 * This table answers a different question — WHICH CHANNEL and WHICH PERSON the
 * period's credits went to — which a one-row-per-period counter cannot
 * (F-328). `20260901120000_credit_usage_events.sql` carries the full argument.
 *
 * ⚠ **FIRE-AND-FORGET, AND THAT IS A DECISION WITH A STATED COST.** This runs
 * on the hottest write path in the product, AFTER the spend is already
 * committed, and a failure here must never turn a successful, already-charged
 * call into an error the agent sees. So it swallows — and therefore the ledger
 * MAY UNDER-COUNT. Every reader treats `SUM(amount)` as a FLOOR, the same way
 * the /home Overview's rails already treat their bounded scans.
 * ⚠ The inverse is forbidden: `20260811130000_mcp_credits.sql`'s header rules
 * out building ENFORCEMENT on a writer allowed to drop writes, and nothing here
 * changes that. The counter is not written from this file.
 */

/** One burn, as the ledger records it. */
export interface CreditUsageEvent {
  /** The PAYER — whose counter actually moved. */
  workspaceId: string;
  /**
   * WHERE the call was made: the addressed workspace, which for a home channel
   * is the `kind='link'` CONTAINER. ⚠ This is the "by channel" dimension — a
   * container holds exactly one channel — and it is NOT `workspaceId` whenever
   * the burn was rerouted to a container owner's billing workspace.
   */
  originWorkspaceId: string | null;
  /** Who burned it. `null` only when the caller could not be identified. */
  userId: string | null;
  amount: number;
  /** The period key the counter used — stamped, never derived from `created_at`
   *  (a paid workspace's period is anchored to its subscription date). */
  periodStart: string;
}

/**
 * Record one burn. **Never throws, never rejects.**
 *
 * ⚠ NOT `await`ed BY ITS CALLER on the critical path — `consumeMcpCredits`
 * fires it and returns. It is exported as an ordinary async function so tests
 * can await it directly; production ordering is deliberately unobserved.
 */
export async function recordCreditUsageEvent(
  event: CreditUsageEvent
): Promise<void> {
  try {
    // ⚠ A REFUSED CONSUME WRITES NOTHING. The caller gates on `allowed`, and
    // this guard is the second half of that rule: a zero or negative amount is
    // a reporting bug, and the table's own CHECK would reject it — turning a
    // swallowed no-op into a swallowed ERROR that looks identical in the logs.
    if (!(event.amount > 0)) return;
    const { error } = await supabaseAdmin()
      .from("credit_usage_events")
      .insert({
        workspace_id: event.workspaceId,
        origin_workspace_id: event.originWorkspaceId,
        user_id: event.userId,
        amount: event.amount,
        period_start: event.periodStart,
      });
    if (error) throw error;
  } catch (err) {
    // ⚠ WARN, NOT ERROR, and it says what was lost: an attribution row, not a
    // credit. The counter already moved; the meter is still right.
    console.warn(
      `[credits] ledger write dropped for workspace ${event.workspaceId}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}
