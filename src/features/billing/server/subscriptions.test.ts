/**
 * 🔒 The legacy per-user Stripe references on `profiles` are USER-WRITABLE claims
 * (db-cleanup audit, 2026-09-28), so neither read may treat them as ownership:
 *   - the webhook's grandfather mapping (`getUserByStripeCustomer`) refuses two
 *     claimants and any claimant Stripe disagrees with;
 *   - account deletion (`getProfileBillingRef`) never hands back a subscription id
 *     whose Stripe customer is not verifiably the caller's.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  profileRow: null as Record<string, unknown> | null,
  claimants: [] as Array<{ id: string }>,
  authEmail: "owner@example.com" as string | null,
  authError: null as Error | null,
}));

vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: state.profileRow, error: null }),
        limit: async () => ({ data: state.claimants, error: null }),
      };
      return chain;
    },
    auth: {
      admin: {
        getUserById: async () => ({
          data: { user: state.authEmail ? { email: state.authEmail } : null },
          error: state.authError,
        }),
      },
    },
  }),
}));

const stripe = vi.hoisted(() => ({
  customers: { retrieve: vi.fn() },
  subscriptions: { retrieve: vi.fn() },
}));
vi.mock("./stripe", () => ({ getStripe: () => stripe }));
vi.mock("@/features/analytics/server/system-events", () => ({
  logSystemEvent: vi.fn(async () => undefined),
}));

import { logSystemEvent } from "@/features/analytics/server/system-events";
import { getProfileBillingRef, getUserByStripeCustomer } from "./subscriptions";

const USER = "user-1";
const CUS = "cus_legacy";
const SUB = "sub_legacy";

function customer(fields: { email?: string | null; metadata?: Record<string, string> }) {
  return { id: CUS, email: fields.email ?? null, metadata: fields.metadata ?? {} };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  state.profileRow = null;
  state.claimants = [];
  state.authEmail = "owner@example.com";
  state.authError = null;
  stripe.customers.retrieve.mockResolvedValue(customer({ email: "owner@example.com" }));
  stripe.subscriptions.retrieve.mockResolvedValue({ id: SUB, customer: CUS });
});

describe("getUserByStripeCustomer — the webhook grandfather mapping", () => {
  it("resolves the single claimant when Stripe's email matches the AUTH email", async () => {
    state.claimants = [{ id: USER }];
    stripe.customers.retrieve.mockResolvedValue(customer({ email: " Owner@Example.com " }));
    await expect(getUserByStripeCustomer(CUS)).resolves.toBe(USER);
    expect(logSystemEvent).not.toHaveBeenCalled();
  });

  it("resolves on matching customer metadata.user_id without needing the email", async () => {
    state.claimants = [{ id: USER }];
    state.authEmail = null;
    stripe.customers.retrieve.mockResolvedValue(
      customer({ email: "other@example.com", metadata: { user_id: USER } })
    );
    await expect(getUserByStripeCustomer(CUS)).resolves.toBe(USER);
  });

  it("REFUSES a claimant whose email Stripe does not recognise, and flags it", async () => {
    state.claimants = [{ id: USER }];
    stripe.customers.retrieve.mockResolvedValue(customer({ email: "victim@example.com" }));
    await expect(getUserByStripeCustomer(CUS)).resolves.toBeNull();
    expect(logSystemEvent).toHaveBeenCalledWith(
      expect.objectContaining({ category: "billing", severity: "error" })
    );
  });

  it("REFUSES when customer metadata names a different user, even if emails match", async () => {
    state.claimants = [{ id: USER }];
    stripe.customers.retrieve.mockResolvedValue(
      customer({ email: "owner@example.com", metadata: { user_id: "someone-else" } })
    );
    await expect(getUserByStripeCustomer(CUS)).resolves.toBeNull();
    expect(logSystemEvent).toHaveBeenCalled();
  });

  it("REFUSES two claimants without asking Stripe to pick one", async () => {
    state.claimants = [{ id: USER }, { id: "attacker" }];
    await expect(getUserByStripeCustomer(CUS)).resolves.toBeNull();
    expect(stripe.customers.retrieve).not.toHaveBeenCalled();
    expect(logSystemEvent).toHaveBeenCalled();
  });

  it("REFUSES a deleted Stripe customer", async () => {
    state.claimants = [{ id: USER }];
    stripe.customers.retrieve.mockResolvedValue({ id: CUS, deleted: true });
    await expect(getUserByStripeCustomer(CUS)).resolves.toBeNull();
  });

  it("returns null with no claimant and never calls Stripe", async () => {
    await expect(getUserByStripeCustomer(CUS)).resolves.toBeNull();
    expect(stripe.customers.retrieve).not.toHaveBeenCalled();
  });

  it("THROWS on a Stripe outage rather than guessing (the webhook retries)", async () => {
    state.claimants = [{ id: USER }];
    stripe.customers.retrieve.mockRejectedValue(new Error("stripe down"));
    await expect(getUserByStripeCustomer(CUS)).rejects.toThrow("stripe down");
  });
});

describe("getProfileBillingRef — account deletion's legacy cancel", () => {
  it("returns the subscription when customer and subscription both verify", async () => {
    state.profileRow = { stripe_customer_id: CUS, stripe_subscription_id: SUB };
    await expect(getProfileBillingRef(USER)).resolves.toEqual({
      stripeCustomerId: CUS,
      stripeSubscriptionId: SUB,
    });
  });

  it("DROPS a subscription that belongs to another Stripe customer (no cross-account cancel)", async () => {
    state.profileRow = { stripe_customer_id: CUS, stripe_subscription_id: "sub_victim" };
    stripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_victim",
      customer: { id: "cus_victim" },
    });
    await expect(getProfileBillingRef(USER)).resolves.toEqual({
      stripeCustomerId: CUS,
      stripeSubscriptionId: null,
    });
    expect(logSystemEvent).toHaveBeenCalled();
  });

  it("DROPS everything when the customer itself does not verify", async () => {
    state.profileRow = { stripe_customer_id: "cus_victim", stripe_subscription_id: SUB };
    stripe.customers.retrieve.mockResolvedValue(customer({ email: "victim@example.com" }));
    await expect(getProfileBillingRef(USER)).resolves.toEqual({
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });

  it("DROPS a subscription id on a profile with no customer id", async () => {
    state.profileRow = { stripe_customer_id: null, stripe_subscription_id: "sub_victim" };
    await expect(getProfileBillingRef(USER)).resolves.toEqual({
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });
    expect(stripe.customers.retrieve).not.toHaveBeenCalled();
    expect(logSystemEvent).toHaveBeenCalled();
  });

  it("returns nothing and asks Stripe nothing for a profile with no legacy ids", async () => {
    state.profileRow = { stripe_customer_id: null, stripe_subscription_id: null };
    await expect(getProfileBillingRef(USER)).resolves.toEqual({
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });
    expect(stripe.customers.retrieve).not.toHaveBeenCalled();
  });

  it("THROWS on an auth lookup failure so the delete route fails closed", async () => {
    state.profileRow = { stripe_customer_id: CUS, stripe_subscription_id: SUB };
    state.authError = new Error("auth down");
    await expect(getProfileBillingRef(USER)).rejects.toThrow("auth down");
  });
});
