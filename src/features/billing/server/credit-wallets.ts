import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { WalletKind } from "../credits";
import type { CreditLedgerAttribution } from "./credit-ledger";

/**
 * THE TWO WALLET COUNTERS — repository only (INVARIANTS §2). One atomic spend
 * and one meter read per wallet, and nothing else: the numbers live in
 * `../credits.ts`, the routing in `./credits-service.ts`.
 *
 * 🔒 **A SPEND WRITES THE COUNTER AND THE LEDGER ROW IN ONE TRANSACTION SINCE
 * 2026-09-13** (Samuel: "the histogram must equal the wallet, always"; F-693,
 * `supabase/migrations/20261004120000_credit_consume_with_ledger.sql`). Both
 * consume RPCs take the ledger's own dimensions as a trailing
 * {@link CreditLedgerAttribution} and insert `credit_usage_events` themselves.
 * ⚠ **THERE IS NO SECOND WRITE TO SEQUENCE AND NO `console.warn`-AND-CONTINUE
 * PATH LEFT**: a refused consume inserts nothing, and an insert that fails aborts
 * the counter move with it, so the RPC throwing is the ONLY way attribution can
 * be missing — and a throw is what the route's fail-open already handles.
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
 *
 * ⚠ **`attribution` IS NOT OPTIONAL AND IS NOT LOGGING.** It is the
 * `credit_usage_events` row this spend writes, in the same transaction — the
 * /home histogram's only source. `userId` here is the PAYER; the CALLER is
 * `attribution.callerUserId`, and the two differ exactly on the guest path.
 */
export async function consumeUserCredits(
  userId: string,
  periodStart: string,
  amount: number,
  limit: number,
  attribution: CreditLedgerAttribution
): Promise<CreditConsumeRow> {
  const { data, error } = await supabaseAdmin().rpc("consume_user_credits", {
    p_user_id: userId,
    p_period_start: periodStart,
    p_amount: amount,
    p_limit: limit,
    p_origin_workspace_id: attribution.originWorkspaceId,
    p_caller_user_id: attribution.callerUserId,
    p_channel_id: attribution.channelId,
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
 *
 * ⚠ **`workspaceId` IS THE CHARGED CONTAINER AND
 * `attribution.originWorkspaceId` IS THE ADDRESSED ONE, AND UNDER RULE B THEY
 * DIFFER** — a workspace-channel agent reaching into a personal KB charges the
 * seat while addressing the shelf. Passing one where the other belongs bills the
 * right wallet and files the burn in the wrong place, or the reverse.
 */
export async function consumeMemberCredits(
  workspaceId: string,
  userId: string,
  periodStart: string,
  amount: number,
  limit: number,
  attribution: CreditLedgerAttribution
): Promise<CreditConsumeRow> {
  const { data, error } = await supabaseAdmin().rpc("consume_member_credits", {
    p_workspace_id: workspaceId,
    p_user_id: userId,
    p_period_start: periodStart,
    p_amount: amount,
    p_limit: limit,
    p_origin_workspace_id: attribution.originWorkspaceId,
    p_caller_user_id: attribution.callerUserId,
    p_channel_id: attribution.channelId,
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

/**
 * Every seat counter this person holds for `periodStart`, summed — the SEAT
 * wallet's half of the reconciliation guard (`credits-audit.ts`).
 *
 * ⚠ **CROSS-WORKSPACE ON PURPOSE, AND IT IS NOT A POOL.** Nothing here decides an
 * allowance; the seat allocation is still fixed per (workspace, member) and
 * `getMemberCreditsUsed` is what a meter reads. This answers the ONE question the
 * ledger can be compared on: the ledger row records the ADDRESSED container, not
 * the charged one, so a per-workspace ledger sum would drop every cross-container
 * seat burn and read as drift. Both sides therefore key on (payer, period).
 *
 * ⚠ Seats in workspaces on DIFFERENT subscription anchors have different
 * `period_start` values and are correctly excluded by the same filter on both
 * sides — that is what makes the comparison exact rather than approximate.
 */
export async function sumMemberCreditsUsed(
  userId: string,
  periodStart: string
): Promise<number> {
  const { data, error } = await supabaseAdmin()
    .from("workspace_member_credit_usage")
    .select("used")
    .eq("user_id", userId)
    .eq("period_start", periodStart);
  if (error) throw error;
  return ((data as { used: number }[] | null) ?? []).reduce(
    (total, row) => total + (row.used ?? 0),
    0
  );
}

/**
 * One wallet's ATTRIBUTION total for a period — `SUM(amount)` over
 * `credit_usage_events`, keyed exactly as the counter is.
 *
 * ⚠ **AN RPC BECAUSE POSTGREST CANNOT AGGREGATE** (the constraint
 * `home/server/repository-overview.ts › scanCreditEvents` records, where the
 * answer was a capped haul tallied in the service). A capped haul is a FLOOR, and
 * a floor cannot measure a DIFFERENCE — it would report the cap as drift. One
 * `SUM` in Postgres is exact and is one round trip
 * (`20261004120000_credit_consume_with_ledger.sql` §4).
 */
export async function sumCreditLedger(
  payerUserId: string,
  wallet: WalletKind,
  periodStart: string
): Promise<number> {
  const { data, error } = await supabaseAdmin().rpc("credit_ledger_sum", {
    p_payer_user_id: payerUserId,
    p_wallet: wallet,
    p_period_start: periodStart,
  });
  if (error) throw error;
  return typeof data === "number" ? data : 0;
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
