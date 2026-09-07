/**
 * The billing surface's URL, as a table. The assertion with teeth: nothing this
 * builder emits points into the retiring app tree, and the params money depends
 * on survive the trip.
 */

import { describe, it, expect } from "vitest";
import {
  BILLING_SURFACE_ROOT,
  STRIPE_SESSION_ID_TEMPLATE,
  billingPath,
  billingSelfPath,
  billingUrl,
  parseBillingIntent,
  parseBillingReturn,
  parseCheckoutPlan,
} from "./url";

describe("the path it builds", () => {
  it("is workspace-scoped when a segment is known", () => {
    expect(billingPath({ segment: "acme-ab12cd34ef56" })).toBe(
      "/billing/acme-ab12cd34ef56"
    );
  });

  it("falls back to the segment-less entry when no segment is known", () => {
    // `/billing` resolves or asks rather than 404ing.
    expect(billingPath()).toBe(BILLING_SURFACE_ROOT);
    expect(billingPath({ segment: null, intent: "upgrade" })).toBe(
      "/billing?billing=upgrade"
    );
  });

  it("carries intent, plan and session id in the order the page reads them", () => {
    expect(
      billingPath({
        segment: "acme-ab12cd34ef56",
        intent: "success",
        plan: "team",
        sessionId: "cs_live_123",
      })
    ).toBe(
      "/billing/acme-ab12cd34ef56?billing=success&plan=team&session_id=cs_live_123"
    );
  });

  it("leaves Stripe's session-id placeholder LITERAL", () => {
    // ⚠ `%7BCHECKOUT_SESSION_ID%7D` is delivered verbatim to the browser —
    // why the query is concatenated, not run through URLSearchParams.
    const url = billingPath({
      segment: "acme-ab12cd34ef56",
      intent: "success",
      sessionId: STRIPE_SESSION_ID_TEMPLATE,
    });
    expect(url).toContain("session_id={CHECKOUT_SESSION_ID}");
    expect(url).not.toContain("%7B");
  });

  it("never points into the retiring app tree", () => {
    for (const path of [
      billingPath(),
      billingPath({ segment: "acme-ab12cd34ef56", intent: "upgrade" }),
      billingPath({ segment: "acme-ab12cd34ef56", intent: "return" }),
      billingUrl("https://www.usedopl.com", { intent: "upgrade" }),
    ]) {
      expect(path).not.toContain("/canvas");
      expect(path).not.toContain("/pricing");
      expect(path).not.toContain("/settings/billing");
    }
  });
});

describe("the absolute form", () => {
  it("joins origin and path without doubling the slash", () => {
    expect(billingUrl("https://www.usedopl.com", { intent: "upgrade" })).toBe(
      "https://www.usedopl.com/billing?billing=upgrade"
    );
    expect(billingUrl("https://www.usedopl.com/", { intent: "upgrade" })).toBe(
      "https://www.usedopl.com/billing?billing=upgrade"
    );
  });
});

describe("billingSelfPath — the page's own URL, for the login bounce", () => {
  it("keeps the query, which is the entire point", () => {
    // First-time payer is signed out: without the query riding along in
    // `redirectTo`, checkout never opens after sign-in.
    expect(
      billingSelfPath("acme-ab12cd34ef56", { billing: "upgrade", plan: "team" })
    ).toBe("/billing/acme-ab12cd34ef56?billing=upgrade&plan=team");
  });

  it("drops repeated params (Next hands those over as arrays) and empty queries", () => {
    expect(billingSelfPath("acme-ab12cd34ef56", {})).toBe(
      "/billing/acme-ab12cd34ef56"
    );
    expect(
      billingSelfPath("acme-ab12cd34ef56", { billing: ["upgrade", "success"] })
    ).toBe("/billing/acme-ab12cd34ef56");
  });

  it("works for the segment-less forwarder too", () => {
    expect(billingSelfPath(null, { billing: "success", session_id: "cs_1" })).toBe(
      "/billing?billing=success&session_id=cs_1"
    );
  });
});

describe("what the page reads back off the URL", () => {
  it("only `success` and `return` arm the post-checkout poll", () => {
    expect(parseBillingReturn("success")).toBe("success");
    expect(parseBillingReturn("return")).toBe("return");
    expect(parseBillingReturn("upgrade")).toBeNull();
    expect(parseBillingReturn("../evil")).toBeNull();
    expect(parseBillingReturn(null)).toBeNull();
    expect(parseBillingReturn(undefined)).toBeNull();
  });

  it("recognizes all three intents and nothing else", () => {
    expect(parseBillingIntent("upgrade")).toBe("upgrade");
    expect(parseBillingIntent("success")).toBe("success");
    expect(parseBillingIntent("return")).toBe("return");
    expect(parseBillingIntent("cancel")).toBeNull();
    expect(parseBillingIntent(null)).toBeNull();
  });

  it("accepts Team and Pro — the two plans on sale — and nothing else", () => {
    expect(parseCheckoutPlan("team")).toBe("team");
    // Personal Pro, $8.99/month on a `kind='personal'` container (2026-09-08,
    // spec §11). Which CONTAINER may buy it is the checkout route's fence, not
    // this parser's: a URL is read before any workspace is resolved.
    expect(parseCheckoutPlan("pro")).toBe("pro");
    // "free" is a plan but not a CHECKOUT — no such price exists.
    expect(parseCheckoutPlan("free")).toBeNull();
    expect(parseCheckoutPlan("enterprise")).toBeNull();
    expect(parseCheckoutPlan(null)).toBeNull();
    expect(parseCheckoutPlan(undefined)).toBeNull();
  });

  it("carries `plan=pro` through the builder with no segment — the personal forward", () => {
    // The seller (a 402 envelope, /pricing) holds no personal-container
    // segment; `/billing` resolves it and must still see the plan.
    expect(billingPath({ intent: "upgrade", plan: "pro" })).toBe(
      "/billing?billing=upgrade&plan=pro"
    );
  });

  it("REFUSES `plan=solo` — a retired price must not open a checkout", () => {
    // 2026-09-07, spec A6: Solo/"Pro" is retired from sale. Old 402 envelopes,
    // bookmarks and sign-in bounces still carry `?plan=solo` and are already in
    // the wild; parsing one to null lands the payer on the plan list instead of
    // in a checkout for a price nobody may buy. Live `solo` ROWS are untouched
    // — they upgrade in place via POST /api/billing/upgrade-to-team.
    expect(parseCheckoutPlan("solo")).toBeNull();
  });
});
