/**
 * The webhook's personal-Pro cases (2026-09-08), split out because
 * `webhook-handler.test.ts` already sits over the 500-line cap on an exemption.
 * Two facts only the assembled handler can state (the derivation is
 * `webhook-plan.test.ts`): a Pro subscription writes `seatCount: 1` whatever
 * quantity Stripe reports, and `invoice.payment_failed` moves a `pro` row to
 * past_due.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Stripe from "stripe";
import type { WorkspaceBillingRow } from "./workspace-billing";

interface UpdateBuilder {
  eq: (col: string, val: unknown) => UpdateBuilder;
  select: (cols: string) => Promise<{ data: unknown[]; error: null }>;
  then: (
    onFulfilled: (v: { error: null }) => unknown,
    onRejected?: (e: unknown) => unknown
  ) => Promise<unknown>;
}

vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from: () => ({
      insert: () => Promise.resolve({ error: null }),
      update: () => {
        const builder: UpdateBuilder = {
          eq: () => builder,
          select: () => Promise.resolve({ data: [{ event_id: "evt" }], error: null }),
          then: (onFulfilled, onRejected) =>
            Promise.resolve({ error: null }).then(onFulfilled, onRejected),
        };
        return builder;
      },
    }),
  }),
}));

vi.mock("./workspace-billing", () => ({
  getWorkspaceBilling: vi.fn(),
  getStripeEventWatermark: vi.fn(),
  upsertWorkspaceBilling: vi.fn(),
  releaseWorkspaceCheckout: vi.fn(),
  findWorkspaceIdByStripeCustomer: vi.fn(),
  findWorkspaceIdByStripeSubscription: vi.fn(),
}));
vi.mock("./seats", () => ({ syncSeatQuantity: vi.fn() }));
vi.mock("./subscriptions", () => ({ getUserByStripeCustomer: vi.fn() }));
vi.mock("@/features/workspaces/server/repository", () => ({
  findSoleOwnedStandardWorkspace: vi.fn(),
  findWorkspaceById: vi.fn(),
}));

import * as repo from "./workspace-billing";
import { findWorkspaceById } from "@/features/workspaces/server/repository";
import { processStripeEvent } from "./webhook-handler";

const mockRepo = vi.mocked(repo);
const findWorkspace = vi.mocked(findWorkspaceById);
const PERSONAL = "personal-1";

function proSub(quantity: number): Stripe.Subscription {
  return {
    id: "sub_pro",
    status: "active",
    customer: "cus_1",
    metadata: { workspace_id: PERSONAL },
    items: {
      data: [
        {
          id: "si_pro",
          quantity,
          price: { id: "price_personal_pro" },
          current_period_end: 1735000000,
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}

function event(type: string, object: unknown, created = 1000): Stripe.Event {
  return { id: `evt_${created}`, type, created, data: { object } } as unknown as Stripe.Event;
}

function billing(over: Partial<WorkspaceBillingRow> = {}): WorkspaceBillingRow {
  return {
    workspaceId: PERSONAL,
    plan: "pro",
    status: "active",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_pro",
    stripePriceId: "price_personal_pro",
    seatCount: 1,
    currentPeriodStart: "2026-09-01T00:00:00.000Z",
    currentPeriodEnd: "2026-10-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    lastStripeEventCreated: 1,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_PERSONAL_PRO_PRICE_ID", "price_personal_pro");
  mockRepo.getStripeEventWatermark.mockResolvedValue(null);
  mockRepo.findWorkspaceIdByStripeCustomer.mockResolvedValue(PERSONAL);
  mockRepo.findWorkspaceIdByStripeSubscription.mockResolvedValue(PERSONAL);
  findWorkspace.mockResolvedValue({
    id: PERSONAL,
    name: "Home",
    slug: "personal",
    publicId: "ff00ff00ff00",
    kind: "personal",
  } as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("a personal Pro subscription", () => {
  it("writes plan `pro` with seatCount 1", async () => {
    await processStripeEvent(event("customer.subscription.updated", proSub(1)));
    expect(mockRepo.upsertWorkspaceBilling).toHaveBeenCalledWith(
      PERSONAL,
      expect.objectContaining({ plan: "pro", seatCount: 1, status: "active" })
    );
  });

  it("pins seatCount to 1 even when Stripe reports a larger quantity", async () => {
    // A hand-edited dashboard quantity must not make a personal container look
    // like a multi-seat workspace to `entitlements.ts`.
    await processStripeEvent(event("customer.subscription.updated", proSub(4)));
    expect(mockRepo.upsertWorkspaceBilling).toHaveBeenCalledWith(
      PERSONAL,
      expect.objectContaining({ seatCount: 1 })
    );
  });

  it("logs — and still writes — a Pro subscription landing on a standard workspace", async () => {
    // Reports, never refuses: the money has already moved by the time the event
    // lands, and dropping the write leaves a payer with no plan at all.
    findWorkspace.mockResolvedValue({
      id: PERSONAL,
      name: "Acme",
      slug: "acme",
      publicId: "ab12cd34ef56",
      kind: "standard",
    } as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await processStripeEvent(event("customer.subscription.updated", proSub(1)));
    expect(err).toHaveBeenCalledWith(expect.stringContaining("mismatch"));
    expect(mockRepo.upsertWorkspaceBilling).toHaveBeenCalledWith(
      PERSONAL,
      expect.objectContaining({ plan: "pro" })
    );
    err.mockRestore();
  });
});

describe("dunning reaches a personal Pro row", () => {
  function invoice(): Stripe.Invoice {
    return {
      customer: "cus_1",
      parent: { subscription_details: { subscription: "sub_pro" } },
    } as unknown as Stripe.Invoice;
  }

  it("flags past_due on a failed invoice", async () => {
    // `pro` must be in the paid set, or it is the one paid plan that silently
    // skips dunning.
    mockRepo.getWorkspaceBilling.mockResolvedValue(billing());
    await processStripeEvent(event("invoice.payment_failed", invoice()));
    expect(mockRepo.upsertWorkspaceBilling).toHaveBeenCalledWith(
      PERSONAL,
      expect.objectContaining({ status: "past_due" })
    );
  });

  it("still ignores a failed invoice on a FREE row", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ plan: "free", stripeSubscriptionId: null })
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await processStripeEvent(event("invoice.payment_failed", invoice()));
    expect(mockRepo.upsertWorkspaceBilling).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
