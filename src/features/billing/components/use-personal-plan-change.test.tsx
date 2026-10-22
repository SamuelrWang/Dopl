// @vitest-environment jsdom
/**
 * The client half of the Pro ⇄ Max switch (2026-10-22 review):
 *   • 3-D Secure on the WEB confirms the invoice's PaymentIntent with Stripe.js,
 *     then POSTs again to finalize — and a failed confirmation changes nothing;
 *   • on the DESKTOP (no Stripe.js under the packaged CSP) the hosted invoice
 *     opens in the browser instead;
 *   • the confirm and cancel copy say what the payer is agreeing to.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const stripeJs = vi.hoisted(() => ({
  confirmCardPayment: vi.fn(),
}));
vi.mock("./embedded-checkout", () => ({
  getStripePromise: async () => ({ confirmCardPayment: stripeJs.confirmCardPayment }),
}));

import { usePersonalPlanChange } from "./use-personal-plan-change";
import { formatMinorUnits, upgradeConfirmCopy } from "./upgrade-confirm-dialog";
import { queuedSwitchCancelNote } from "./billing-cancel-plan";

const fetchSpy = vi.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const posts = () =>
  fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");

beforeEach(() => {
  fetchSpy.mockReset();
  stripeJs.confirmCardPayment.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as { dopl?: unknown }).dopl;
});

const REQUIRES_ACTION = {
  ok: true,
  outcome: "requires_action",
  plan: "pro",
  scheduledPlan: null,
  effectiveAt: null,
  payment: { clientSecret: "pi_secret", hostedInvoiceUrl: "https://invoice.stripe.com/i/1" },
};

describe("3-D Secure on the web", () => {
  it("confirms with Stripe.js, then POSTs again to finalize", async () => {
    fetchSpy
      .mockResolvedValueOnce(json(REQUIRES_ACTION))
      .mockResolvedValue(json({ ok: true, outcome: "unchanged" }));
    stripeJs.confirmCardPayment.mockResolvedValue({ paymentIntent: { status: "succeeded" } });
    const { result } = renderHook(() => usePersonalPlanChange("ws-1", false), { wrapper });
    let ok = false;
    await act(async () => {
      ok = await result.current.change("max");
    });
    expect(ok).toBe(true);
    expect(stripeJs.confirmCardPayment).toHaveBeenCalledWith("pi_secret");
    expect(posts()).toHaveLength(2);
  });

  it("🔒 a failed confirmation shows Stripe's reason and does NOT finalize", async () => {
    fetchSpy.mockResolvedValue(json(REQUIRES_ACTION));
    stripeJs.confirmCardPayment.mockResolvedValue({
      error: { message: "Authentication failed." },
    });
    const { result } = renderHook(() => usePersonalPlanChange("ws-1", false), { wrapper });
    await act(async () => {
      await result.current.change("max");
    });
    expect(result.current.error).toBe("Authentication failed.");
    expect(posts()).toHaveLength(1);
  });
});

describe("3-D Secure on the desktop", () => {
  it("opens the hosted invoice in the browser — never Stripe.js", async () => {
    const openExternal = vi.fn(async () => ({ ok: true }));
    const apiRequest = vi.fn(async () => ({
      status: 200,
      statusText: "OK",
      hasBody: true,
      body: REQUIRES_ACTION,
    }));
    (window as { dopl?: unknown }).dopl = { apiRequest, openExternal };
    const { result } = renderHook(() => usePersonalPlanChange("ws-1", false), { wrapper });
    let ok = true;
    await act(async () => {
      ok = await result.current.change("max");
    });
    expect(ok).toBe(false);
    expect(openExternal).toHaveBeenCalledWith("https://invoice.stripe.com/i/1");
    expect(stripeJs.confirmCardPayment).not.toHaveBeenCalled();
    expect(result.current.notice).toMatch(/finish it in your browser/);
  });
});

describe("the copy the payer agrees to", () => {
  it("names the amount, that it is charged now, and the fresh period", () => {
    expect(formatMinorUnits(1601, "usd")).toBe("$16.01");
    const copy = upgradeConfirmCopy("max", { amountDue: 1601, currency: "usd" });
    expect(copy).toContain("You'll be charged $16.01 now");
    expect(copy).toContain("20,000 credits");
    expect(copy).toContain("billing date moves to today");
  });

  it("🔒 the cancel confirmation says it clears a queued switch, and resume won't restore it", () => {
    expect(queuedSwitchCancelNote("pro")).toContain("also cancels your switch to Pro");
    expect(queuedSwitchCancelNote("pro")).toContain("if you resume, choose it again");
    expect(queuedSwitchCancelNote(null)).toBe("");
  });
});
