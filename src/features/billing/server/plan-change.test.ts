/**
 * `plan-change.ts` — moving a live personal subscription Pro ⇄ Max in place.
 *
 * The properties with teeth:
 *   • ONE subscription: an upgrade updates the existing item (never a second
 *     subscription), prorated and paid NOW (`always_invoice`), and a declined
 *     card changes NOTHING (`error_if_incomplete` → 402 `PAYMENT_FAILED`);
 *   • a downgrade waits for the period end (a schedule), bills nothing today and
 *     leaves the row on Max;
 *   • picking the current plan while a downgrade is queued cancels it;
 *   • every refusal (past_due, ending, no live sub, unset price env, concurrent
 *     change) happens before Stripe is written, and the claim is always freed.
 *
 * Stripe is faked at the SDK (`stripe`'s default export) so the real
 * `./stripe.ts`, `./stripe-schedule.ts` and `./webhook-plan.ts` run.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WorkspaceBillingRow } from "./workspace-billing";

type Params = Record<string, unknown>;

const fake = vi.hoisted(() => ({
  subscription: null as Record<string, unknown> | null,
  schedule: null as Record<string, unknown> | null,
  calls: [] as Array<{ op: string; id?: string; params?: Params }>,
  updateError: null as Error | null,
}));

vi.mock("stripe", () => {
  class StripeError extends Error {
    statusCode?: number;
    constructor(message: string, statusCode?: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  class StripeCardError extends StripeError {}
  class FakeStripe {
    static errors = { StripeError, StripeCardError };
    subscriptions = {
      retrieve: async () => fake.subscription,
      update: async (id: string, params: Params) => {
        fake.calls.push({ op: "subscriptions.update", id, params });
        if (fake.updateError) throw fake.updateError;
        return { ...fake.subscription, ...params };
      },
    };
    subscriptionSchedules = {
      retrieve: async () => fake.schedule,
      create: async (params: Params) => {
        fake.calls.push({ op: "schedules.create", params });
        fake.schedule = {
          id: "sub_sched_new",
          status: "active",
          current_phase: { start_date: 1_760_000_000, end_date: 1_762_600_000 },
          phases: [],
        };
        return fake.schedule;
      },
      update: async (id: string, params: Params) => {
        fake.calls.push({ op: "schedules.update", id, params });
        const phases = (params.phases as Array<Record<string, unknown>>).map((p, i) => ({
          start_date: i === 0 ? p.start_date : 1_762_600_000,
          end_date: i === 0 ? p.end_date : 1_765_200_000,
          items: p.items,
        }));
        return { ...fake.schedule, id, phases };
      },
      release: async (id: string) => {
        fake.calls.push({ op: "schedules.release", id });
        return { id, status: "released" };
      },
    };
  }
  return { default: FakeStripe };
});

vi.mock("@/features/workspaces/server/repository", () => ({ findWorkspaceById: vi.fn() }));
vi.mock("./workspace-billing", () => ({
  getWorkspaceBilling: vi.fn(),
  upsertWorkspaceBilling: vi.fn(),
  claimWorkspaceCheckout: vi.fn(),
  releaseWorkspaceCheckout: vi.fn(),
}));

import Stripe from "stripe";
import * as repo from "./workspace-billing";
import { changePersonalPlan, getPlanChangeState } from "./plan-change";

const mockRepo = vi.mocked(repo);
const HOME = "personal-1";

function row(over: Partial<WorkspaceBillingRow> = {}): WorkspaceBillingRow {
  return {
    workspaceId: HOME,
    plan: "pro",
    status: "active",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    stripePriceId: "price_pro",
    seatCount: 1,
    currentPeriodStart: "2026-10-09T00:00:00.000Z",
    currentPeriodEnd: "2026-11-08T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    lastStripeEventCreated: 1,
    ...over,
  };
}

function subscription(price: string, over: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    status: "active",
    cancel_at_period_end: false,
    schedule: null,
    metadata: { workspace_id: HOME, plan: price === "price_max" ? "max" : "pro" },
    items: {
      data: [
        {
          id: "si_1",
          quantity: 1,
          price: { id: price },
          current_period_start: 1_760_000_000,
          current_period_end: 1_762_600_000,
        },
      ],
    },
    ...over,
  };
}

/** A live schedule whose next phase moves to `price`. */
function queued(price: string) {
  return {
    id: "sub_sched_1",
    status: "active",
    current_phase: { start_date: 1_760_000_000, end_date: 1_762_600_000 },
    phases: [
      { start_date: 1_760_000_000, end_date: 1_762_600_000, items: [{ price: "price_max" }] },
      { start_date: 1_762_600_000, end_date: 1_765_200_000, items: [{ price }] },
    ],
  };
}

const ops = () => fake.calls.map((c) => c.op);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
  vi.stubEnv("STRIPE_PERSONAL_PRO_PRICE_ID", "price_pro");
  vi.stubEnv("STRIPE_PERSONAL_MAX_PRICE_ID", "price_max");
  fake.subscription = subscription("price_pro");
  fake.schedule = null;
  fake.calls = [];
  fake.updateError = null;
  mockRepo.getWorkspaceBilling.mockResolvedValue(row());
  mockRepo.claimWorkspaceCheckout.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("UPGRADE Pro → Max — immediate, prorated, paid now", () => {
  it("updates the ONE existing item to the Max price with always_invoice + error_if_incomplete", async () => {
    const result = await changePersonalPlan(HOME, "max");
    expect(result).toEqual({
      outcome: "upgraded",
      plan: "max",
      scheduledPlan: null,
      effectiveAt: null,
    });
    const update = fake.calls.find((c) => c.op === "subscriptions.update");
    expect(update?.id).toBe("sub_1");
    expect(update?.params).toMatchObject({
      items: [{ id: "si_1", price: "price_max", quantity: 1 }],
      proration_behavior: "always_invoice",
      payment_behavior: "error_if_incomplete",
      metadata: { workspace_id: HOME, plan: "max" },
    });
  });

  it("writes the local row without stamping the event watermark", async () => {
    await changePersonalPlan(HOME, "max");
    expect(mockRepo.upsertWorkspaceBilling).toHaveBeenCalledWith(HOME, {
      plan: "max",
      stripePriceId: "price_max",
      seatCount: 1,
    });
  });

  it("🔒 a declined card is 402 PAYMENT_FAILED and changes NOTHING locally", async () => {
    fake.updateError = new (
      Stripe as unknown as { errors: { StripeCardError: new (m: string, s: number) => Error } }
    ).errors.StripeCardError("Your card was declined.", 402);
    await expect(changePersonalPlan(HOME, "max")).rejects.toMatchObject({
      status: 402,
      code: "PAYMENT_FAILED",
    });
    expect(mockRepo.upsertWorkspaceBilling).not.toHaveBeenCalled();
    expect(mockRepo.releaseWorkspaceCheckout).toHaveBeenCalledWith(HOME);
  });

  it("rethrows a non-payment Stripe failure (500 at the edge), still freeing the claim", async () => {
    fake.updateError = new Error("stripe down");
    await expect(changePersonalPlan(HOME, "max")).rejects.toThrow("stripe down");
    expect(mockRepo.releaseWorkspaceCheckout).toHaveBeenCalledWith(HOME);
  });
});

describe("DOWNGRADE Max → Pro — at the period end", () => {
  beforeEach(() => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(row({ plan: "max", stripePriceId: "price_max" }));
    fake.subscription = subscription("price_max");
  });

  it("queues a schedule: current phase restated on Max, next phase Pro, no proration", async () => {
    const result = await changePersonalPlan(HOME, "pro");
    expect(result).toEqual({
      outcome: "downgrade_scheduled",
      plan: "max",
      scheduledPlan: "pro",
      effectiveAt: new Date(1_762_600_000 * 1000).toISOString(),
    });
    expect(ops()).toEqual(["schedules.create", "schedules.update"]);
    const update = fake.calls[1].params as { phases: Array<Record<string, unknown>> };
    expect(update).toMatchObject({ end_behavior: "release" });
    expect(update.phases[0]).toMatchObject({
      items: [{ price: "price_max", quantity: 1 }],
      start_date: 1_760_000_000,
      end_date: 1_762_600_000,
      metadata: { plan: "max" },
    });
    expect(update.phases[1]).toMatchObject({
      items: [{ price: "price_pro", quantity: 1 }],
      proration_behavior: "none",
      metadata: { plan: "pro" },
    });
  });

  it("🔒 bills NOTHING today and leaves the row on Max", async () => {
    await changePersonalPlan(HOME, "pro");
    expect(ops()).not.toContain("subscriptions.update");
    expect(mockRepo.upsertWorkspaceBilling).not.toHaveBeenCalled();
  });

  it("is idempotent when the same downgrade is already queued", async () => {
    fake.subscription = subscription("price_max", { schedule: "sub_sched_1" });
    fake.schedule = queued("price_pro");
    const result = await changePersonalPlan(HOME, "pro");
    expect(result.outcome).toBe("unchanged");
    expect(result.scheduledPlan).toBe("pro");
    expect(fake.calls).toEqual([]);
  });

  it("choosing Max again CANCELS the queued downgrade (releases the schedule)", async () => {
    fake.subscription = subscription("price_max", { schedule: "sub_sched_1" });
    fake.schedule = queued("price_pro");
    const result = await changePersonalPlan(HOME, "max");
    expect(result).toMatchObject({ outcome: "downgrade_canceled", plan: "max", scheduledPlan: null });
    expect(ops()).toEqual(["schedules.release"]);
  });
});

describe("refusals — before Stripe is written", () => {
  it.each([
    ["no live personal sub", row({ plan: "free", status: "free", stripeSubscriptionId: null }), "NO_ACTIVE_SUBSCRIPTION", 409],
    ["a Team row", row({ plan: "team" }), "NO_ACTIVE_SUBSCRIPTION", 409],
    ["a canceled row", row({ status: "canceled" }), "NO_ACTIVE_SUBSCRIPTION", 409],
    ["past_due", row({ status: "past_due" }), "PAYMENT_PAST_DUE", 409],
    ["a plan set to end", row({ cancelAtPeriodEnd: true }), "PLAN_ENDING", 409],
  ] as const)("%s → %s", async (_label, billing, code, status) => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(billing);
    await expect(changePersonalPlan(HOME, "max")).rejects.toMatchObject({ code, status });
    expect(fake.calls).toEqual([]);
    expect(mockRepo.claimWorkspaceCheckout).not.toHaveBeenCalled();
  });

  it("🔒 503 PRICE_NOT_CONFIGURED when the target's env is unset — never another tier's price", async () => {
    vi.stubEnv("STRIPE_PERSONAL_MAX_PRICE_ID", "");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(changePersonalPlan(HOME, "max")).rejects.toMatchObject({
      status: 503,
      code: "PRICE_NOT_CONFIGURED",
    });
    expect(err).toHaveBeenCalledWith(expect.stringContaining("STRIPE_PERSONAL_MAX_PRICE_ID"));
    expect(fake.calls).toEqual([]);
    err.mockRestore();
  });

  it("409 PLAN_CHANGE_IN_PROGRESS when another change holds the claim — and frees nothing", async () => {
    mockRepo.claimWorkspaceCheckout.mockResolvedValue(false);
    await expect(changePersonalPlan(HOME, "max")).rejects.toMatchObject({
      code: "PLAN_CHANGE_IN_PROGRESS",
    });
    expect(fake.calls).toEqual([]);
    expect(mockRepo.releaseWorkspaceCheckout).not.toHaveBeenCalled();
  });

  it("re-checks STRIPE, not just the row: an ending sub in Stripe is refused", async () => {
    fake.subscription = subscription("price_pro", { cancel_at_period_end: true });
    await expect(changePersonalPlan(HOME, "max")).rejects.toMatchObject({ code: "PLAN_ENDING" });
    expect(fake.calls).toEqual([]);
    expect(mockRepo.releaseWorkspaceCheckout).toHaveBeenCalledWith(HOME);
  });

  it("a double-click lands once: the second request sees Max and answers unchanged", async () => {
    fake.subscription = subscription("price_max");
    const result = await changePersonalPlan(HOME, "max");
    expect(result.outcome).toBe("unchanged");
    expect(fake.calls).toEqual([]);
  });
});

describe("getPlanChangeState — the pane's read", () => {
  it("reports a queued downgrade and its date", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(row({ plan: "max" }));
    fake.subscription = subscription("price_max", { schedule: "sub_sched_1" });
    fake.schedule = queued("price_pro");
    expect(await getPlanChangeState(HOME)).toEqual({
      plan: "max",
      scheduledPlan: "pro",
      effectiveAt: new Date(1_762_600_000 * 1000).toISOString(),
    });
  });

  it("reports nothing pending for a schedule priced in a way this env cannot name", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(row({ plan: "max" }));
    fake.subscription = subscription("price_max", { schedule: "sub_sched_1" });
    fake.schedule = queued("price_mystery");
    expect((await getPlanChangeState(HOME)).scheduledPlan).toBeNull();
  });

  it("answers a free container without calling Stripe", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(null);
    expect(await getPlanChangeState(HOME)).toEqual({
      plan: null,
      scheduledPlan: null,
      effectiveAt: null,
    });
  });
});
