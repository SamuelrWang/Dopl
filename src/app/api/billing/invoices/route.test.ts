/**
 * GET /api/billing/invoices — DTO-shaped pins, since the route's job is a translation: Stripe's
 * `amount_paid` / `hosted_invoice_url` / epoch `created` must not reach a client, and the page
 * size must stay the ONE constant in `features/billing/billing-account.ts`.
 * The Stripe SDK is faked at the module boundary; nothing touches the network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import type { WorkspaceBillingRow } from "@/features/billing/server/workspace-billing";
import { INVOICE_PAGE_SIZE } from "@/features/billing/billing-account";

const AUTH: WorkspaceAuthContext = {
  userId: "user-1",
  workspaceId: "ws-1",
  workspaceSlug: "acme",
  workspacePublicId: "pub-1",
  role: "admin",
  apiKeyWorkspaceId: null,
};

interface GateOptions {
  minRole?: string;
  sessionOnly?: boolean;
}

const gate = vi.hoisted(() => ({ opts: undefined as GateOptions | undefined }));

vi.mock("@/shared/auth/with-workspace-auth", () => ({
  withWorkspaceAuth: (
    handler: (req: Request, ctx: WorkspaceAuthContext) => Promise<Response>,
    opts?: GateOptions
  ) => {
    gate.opts = opts;
    return (req: Request) => handler(req, AUTH);
  },
}));

const stripeCalls = vi.hoisted(() => ({
  listParams: null as Record<string, unknown> | null,
  data: [] as unknown[],
}));

vi.mock("stripe", () => ({
  default: class FakeStripe {
    invoices = {
      list: async (params: Record<string, unknown>) => {
        stripeCalls.listParams = params;
        return { data: stripeCalls.data };
      },
    };
  },
}));

vi.mock("@/features/billing/server/workspace-billing", () => ({
  getWorkspaceBilling: vi.fn(),
  upsertWorkspaceBilling: vi.fn(),
}));

import { GET } from "./route";
import * as repo from "@/features/billing/server/workspace-billing";

const mockRepo = vi.mocked(repo);

function billing(overrides: Partial<WorkspaceBillingRow> = {}): WorkspaceBillingRow {
  return {
    workspaceId: "ws-1",
    plan: "team",
    status: "active",
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
    stripePriceId: "price_seat",
    seatCount: 3,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    lastStripeEventCreated: null,
    ...overrides,
  };
}

const request = () => new NextRequest("http://localhost/api/billing/invoices");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
  stripeCalls.listParams = null;
  stripeCalls.data = [];
  mockRepo.getWorkspaceBilling.mockResolvedValue(billing());
});

describe("who may read the invoices", () => {
  it("is gated at ADMIN", () => {
    expect(gate.opts).toMatchObject({ minRole: "admin" });
  });

  it("is a READ, so it is not sessionOnly", () => {
    expect(gate.opts?.sessionOnly).toBeUndefined();
  });
});

describe("what Stripe is asked for", () => {
  it("asks for THIS workspace's customer, one page deep", async () => {
    await GET(request());
    expect(stripeCalls.listParams).toEqual({
      customer: "cus_123",
      limit: INVOICE_PAGE_SIZE,
    });
  });
});

describe("what crosses the wire", () => {
  it("is camelCase with an ISO date — no Stripe key shape survives", async () => {
    stripeCalls.data = [
      {
        id: "in_1",
        number: "DOPL-0001",
        created: 1_780_000_000,
        amount_paid: 599,
        amount_due: 599,
        currency: "usd",
        status: "paid",
        hosted_invoice_url: "https://invoice.stripe.com/i/1",
      },
    ];
    const body = await (await GET(request())).json();
    expect(body.invoices[0]).toEqual({
      id: "in_1",
      number: "DOPL-0001",
      created: new Date(1_780_000_000 * 1000).toISOString(),
      amountPaid: 599,
      amountDue: 599,
      currency: "usd",
      status: "paid",
      hostedInvoiceUrl: "https://invoice.stripe.com/i/1",
    });
    expect(JSON.stringify(body)).not.toContain("amount_paid");
    expect(JSON.stringify(body)).not.toContain("hosted_invoice_url");
  });

  it("keeps a draft's missing number and hosted URL as explicit nulls", async () => {
    stripeCalls.data = [
      {
        id: "in_2",
        created: 1_780_000_000,
        amount_paid: 0,
        amount_due: 799,
        currency: "usd",
        status: "open",
      },
    ];
    const body = await (await GET(request())).json();
    expect(body.invoices[0]).toMatchObject({
      number: null,
      hostedInvoiceUrl: null,
      amountDue: 799,
    });
  });
});

describe("when there is no Stripe account", () => {
  it("answers [] for a workspace that never subscribed", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(null);
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect((await res.json()).invoices).toEqual([]);
    // A missing customer is not a lookup.
    expect(stripeCalls.listParams).toBeNull();
  });

  it("answers [] with no Stripe key configured", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect((await res.json()).invoices).toEqual([]);
    expect(stripeCalls.listParams).toBeNull();
  });
});
