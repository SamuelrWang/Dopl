// @vitest-environment jsdom
/**
 * Stripe panes when Stripe does NOT answer.
 *
 * Empty states here are MEASUREMENTS ("No card on file" = Stripe said none). A
 * read that THREW measured nothing, yet `undefined` (failed) and `null`
 * (measured absent) collapse into one falsy check and `data ?? []` erases the
 * distinction. Drives the real transport with a FAILING route (whole
 * hook/query/pane path, not a stubbed hook): on failure pane must say it could
 * not load, offer retry, and NEVER say what is only true when Stripe answered.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { BillingCancelPlan } from "./billing-cancel-plan";
import { BillingInvoices } from "./billing-invoices";
import { BillingPaymentMethod } from "./billing-payment-method";
import {
  BILLING_CANCEL_PATH,
  BILLING_INVOICES_PATH,
  BILLING_PAYMENT_METHOD_PATH,
} from "./use-billing-account";
import type { BillingPortal } from "./use-billing-portal";
import type { PaymentMethodDto } from "../billing-account";

/**
 * ⚠ Real `ConfirmDialog` portals in from a `requestAnimationFrame` chain, so
 * clicking through it times the animation, not the flow. Stub reproduces the
 * one contract the section is written against: `await onConfirm()`, close on
 * resolve, STAY OPEN on throw.
 */
vi.mock("@/shared/ui/confirm-dialog", () => ({
  ConfirmDialog: ({
    open,
    onOpenChange,
    confirmLabel,
    onConfirm,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    confirmLabel?: string;
    onConfirm: () => void | Promise<void>;
  }) =>
    open ? (
      <div data-testid="confirm-dialog">
        <button
          type="button"
          onClick={async () => {
            try {
              await onConfirm();
              onOpenChange(false);
            } catch {
              /* real dialog swallows it and stays open */
            }
          }}
        >
          {`Confirm: ${confirmLabel}`}
        </button>
      </div>
    ) : null,
}));

/** What the fake wire answers for a given path. */
type Reply = { status: number; body: unknown };
let reply: (path: string, init?: { method?: string }) => Reply;
const calls: Array<{ path: string; method: string }> = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("fetch", async (url: unknown, init?: { method?: string }) => {
    const path = String(url);
    calls.push({ path, method: init?.method ?? "GET" });
    const { status, body } = reply(path, init);
    return {
      status,
      statusText: "",
      json: async () => body,
    } as unknown as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function mount(node: ReactElement) {
  const client = new QueryClient({
    // No retry: failing read reaches error state in one hop, no backoff wait.
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
}

const PORTAL: BillingPortal = {
  open: async () => {},
  loading: false,
  error: null,
};

const CARD: PaymentMethodDto = {
  brand: "visa",
  last4: "4242",
  expMonth: 4,
  expYear: 2029,
};

/** Every billing read answers 500, as a thrown Stripe call surfaces. */
const stripeIsDown: typeof reply = () => ({
  status: 500,
  body: { error: { code: "INTERNAL_ERROR", message: "Stripe is unavailable" } },
});

describe("the payment method pane when the read fails", () => {
  it("says it couldn't load — never 'No card on file'", async () => {
    reply = stripeIsDown;
    const view = mount(
      <BillingPaymentMethod workspaceId="ws-1" portal={PORTAL} />
    );

    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toContain(
        "Couldn't load the payment method"
      )
    );
    expect(view.queryByText(/No card on file/)).toBeNull();
    expect(view.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("re-reads the route when Retry is clicked", async () => {
    reply = stripeIsDown;
    const view = mount(
      <BillingPaymentMethod workspaceId="ws-1" portal={PORTAL} />
    );
    await waitFor(() => view.getByRole("button", { name: "Retry" }));
    const before = calls.length;

    reply = () => ({ status: 200, body: { paymentMethod: CARD } });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Retry" }));
    });

    await waitFor(() => expect(view.getByText("Visa •••• 4242")).toBeTruthy());
    expect(calls.length).toBeGreaterThan(before);
  });

  it("still says 'No card on file' when Stripe genuinely answers none", async () => {
    reply = () => ({ status: 200, body: { paymentMethod: null } });
    const view = mount(
      <BillingPaymentMethod workspaceId="ws-1" portal={PORTAL} />
    );

    await waitFor(() => expect(view.getByText(/No card on file/)).toBeTruthy());
    expect(view.queryByRole("alert")).toBeNull();
  });

  it("drops the Expires line rather than printing '00 / 0'", async () => {
    // Stripe can return a card with no expiry; zero-defaulting renders a date
    // that does not exist.
    reply = () => ({
      status: 200,
      body: { paymentMethod: { ...CARD, expMonth: null, expYear: null } },
    });
    const view = mount(
      <BillingPaymentMethod workspaceId="ws-1" portal={PORTAL} />
    );

    await waitFor(() => expect(view.getByText("Visa •••• 4242")).toBeTruthy());
    expect(view.queryByText(/Expires/)).toBeNull();
    expect(view.container.textContent).not.toContain("00 /");
  });
});

describe("the invoice table when the read fails", () => {
  it("says it couldn't load — never 'No invoices yet'", async () => {
    reply = stripeIsDown;
    const view = mount(<BillingInvoices workspaceId="ws-1" />);

    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toContain(
        "Couldn't load invoices"
      )
    );
    // `invoices` is `data ?? []` — same empty array as a customer with no
    // history.
    expect(view.queryByText(/No invoices yet/)).toBeNull();
    expect(view.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("still says 'No invoices yet' for a customer who has none", async () => {
    reply = () => ({ status: 200, body: { invoices: [] } });
    const view = mount(<BillingInvoices workspaceId="ws-1" />);

    await waitFor(() => expect(view.getByText(/No invoices yet/)).toBeTruthy());
    expect(view.queryByRole("alert")).toBeNull();
  });
});

describe("a cancel the server refuses", () => {
  function cancelPane() {
    return mount(
      <BillingCancelPlan
        workspaceId="ws-1"
        cancelAtPeriodEnd={false}
        currentPeriodEnd="2026-09-04T12:00:00.000Z"
      />
    );
  }

  async function confirmCancel(view: ReturnType<typeof cancelPane>) {
    fireEvent.click(view.getByRole("button", { name: "Cancel plan" }));
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Confirm: Cancel plan" }));
    });
  }

  it("shows the server's reason IN THE SECTION and closes the dialog", async () => {
    reply = (path) =>
      path.startsWith(BILLING_CANCEL_PATH)
        ? {
            status: 409,
            body: {
              error: {
                code: "NO_ACTIVE_SUBSCRIPTION",
                message: "This workspace has no active subscription to cancel.",
              },
            },
          }
        : { status: 200, body: {} };

    const view = cancelPane();
    await confirmCancel(view);

    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toContain(
        "This workspace has no active subscription to cancel."
      )
    );
    expect(view.queryByTestId("confirm-dialog")).toBeNull();
  });

  it("leaves the button live rather than stuck on 'Cancelling…'", async () => {
    reply = (path) =>
      path.startsWith(BILLING_CANCEL_PATH)
        ? { status: 500, body: { error: { message: "Stripe exploded" } } }
        : { status: 200, body: {} };

    const view = cancelPane();
    await confirmCancel(view);

    await waitFor(() => expect(view.getByRole("alert")).toBeTruthy());
    const button = view.getByRole("button", {
      name: "Cancel plan",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("fires exactly ONE POST per confirmed cancel", async () => {
    // Button held through the awaited status invalidation, not just the round
    // trip: in the gap the section still renders "Cancel plan" from OLD status.
    reply = (path) =>
      path.startsWith(BILLING_CANCEL_PATH)
        ? {
            status: 200,
            body: { cancelAtPeriodEnd: true, currentPeriodEnd: null },
          }
        : { status: 200, body: { plan: "team" } };

    const view = cancelPane();
    await confirmCancel(view);

    await waitFor(() =>
      expect(
        (view.getByRole("button", { name: "Cancel plan" }) as HTMLButtonElement)
          .disabled
      ).toBe(false)
    );
    expect(
      calls.filter((c) => c.path.startsWith(BILLING_CANCEL_PATH))
    ).toHaveLength(1);
  });
});

describe("the paths these panes actually read", () => {
  it("names the three billing routes, so a rename cannot go unnoticed", () => {
    expect(BILLING_PAYMENT_METHOD_PATH).toBe("/api/billing/payment-method");
    expect(BILLING_INVOICES_PATH).toBe("/api/billing/invoices");
    expect(BILLING_CANCEL_PATH).toBe("/api/billing/cancel");
  });
});
