import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpgradeModal } from "@/features/billing/components/upgrade-modal";
import { createQueryClient } from "#/lib/query-client";
import type { BridgeResponse } from "#/lib/dopl-bridge";
import { SEGMENT, WORKSPACE_ID, installBridge } from "#/test-utils/bridge";

/**
 * The PAYWALL's desktop degradation. `UpgradeModal` is a WEB component the SPA
 * reuses, and its checkout step mounts Stripe Embedded Checkout, which the
 * packaged renderer cannot load (`script-src 'self'`, `connect-src 'none'`,
 * `frame-src 'none'`).
 *
 * Asserted through the real bridge, which is also what marks this renderer as
 * the SPA: pitch stays, Stripe mount goes, purchase leaves for the browser.
 */

const apiRequest = vi.hoisted(() => vi.fn());
const openExternal = vi.hoisted(() => vi.fn(() => Promise.resolve({ ok: true })));


/** Free, single member — the state that offers both Pro and Team checkout. */
const FREE_STATUS = {
  plan: "free",
  status: "free",
  memberCount: 1,
  seatCount: null,
  objectCap: 100,
  objectsUsed: 100,
  canCreateObjects: false,
  chatsWindowDays: 90,
  subscription_period_end: null,
  has_stripe_customer: false,
};

function ok(body: unknown): BridgeResponse {
  return { status: 200, statusText: "OK", hasBody: true, body };
}

function renderModal() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <UpgradeModal
        open
        onOpenChange={() => {}}
        workspaceId={WORKSPACE_ID}
        reason="You've hit the object cap."
      />
    </QueryClientProvider>
  );
}

describe("UpgradeModal in the desktop SPA", () => {
  beforeEach(() => {
    openExternal.mockClear();
    window.location.hash = `#/${SEGMENT}/ontology`;
    apiRequest.mockImplementation((path: string) => {
      if (path === "/api/billing/status") return Promise.resolve(ok(FREE_STATUS));
      return Promise.reject(new Error(`unexpected request: ${path}`));
    });
    installBridge({ apiRequest, openExternal, appOrigin: "https://www.usedopl.com" });
  });

  it("keeps the plan pitch and hands checkout to the browser, scoped to this workspace", async () => {
    renderModal();

    // Pitch unchanged — only the payment leg differs.
    expect(await screen.findByRole("button", { name: "Choose Pro" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose Pro" }));

    expect(await screen.findByText("Subscribe to Pro")).toBeInTheDocument();
    expect(screen.getByText("$5.99 / month — flat, single member")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue in your browser" }));

    // Standalone billing page, carrying the chosen plan so the browser opens
    // straight into that checkout.
    await waitFor(() =>
      expect(openExternal).toHaveBeenCalledWith(
        `https://www.usedopl.com/billing/${SEGMENT}?billing=upgrade&plan=solo`
      )
    );
    // ⚠ Origin is the preload constant, never the file:// document.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("mounts no Stripe checkout and never dead-ends on its error card", async () => {
    renderModal();

    fireEvent.click(await screen.findByRole("button", { name: "Choose Team" }));

    expect(await screen.findByText("Subscribe to Team")).toBeInTheDocument();
    expect(screen.queryByText("Checkout couldn't load")).not.toBeInTheDocument();
    // Stripe's PaymentElement and the checkout skeleton are both absent.
    expect(screen.queryByLabelText("Loading checkout")).not.toBeInTheDocument();
    expect(
      apiRequest.mock.calls.map((c) => (c as unknown[])[0])
    ).not.toContain("/api/billing/checkout");
  });

  it("the in-place Solo→Team switch is untouched — it is pure API", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === "/api/billing/status") {
        return Promise.resolve(
          ok({ ...FREE_STATUS, status: "active", memberCount: 3 })
        );
      }
      if (path === "/api/billing/upgrade-to-team") {
        return Promise.resolve(ok({ ok: true, seatCount: 3 }));
      }
      return Promise.reject(new Error(`unexpected request: ${path}`));
    });

    renderModal();

    fireEvent.click(await screen.findByRole("button", { name: "Switch to Team" }));

    await waitFor(() =>
      expect(
        apiRequest.mock.calls.some(
          (c) => (c as unknown[])[0] === "/api/billing/upgrade-to-team"
        )
      ).toBe(true)
    );
    expect(openExternal).not.toHaveBeenCalled();
  });
});
