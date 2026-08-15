/**
 * INVARIANT SUITE — MCP credit consume path (runs ONCE PER TOOL CALL). Pins:
 *   1. QUERY BUDGET — three round trips (billing row, member count, RPC); NO
 *      `COUNT(*)` over `ontology_objects`, NO second `workspace_billing` read.
 *      Mock CALL COUNTS are the only way to state that.
 *   2. WHICH WINDOW IT CHARGES — verdict read first, FREE verdict ignores a
 *      subscription anchor (self-heal for mid-period cancellation).
 *
 * ⚠ Repository mocked; `entitlements.ts` is REAL, so the lean verdict helper
 * is proven to be the same `paidEntitlement` logic, not a copy.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WorkspaceBillingRow } from "./workspace-billing";

vi.mock("./workspace-billing", () => ({
  getWorkspaceBilling: vi.fn(),
  countActiveMembers: vi.fn(),
  countOntologyObjects: vi.fn(),
  consumeWorkspaceCredits: vi.fn(),
  getWorkspaceCreditsUsed: vi.fn(),
}));

import * as repo from "./workspace-billing";
import {
  consumeMcpCredits,
  creditPeriodFor,
  summarizeCredits,
} from "./credits-service";

const mockRepo = vi.mocked(repo);
const WS = "ws-1";

/** 2026-08-11, mid-month — anchor fixtures below straddle it. */
const NOW = new Date("2026-08-11T12:00:00.000Z");
const CALENDAR_START = "2026-08-01T00:00:00.000Z";
const CALENDAR_END = "2026-09-01T00:00:00.000Z";

function billing(overrides: Partial<WorkspaceBillingRow> = {}): WorkspaceBillingRow {
  return {
    workspaceId: WS,
    plan: "team",
    status: "active",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    stripePriceId: "price_seat",
    seatCount: 3,
    currentPeriodStart: "2026-07-21T09:30:00.000Z",
    currentPeriodEnd: "2026-08-21T09:30:00.000Z",
    cancelAtPeriodEnd: false,
    lastStripeEventCreated: null,
    ...overrides,
  };
}

function setup(opts: {
  billing: WorkspaceBillingRow | null;
  members: number;
  allowed?: boolean;
  used?: number;
}) {
  mockRepo.getWorkspaceBilling.mockResolvedValue(opts.billing);
  mockRepo.countActiveMembers.mockResolvedValue(opts.members);
  mockRepo.consumeWorkspaceCredits.mockResolvedValue({
    allowed: opts.allowed ?? true,
    used: opts.used ?? 1,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("consumeMcpCredits — the query budget (B1)", () => {
  it("NEVER counts ontology objects — that cap is not on this path", async () => {
    setup({ billing: billing(), members: 3 });
    await consumeMcpCredits(WS);
    expect(mockRepo.countOntologyObjects).not.toHaveBeenCalled();
  });

  it("reads workspace_billing EXACTLY ONCE — one row feeds verdict AND period", async () => {
    setup({ billing: billing(), members: 3 });
    await consumeMcpCredits(WS);
    expect(mockRepo.getWorkspaceBilling).toHaveBeenCalledTimes(1);
  });

  it("is three round trips total: billing, members, RPC", async () => {
    setup({ billing: billing(), members: 3 });
    await consumeMcpCredits(WS);
    expect(mockRepo.getWorkspaceBilling).toHaveBeenCalledTimes(1);
    expect(mockRepo.countActiveMembers).toHaveBeenCalledTimes(1);
    expect(mockRepo.consumeWorkspaceCredits).toHaveBeenCalledTimes(1);
    expect(mockRepo.countOntologyObjects).toHaveBeenCalledTimes(0);
  });

  it("holds the budget for a workspace with NO billing row (the free path)", async () => {
    setup({ billing: null, members: 1 });
    await consumeMcpCredits(WS);
    expect(mockRepo.getWorkspaceBilling).toHaveBeenCalledTimes(1);
    expect(mockRepo.countOntologyObjects).not.toHaveBeenCalled();
  });
});

describe("consumeMcpCredits — the limit is the ENTITLED plan, never the raw column", () => {
  it("charges a live team workspace against 25,000", async () => {
    setup({ billing: billing({ plan: "team" }), members: 4 });
    const res = await consumeMcpCredits(WS);
    expect(res.limit).toBe(25_000);
    expect(mockRepo.consumeWorkspaceCredits).toHaveBeenCalledWith(
      WS,
      "2026-07-21T09:30:00.000Z",
      1,
      25_000
    );
  });

  it("charges a live single-member solo workspace against 10,000", async () => {
    setup({ billing: billing({ plan: "solo", seatCount: 1 }), members: 1 });
    expect((await consumeMcpCredits(WS)).limit).toBe(10_000);
  });

  it("a DEGRADED solo (2 members) gets the FREE limit and the calendar month", async () => {
    // Reading `workspace_billing.plan` here would hand 10,000 credits it is
    // not entitled to, on the subscription's own window.
    setup({ billing: billing({ plan: "solo", seatCount: 1 }), members: 2 });
    const res = await consumeMcpCredits(WS);
    expect(res.limit).toBe(500);
    expect(res.periodStart).toBe(CALENDAR_START);
  });

  it("a workspace with no billing row gets the free limit", async () => {
    setup({ billing: null, members: 1 });
    expect((await consumeMcpCredits(WS)).limit).toBe(500);
  });

  it("past_due keeps the paid allowance (grace), like every other entitlement", async () => {
    setup({ billing: billing({ status: "past_due" }), members: 4 });
    expect((await consumeMcpCredits(WS)).limit).toBe(25_000);
  });
});

/**
 * Cancellation lockout, end to end. Team workspace spent 8,000 credits, then
 * canceled mid-period; row keeps a FUTURE-ending anchor. Honouring it charges
 * the next call to a key already at 8,000 used against a NEW 500 limit. Heals
 * on the next consume — no webhook, no cron.
 */
describe("consumeMcpCredits — a canceled workspace is not locked out (B2b)", () => {
  const CANCELED = () =>
    billing({
      plan: "free",
      status: "canceled",
      stripeSubscriptionId: null,
      seatCount: null,
      currentPeriodStart: "2026-07-21T09:30:00.000Z",
      currentPeriodEnd: "2026-08-21T09:30:00.000Z",
    });

  it("charges the CALENDAR MONTH, not the dead subscription anchor", async () => {
    setup({ billing: CANCELED(), members: 3 });
    const res = await consumeMcpCredits(WS);
    expect(res.periodStart).toBe(CALENDAR_START);
    expect(res.periodEnd).toBe(CALENDAR_END);
  });

  it("spends against a FRESH counter key at the free limit — allowed, not refused", async () => {
    setup({ billing: CANCELED(), members: 3, allowed: true, used: 1 });
    const res = await consumeMcpCredits(WS);
    expect(mockRepo.consumeWorkspaceCredits).toHaveBeenCalledWith(
      WS,
      CALENDAR_START,
      1,
      500
    );
    expect(res.allowed).toBe(true);
    expect(res.limit).toBe(500);
    expect(res.remaining).toBe(499);
  });

  it("holds even when the sub row was NOT cleaned up (status canceled, plan still team)", async () => {
    // Webhook never reached: `plan` still "team". Period rule consults the
    // VERDICT, and canceled is not entitled.
    setup({
      billing: billing({ plan: "team", status: "canceled" }),
      members: 3,
    });
    const res = await consumeMcpCredits(WS);
    expect(res.periodStart).toBe(CALENDAR_START);
    expect(res.limit).toBe(500);
  });

  it("a still-LIVE paid workspace keeps its own billing-date window", async () => {
    setup({ billing: billing(), members: 3 });
    expect((await consumeMcpCredits(WS)).periodStart).toBe(
      "2026-07-21T09:30:00.000Z"
    );
  });
});

describe("the settings meter resolves the SAME window as enforcement", () => {
  it("summarizeCredits and consumeMcpCredits agree for a canceled workspace", async () => {
    const row = billing({ plan: "team", status: "canceled" });
    setup({ billing: row, members: 3 });
    mockRepo.getWorkspaceCreditsUsed.mockResolvedValue(12);

    const charged = await consumeMcpCredits(WS);
    const metered = await summarizeCredits(WS, "free", row);

    expect(metered.periodStart).toBe(charged.periodStart);
    expect(metered.periodEnd).toBe(charged.periodEnd);
    expect(metered.limit).toBe(charged.limit);
    expect(mockRepo.getWorkspaceCreditsUsed).toHaveBeenCalledWith(
      WS,
      charged.periodStart
    );
  });

  it("and for a live paid workspace", async () => {
    const row = billing();
    setup({ billing: row, members: 3 });
    mockRepo.getWorkspaceCreditsUsed.mockResolvedValue(40);

    const charged = await consumeMcpCredits(WS);
    const metered = await summarizeCredits(WS, "team", row);

    expect(metered.periodStart).toBe(charged.periodStart);
    expect(metered.limit).toBe(charged.limit);
  });
});

describe("creditPeriodFor", () => {
  it("a null row is the calendar month", () => {
    expect(creditPeriodFor(null, "free")).toEqual({
      periodStart: CALENDAR_START,
      periodEnd: CALENDAR_END,
    });
  });

  it("a free verdict ignores the row's anchor", () => {
    expect(creditPeriodFor(billing(), "free").periodStart).toBe(CALENDAR_START);
  });

  it("a paid verdict honours it", () => {
    expect(creditPeriodFor(billing(), "team").periodStart).toBe(
      "2026-07-21T09:30:00.000Z"
    );
  });
});

describe("consumeMcpCredits — refusal", () => {
  it("reports allowed:false with remaining 0 and an upgrade url", async () => {
    setup({ billing: null, members: 1, allowed: false, used: 500 });
    const res = await consumeMcpCredits(WS);
    expect(res.allowed).toBe(false);
    expect(res.used).toBe(500);
    expect(res.remaining).toBe(0);
    expect(res.upgradeUrl).toMatch(/\/billing\?billing=upgrade$/);
  });
});
