import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * Residual per-user Stripe references, still stored on `profiles`.
 *
 * The per-user subscription model is retired — billing is container-level (see
 * workspace-billing.ts / entitlements.ts), one row per `workspaces` row keyed by
 * container id. The profiles.subscription_* columns are intentionally not dropped
 * but are no longer written. Two things still read from here: the one grandfathered
 * live subscription, which the webhook maps to a workspace via the profile's
 * stripe_customer_id, and account deletion cancelling it by its stored id.
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
 * User behind a Stripe customer id — grandfather mapping ONLY (legacy customer
 * id lives on the profile; new customers live on workspace_billing).
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
