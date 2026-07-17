import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * Residual per-user Stripe references, still stored on `profiles`.
 *
 * The per-user subscription model (tier / status / 24h trial) is RETIRED —
 * billing is now workspace-level (see workspace-billing.ts / entitlements.ts).
 * The profiles.subscription_* columns are intentionally NOT dropped, but they
 * are no longer written. Two things still read from here:
 *   1. The ONE grandfathered live subscription is tied to a profile's
 *      stripe_customer_id — the webhook maps it to a workspace via this.
 *   2. Account deletion cancels the legacy subscription by its stored id.
 */

export interface ProfileBillingRef {
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export async function getProfileBillingRef(
  userId: string
): Promise<ProfileBillingRef> {
  const { data } = await supabaseAdmin()
    .from("profiles")
    .select("stripe_customer_id, stripe_subscription_id")
    .eq("id", userId)
    .single();

  return {
    stripeCustomerId: data?.stripe_customer_id ?? null,
    stripeSubscriptionId: data?.stripe_subscription_id ?? null,
  };
}

/**
 * Find the user behind a Stripe customer id (grandfather mapping only —
 * the legacy customer id lives on the profile; new customers live on
 * workspace_billing).
 */
export async function getUserByStripeCustomer(
  stripeCustomerId: string
): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();

  return (data as { id: string } | null)?.id ?? null;
}
