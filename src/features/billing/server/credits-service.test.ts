/**
 * INVARIANT SUITE — MCP credit consume path (runs ONCE PER TOOL CALL), part 1 of
 * two: WHICH WALLET a burn lands on, and WHAT IT COSTS IN ROUND TRIPS. Pins:
 *   1. QUERY BUDGET, PER WALLET — seat = 3 round trips (billing row, member
 *      count, RPC); link = 2 (owner lookup, RPC); personal = 1 (RPC alone).
 *      NO `COUNT(*)` over `ontology_objects`, NO second `workspace_billing`
 *      read, and NO billing read at all on the personal arm. Mock CALL COUNTS
 *      are the only way to state that.
 *   2. WHICH WALLET, AND WHOSE — the addressed container's kind decides
 *      (`credits-service.ts › resolveBillingTarget`'s table).
 *   3. THE SEAT LIMIT IS PER MEMBER and comes from the ENTITLEMENT VERDICT.
 *
 * ⚠ **SPLIT AT THE 500-LINE CAP (§1: "split, do not squeeze").**
 * `credits-service-window.test.ts` took the WINDOW half — the cancellation
 * self-heal, the meter/enforcement agreement, the refusal and its upgrade url,
 * the unmetered posture and the ledger. The seam is real: this file is about
 * WHOSE counter moves, that one about WHICH KEY it moves under and what the
 * answer says.
 *
 * ⚠ **REWRITTEN 2026-09-07 (Samuel's per-seat + personal-wallet ruling).** The
 * numbers here were 500 / 10,000 / 25,000 POOLED PER WORKSPACE, and the budget
 * was "three round trips" full stop. Both moved; the reasoning did not.
 *
 * ⚠ Repositories mocked; `entitlements.ts` is REAL, so the lean verdict helper
 * is proven to be the same `paidEntitlement` logic, not a copy.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WorkspaceBillingRow } from "./workspace-billing";

// ⚠ THE LEDGER IS MOCKED, NOT LET THROUGH. It is a `supabaseAdmin()` insert on
// the hottest path in the product, and what this suite pins about it is WHEN it
// is called and WITH WHAT — never that Supabase was reachable.
vi.mock("./credit-ledger", () => ({ recordCreditUsageEvent: vi.fn() }));

vi.mock("./workspace-billing", () => ({
  getWorkspaceBilling: vi.fn(),
  countActiveMembers: vi.fn(),
  countOntologyObjects: vi.fn(),
}));

vi.mock("./credit-wallets", () => ({
  consumeUserCredits: vi.fn(),
  consumeMemberCredits: vi.fn(),
  getUserCreditsUsed: vi.fn(),
  getMemberCreditsUsed: vi.fn(),
}));

vi.mock("@/features/workspaces/server/repository", () => ({
  findActiveOwnerUserId: vi.fn(),
}));

import * as repo from "./workspace-billing";
import * as wallets from "./credit-wallets";
import { findActiveOwnerUserId } from "@/features/workspaces/server/repository";
import { consumeMcpCredits, resolveBillingTarget } from "./credits-service";

const mockRepo = vi.mocked(repo);
const mockWallets = vi.mocked(wallets);
const mockOwner = vi.mocked(findActiveOwnerUserId);

const WS = "ws-1";
const CONTAINER = "ws-link-1";
const PERSONAL = "ws-personal-1";
const CALLER = "user-caller";
const OWNER = "user-operator";

/** 2026-08-11, mid-month — anchor fixtures below straddle it. */
const NOW = new Date("2026-08-11T12:00:00.000Z");
const CALENDAR_START = "2026-08-01T00:00:00.000Z";
const CALENDAR_END = "2026-09-01T00:00:00.000Z";

const seatCaller = { userId: CALLER, workspaceKind: "standard" as const };
const linkCaller = { userId: CALLER, workspaceKind: "link" as const };
const personalCaller = { userId: CALLER, workspaceKind: "personal" as const };

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
  const outcome = { allowed: opts.allowed ?? true, used: opts.used ?? 1 };
  mockWallets.consumeMemberCredits.mockResolvedValue(outcome);
  mockWallets.consumeUserCredits.mockResolvedValue(outcome);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mockOwner.mockResolvedValue(OWNER);
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * 🔒 THE ATTRIBUTION TABLE (`credits-service.ts`'s docblock), one case per row.
 * Each wrong answer is a different bill going to a different person.
 */
describe("resolveBillingTarget — the addressed kind picks the wallet", () => {
  it("standard (and a kind-less legacy row) → the CALLER's own SEAT", async () => {
    expect(await resolveBillingTarget(WS, seatCaller)).toEqual({
      wallet: "seat",
      workspaceId: WS,
      payerUserId: CALLER,
    });
    expect(await resolveBillingTarget(WS, { userId: CALLER })).toEqual({
      wallet: "seat",
      workspaceId: WS,
      payerUserId: CALLER,
    });
    // A seat needs no owner: the caller IS the payer.
    expect(mockOwner).not.toHaveBeenCalled();
  });

  it("personal → the caller's PERSONAL wallet, WITHOUT an owner lookup", async () => {
    expect(await resolveBillingTarget(PERSONAL, personalCaller)).toEqual({
      wallet: "personal",
      workspaceId: PERSONAL,
      payerUserId: CALLER,
    });
    // ⚠ THE ROUND TRIP THIS SAVES IS THE POINT. A personal container has exactly
    // one member — its owner — so the caller is provably the payer and asking
    // the database buys an answer we already hold.
    expect(mockOwner).not.toHaveBeenCalled();
  });

  it("link → the container OWNER's PERSONAL wallet, whoever called", async () => {
    // ⚠ THE CALLER IS DELIBERATELY NOT THE OWNER. A case where they are the same
    // user passes against a version that bills the caller.
    expect(await resolveBillingTarget(CONTAINER, linkCaller)).toEqual({
      wallet: "personal",
      workspaceId: CONTAINER,
      payerUserId: OWNER,
    });
    expect(mockOwner).toHaveBeenCalledWith(CONTAINER);
  });

  it("container with no active owner → unmetered, with the ONLY reason left", async () => {
    mockOwner.mockResolvedValue(null);
    expect(await resolveBillingTarget(CONTAINER, linkCaller)).toEqual({
      wallet: null,
      workspaceId: CONTAINER,
      payerUserId: null,
      reason: "container-has-no-active-owner",
    });
  });

  it("🔒 the workspaceId is ALWAYS the addressed container, never a rerouted one", async () => {
    // ⚠ THE REVERT DETECTOR FOR THE OLD MODEL. Until 2026-09-07 this answered
    // the container owner's SOLE owned STANDARD workspace — a different id —
    // and refused (unmetered) when they owned none or two. Every arm now names
    // the workspace that was addressed.
    // ⚠ EACH ARM IS PAIRED WITH THE ID IT WAS ASKED ABOUT. A membership test
    // over all three ids (`expect([A,B,C]).toContain(target.workspaceId)`) is
    // GREEN under the very reroute it claims to detect — CONTAINER → WS is a
    // member of that set.
    for (const [addressed, caller] of [
      [CONTAINER, linkCaller],
      [PERSONAL, personalCaller],
      [WS, seatCaller],
    ] as const) {
      expect((await resolveBillingTarget(addressed, caller)).workspaceId).toBe(
        addressed
      );
    }
  });
});

describe("consumeMcpCredits — the query budget, per wallet", () => {
  it("SEAT is three round trips: billing, members, RPC", async () => {
    setup({ billing: billing(), members: 3 });
    await consumeMcpCredits(WS, seatCaller);
    expect(mockRepo.getWorkspaceBilling).toHaveBeenCalledTimes(1);
    expect(mockRepo.countActiveMembers).toHaveBeenCalledTimes(1);
    expect(mockWallets.consumeMemberCredits).toHaveBeenCalledTimes(1);
    expect(mockOwner).toHaveBeenCalledTimes(0);
    expect(mockRepo.countOntologyObjects).toHaveBeenCalledTimes(0);
  });

  it("LINK is two: the owner lookup, then the RPC", async () => {
    setup({ billing: billing(), members: 3 });
    await consumeMcpCredits(CONTAINER, linkCaller);
    expect(mockOwner).toHaveBeenCalledTimes(1);
    expect(mockWallets.consumeUserCredits).toHaveBeenCalledTimes(1);
    // ⚠ NO BILLING ROW ON THE PERSONAL ARM. One tier, one constant, no anchor —
    // reading a plan here would double the cost of the commonest burn in the
    // product for an answer that has one value.
    expect(mockRepo.getWorkspaceBilling).toHaveBeenCalledTimes(0);
    expect(mockRepo.countActiveMembers).toHaveBeenCalledTimes(0);
  });

  it("PERSONAL is ONE: the RPC alone — the owner IS the caller", async () => {
    setup({ billing: billing(), members: 3 });
    await consumeMcpCredits(PERSONAL, personalCaller);
    expect(mockWallets.consumeUserCredits).toHaveBeenCalledTimes(1);
    expect(mockOwner).toHaveBeenCalledTimes(0);
    expect(mockRepo.getWorkspaceBilling).toHaveBeenCalledTimes(0);
    expect(mockRepo.countActiveMembers).toHaveBeenCalledTimes(0);
  });

  it("NEVER counts ontology objects on any wallet — that cap is not on this path", async () => {
    setup({ billing: billing(), members: 3 });
    await consumeMcpCredits(WS, seatCaller);
    await consumeMcpCredits(CONTAINER, linkCaller);
    await consumeMcpCredits(PERSONAL, personalCaller);
    expect(mockRepo.countOntologyObjects).not.toHaveBeenCalled();
  });

  it("reads workspace_billing EXACTLY ONCE on a seat — one row feeds verdict AND period", async () => {
    setup({ billing: billing(), members: 3 });
    await consumeMcpCredits(WS, seatCaller);
    expect(mockRepo.getWorkspaceBilling).toHaveBeenCalledTimes(1);
  });
});

describe("consumeMcpCredits — the SEAT limit is PER MEMBER and the ENTITLED plan", () => {
  it("charges a live team member against 5,000 — the member's own counter", async () => {
    setup({ billing: billing({ plan: "team" }), members: 4 });
    const res = await consumeMcpCredits(WS, seatCaller);
    expect(res.limit).toBe(5_000);
    expect(res.wallet).toBe("seat");
    // ⚠ THE KEY CARRIES THE MEMBER. A pooled counter (workspace + period) is
    // exactly what this wave replaced, and it cannot express a fixed per-person
    // allocation.
    expect(mockWallets.consumeMemberCredits).toHaveBeenCalledWith(
      WS,
      CALLER,
      "2026-07-21T09:30:00.000Z",
      1,
      5_000
    );
  });

  it("🔒 does NOT multiply by the seat count — the allocation is not pooled", async () => {
    setup({ billing: billing({ plan: "team", seatCount: 9 }), members: 9 });
    expect((await consumeMcpCredits(WS, seatCaller)).limit).toBe(5_000);
  });

  it("charges a free workspace's member against 100", async () => {
    setup({ billing: null, members: 5 });
    const res = await consumeMcpCredits(WS, seatCaller);
    expect(res.limit).toBe(100);
    expect(res.periodStart).toBe(CALENDAR_START);
  });

  it("a DEGRADED solo (2 members) gets the FREE limit and the calendar month", async () => {
    // Reading `workspace_billing.plan` here would hand each member 5,000
    // credits they are not entitled to, on the subscription's own window.
    setup({ billing: billing({ plan: "solo", seatCount: 1 }), members: 2 });
    const res = await consumeMcpCredits(WS, seatCaller);
    expect(res.limit).toBe(100);
    expect(res.periodStart).toBe(CALENDAR_START);
  });

  it("a live single-member solo keeps the legacy PAID allowance", async () => {
    setup({ billing: billing({ plan: "solo", seatCount: 1 }), members: 1 });
    expect((await consumeMcpCredits(WS, seatCaller)).limit).toBe(5_000);
  });

  it("past_due keeps the paid allowance (grace), like every other entitlement", async () => {
    setup({ billing: billing({ status: "past_due" }), members: 4 });
    expect((await consumeMcpCredits(WS, seatCaller)).limit).toBe(5_000);
  });
});

describe("consumeMcpCredits — the PERSONAL wallet", () => {
  it("spends the OWNER's wallet on a link container, on the calendar month", async () => {
    setup({ billing: billing(), members: 3, used: 7 });
    const res = await consumeMcpCredits(CONTAINER, linkCaller);
    expect(mockWallets.consumeUserCredits).toHaveBeenCalledWith(
      OWNER,
      CALENDAR_START,
      1,
      500
    );
    // ⚠ THE REVERT DETECTOR. A version that bills the caller passes every other
    // assertion here.
    expect(mockWallets.consumeUserCredits).not.toHaveBeenCalledWith(
      CALLER,
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    expect(res).toMatchObject({
      wallet: "personal",
      allowed: true,
      used: 7,
      limit: 500,
      remaining: 493,
      periodStart: CALENDAR_START,
      periodEnd: CALENDAR_END,
    });
  });

  it("spends the CALLER's own wallet in their personal container", async () => {
    setup({ billing: null, members: 1 });
    await consumeMcpCredits(PERSONAL, personalCaller);
    expect(mockWallets.consumeUserCredits).toHaveBeenCalledWith(
      CALLER,
      CALENDAR_START,
      1,
      500
    );
  });

  it("🔒 a paid workspace's anchor never reaches the personal wallet", async () => {
    // The owner is on a live Team plan with a mid-month anchor; their HOME spend
    // still rolls on the 1st, because the wallet has no subscription.
    setup({ billing: billing(), members: 3 });
    expect((await consumeMcpCredits(CONTAINER, linkCaller)).periodStart).toBe(
      CALENDAR_START
    );
  });
});
