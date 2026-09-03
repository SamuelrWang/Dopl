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
      billingSelfPath("acme-ab12cd34ef56", { billing: "upgrade", plan: "solo" })
    ).toBe("/billing/acme-ab12cd34ef56?billing=upgrade&plan=solo");
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

  it("accepts only the two purchasable plans", () => {
    expect(parseCheckoutPlan("solo")).toBe("solo");
    expect(parseCheckoutPlan("team")).toBe("team");
    // "free" is a plan but not a CHECKOUT — no such price exists.
    expect(parseCheckoutPlan("free")).toBeNull();
    expect(parseCheckoutPlan("enterprise")).toBeNull();
    expect(parseCheckoutPlan(null)).toBeNull();
  });
});
