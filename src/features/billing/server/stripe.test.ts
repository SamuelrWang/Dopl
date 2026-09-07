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

import {
  createPortalSession,
  createWorkspaceCheckoutSession,
  selectSeatItem,
} from "./stripe";

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
    // ⚠ Not whatever `/billing` resolves — a multi-workspace admin would be
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

  it("falls back to the segment-less entry when no segment is known", async () => {
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

describe("what a checkout may be minted for", () => {
  it("always bills the per-seat Team price at the seat quantity", async () => {
    // ⚠ 2026-09-07 (spec A6): Solo/"Pro" is retired from sale, so there is no
    // longer a price BRANCH here — `WorkspaceCheckoutArgs["plan"]` is the
    // literal "team" and the flat Solo line cannot be minted by anyone. The
    // route's 400 `PLAN_RETIRED` is the first lock; this is the second.
    await checkout(SEGMENT);
    expect(captured.checkout!.line_items).toEqual([
      { price: "price_seat", quantity: 3 },
    ]);
    expect(JSON.stringify(captured.checkout!.line_items)).not.toContain(
      "price_solo"
    );
  });

  it("stamps plan 'team' into BOTH metadata blocks, which is what the webhook reads back", async () => {
    await checkout(SEGMENT);
    expect(captured.checkout!.metadata).toEqual({
      workspace_id: "ws-1",
      plan: "team",
    });
    expect(captured.checkout!.subscription_data!.metadata).toEqual({
      workspace_id: "ws-1",
      plan: "team",
    });
  });

  it("refuses to mint at all when the seat price is unset, rather than guessing another price", async () => {
    vi.stubEnv("STRIPE_PRO_SEAT_PRICE_ID", "");
    await expect(
      createWorkspaceCheckoutSession({
        workspaceId: "ws-1",
        plan: "team",
        quantity: 3,
        email: "a@b.com",
        segment: SEGMENT,
      })
    ).rejects.toThrow(/STRIPE_PRO_SEAT_PRICE_ID/);
    // ⚠ Not "fall back to the Solo price it can still see" — a misconfigured
    // env must fail loudly, never sell the retired plan by accident.
    expect(captured.checkout).toBeNull();
  });
});

describe("selectSeatItem — the LEGACY Solo arm, which stays", () => {
  function sub(items: Array<{ id: string; priceId: string }>) {
    return {
      items: { data: items.map((i) => ({ id: i.id, price: { id: i.priceId } })) },
    } as unknown as Stripe.Subscription;
  }

  it("prefers the per-seat Team price over anything else on the subscription", () => {
    expect(
      selectSeatItem(
        sub([
          { id: "si_solo", priceId: "price_solo" },
          { id: "si_seat", priceId: "price_seat" },
        ])
      )!.id
    ).toBe("si_seat");
  });

  it("still finds the flat Solo item on a LIVE legacy subscription", () => {
    // ⚠ Solo is off SALE (2026-09-07, spec A6), not off the books. Deleting
    // this arm would send `upgrade-to-team` and the seat sync at
    // `items.data[0]` — the wrong line the moment a legacy sub holds two.
    expect(
      selectSeatItem(
        sub([
          { id: "si_addon", priceId: "price_addon" },
          { id: "si_solo", priceId: "price_solo" },
        ])
      )!.id
    ).toBe("si_solo");
  });

  it("falls back to the first item for a subscription on neither known price", () => {
    expect(selectSeatItem(sub([{ id: "si_legacy20", priceId: "price_20" }]))!.id).toBe(
      "si_legacy20"
    );
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
