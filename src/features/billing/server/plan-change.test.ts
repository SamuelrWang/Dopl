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
  /** When set, a price update comes back PENDING with this PaymentIntent status. */
  pendingIntent: null as string | null,
  invoiceStatus: "open",
}));

/** The anchor reset: an upgrade's new period starts "now" in the fake. */
const NEW_START = 1_761_000_000;
const NEW_END = 1_763_600_000;

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
        const base = fake.subscription as Record<string, unknown>;
        if (params.items && fake.pendingIntent) {
          return { ...base, pending_update: { expires_at: 1 }, latest_invoice: "in_1" };
        }
        if (params.items) {
          const [item] = params.items as Array<{ id: string; price: string }>;
          fake.subscription = {
            ...base,
            items: {
              data: [
                {
                  id: item.id,
                  quantity: 1,
                  price: { id: item.price },
                  current_period_start: NEW_START,
                  current_period_end: NEW_END,
                },
              ],
            },
          };
          return fake.subscription;
        }
        fake.subscription = { ...base, ...params };
        return fake.subscription;
      },
    };
    invoices = {
      retrieve: async (id: string) => ({
        id,
        status: fake.invoiceStatus,
        hosted_invoice_url: "https://invoice.stripe.com/i/1",
        confirmation_secret: { client_secret: "cs_conf" },
        payments: {
          data: [
            { payment: { payment_intent: { status: fake.pendingIntent, client_secret: "pi_secret" } } },
          ],
        },
      }),
      voidInvoice: async (id: string) => {
        fake.calls.push({ op: "invoices.void", id });
        return { id, status: "void" };
      },
      createPreview: async (params: Params) => {
        fake.calls.push({ op: "invoices.preview", params });
        return { amount_due: 1601, currency: "usd" };
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
import { changePersonalPlan, getPlanChangeState, previewPersonalUpgrade } from "./plan-change";

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
    customer: "cus_1",
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
  fake.pendingIntent = null;
  fake.invoiceStatus = "open";
  mockRepo.getWorkspaceBilling.mockResolvedValue(row());
  mockRepo.claimWorkspaceCheckout.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("UPGRADE Pro → Max — a fresh period, paid in full, applied only when paid", () => {
  it("🔒 resets the billing anchor: always_invoice + billing_cycle_anchor now + pending_if_incomplete", async () => {
    const result = await changePersonalPlan(HOME, "max");
    expect(result).toEqual({
      outcome: "upgraded",
      plan: "max",
      scheduledPlan: null,
      effectiveAt: null,
    });
    const update = fake.calls.find((c) => c.op === "subscriptions.update");
    expect(update?.id).toBe("sub_1");
    expect(update?.params).toEqual({
      items: [{ id: "si_1", price: "price_max", quantity: 1 }],
      billing_cycle_anchor: "now",
      proration_behavior: "always_invoice",
      payment_behavior: "pending_if_incomplete",
    });
  });

  it("stamps `plan` metadata in a SECOND call — pending updates cannot carry it", async () => {
    await changePersonalPlan(HOME, "max");
    const updates = fake.calls.filter((c) => c.op === "subscriptions.update");
    expect(updates).toHaveLength(2);
    expect(updates[1].params).toEqual({ metadata: { workspace_id: HOME, plan: "max" } });
  });

  it("🔒 writes the NEW period, so the credit counter starts fresh (the late-month exploit)", async () => {
    await changePersonalPlan(HOME, "max");
    expect(mockRepo.upsertWorkspaceBilling).toHaveBeenCalledWith(HOME, {
      plan: "max",
      stripePriceId: "price_max",
      seatCount: 1,
      currentPeriodStart: new Date(NEW_START * 1000).toISOString(),
      currentPeriodEnd: new Date(NEW_END * 1000).toISOString(),
    });
    // The old anchor would have kept the old counter key: the new start differs.
    expect(new Date(NEW_START * 1000).toISOString()).not.toBe(row().currentPeriodStart);
  });

  it("🔒 3-D Secure: answers requires_action with the client secret and changes NOTHING yet", async () => {
    fake.pendingIntent = "requires_action";
    const result = await changePersonalPlan(HOME, "max");
    expect(result).toMatchObject({
      outcome: "requires_action",
      plan: "pro",
      payment: { clientSecret: "pi_secret", hostedInvoiceUrl: "https://invoice.stripe.com/i/1" },
    });
    expect(mockRepo.upsertWorkspaceBilling).not.toHaveBeenCalled();
    expect(fake.calls.filter((c) => c.op === "subscriptions.update")).toHaveLength(1);
  });

  it("🔒 a decline (pending, payment failed) VOIDS the invoice and is 402 — nothing changed", async () => {
    fake.pendingIntent = "requires_payment_method";
    await expect(changePersonalPlan(HOME, "max")).rejects.toMatchObject({
      status: 402,
      code: "PAYMENT_FAILED",
    });
    expect(fake.calls.some((c) => c.op === "invoices.void" && c.id === "in_1")).toBe(true);
    expect(mockRepo.upsertWorkspaceBilling).not.toHaveBeenCalled();
    expect(mockRepo.releaseWorkspaceCheckout).toHaveBeenCalledWith(HOME);
  });

  it("a retry while a payment is pending re-offers it rather than stacking an update", async () => {
    fake.subscription = subscription("price_pro", { pending_update: { expires_at: 1 }, latest_invoice: "in_1" });
    fake.pendingIntent = "requires_action";
    const result = await changePersonalPlan(HOME, "max");
    expect(result.outcome).toBe("requires_action");
    expect(fake.calls.filter((c) => c.op === "subscriptions.update")).toHaveLength(0);
  });

  it("finishes a 3-D Secure upgrade on the follow-up POST: stamps metadata, writes the row", async () => {
    // Stripe applied the pending update; the metadata still says pro.
    fake.subscription = subscription("price_max", { metadata: { workspace_id: HOME, plan: "pro" } });
    mockRepo.getWorkspaceBilling.mockResolvedValue(row({ plan: "pro" }));
    const result = await changePersonalPlan(HOME, "max");
    expect(result.outcome).toBe("unchanged");
    expect(fake.calls[0]).toMatchObject({ op: "subscriptions.update", params: { metadata: { plan: "max" } } });
    expect(mockRepo.upsertWorkspaceBilling).toHaveBeenCalledWith(
      HOME,
      expect.objectContaining({ plan: "max", stripePriceId: "price_max" })
    );
  });

  it("🔒 a DB refusal AFTER the charge is 500 PLAN_RECORD_FAILED naming the migration", async () => {
    mockRepo.upsertWorkspaceBilling.mockRejectedValueOnce(new Error("23514 check violation"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(changePersonalPlan(HOME, "max")).rejects.toMatchObject({
      status: 500,
      code: "PLAN_RECORD_FAILED",
    });
    expect(err).toHaveBeenCalledWith(
      expect.stringContaining("20261121170000_workspace_billing_plan_max.sql")
    );
    err.mockRestore();
  });

  it("🔒 a synchronous card error is 402 PAYMENT_FAILED, still freeing the claim", async () => {
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

describe("previewPersonalUpgrade — the confirm dialog's amount", () => {
  it("previews the EXACT update the switch makes", async () => {
    expect(await previewPersonalUpgrade(HOME, "max")).toEqual({ amountDue: 1601, currency: "usd" });
    const preview = fake.calls.find((c) => c.op === "invoices.preview");
    expect(preview?.params).toEqual({
      customer: "cus_1",
      subscription: "sub_1",
      subscription_details: {
        items: [{ id: "si_1", price: "price_max", quantity: 1 }],
        billing_cycle_anchor: "now",
        proration_behavior: "always_invoice",
      },
    });
  });

  it("409 NOT_AN_UPGRADE for a downgrade or the current plan — nothing is charged today", async () => {
    await expect(previewPersonalUpgrade(HOME, "pro")).rejects.toMatchObject({ code: "NOT_AN_UPGRADE" });
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

  it("🔒 Stripe says past_due while the row says active → PAYMENT_PAST_DUE, not 'no plan'", async () => {
    fake.subscription = subscription("price_pro", { status: "past_due" });
    await expect(changePersonalPlan(HOME, "max")).rejects.toMatchObject({ code: "PAYMENT_PAST_DUE" });
    expect(fake.calls).toEqual([]);
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
    // No price write — only the (already-correct) row is re-recorded.
    expect(fake.calls.filter((c) => c.op === "subscriptions.update")).toEqual([]);
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
