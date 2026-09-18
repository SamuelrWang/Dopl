/**
 * The PERSONAL wallet's tier: which row decides it, what it allows, and when it
 * rolls. The wallet gained a plan on 2026-09-08, billed on the owner's own
 * `kind='personal'` container (spec §11.1).
 *
 * Repository mocked; `entitlements.ts` and `credits.ts` are real, so the verdict
 * is the same `paidEntitlement` the seat wallet uses and the window the same
 * `resolveCreditPeriod` — not a second copy of either.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WorkspaceBillingRow } from "./workspace-billing";

vi.mock("./workspace-billing", () => ({
  getWorkspaceBilling: vi.fn(),
  getPersonalBilling: vi.fn(),
  countActiveMembers: vi.fn(),
  countOntologyObjects: vi.fn(),
}));

import * as repo from "./workspace-billing";
import { personalWalletTier, readPersonalBilling } from "./personal-wallet";

const mockRepo = vi.mocked(repo);

const OWNER = "user-operator";
const PERSONAL = "ws-personal-1";
const NOW = new Date("2026-08-11T12:00:00.000Z");
const CALENDAR_START = "2026-08-01T00:00:00.000Z";
const CALENDAR_END = "2026-09-01T00:00:00.000Z";
const ANCHOR_START = "2026-07-21T09:30:00.000Z";
const ANCHOR_END = "2026-08-21T09:30:00.000Z";

function billing(overrides: Partial<WorkspaceBillingRow> = {}): WorkspaceBillingRow {
  return {
    workspaceId: PERSONAL,
    plan: "pro",
    status: "active",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    stripePriceId: "price_personal_pro",
    seatCount: null,
    currentPeriodStart: ANCHOR_START,
    currentPeriodEnd: ANCHOR_END,
    cancelAtPeriodEnd: false,
    lastStripeEventCreated: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Why there are two reads: the addressed container IS the billing row when the
 * caller addressed their own personal shelf; inside a link container the payer's
 * row is somewhere else entirely.
 */
describe("readPersonalBilling", () => {
  it("reads the ADDRESSED container directly when it is the personal one", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(billing());

    expect(await readPersonalBilling(OWNER, PERSONAL)).toMatchObject({
      plan: "pro",
    });
    expect(mockRepo.getWorkspaceBilling).toHaveBeenCalledWith(PERSONAL);
    // No owner → container hop when we were handed the container.
    expect(mockRepo.getPersonalBilling).not.toHaveBeenCalled();
  });

  it("makes the owner → container hop when no personal container was addressed", async () => {
    mockRepo.getPersonalBilling.mockResolvedValue({
      containerId: PERSONAL,
      billing: billing(),
    });

    expect(await readPersonalBilling(OWNER, null)).toMatchObject({
      plan: "pro",
    });
    expect(mockRepo.getPersonalBilling).toHaveBeenCalledWith(OWNER);
    // Never the addressed container: a link container has no billing row, so
    // reading it answers `null` and reports Pro as free.
    expect(mockRepo.getWorkspaceBilling).not.toHaveBeenCalled();
  });

  it("answers null for a personal container that has never been billed", async () => {
    mockRepo.getPersonalBilling.mockResolvedValue({
      containerId: PERSONAL,
      billing: null,
    });
    expect(await readPersonalBilling(OWNER, null)).toBeNull();
  });

  it("🔒 falls back to null AND WARNS when the user has no personal container", async () => {
    // Cannot happen after `20260920120000_workspace_kind_personal.sql`, and the
    // burn still has to be charged to something. Free is the safe direction; the
    // warning stops a paying customer being quietly metered at 500.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockRepo.getPersonalBilling.mockResolvedValue(null);

    expect(await readPersonalBilling(OWNER, null)).toBeNull();

    const line = warn.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(line).toContain(OWNER);
    expect(line).toContain("no kind='personal' container");
    warn.mockRestore();
  });

  it("does NOT warn for a container that simply has no subscription", async () => {
    // The two nulls mean different things: "no container" is an impossible
    // state worth a line, "no row" is just a free home space.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockRepo.getPersonalBilling.mockResolvedValue({
      containerId: PERSONAL,
      billing: null,
    });
    await readPersonalBilling(OWNER, null);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("personalWalletTier", () => {
  it("a live pro row: verdict pro, 5,000, on the SUBSCRIPTION anchor", () => {
    expect(personalWalletTier(billing())).toEqual({
      verdict: "pro",
      limit: 5_000,
      periodStart: ANCHOR_START,
      periodEnd: ANCHOR_END,
    });
  });

  it("past_due keeps the Pro tier (grace)", () => {
    expect(personalWalletTier(billing({ status: "past_due" }))).toMatchObject({
      verdict: "pro",
      limit: 5_000,
    });
  });

  it("no row: verdict free, 500, on the calendar month", () => {
    expect(personalWalletTier(null)).toEqual({
      verdict: "free",
      limit: 500,
      periodStart: CALENDAR_START,
      periodEnd: CALENDAR_END,
    });
  });

  it("🔒 a CANCELED pro row drops to 500 AND to the calendar month — no lockout", () => {
    // The self-heal: a canceled row keeps a future-ending anchor, and honouring
    // it would lock a key already spent to 5,000 out of a fresh 500 limit. The
    // free verdict is read first and ignores the anchor
    // (`credits.ts › resolveCreditPeriod`).
    expect(personalWalletTier(billing({ status: "canceled" }))).toEqual({
      verdict: "free",
      limit: 500,
      periodStart: CALENDAR_START,
      periodEnd: CALENDAR_END,
    });
  });

  it("🔒 counts ONE member, so `solo`'s degrade rule can never fire here", () => {
    // A personal container holds its owner and nobody else, so the member count
    // is a constant: a real count would be a round trip to learn 1.
    expect(personalWalletTier(billing({ plan: "solo" }))).toMatchObject({
      verdict: "solo",
    });
  });

  it("🔒 a stray `team` row still yields the FREE personal allowance", () => {
    // `team` cannot be the plan on a personal container. On a bad row the verdict
    // is `team` but the allowance is the free personal figure:
    // `personalCreditsForPlan` answers 5,000 only for `pro`.
    expect(personalWalletTier(billing({ plan: "team" }))).toMatchObject({
      verdict: "team",
      limit: 500,
    });
  });
});
