import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { WalletKind } from "../credits";
import type { CreditLedgerAttribution } from "./credit-ledger";

/**
 * The two wallet counters — repository only (INVARIANTS §2). One atomic spend and
 * one meter read per wallet: the numbers live in `../credits.ts`, the routing in
 * `./credits-service.ts`.
 *
 * F-693 (2026-09-13): a spend writes the counter and the ledger row in one
 * transaction. Both consume RPCs take the ledger's dimensions as a trailing
 * {@link CreditLedgerAttribution} and insert `credit_usage_events` themselves, so
 * there is no second write to sequence: a refused consume inserts nothing, a failed
 * insert aborts the counter move, and the RPC throwing is the only way attribution
 * can go missing.
 *
 * 2026-09-07: both counters are per-payer. `user_credit_usage` keys on the person,
 * `workspace_member_credit_usage` on (workspace, person) — the pooled
 * (workspace, period) row could not express "each member gets a fixed 5,000".
 *
 * Kept separate from `workspace-billing.ts`, which every suite in this feature
 * mocks wholesale: folding wallet writes back in would put a mock for the hottest
 * write path in the product into every entitlements test.
 *
 * Both consume functions throw on a DB error; the fail direction is the route's
 * decision, and `POST /api/mcp/credits/consume` fails open.
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
 * Atomic cross-instance compare-and-set in Postgres (one upsert-CAS statement, no
 * advisory lock), so two concurrent tool calls can never both spend the last credit.
 *
 * `attribution` is not logging: it is the `credit_usage_events` row this spend
 * writes in the same transaction. `userId` is the PAYER; the caller is
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
 * The limit is this member's, not the workspace's: nothing sums or divides by the
 * seat count, so a member out of credits stays out while a colleague's seat is
 * untouched.
 *
 * `workspaceId` is the charged container, `attribution.originWorkspaceId` the
 * addressed one, and under rule B they differ. Passing one where the other belongs
 * files the burn in the wrong place.
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
 * No row means zero — the counter row is created by the first consume of a period,
 * so "made no MCP call this month" and "used 0" are the same state.
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
 * Cross-workspace on purpose, and not a pool: nothing here decides an allowance.
 * The ledger row records the ADDRESSED container, so a per-workspace ledger sum
 * would drop every cross-container seat burn and read as drift; both sides key on
 * (payer, period) instead. Seats on different subscription anchors have different
 * `period_start` values and drop out of both sides by the same filter.
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
 * An RPC because PostgREST cannot aggregate (see
 * `home/server/repository-overview.ts › scanCreditEvents`, which tallies a capped
 * haul instead). A capped haul is a floor, and a floor cannot measure a difference
 * — it would report the cap as drift. One `SUM` in Postgres is exact.
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
