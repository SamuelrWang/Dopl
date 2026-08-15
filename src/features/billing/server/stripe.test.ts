/**
 * Where Stripe sends the browser back. A checkout session is redeemed minutes
 * to days later and a portal session outlives its tab, so these two
 * `return_url` strings get a test of their own: the failure mode is a customer
 * who paid landing on a redirect that no longer exists.
 *
 * Stripe SDK faked at the module boundary — no network, no session created.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";

const captured = vi.hoisted(() => ({
  checkout: null as Stripe.Checkout.SessionCreateParams | null,
  portal: null as Stripe.BillingPortal.SessionCreateParams | null,
}));

vi.mock("stripe", () => ({
  default: class FakeStripe {
    checkout = {
      sessions: {
        create: async (params: Stripe.Checkout.SessionCreateParams) => {
          captured.checkout = params;
          return { client_secret: "cs_test_secret" };
        },
      },
    };
    billingPortal = {
      sessions: {
        create: async (params: Stripe.BillingPortal.SessionCreateParams) => {
          captured.portal = params;
          return { url: "https://billing.stripe.com/p/session_123" };
        },
      },
    };
  },
}));

import { createPortalSession, createWorkspaceCheckoutSession } from "./stripe";

const SEGMENT = "acme-ab12cd34ef56";

beforeEach(() => {
  captured.checkout = null;
  captured.portal = null;
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
  vi.stubEnv("STRIPE_SOLO_PRICE_ID", "price_solo");
  vi.stubEnv("STRIPE_PRO_SEAT_PRICE_ID", "price_seat");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.usedopl.com");
});

async function checkout(segment?: string | null) {
  await createWorkspaceCheckoutSession({
    workspaceId: "ws-1",
    plan: "team",
    quantity: 3,
    email: "a@b.com",
    segment,
  });
  return captured.checkout!.return_url!;
}

describe("the checkout return", () => {
  it("lands on the billing page for the workspace that was PAID FOR", async () => {
    // ⚠ Not the buyer's DEFAULT workspace — a multi-workspace admin would be
    // returned to the first workspace's billing state.
    expect(await checkout(SEGMENT)).toBe(
      `https://www.usedopl.com/billing/${SEGMENT}?billing=success&session_id={CHECKOUT_SESSION_ID}`
    );
  });

  it("keeps Stripe's session-id placeholder literal", async () => {
    // ⚠ Percent-encoded braces are not substituted by Stripe.
    const url = await checkout(SEGMENT);
    expect(url).toContain("session_id={CHECKOUT_SESSION_ID}");
    expect(url).not.toContain("%7B");
  });

  it("falls back to the default-workspace forwarder when no segment is known", async () => {
    expect(await checkout(undefined)).toBe(
      "https://www.usedopl.com/billing?billing=success&session_id={CHECKOUT_SESSION_ID}"
    );
  });

  it("never returns into the retiring app tree", async () => {
    expect(await checkout(SEGMENT)).not.toContain("/canvas");
  });

  it("still uses elements mode — the reason billing needs a web page at all", async () => {
    await checkout(SEGMENT);
    expect(captured.checkout!.ui_mode).toBe("elements");
  });
});

describe("the portal return", () => {
  it("comes back to the same workspace's billing page, polling quietly", async () => {
    await createPortalSession("cus_123", SEGMENT);
    expect(captured.portal!.return_url).toBe(
      `https://www.usedopl.com/billing/${SEGMENT}?billing=return`
    );
  });

  it("degrades to the forwarder without a segment, and never to /canvas", async () => {
    await createPortalSession("cus_123");
    expect(captured.portal!.return_url).toBe(
      "https://www.usedopl.com/billing?billing=return"
    );
    expect(captured.portal!.return_url).not.toContain("/canvas");
  });
});
