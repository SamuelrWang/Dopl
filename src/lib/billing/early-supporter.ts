import { supabaseAdmin } from "@/shared/supabase/admin";

export type EarlySupporterClaimResult =
  | { granted: true; amount: number; slot_number: number }
  | { granted: false; reason: "already_claimed" | "promo_full" | "no_profile" | "rpc_error" };

/**
 * Best-effort attempt to claim the early-supporter grant for a freshly
 * authenticated user. Calls the atomic Postgres RPC which handles
 * idempotency, the 100-slot cap, and the credit grant in a single
 * transaction.
 *
 * Never throws — the caller should not let a grant failure block sign-in.
 */
export async function tryClaimEarlySupporterGrant(
  userId: string
): Promise<EarlySupporterClaimResult> {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase.rpc("claim_early_supporter_grant", {
    p_user_id: userId,
  });

  if (error) {
    return { granted: false, reason: "rpc_error" };
  }

  // RPC returns jsonb directly; supabase-js surfaces it as the raw object.
  return data as EarlySupporterClaimResult;
}
