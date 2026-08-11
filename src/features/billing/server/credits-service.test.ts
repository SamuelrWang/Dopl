/**
 * INVARIANT SUITE — the MCP credit consume path.
 *
 * This function runs ONCE PER MCP TOOL CALL, so two things are pinned that a
 * behavioural test would normally not bother with:
 *
 *   1. ITS QUERY BUDGET. Three round trips: the billing row, the member count,
 *      the RPC — and specifically NO `COUNT(*)` over `ontology_objects`, and
 *      NO second read of `workspace_billing`. It used to do five because it
 *      called `getWorkspaceEntitlements` (which fans out to the object count
 *      for a cap this path does not consult) and then re-read billing for the
 *      period anchor. Mock CALL COUNTS are the only way to state that.
 *   2. WHICH WINDOW IT CHARGES. The plan verdict is read first, and a FREE
 *      verdict ignores a subscription anchor outright — the self-heal for a
 *      workspace canceled mid-period, which otherwise stays locked out of MCP
 *      until the dead anchor expires.
 *
 * The repository is mocked; `entitlements.ts` is REAL, because the whole point
 * of the lean verdict helper is that it is the same `paidEntitlement` logic
 * and not a second copy of it.
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

/** 2026-08-11, mid-month — the anchor fixtures below straddle it. */
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
    // A LIVE anchor: started before `NOW`, ends after it.
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
    // Same backstop `entitlements.ts › paidEntitlement` applies to the object
    // cap — reading `workspace_billing.plan` here would hand this workspace
    // 10,000 credits it is not entitled to, on the subscription's own window.
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
 * B2 — THE CANCELLATION LOCKOUT, end to end.
 *
 * The stuck state: a team workspace spent 8,000 credits this period, then
 * canceled mid-period. The row still carries a period anchor ending in the
 * FUTURE. Honouring it would charge the next call to `2026-07-21…` — the key
 * that already holds 8,000 used against a NEW limit of 500 — and MCP would
 * refuse every call for the rest of the dead period. This heals on the next
 * consume, with no webhook and no cron.
 */
describe("consumeMcpCredits — a canceled workspace is not locked out (B2b)", () => {
  const CANCELED = () =>
    billing({
      plan: "free",
      status: "canceled",
      stripeSubscriptionId: null,
      seatCount: null,
      // The anchor a pre-fix cancellation left behind, still live.
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
    // The rows a webhook never reached: `plan` still reads "team". The VERDICT
    // is what the period rule consults, and a canceled status is not entitled.
    setup({
      billing: billing({ plan: "team", status: "canceled" }),
      members: 3,
    });
    const res = await consumeMcpCredits(WS);
    expect(res.periodStart).toBe(CALENDAR_START);
    expect(res.limit).toBe(500);
  });

  it("a still-LIVE paid workspace keeps its own billing-date window", async () => {
    // The other half of the rule: this must not become "everyone gets the 1st".
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
    // `status-service.ts` passes the ENTITLED plan, which is "free" here.
    const metered = await summarizeCredits(WS, "free", row);

    expect(metered.periodStart).toBe(charged.periodStart);
    expect(metered.periodEnd).toBe(charged.periodEnd);
    expect(metered.limit).toBe(charged.limit);
    // And the meter read the counter under the window the gate charged.
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
