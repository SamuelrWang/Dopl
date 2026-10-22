/**
 * The webhook's personal-MAX cases (2026-10-22) — derivation and the assembled
 * handler, in one file because both halves are small and `webhook-handler.test.ts`
 * already sits over the line cap on an exemption.
 *
 * The properties with teeth:
 *   • the Max PRICE maps to `max`, and is never read as Pro or Team;
 *   • an UNKNOWN price never grants Max — metadata `plan: "max"` is honoured
 *     only where this environment cannot name the Max price at all;
 *   • a tier switch (Pro → Max upgrade, Max → Pro at the schedule boundary) is
 *     an ordinary `customer.subscription.updated` mapped by price, and the
 *     event watermark drops an older event that arrives after a newer one;
 *   • Max is a paid plan for dunning, flat at seatCount 1.
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

/** Stripe's CURRENT view of a subscription, for the re-fetch cases. Only reached
 *  when STRIPE_SECRET_KEY is stubbed; every other case uses the event snapshot. */
const live = vi.hoisted(() => ({
  subscription: null as unknown,
  error: null as (Error & { code?: string }) | null,
  retrieves: 0,
}));
vi.mock("stripe", () => ({
  default: class FakeStripe {
    subscriptions = {
      retrieve: async () => {
        live.retrieves += 1;
        if (live.error) throw live.error;
        return live.subscription;
      },
    };
  },
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
import { derivePlan, reportPlanContainerMismatch } from "./webhook-plan";

const mockRepo = vi.mocked(repo);
const findWorkspace = vi.mocked(findWorkspaceById);
const PERSONAL = "personal-1";

function sub(
  priceId: string,
  opts: { quantity?: number; metadata?: Record<string, string> } = {}
): Stripe.Subscription {
  return {
    id: "sub_personal",
    status: "active",
    customer: "cus_1",
    metadata: { workspace_id: PERSONAL, ...(opts.metadata ?? {}) },
    items: {
      data: [
        {
          id: "si_1",
          quantity: opts.quantity ?? 1,
          price: { id: priceId },
          current_period_start: 1_760_000_000,
          current_period_end: 1_762_600_000,
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
    plan: "max",
    status: "active",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_personal",
    stripePriceId: "price_personal_max",
    seatCount: 1,
    currentPeriodStart: "2026-10-01T00:00:00.000Z",
    currentPeriodEnd: "2026-11-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    lastStripeEventCreated: 1,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_PRO_SEAT_PRICE_ID", "price_seat");
  vi.stubEnv("STRIPE_PERSONAL_PRO_PRICE_ID", "price_personal_pro");
  vi.stubEnv("STRIPE_PERSONAL_MAX_PRICE_ID", "price_personal_max");
  mockRepo.getStripeEventWatermark.mockResolvedValue(null);
  mockRepo.findWorkspaceIdByStripeCustomer.mockResolvedValue(PERSONAL);
  mockRepo.findWorkspaceIdByStripeSubscription.mockResolvedValue(PERSONAL);
  findWorkspace.mockResolvedValue({
    id: PERSONAL,
    name: "Home",
    slug: "home",
    publicId: "ff00ff00ff00",
    kind: "home",
  } as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("derivePlan — Max", () => {
  it("maps the Max price to `max`, whatever the metadata says", () => {
    expect(derivePlan(sub("price_personal_max"))).toBe("max");
    expect(derivePlan(sub("price_personal_max", { metadata: { plan: "pro" } }))).toBe("max");
  });

  it("never calls the Pro price Max, even under stale `plan: max` metadata", () => {
    // A Max → Pro schedule phase whose metadata did not move: the PRICE wins.
    expect(derivePlan(sub("price_personal_pro", { metadata: { plan: "max" } }))).toBe("pro");
  });

  it("🔒 a REPRICED Max sub stamped `plan: max` stays Max — logged, never dropped to team", () => {
    // 2026-10-22 review: reading it as `team` would drop a paying subscriber to
    // the free personal allowance the day Max is repriced.
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(derivePlan(sub("price_old_max", { metadata: { plan: "max" } }))).toBe("max");
    expect(err).toHaveBeenCalledWith(expect.stringContaining("STRIPE_LEGACY_MAX_PRICE_IDS"));
    err.mockRestore();
  });

  it("recognises a LEGACY Max price from STRIPE_LEGACY_MAX_PRICE_IDS with no metadata", () => {
    vi.stubEnv("STRIPE_LEGACY_MAX_PRICE_IDS", "price_old_max, price_older_max");
    expect(derivePlan(sub("price_old_max"))).toBe("max");
    expect(derivePlan(sub("price_older_max"))).toBe("max");
  });

  it("recognises a Max price by its lookup key, whatever its id", () => {
    const s = sub("price_rotated");
    (s.items.data[0].price as unknown as { lookup_key: string }).lookup_key = "dopl_personal_max";
    expect(derivePlan(s)).toBe("max");
  });

  it("an unknown price with NO Max stamp still never becomes Max", () => {
    expect(derivePlan(sub("price_mystery"))).toBe("team");
  });

  it("honours `plan: max` metadata only where the Max price is unknowable", () => {
    vi.stubEnv("STRIPE_PERSONAL_MAX_PRICE_ID", "");
    expect(derivePlan(sub("price_mystery", { metadata: { plan: "max" } }))).toBe("max");
  });

  it("reads an unset Max env as recognising nothing", () => {
    vi.stubEnv("STRIPE_PERSONAL_MAX_PRICE_ID", "");
    expect(derivePlan(sub("price_personal_max"))).toBe("team");
  });
});

describe("reportPlanContainerMismatch — Max", () => {
  it("is quiet when Max lands on a home space", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await reportPlanContainerMismatch(PERSONAL, "max");
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("ERRORS when Max lands on a standard workspace", async () => {
    findWorkspace.mockResolvedValue({ id: "ws-1", kind: "standard" } as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await reportPlanContainerMismatch("ws-1", "max");
    expect(err.mock.calls[0][0]).toContain("'max'");
    err.mockRestore();
  });
});

describe("🔒 the upsert RE-FETCHES the subscription (same-second events, 2026-10-22 review)", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    live.subscription = null;
    live.error = null;
    live.retrieves = 0;
  });

  it("writes what Stripe holds NOW, not the event's snapshot", async () => {
    // The snapshot says Pro (a release event); Stripe already bills Max.
    live.subscription = sub("price_personal_max");
    await processStripeEvent(event("customer.subscription.updated", sub("price_personal_pro")));
    expect(live.retrieves).toBe(1);
    expect(mockRepo.upsertWorkspaceBilling).toHaveBeenCalledWith(
      PERSONAL,
      expect.objectContaining({ plan: "max", stripePriceId: "price_personal_max" })
    );
  });

  it("APPLIES a same-second event — it carries the latest state, so it must not be dropped", async () => {
    mockRepo.getStripeEventWatermark.mockResolvedValue(1000);
    live.subscription = sub("price_personal_max");
    await processStripeEvent(event("customer.subscription.updated", sub("price_personal_pro"), 1000));
    expect(mockRepo.upsertWorkspaceBilling).toHaveBeenCalledWith(
      PERSONAL,
      expect.objectContaining({ plan: "max", lastStripeEventCreated: 1000 })
    );
  });

  it("still drops a strictly OLDER event", async () => {
    mockRepo.getStripeEventWatermark.mockResolvedValue(2000);
    live.subscription = sub("price_personal_max");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await processStripeEvent(event("customer.subscription.updated", sub("price_personal_pro"), 1500));
    expect(mockRepo.upsertWorkspaceBilling).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("🔒 a Stripe outage THROWS (Stripe retries) — it never writes a guess", async () => {
    live.error = Object.assign(new Error("stripe down"), { code: "api_error" });
    await expect(
      processStripeEvent(event("customer.subscription.updated", sub("price_personal_max")))
    ).rejects.toThrow("stripe down");
    expect(mockRepo.upsertWorkspaceBilling).not.toHaveBeenCalled();
  });

  it("falls back to the snapshot for a subscription Stripe no longer has", async () => {
    live.error = Object.assign(new Error("No such subscription"), { code: "resource_missing" });
    await processStripeEvent(event("customer.subscription.updated", sub("price_personal_max")));
    expect(mockRepo.upsertWorkspaceBilling).toHaveBeenCalledWith(
      PERSONAL,
      expect.objectContaining({ plan: "max" })
    );
  });
});

describe("the assembled handler", () => {
  it("writes plan `max`, seatCount pinned to 1, on the Max price", async () => {
    await processStripeEvent(
      event("customer.subscription.updated", sub("price_personal_max", { quantity: 3 }))
    );
    expect(mockRepo.upsertWorkspaceBilling).toHaveBeenCalledWith(
      PERSONAL,
      expect.objectContaining({
        plan: "max",
        seatCount: 1,
        status: "active",
        stripePriceId: "price_personal_max",
      })
    );
  });

  it("switches Pro → Max on the upgrade's update event, keeping the period anchor", async () => {
    await processStripeEvent(event("customer.subscription.updated", sub("price_personal_max")));
    const patch = mockRepo.upsertWorkspaceBilling.mock.calls[0][1];
    expect(patch.plan).toBe("max");
    // Same anchor as the Pro period: the credit counter keeps its key, so the
    // payer's spend carries over against the bigger allowance.
    expect(patch.currentPeriodStart).toBe(new Date(1_760_000_000 * 1000).toISOString());
  });

  it("switches Max → Pro when the schedule's phase boundary swaps the price", async () => {
    await processStripeEvent(event("customer.subscription.updated", sub("price_personal_pro")));
    expect(mockRepo.upsertWorkspaceBilling).toHaveBeenCalledWith(
      PERSONAL,
      expect.objectContaining({ plan: "pro" })
    );
  });

  it("🔒 drops an OLDER Pro event that arrives after the newer Max one (out of order)", async () => {
    mockRepo.getStripeEventWatermark.mockResolvedValue(2000);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await processStripeEvent(
      event("customer.subscription.updated", sub("price_personal_pro"), 1500)
    );
    expect(mockRepo.upsertWorkspaceBilling).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("reverts a canceled Max subscription to free and clears the anchor", async () => {
    await processStripeEvent(
      event("customer.subscription.deleted", sub("price_personal_max"))
    );
    expect(mockRepo.upsertWorkspaceBilling).toHaveBeenCalledWith(
      PERSONAL,
      expect.objectContaining({
        plan: "free",
        status: "canceled",
        stripeSubscriptionId: null,
        currentPeriodStart: null,
      })
    );
  });

  it("flags past_due on a failed Max invoice — Max is in the paid set", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(billing());
    await processStripeEvent(
      event("invoice.payment_failed", {
        customer: "cus_1",
        parent: { subscription_details: { subscription: "sub_personal" } },
      })
    );
    expect(mockRepo.upsertWorkspaceBilling).toHaveBeenCalledWith(
      PERSONAL,
      expect.objectContaining({ status: "past_due" })
    );
  });
});
