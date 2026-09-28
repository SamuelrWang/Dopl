import "server-only";
import type Stripe from "stripe";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { logSystemEvent } from "@/features/analytics/server/system-events";
import { getStripe } from "./stripe";

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

/*
 * 🔒 THE PROFILE IS A CLAIM, NOT A MAPPING (db-cleanup audit, 2026-09-28).
 *
 * `profiles` has been user-UPDATABLE through PostgREST (policy `profiles_update_own`
 * + a table-wide UPDATE grant to `authenticated`), so `stripe_customer_id` and
 * `stripe_subscription_id` are whatever the row's owner last wrote. Until the held
 * migration `20261110160000_profiles_update_column_grants.sql` is released, reading
 * them as ownership lets a user (a) attach a Stripe customer they do not own to
 * themselves in the webhook's grandfather path, or (b) cancel someone else's
 * subscription by deleting their own account.
 *
 * So both reads below VERIFY against Stripe, which is authoritative:
 *   - the customer's `metadata.user_id`, when Stripe carries one, must be this user;
 *   - otherwise the customer's email must equal the user's AUTH email (auth.users,
 *     not `profiles.email`, which is user-writable too);
 *   - exactly one profile may claim the customer — two claimants is a refusal.
 * A failed check returns "no legacy reference" and records a `billing` system event.
 * A Stripe/auth OUTAGE throws: the callers fail closed on that, they do not guess.
 */

const SOURCE = "billing/legacy-customer";

async function flagMismatch(
  message: string,
  userId: string | null,
  metadata: Record<string, unknown>
): Promise<void> {
  console.error(`[billing] ${message}`, metadata);
  await logSystemEvent({
    severity: "error",
    category: "billing",
    source: SOURCE,
    message,
    fingerprintKeys: ["billing", SOURCE, message],
    metadata,
    userId,
  });
}

function normalizeEmail(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e ? e : null;
}

/**
 * Does Stripe agree that `customerId` belongs to `userId`? Throws on a Stripe or
 * auth outage; `false` (flagged) on a real mismatch.
 */
async function stripeCustomerBelongsTo(
  customerId: string,
  userId: string
): Promise<boolean> {
  const customer = await getStripe().customers.retrieve(customerId);
  if ("deleted" in customer && customer.deleted) {
    await flagMismatch("Legacy Stripe customer is deleted", userId, { customerId });
    return false;
  }
  const live = customer as Stripe.Customer;

  const metaUserId = live.metadata?.user_id;
  if (metaUserId) {
    if (metaUserId === userId) return true;
    await flagMismatch("Legacy Stripe customer metadata names a different user", userId, {
      customerId,
    });
    return false;
  }

  const { data, error } = await supabaseAdmin().auth.admin.getUserById(userId);
  if (error) throw error;
  const authEmail = normalizeEmail(data.user?.email);
  const customerEmail = normalizeEmail(live.email);
  if (authEmail && customerEmail && authEmail === customerEmail) return true;
  await flagMismatch("Legacy Stripe customer email does not match the claiming user", userId, {
    customerId,
  });
  return false;
}

/**
 * The caller's legacy per-user Stripe references, VERIFIED (see above). Used by
 * account deletion to cancel the one grandfathered subscription: an unverified
 * subscription id comes back `null`, so deleting an account can never cancel a
 * subscription the account does not own.
 */
export async function getProfileBillingRef(
  userId: string
): Promise<ProfileBillingRef> {
  const { data } = await supabaseAdmin()
    .from("profiles")
    .select("stripe_customer_id, stripe_subscription_id")
    .eq("id", userId)
    .single();

  const customerId: string | null = data?.stripe_customer_id ?? null;
  const subscriptionId: string | null = data?.stripe_subscription_id ?? null;
  const none: ProfileBillingRef = { stripeCustomerId: null, stripeSubscriptionId: null };
  if (!customerId) {
    if (subscriptionId) {
      await flagMismatch("Legacy subscription id on a profile with no customer", userId, {
        subscriptionId,
      });
    }
    return none;
  }
  if (!(await stripeCustomerBelongsTo(customerId, userId))) return none;
  if (!subscriptionId) return { stripeCustomerId: customerId, stripeSubscriptionId: null };

  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  const subCustomer =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  if (subCustomer !== customerId) {
    await flagMismatch("Legacy subscription belongs to a different Stripe customer", userId, {
      customerId,
      subscriptionId,
    });
    return { stripeCustomerId: customerId, stripeSubscriptionId: null };
  }
  return { stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId };
}

/**
 * User behind a Stripe customer id — grandfather mapping ONLY (legacy customer
 * id lives on the profile; new customers live on workspace_billing). VERIFIED:
 * two claimants, or a claimant Stripe disagrees with, resolves to nobody.
 */
export async function getUserByStripeCustomer(
  stripeCustomerId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", stripeCustomerId)
    .limit(2);
  if (error) throw error;

  const rows = (data ?? []) as Array<{ id: string }>;
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    await flagMismatch("Legacy Stripe customer is claimed by more than one profile", null, {
      customerId: stripeCustomerId,
      userIds: rows.map((r) => r.id),
    });
    return null;
  }
  const userId = rows[0].id;
  return (await stripeCustomerBelongsTo(stripeCustomerId, userId)) ? userId : null;
}
