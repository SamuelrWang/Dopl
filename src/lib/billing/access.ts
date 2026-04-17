import { supabaseAdmin } from "@/lib/supabase";

/**
 * Single source of truth for whether a user can take any gated action
 * (ingestion, MCP tool calls, chat tool use).
 *
 * Replaces the old credit-balance checks. No credit math happens here
 * or anywhere downstream — access is a pure function of trial window +
 * Stripe subscription status.
 */

export type AccessReason =
  | "trialing"       // inside 24h trial window
  | "paid"           // active Stripe subscription
  | "expired"        // trial ended, no paid sub
  | "never_started"; // trial_started_at is null (should be rare — auth callback stamps it)

export interface AccessDecision {
  allowed: boolean;
  reason: AccessReason;
  trial_expires_at: string | null;
}

export async function hasActiveAccess(
  userId: string
): Promise<AccessDecision> {
  const { data } = await supabaseAdmin()
    .from("profiles")
    .select(
      "subscription_status, trial_started_at, trial_expires_at"
    )
    .eq("id", userId)
    .single();

  const status = data?.subscription_status || "expired";
  const trialStartedAt = data?.trial_started_at as string | null;
  const trialExpiresAt = data?.trial_expires_at as string | null;

  // Paid wins unconditionally.
  if (status === "active") {
    return { allowed: true, reason: "paid", trial_expires_at: trialExpiresAt };
  }

  // No trial stamped at all — auth callback didn't run (possible for
  // pre-existing users, edge cases). Treat as expired so gated routes
  // paywall them; they can subscribe without issue.
  if (!trialStartedAt || !trialExpiresAt) {
    return {
      allowed: false,
      reason: "never_started",
      trial_expires_at: null,
    };
  }

  // Trial active if current time is before expiry.
  const now = Date.now();
  const expiresMs = new Date(trialExpiresAt).getTime();
  if (now < expiresMs) {
    return {
      allowed: true,
      reason: "trialing",
      trial_expires_at: trialExpiresAt,
    };
  }

  return {
    allowed: false,
    reason: "expired",
    trial_expires_at: trialExpiresAt,
  };
}

/**
 * Structured JSON error body returned by every gated route when access
 * is denied. Keeps the shape consistent so agents/clients can surface a
 * single "subscribe to continue" UX regardless of which endpoint 402'd.
 */
export function accessDeniedBody(decision: AccessDecision) {
  return {
    error: "trial_expired",
    message:
      decision.reason === "never_started"
        ? "No trial on file. Sign in or subscribe to continue."
        : "Your free trial has ended. Subscribe for $7.99/mo to continue.",
    reason: decision.reason,
    trial_expires_at: decision.trial_expires_at,
    subscribe_url: `${
      process.env.NEXT_PUBLIC_APP_URL || "https://www.usedopl.com"
    }/pricing`,
  };
}
