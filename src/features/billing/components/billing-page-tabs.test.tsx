// @vitest-environment jsdom
/**
 * Tab switcher as a hazard. A tab click UNMOUNTS the other pane, and Billing
 * can be holding Stripe's embedded card form — so while checkout is up the
 * control is inert and says why (H1). The same click also edits the URL:
 * `?tab=` written via `replaceState`, and the `?billing=` intent DROPPED
 * because the click consumed it (H2). Together they keep the post-payment poll
 * (mounts only in the Billing pane) from being lost to a stray param.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

// Mounting the real form pulls the Stripe script + a client-secret fetch.
vi.mock("./embedded-checkout", () => ({
  EmbeddedCheckoutForm: () => <div data-testid="embedded-checkout" />,
}));

const { BillingPageScreen } = await import("./billing-page-screen");
const { BILLING_STATUS_PATH } = await import("./use-workspace-entitlements");
type Status = import("./use-workspace-entitlements").WorkspaceEntitlementsStatus;

const FREE: Status = {
  plan: "free",
  status: "free",
  memberCount: 3,
  seatCount: null,
  objectCap: 100,
  objectsUsed: 12,
  canCreateObjects: true,
  chatsWindowDays: 90,
  credits: {
    used: 120,
    limit: 500,
    remaining: 380,
    periodStart: "2026-08-01T00:00:00.000Z",
    periodEnd: "2026-09-01T12:00:00.000Z",
  },
  cancelAtPeriodEnd: false,
  subscription_period_end: null,
  has_stripe_customer: false,
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    async () =>
      ({ status: 200, statusText: "", json: async () => ({}) }) as unknown as Response
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function mount(
  overrides: Partial<Parameters<typeof BillingPageScreen>[0]> = {},
  url = "/billing/acme-ab12cd34ef56"
) {
  window.history.replaceState(null, "", url);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData([BILLING_STATUS_PATH, "ws-1", undefined], FREE);
  return render(
    <QueryClientProvider client={client}>
      <BillingPageScreen
        workspaceName="Acme"
        workspaceId="ws-1"
        role="owner"
        billingReturn={null}
        initialCheckoutPlan={null}
        initialTab="billing"
        {...overrides}
      />
    </QueryClientProvider>
  );
}

const tabButton = (view: ReturnType<typeof mount>, name: string) =>
  view.getByRole("tab", { name }) as HTMLButtonElement;

describe("the switcher while checkout is mounted", () => {
  it("goes inert, and says why", async () => {
    const view = mount({ initialCheckoutPlan: "team" });

    await waitFor(() => expect(view.getByTestId("embedded-checkout")).toBeTruthy());
    expect(tabButton(view, "Usage").disabled).toBe(true);
    expect(tabButton(view, "Billing").disabled).toBe(true);
    expect(view.getByRole("status").textContent).toContain(
      "before switching tabs"
    );
  });

  it("refuses the click that would discard the card form", async () => {
    const view = mount({ initialCheckoutPlan: "team" });
    await waitFor(() => expect(view.getByTestId("embedded-checkout")).toBeTruthy());

    await act(async () => {
      fireEvent.click(tabButton(view, "Usage"));
    });

    expect(view.getByTestId("embedded-checkout")).toBeTruthy();
    expect(view.queryByText("MCP credits")).toBeNull();
  });

  it("is live again once checkout is left", async () => {
    // "← Back to plans" is the sanctioned exit; it must re-enable the switcher.
    const view = mount({ initialCheckoutPlan: "team" });
    await waitFor(() => expect(view.getByTestId("embedded-checkout")).toBeTruthy());

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: /Back to plans/ }));
    });

    await waitFor(() => expect(tabButton(view, "Usage").disabled).toBe(false));
  });

  it("is live on a plain visit, with no explanation shown", () => {
    const view = mount();
    expect(tabButton(view, "Usage").disabled).toBe(false);
    expect(view.queryByRole("status")).toBeNull();
  });
});

describe("what a manual tab switch does to the URL", () => {
  it("writes ?tab= and DROPS the consumed billing intent", async () => {
    const view = mount(
      { billingReturn: "success", initialTab: "billing" },
      "/billing/acme-ab12cd34ef56?billing=success&session_id=cs_test_123"
    );

    await act(async () => {
      fireEvent.click(tabButton(view, "Usage"));
    });

    const params = new URLSearchParams(window.location.search);
    expect(params.get("tab")).toBe("usage");
    // Left in place, `?billing=success` outranks `?tab=` on the next load and
    // re-runs the poll on a tab the visitor explicitly left.
    expect(params.get("billing")).toBeNull();
    expect(params.get("session_id")).toBeNull();
  });

  it("leaves the rest of the query alone", async () => {
    const view = mount(
      {},
      "/billing/acme-ab12cd34ef56?billing=upgrade&ref=desktop"
    );

    await act(async () => {
      fireEvent.click(tabButton(view, "Usage"));
    });

    const params = new URLSearchParams(window.location.search);
    expect(params.get("ref")).toBe("desktop");
    expect(params.get("tab")).toBe("usage");
    expect(params.get("billing")).toBeNull();
  });

  it("keeps the path — a tab switch is not a navigation", async () => {
    const view = mount();
    await act(async () => {
      fireEvent.click(tabButton(view, "Usage"));
    });
    expect(window.location.pathname).toBe("/billing/acme-ab12cd34ef56");
  });
});
