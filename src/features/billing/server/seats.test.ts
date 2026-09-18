/**
 * Invariant suite — seat sync. Locks `syncSeatQuantity`'s guards (no key / live
 * Team sub / a changed count / non-flat plan) and the happy path. Stripe and the
 * billing repository are fully mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceBillingRow } from "./workspace-billing";

const retrieve = vi.fn();
const updateItem = vi.fn();

// Keep the real `selectSeatItem` (the picker under test); stub the Stripe
// client + config guard.
vi.mock("./stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stripe")>();
  return {
    ...actual,
    isStripeConfigured: vi.fn(),
    getStripe: vi.fn(() => ({
      subscriptions: { retrieve },
      subscriptionItems: { update: updateItem },
    })),
  };
});

vi.mock("./workspace-billing", () => ({
  getWorkspaceBilling: vi.fn(),
  countActiveMembers: vi.fn(),
  upsertWorkspaceBilling: vi.fn(),
}));

import * as stripe from "./stripe";
import * as repo from "./workspace-billing";
import { syncSeatQuantity } from "./seats";

const mockStripe = vi.mocked(stripe);
const mockRepo = vi.mocked(repo);
const WS = "ws-1";

function billing(overrides: Partial<WorkspaceBillingRow>): WorkspaceBillingRow {
  return {
    workspaceId: WS,
    plan: "team",
    status: "active",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    stripePriceId: "price_seat",
    seatCount: 2,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    lastStripeEventCreated: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStripe.isStripeConfigured.mockReturnValue(true);
  retrieve.mockResolvedValue({ items: { data: [{ id: "si_1" }] } });
});

describe("syncSeatQuantity — guards", () => {
  it("no-ops (and never reads billing) when Stripe is unconfigured", async () => {
    mockStripe.isStripeConfigured.mockReturnValue(false);
    await syncSeatQuantity(WS);
    expect(mockRepo.getWorkspaceBilling).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("no-ops when there is no billing row", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(null);
    await syncSeatQuantity(WS);
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("no-ops for a free workspace", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ plan: "free", status: "free", stripeSubscriptionId: null })
    );
    await syncSeatQuantity(WS);
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("no-ops when the seat count already matches", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(billing({ seatCount: 3 }));
    mockRepo.countActiveMembers.mockResolvedValue(3);
    await syncSeatQuantity(WS);
    expect(retrieve).not.toHaveBeenCalled();
    expect(updateItem).not.toHaveBeenCalled();
    expect(mockRepo.upsertWorkspaceBilling).not.toHaveBeenCalled();
  });

  it("never resizes a flat legacy Solo subscription (single member)", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ plan: "solo", seatCount: 1 })
    );
    mockRepo.countActiveMembers.mockResolvedValue(1);
    await syncSeatQuantity(WS);
    expect(retrieve).not.toHaveBeenCalled();
    expect(updateItem).not.toHaveBeenCalled();
    expect(mockRepo.upsertWorkspaceBilling).not.toHaveBeenCalled();
  });

  it("warns but does not resize a legacy Solo workspace with 2+ members", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ plan: "solo", seatCount: 1 })
    );
    mockRepo.countActiveMembers.mockResolvedValue(2);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await syncSeatQuantity(WS);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("legacy Solo"));
    expect(updateItem).not.toHaveBeenCalled();
    expect(mockRepo.upsertWorkspaceBilling).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  /**
   * The personal Pro tier is flat (2026-09-08): one price at quantity 1, no seat
   * item. Falling through to the Team path would call `subscriptionItems.update`
   * with a member count — a billed proration against the wrong subscription.
   */
  it("never resizes a flat personal PRO subscription", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ plan: "pro", seatCount: null })
    );
    mockRepo.countActiveMembers.mockResolvedValue(1);
    await syncSeatQuantity(WS);
    expect(retrieve).not.toHaveBeenCalled();
    expect(updateItem).not.toHaveBeenCalled();
    expect(mockRepo.upsertWorkspaceBilling).not.toHaveBeenCalled();
  });

  it("still refuses to resize a PRO container in past_due grace", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ plan: "pro", status: "past_due", seatCount: null })
    );
    mockRepo.countActiveMembers.mockResolvedValue(1);
    await syncSeatQuantity(WS);
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("warns but does not resize a PRO container that somehow has 2+ members", async () => {
    // Cannot happen (`entitlements.ts › assertCanAddMember` refuses), which is
    // exactly why the anomaly is worth a line rather than a silent resize.
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ plan: "pro", seatCount: null })
    );
    mockRepo.countActiveMembers.mockResolvedValue(2);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await syncSeatQuantity(WS);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("personal Pro container")
    );
    expect(updateItem).not.toHaveBeenCalled();
    expect(mockRepo.upsertWorkspaceBilling).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("syncSeatQuantity — reconcile", () => {
  it("updates the subscription item quantity + persists seat_count", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(billing({ seatCount: 2 }));
    mockRepo.countActiveMembers.mockResolvedValue(4);
    await syncSeatQuantity(WS);
    expect(retrieve).toHaveBeenCalledWith("sub_1");
    expect(updateItem).toHaveBeenCalledWith("si_1", { quantity: 4 });
    expect(mockRepo.upsertWorkspaceBilling).toHaveBeenCalledWith(WS, {
      seatCount: 4,
    });
  });

  it("still reconciles a past_due (grace) subscription", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ status: "past_due", seatCount: 5 })
    );
    mockRepo.countActiveMembers.mockResolvedValue(3);
    await syncSeatQuantity(WS);
    expect(updateItem).toHaveBeenCalledWith("si_1", { quantity: 3 });
  });

  it("updates the seat-priced item on a multi-item subscription, not data[0]", async () => {
    vi.stubEnv("STRIPE_PRO_SEAT_PRICE_ID", "price_seat");
    retrieve.mockResolvedValue({
      items: {
        data: [
          { id: "si_addon", price: { id: "price_addon" } },
          { id: "si_seat", price: { id: "price_seat" } },
        ],
      },
    });
    mockRepo.getWorkspaceBilling.mockResolvedValue(billing({ seatCount: 2 }));
    mockRepo.countActiveMembers.mockResolvedValue(4);

    await syncSeatQuantity(WS);

    expect(updateItem).toHaveBeenCalledWith("si_seat", { quantity: 4 });
    vi.unstubAllEnvs();
  });
});
