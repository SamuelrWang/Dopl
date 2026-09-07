import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * THE TWO WALLET COUNTERS — repository only (INVARIANTS §2). One atomic spend
 * and one meter read per wallet, and nothing else: the numbers live in
 * `../credits.ts`, the routing in `./credits-service.ts`.
 *
 * 🔒 **BOTH COUNTERS ARE PER-PAYER, WHICH IS THE WHOLE POINT OF THE WAVE**
 * (Samuel, 2026-09-07). `workspace_credit_usage` was one pooled row per
 * (workspace, period) and could not express "each member gets a fixed 5,000".
 * `user_credit_usage` keys on the person; `workspace_member_credit_usage` keys
 * on (workspace, person). Migration `20260930120000_credit_wallets.sql`.
 *
 * ⚠ **A SEPARATE MODULE FROM `workspace-billing.ts`, DELIBERATELY.** That file
 * is the `workspace_billing` row plus the two counts the entitlement layer
 * needs, and every suite in this feature mocks it wholesale. Wallet writes are a
 * different table, a different key and a different lifecycle; folding them back
 * in means every entitlements test carries a mock for the hottest write path in
 * the product.
 *
 * ⚠ Both consume functions THROW on a DB error. The fail DIRECTION is the
 * route's decision, and `POST /api/mcp/credits/consume` fails OPEN.
 */

/** One atomic credit spend: allowed?, plus the counter AFTER the attempt
 *  (unchanged when refused, so a refusal renders `used/limit` with no second
 *  read). */
export interface CreditConsumeRow {
  allowed: boolean;
  used: number;
}

/** `RETURNS TABLE` arrives as a one-row array; both RPCs share the unwrap. */
function firstRow(data: unknown, rpc: string): CreditConsumeRow {
  const row = (data as { allowed: boolean; used: number }[] | null)?.[0];
  if (!row) throw new Error(`${rpc} returned no row`);
  return { allowed: row.allowed === true, used: row.used ?? 0 };
}

/**
 * Spend `amount` from the PERSONAL wallet of `userId` for `periodStart`,
 * refusing past `limit`.
 *
 * ⚠ Atomic cross-instance compare-and-set in Postgres (`consume_user_credits`,
 * one upsert-CAS statement, no advisory lock), so two concurrent tool calls in
 * two different home containers can never both spend the last credit.
 */
export async function consumeUserCredits(
  userId: string,
  periodStart: string,
  amount: number,
  limit: number
): Promise<CreditConsumeRow> {
  const { data, error } = await supabaseAdmin().rpc("consume_user_credits", {
    p_user_id: userId,
    p_period_start: periodStart,
    p_amount: amount,
    p_limit: limit,
  });
  if (error) throw error;
  return firstRow(data, "consume_user_credits");
}

/**
 * Spend `amount` from `userId`'s SEAT in `workspaceId` for `periodStart`,
 * refusing past `limit`. Same CAS shape as above, one key wider.
 *
 * ⚠ **THE LIMIT IS THIS MEMBER'S, NOT THE WORKSPACE'S.** Nothing here sums or
 * divides by the seat count: the allocation is fixed per member and is not
 * pooled, so a member out of credits stays out even while a colleague's seat is
 * untouched.
 */
export async function consumeMemberCredits(
  workspaceId: string,
  userId: string,
  periodStart: string,
  amount: number,
  limit: number
): Promise<CreditConsumeRow> {
  const { data, error } = await supabaseAdmin().rpc("consume_member_credits", {
    p_workspace_id: workspaceId,
    p_user_id: userId,
    p_period_start: periodStart,
    p_amount: amount,
    p_limit: limit,
  });
  if (error) throw error;
  return firstRow(data, "consume_member_credits");
}

/**
 * Credits spent from a personal wallet in `(userId, periodStart)`.
 *
 * ⚠ NO ROW MEANS ZERO — the counter row is created by the first consume of a
 * period, so "made no MCP call this month" and "used 0" are the same state.
 */
export async function getUserCreditsUsed(
  userId: string,
  periodStart: string
): Promise<number> {
  const { data, error } = await supabaseAdmin()
    .from("user_credit_usage")
    .select("used")
    .eq("user_id", userId)
    .eq("period_start", periodStart)
    .maybeSingle();
  if (error) throw error;
  return (data as { used: number } | null)?.used ?? 0;
}

/** Credits spent from one seat in `(workspaceId, userId, periodStart)`. No row
 *  means zero, same as above. */
export async function getMemberCreditsUsed(
  workspaceId: string,
  userId: string,
  periodStart: string
): Promise<number> {
  const { data, error } = await supabaseAdmin()
    .from("workspace_member_credit_usage")
    .select("used")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("period_start", periodStart)
    .maybeSingle();
  if (error) throw error;
  return (data as { used: number } | null)?.used ?? 0;
}
