/**
 * INVARIANT SUITE — Stripe webhook handler.
 *
 * Drives `processStripeEvent` with the billing repository, Stripe client,
 * seat-sync, and idempotency table all mocked (no network, no DB). Locks the
 * adversarial-review fixes:
 *   - status mapping: incomplete/unpaid/incomplete_expired -> canceled
 *   - event-ordering watermark: a stale (older event.created) replay no-ops
 *   - invoice.payment_succeeded recovers ONLY on a matching subscription
 *   - invoice.payment_failed sets past_due ONLY on a matching Pro row
 *   - multi-item subs bill the seat-priced item; period end prefers sub-level
 *   - checkout re-syncs seats
 *   - idempotency claim is atomic (duplicate short-circuits; error releases)
 *   - grandfather path warns on ambiguous / unmapped mappings
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Stripe from "stripe";

const retrieveSub = vi.fn();

const supa = vi.hoisted(() => ({
  updateCalls: [] as Array<Record<string, unknown>>,
  claimResult: { data: [{ event_id: "evt" }] as unknown[], error: null as null },
  insertError: null as { code?: string; message?: string } | null,
}));

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
      insert: () => Promise.resolve({ error: supa.insertError }),
      update: (patch: Record<string, unknown>) => {
        supa.updateCalls.push(patch);
        const builder: UpdateBuilder = {
          eq: () => builder,
          select: () => Promise.resolve(supa.claimResult),
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
  findWorkspaceIdByStripeCustomer: vi.fn(),
  findWorkspaceIdByStripeSubscription: vi.fn(),
}));

// Keep the real selectSeatItem (finding #5) while stubbing the Stripe client.
vi.mock("./stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stripe")>();
  return {
    ...actual,
    getStripe: vi.fn(() => ({ subscriptions: { retrieve: retrieveSub } })),
  };
});

vi.mock("./seats", () => ({ syncSeatQuantity: vi.fn() }));
vi.mock("./subscriptions", () => ({ getUserByStripeCustomer: vi.fn() }));
vi.mock("@/features/workspaces/server/repository", () => ({
  findDefaultWorkspaceForUser: vi.fn(),
  countWorkspacesOwnedBy: vi.fn(),
}));

import * as repo from "./workspace-billing";
import { syncSeatQuantity } from "./seats";
import { getUserByStripeCustomer } from "./subscriptions";
import {
  countWorkspacesOwnedBy,
  findDefaultWorkspaceForUser,
} from "@/features/workspaces/server/repository";
import { processStripeEvent } from "./webhook-handler";

const mockRepo = vi.mocked(repo);
const WS = "ws-1";

function sub(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: "sub_1",
    status: "active",
    customer: "cus_1",
    metadata: { workspace_id: WS },
    items: {
      data: [
        {
          id: "si_1",
          quantity: 3,
          price: { id: "price_seat" },
          current_period_end: 1735000000,
        },
      ],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function invoice(overrides: Record<string, unknown> = {}): Stripe.Invoice {
  return {
    customer: "cus_1",
    parent: { subscription_details: { subscription: "sub_1" } },
    ...overrides,
  } as unknown as Stripe.Invoice;
}

function event(
  type: string,
  object: unknown,
  created = 1000
): Stripe.Event {
  return {
    id: `evt_${created}`,
    type,
    created,
    data: { object },
  } as unknown as Stripe.Event;
}

beforeEach(() => {
  vi.clearAllMocks();
  supa.updateCalls = [];
  supa.claimResult = { data: [{ event_id: "evt" }], error: null };
  supa.insertError = null;
  mockRepo.getStripeEventWatermark.mockResolvedValue(null);
  mockRepo.findWorkspaceIdByStripeCustomer.mockResolvedValue(WS);
  mockRepo.findWorkspaceIdByStripeSubscription.mockResolvedValue(WS);
  retrieveSub.mockResolvedValue(sub());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("mapStatus (via subscription.updated)", () => {
  it.each([
    ["incomplete", "free", "canceled"],
    ["incomplete_expired", "free", "canceled"],
    ["unpaid", "free", "canceled"],
    ["past_due", "pro", "past_due"],
    ["active", "pro", "active"],
    ["trialing", "pro", "active"],
  ] as const)(
    "maps stripe %s -> plan %s / status %s",
    async (stripeStatus, plan, status) => {
      await processStripeEvent(
        event("customer.subscription.updated", sub({ status: stripeStatus }))
      );
      expect(mockRepo.upsertWorkspaceBilling).toHaveBeenCalledWith(
        WS,
        expect.objectContaining({ plan, status })
      );
    }
  );

  it("never-paid states carry no seat count (non-entitled)", async () => {
    await processStripeEvent(
      event("customer.subscription.updated", sub({ status: "unpaid" }))
    );
    expect(mockRepo.upsertWorkspaceBilling).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ plan: "free", seatCount: null })
    );
  });
});

describe("event-ordering watermark", () => {
  it("applies a fresh event and stamps the watermark", async () => {
    mockRepo.getStripeEventWatermark.mockResolvedValue(100);
    await processStripeEvent(
      event("customer.subscription.updated", sub(), 150)
    );
    expect(mockRepo.upsertWorkspaceBilling).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ status: "active", lastStripeEventCreated: 150 })
    );
  });

  it("skips a stale (older-or-equal) replay — no billing write", async () => {
    mockRepo.getStripeEventWatermark.mockResolvedValue(200);
    await processStripeEvent(
      event("customer.subscription.updated", sub(), 150)
    );
    expect(mockRepo.upsertWorkspaceBilling).not.toHaveBeenCalled();
  });

  it("a late updated(active) after a deleted(canceled) cannot resurrect Pro", async () => {
    // deleted at t=300 wins; the redelivered older active update at t=250 is stale.
    mockRepo.getStripeEventWatermark.mockResolvedValue(300);
    await processStripeEvent(
      event("customer.subscription.updated", sub({ status: "active" }), 250)
    );
    expect(mockRepo.upsertWorkspaceBilling).not.toHaveBeenCalled();
  });

  it("applies when no watermark is set yet (null)", async () => {
    mockRepo.getStripeEventWatermark.mockResolvedValue(null);
    await processStripeEvent(
      event("customer.subscription.deleted", sub(), 500)
    );
    expect(mockRepo.upsertWorkspaceBilling).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({
        plan: "free",
        status: "canceled",
        stripeSubscriptionId: null,
        lastStripeEventCreated: 500,
      })
    );
  });
});

describe("multi-item subscriptions + period end", () => {
  it("bills the seat-priced item, not data[0], and prefers sub-level period end", async () => {
    vi.stubEnv("STRIPE_PRO_SEAT_PRICE_ID", "price_seat");
    const multi = sub({
      status: "active",
      items: {
        data: [
          { id: "si_addon", quantity: 1, price: { id: "price_addon" } },
          {
            id: "si_seat",
            quantity: 5,
            price: { id: "price_seat" },
            current_period_end: 111,
          },
        ],
      },
      current_period_end: 999,
    } as unknown as Partial<Stripe.Subscription>);

    await processStripeEvent(event("customer.subscription.updated", multi));

    expect(mockRepo.upsertWorkspaceBilling).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({
        seatCount: 5,
        stripePriceId: "price_seat",
        currentPeriodEnd: new Date(999 * 1000).toISOString(),
      })
    );
  });
});

describe("invoice.payment_succeeded", () => {
  it("recovers to active when the invoice's subscription matches the stored one", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue({
      stripeSubscriptionId: "sub_1",
    } as never);
    await processStripeEvent(event("invoice.payment_succeeded", invoice()));
    expect(mockRepo.upsertWorkspaceBilling).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ plan: "pro", status: "active" })
    );
  });

  it("never resurrects a row with a null stored subscription", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue({
      stripeSubscriptionId: null,
    } as never);
    await processStripeEvent(event("invoice.payment_succeeded", invoice()));
    expect(mockRepo.upsertWorkspaceBilling).not.toHaveBeenCalled();
  });

  it("ignores a mismatched subscription", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue({
      stripeSubscriptionId: "sub_other",
    } as never);
    await processStripeEvent(event("invoice.payment_succeeded", invoice()));
    expect(mockRepo.upsertWorkspaceBilling).not.toHaveBeenCalled();
  });
});

describe("invoice.payment_failed", () => {
  it("sets past_due on a matching Pro row", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue({
      plan: "pro",
      stripeSubscriptionId: "sub_1",
    } as never);
    await processStripeEvent(event("invoice.payment_failed", invoice()));
    expect(mockRepo.upsertWorkspaceBilling).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ status: "past_due" })
    );
  });

  it("never flags a free row (no free/past_due nonsense)", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue({
      plan: "free",
      stripeSubscriptionId: null,
    } as never);
    await processStripeEvent(event("invoice.payment_failed", invoice()));
    expect(mockRepo.upsertWorkspaceBilling).not.toHaveBeenCalled();
  });

  it("ignores a Pro row when the invoice names a different subscription", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue({
      plan: "pro",
      stripeSubscriptionId: "sub_other",
    } as never);
    await processStripeEvent(event("invoice.payment_failed", invoice()));
    expect(mockRepo.upsertWorkspaceBilling).not.toHaveBeenCalled();
  });
});

describe("checkout.session.completed", () => {
  it("re-syncs seats after applying the subscription", async () => {
    const session = {
      metadata: { workspace_id: WS },
      customer: "cus_1",
      subscription: "sub_1",
    };
    await processStripeEvent(event("checkout.session.completed", session));
    expect(mockRepo.upsertWorkspaceBilling).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ plan: "pro", status: "active" })
    );
    expect(syncSeatQuantity).toHaveBeenCalledWith(WS);
  });

  it("a seat-sync failure does not fail the webhook", async () => {
    vi.mocked(syncSeatQuantity).mockRejectedValue(new Error("stripe down"));
    const session = {
      metadata: { workspace_id: WS },
      customer: "cus_1",
      subscription: "sub_1",
    };
    const result = await processStripeEvent(
      event("checkout.session.completed", session)
    );
    expect(result.received).toBe(true);
  });
});

describe("idempotency claim (atomic)", () => {
  it("dispatches when the claim returns a row", async () => {
    supa.claimResult = { data: [{ event_id: "evt" }], error: null };
    const result = await processStripeEvent(
      event("customer.subscription.updated", sub())
    );
    expect(result).toEqual({ received: true });
    expect(mockRepo.upsertWorkspaceBilling).toHaveBeenCalled();
  });

  it("short-circuits as duplicate when the claim returns no rows", async () => {
    supa.claimResult = { data: [], error: null };
    const result = await processStripeEvent(
      event("customer.subscription.updated", sub())
    );
    expect(result).toEqual({ received: true, duplicate: true });
    expect(mockRepo.upsertWorkspaceBilling).not.toHaveBeenCalled();
  });

  it("releases the claim (processed=false) and rethrows on a dispatch error", async () => {
    mockRepo.getStripeEventWatermark.mockRejectedValue(new Error("boom"));
    await expect(
      processStripeEvent(event("customer.subscription.updated", sub()))
    ).rejects.toThrow("boom");
    const released = supa.updateCalls.some(
      (c) => c.processed === false && typeof c.last_error === "string"
    );
    expect(released).toBe(true);
  });
});

describe("grandfather mapping warnings", () => {
  it("warns when the user owns multiple workspaces (ambiguous)", async () => {
    mockRepo.findWorkspaceIdByStripeCustomer.mockResolvedValue(null);
    mockRepo.findWorkspaceIdByStripeSubscription.mockResolvedValue(null);
    vi.mocked(getUserByStripeCustomer).mockResolvedValue("user-1");
    vi.mocked(findDefaultWorkspaceForUser).mockResolvedValue({
      id: WS,
    } as never);
    vi.mocked(countWorkspacesOwnedBy).mockResolvedValue(2);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await processStripeEvent(
      event("customer.subscription.updated", sub({ metadata: {} }))
    );

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Ambiguous"));
    warn.mockRestore();
  });

  it("warns when the subscription maps to no workspace (money paid, no Pro)", async () => {
    mockRepo.findWorkspaceIdByStripeCustomer.mockResolvedValue(null);
    mockRepo.findWorkspaceIdByStripeSubscription.mockResolvedValue(null);
    vi.mocked(getUserByStripeCustomer).mockResolvedValue("user-1");
    vi.mocked(findDefaultWorkspaceForUser).mockResolvedValue(null);
    vi.mocked(countWorkspacesOwnedBy).mockResolvedValue(0);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await processStripeEvent(
      event("customer.subscription.updated", sub({ metadata: {} }))
    );

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("could not be mapped")
    );
    expect(mockRepo.upsertWorkspaceBilling).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
