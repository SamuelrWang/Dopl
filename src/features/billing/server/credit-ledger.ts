import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { WalletKind } from "../credits";

/**
 * THE CREDIT ATTRIBUTION LEDGER'S WRITER — one row per successful burn.
 *
 * 🔒 **IT IS NOT THE BILLING COUNTER AND IT MAY NOT BEHAVE LIKE ONE.**
 * The WALLET COUNTERS (`credit-wallets.ts` → `user_credit_usage`,
 * `workspace_member_credit_usage`) remain the sole authority on whether a call
 * is allowed and how much of the allowance is gone. ⚠ That sentence named
 * `workspace_credit_usage` until 2026-09-07; the pooled counter is retired from
 * writes (`20260930120000_credit_wallets.sql` §5) and the argument is unchanged.
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

/**
 * One burn, as the ledger records it.
 *
 * 🔒 **THE PAYER IS A PERSON NOW, NOT A WORKSPACE (2026-09-07, Samuel's
 * per-seat + personal-wallet ruling), AND THAT MOVED WHAT `workspaceId` MEANS.**
 * It used to be the payer — for a home burn, the owner's separate standard
 * workspace. There is no such workspace on the credit path any more, so the
 * column holds the ADDRESSED CONTAINER and `payerUserId` carries the payer.
 * The row's four dimensions are now: where (`workspaceId` /
 * `originWorkspaceId`), who called (`userId`), whose wallet (`payerUserId`),
 * which wallet (`wallet`).
 */
export interface CreditUsageEvent {
  /**
   * THE ADDRESSED CONTAINER — the workspace row the caller was authorized into.
   * ⚠ Equal to `originWorkspaceId` on every row this build writes; both are
   * kept because the column is `NOT NULL` with an FK (so it cannot hold a
   * person) and `/home`'s rails read the origin. ⚠ It is NOT the payer.
   */
  workspaceId: string;
  /**
   * WHERE the call was made: the addressed workspace, which for a home channel
   * is the `kind='link'` CONTAINER. ⚠ This is the "by channel" dimension — a
   * container holds exactly one channel.
   */
  originWorkspaceId: string | null;
  /** Who burned it. `null` only when the caller could not be identified. */
  userId: string | null;
  /** WHICH COUNTER MOVED — `credit-wallets.ts`'s two tables. */
  wallet: WalletKind;
  /**
   * THE PAYER — whose wallet moved. The container OWNER on a personal burn
   * (which is not the caller when a peer made the call), the caller themself on
   * a seat burn. ⚠ This is the column "who spent my credits" reads; `userId`
   * answers a different question and the two differ exactly on the guest path.
   */
  payerUserId: string | null;
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
        wallet: event.wallet,
        payer_user_id: event.payerUserId,
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
