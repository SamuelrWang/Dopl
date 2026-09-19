// @vitest-environment jsdom
/**
 * Account → Billing history. Real hooks + transport over a fake wire: the
 * status read answers from `rows`, the invoices read from `invoices`, both keyed
 * by `x-workspace-id` (none = the personal container).
 *
 * Pins: no block and NO invoices request for a never-paid user; hidden when the
 * history holds no paid charge; paid non-zero charges only, newest first, with
 * currency-formatted amount + date; canceled plan still shows history; Team
 * history only for an admin; receipt link opens through the shared opener;
 * failed read says so with Retry.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { InvoiceDto } from "@/features/billing/billing-account";
import { AccountBillingHistory } from "./account-billing-history";

const opened = vi.hoisted(() => [] as string[]);
vi.mock("@/shared/lib/open-external", () => ({
  openExternalUrl: async (url: string) => {
    opened.push(url);
  },
}));

const PERSONAL = "__personal__";

interface Row {
  plan: "free" | "pro" | "team";
  status: "free" | "active" | "canceled";
  containerKind: "personal" | "standard";
  hasCustomer: boolean;
}

let rows: Record<string, Row>;
let invoices: Record<string, InvoiceDto[] | "error">;
const invoiceReads: string[] = [];

function inv(overrides: Partial<InvoiceDto>): InvoiceDto {
  return {
    id: "in_x",
    number: "A-1",
    created: "2026-08-04T12:00:00.000Z",
    amountPaid: 899,
    amountDue: 899,
    currency: "usd",
    status: "paid",
    hostedInvoiceUrl: "https://invoice.stripe.com/i/x",
    ...overrides,
  };
}

function statusBody(row: Row) {
  return {
    plan: row.plan,
    status: row.status,
    containerKind: row.containerKind,
    memberCount: 1,
    seatCount: null,
    objectCap: null,
    objectsUsed: 0,
    canCreateObjects: true,
    chatsWindowDays: null,
    credits: {
      wallet: "personal",
      used: 0,
      limit: 500,
      remaining: 500,
      periodStart: "",
      periodEnd: "",
      ledgerDrift: 0,
      unmeteredSince: null,
    },
    cancelAtPeriodEnd: false,
    subscription_period_end: null,
    has_stripe_customer: row.hasCustomer,
  };
}

beforeEach(() => {
  opened.length = 0;
  invoiceReads.length = 0;
  rows = {
    [PERSONAL]: {
      plan: "free",
      status: "free",
      containerKind: "personal",
      hasCustomer: false,
    },
  };
  invoices = {};
  vi.stubGlobal(
    "fetch",
    async (url: unknown, init?: { headers?: Record<string, string> }) => {
      const path = String(url);
      const ws = init?.headers?.["x-workspace-id"] ?? PERSONAL;
      const respond = (status: number, body: unknown) =>
        ({ status, statusText: "", json: async () => body }) as unknown as Response;
      if (path.startsWith("/api/billing/status")) {
        return respond(200, statusBody(rows[ws]));
      }
      if (path.startsWith("/api/billing/invoices")) {
        invoiceReads.push(ws);
        const list = invoices[ws] ?? [];
        return list === "error"
          ? respond(500, { error: { message: "Stripe is unavailable" } })
          : respond(200, { invoices: list });
      }
      return respond(404, {});
    }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function mount(props: Parameters<typeof AccountBillingHistory>[0] = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AccountBillingHistory {...props} />
    </QueryClientProvider>
  );
}

async function settle() {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function personalCustomer(list: InvoiceDto[] | "error", status: Row["status"] = "active") {
  rows[PERSONAL] = {
    plan: status === "canceled" ? "free" : "pro",
    status,
    containerKind: "personal",
    hasCustomer: true,
  };
  invoices[PERSONAL] = list;
}

describe("hidden", () => {
  it("renders nothing and sends NO invoices request for a never-paid user", async () => {
    const view = mount();
    await settle();
    expect(view.queryByRole("region", { name: "Billing history" })).toBeNull();
    expect(invoiceReads).toEqual([]);
  });

  it("renders nothing when the history holds no paid charge", async () => {
    personalCustomer([
      inv({ id: "a", status: "open", amountPaid: 0 }),
      inv({ id: "b", status: "paid", amountPaid: 0 }),
      inv({ id: "c", status: "void", amountPaid: 0 }),
    ]);
    const view = mount();
    await settle();
    expect(invoiceReads).toEqual([PERSONAL]);
    expect(view.queryByRole("region", { name: "Billing history" })).toBeNull();
  });
});

describe("rows", () => {
  it("lists paid charges newest first with amount + date", async () => {
    personalCustomer([
      inv({ id: "old", created: "2026-07-04T12:00:00.000Z", amountPaid: 899 }),
      inv({ id: "new", created: "2026-08-04T12:00:00.000Z", amountPaid: 1234 }),
      inv({ id: "due", status: "open", amountPaid: 0, amountDue: 899 }),
    ]);
    const view = mount();
    await waitFor(() =>
      expect(view.getByRole("region", { name: "Billing history" })).toBeTruthy()
    );
    const items = view.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("Aug 4, 2026");
    expect(items[0].textContent).toContain("$12.34");
    expect(items[1].textContent).toContain("Jul 4, 2026");
    expect(items[1].textContent).toContain("$8.99");
  });

  it("formats a non-USD currency", async () => {
    personalCustomer([inv({ currency: "eur", amountPaid: 899 })]);
    const view = mount();
    await waitFor(() => expect(view.getAllByRole("listitem")).toHaveLength(1));
    expect(view.getByRole("listitem").textContent).toMatch(/€\s?8\.99/);
  });

  it("still shows history after the plan was canceled", async () => {
    personalCustomer([inv({})], "canceled");
    const view = mount();
    await waitFor(() => expect(view.getAllByRole("listitem")).toHaveLength(1));
  });

  it("opens the receipt through the shared opener", async () => {
    personalCustomer([inv({ hostedInvoiceUrl: "https://invoice.stripe.com/i/abc" })]);
    const view = mount();
    const link = await view.findByRole("button", { name: /Open receipt for/ });
    fireEvent.click(link);
    expect(opened).toEqual(["https://invoice.stripe.com/i/abc"]);
  });
});

describe("Team scoping", () => {
  beforeEach(() => {
    rows["ws-1"] = {
      plan: "team",
      status: "active",
      containerKind: "standard",
      hasCustomer: true,
    };
    invoices["ws-1"] = [inv({ id: "team-1", amountPaid: 2697 })];
  });

  it("shows the open workspace's charges to an admin, read with its header", async () => {
    const view = mount({ workspaceId: "ws-1", role: "admin" });
    await waitFor(() => expect(view.getAllByRole("listitem")).toHaveLength(1));
    expect(view.getByRole("listitem").textContent).toContain("$26.97");
    expect(invoiceReads).toEqual(["ws-1"]);
  });

  it("never reads a workspace's invoices for a member", async () => {
    const view = mount({ workspaceId: "ws-1", role: "member" });
    await settle();
    expect(invoiceReads).toEqual([]);
    expect(view.queryByRole("region", { name: "Billing history" })).toBeNull();
  });

  it("tags each row with its plan when both histories exist", async () => {
    personalCustomer([inv({ id: "pro-1", created: "2026-07-01T12:00:00.000Z" })]);
    const view = mount({ workspaceId: "ws-1", role: "owner" });
    await waitFor(() => expect(view.getAllByRole("listitem")).toHaveLength(2));
    const [first, second] = view.getAllByRole("listitem");
    expect(first.textContent).toContain("Team");
    expect(second.textContent).toContain("Pro");
  });
});

describe("a failed read", () => {
  it("says so with Retry — never hides as if empty", async () => {
    personalCustomer("error");
    const view = mount();
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toContain(
        "Couldn't load billing history"
      )
    );
    invoices[PERSONAL] = [inv({})];
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(view.getAllByRole("listitem")).toHaveLength(1));
  });
});
