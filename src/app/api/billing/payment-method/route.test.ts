/**
 * GET /api/billing/payment-method — three properties whose wrong answers all look fine:
 *   - the ROLE gate is admin (a viewer reading the card is a leak nothing in the markup shows);
 *   - Stripe's DEFAULT method wins over the newest attached card — that is what Stripe charges;
 *   - no key / no customer answers `null`, not an error.
 * The Stripe SDK is faked at the module boundary; nothing touches the network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type Stripe from "stripe";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import type { WorkspaceBillingRow } from "@/features/billing/server/workspace-billing";

const AUTH: WorkspaceAuthContext = {
  userId: "user-1",
  workspaceId: "ws-1",
  workspaceSlug: "acme",
  workspacePublicId: "pub-1",
  role: "admin",
  apiKeyWorkspaceId: null,
};

/** The wrapper's option bag is not exported; this is the half asserted on. */
interface GateOptions {
  minRole?: string;
  sessionOnly?: boolean;
  writeScopeExempt?: boolean;
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
  customer: null as Record<string, unknown> | null,
  cards: [] as unknown[],
  listedFor: null as string | null,
}));

vi.mock("stripe", () => ({
  default: class FakeStripe {
    customers = {
      retrieve: async () => stripeCalls.customer,
    };
    paymentMethods = {
      list: async ({ customer }: { customer: string }) => {
        stripeCalls.listedFor = customer;
        return { data: stripeCalls.cards };
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

function billing(overrides: Partial<WorkspaceBillingRow>): WorkspaceBillingRow {
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

function card(last4: string): Stripe.PaymentMethod {
  return {
    id: `pm_${last4}`,
    object: "payment_method",
    card: { brand: "visa", last4, exp_month: 4, exp_year: 2029 },
  } as unknown as Stripe.PaymentMethod;
}

const request = () =>
  new NextRequest("http://localhost/api/billing/payment-method");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
  stripeCalls.customer = { invoice_settings: {} };
  stripeCalls.cards = [];
  stripeCalls.listedFor = null;
  mockRepo.getWorkspaceBilling.mockResolvedValue(billing({}));
});

describe("who may read the card", () => {
  it("is gated at ADMIN — a viewer has no business reading it", () => {
    expect(gate.opts).toMatchObject({ minRole: "admin" });
  });

  it("is a READ, so it is not sessionOnly", () => {
    // ⚠ Pinning the ABSENCE of sessionOnly: a copy-paste from cancel/portal locks the SPA out.
    expect(gate.opts?.sessionOnly).toBeUndefined();
  });
});

describe("which method is reported", () => {
  it("prefers Stripe's DEFAULT payment method over the newest card", async () => {
    stripeCalls.customer = {
      invoice_settings: { default_payment_method: card("4242") },
    };
    stripeCalls.cards = [card("1111")];
    const body = await (await GET(request(), { params: Promise.resolve({}) })).json();
    expect(body.paymentMethod).toEqual({
      brand: "visa",
      last4: "4242",
      expMonth: 4,
      expYear: 2029,
    });
    expect(stripeCalls.listedFor).toBeNull();
  });

  it("falls back to the attached card when no default is set", async () => {
    // Normal after an embedded checkout: card attached, `default_payment_method` never written.
    stripeCalls.cards = [card("1111")];
    const body = await (await GET(request(), { params: Promise.resolve({}) })).json();
    expect(body.paymentMethod.last4).toBe("1111");
    expect(stripeCalls.listedFor).toBe("cus_123");
  });

  it("answers null for a customer with no card at all", async () => {
    expect((await (await GET(request(), { params: Promise.resolve({}) })).json()).paymentMethod).toBeNull();
  });

  it("answers null for a non-card default (SEPA, bank debit)", async () => {
    // Nothing to render as brand + last4; the portal is the surface that can.
    stripeCalls.customer = {
      invoice_settings: {
        default_payment_method: { id: "pm_sepa", object: "payment_method" },
      },
    };
    const body = await (await GET(request(), { params: Promise.resolve({}) })).json();
    expect(body.paymentMethod).toBeNull();
  });
});

describe("when there is no Stripe account", () => {
  it("answers null — never 500 — for a workspace that never subscribed", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(null);
    const res = await GET(request(), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect((await res.json()).paymentMethod).toBeNull();
  });

  it("answers null with no Stripe key configured", async () => {
    // Preview/test environments have no key; the pane renders its empty state.
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const res = await GET(request(), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect((await res.json()).paymentMethod).toBeNull();
  });
});
