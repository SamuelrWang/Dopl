/**
 * Invariant suite — MCP credit consume, part 2: which period key a burn is charged
 * under, and what the answer says. Pins the window (a free verdict ignores a
 * subscription anchor, self-healing a mid-period cancellation — on both wallets
 * since 2026-09-08, so a Pro home space rolls on its Stripe date), meter/enforcement
 * agreement, the refusal and its upgrade url, and the ledger's caller-vs-payer split.
 *
 * Split from `credits-service.test.ts` (the routing half) at the 500-line cap.
 * Repositories mocked; `entitlements.ts` is real, so the lean verdict helper is
 * proven to be the same `paidEntitlement` logic, not a copy.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WorkspaceBillingRow } from "./workspace-billing";

vi.mock("./workspace-billing", () => ({
  getWorkspaceBilling: vi.fn(),
  // `personal-wallet.ts` stays real here — only the repository is mocked — so
  // tier, window and limit are computed from the row this mock hands back.
  getPersonalBilling: vi.fn(),
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
import { consumeMcpCredits } from "./credits-service";
// Meter half lives in `credits-meter.ts` (2026-09-13); this file drives both
// sides, which is the point of the agreement cases.
import { creditPeriodFor, summarizeCredits, unmetered } from "./credits-meter";
import {
  ledgerAttribution,
  personalTarget,
  seatTarget,
  teamBillingRow,
  unmeteredTarget,
} from "./credits-target-fixtures";

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

/** `credits-target-fixtures.ts › teamBillingRow` + this suite's MID-MONTH anchor. */
function billing(overrides: Partial<WorkspaceBillingRow> = {}): WorkspaceBillingRow {
  return teamBillingRow({
    currentPeriodStart: "2026-07-21T09:30:00.000Z",
    currentPeriodEnd: "2026-08-21T09:30:00.000Z",
    ...overrides,
  });
}

function setup(opts: {
  billing: WorkspaceBillingRow | null;
  members: number;
  allowed?: boolean;
  used?: number;
  /** The OWNER's personal container row — separate from `billing` on purpose. */
  personalBilling?: WorkspaceBillingRow | null;
}) {
  mockRepo.getWorkspaceBilling.mockResolvedValue(opts.billing);
  mockRepo.countActiveMembers.mockResolvedValue(opts.members);
  // The owner's personal container, free by default — the arm a link burn takes.
  mockRepo.getPersonalBilling.mockResolvedValue({
    containerId: PERSONAL,
    billing: opts.personalBilling ?? null,
  });
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
 * Cancellation lockout on the seat wallet: a canceled row keeps a future-ending
 * anchor, so honouring it would charge the next call to a key already at 4,000
 * used against a new 100 limit. Heals on the next consume — no webhook, no cron.
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
    const res = await consumeMcpCredits(WS, seatCaller);
    expect(res.periodStart).toBe(CALENDAR_START);
    expect(res.periodEnd).toBe(CALENDAR_END);
  });

  it("spends against a FRESH counter key at the free limit — allowed, not refused", async () => {
    setup({ billing: CANCELED(), members: 3, allowed: true, used: 1 });
    const res = await consumeMcpCredits(WS, seatCaller);
    expect(mockWallets.consumeMemberCredits).toHaveBeenCalledWith(
      WS,
      CALLER,
      CALENDAR_START,
      1,
      100,
      ledgerAttribution(WS, CALLER)
    );
    expect(res.allowed).toBe(true);
    expect(res.limit).toBe(100);
    expect(res.remaining).toBe(99);
  });

  it("holds even when the sub row was NOT cleaned up (status canceled, plan still team)", async () => {
    setup({ billing: billing({ plan: "team", status: "canceled" }), members: 3 });
    const res = await consumeMcpCredits(WS, seatCaller);
    expect(res.periodStart).toBe(CALENDAR_START);
    expect(res.limit).toBe(100);
  });

  it("a still-LIVE paid workspace keeps its own billing-date window", async () => {
    setup({ billing: billing(), members: 3 });
    expect((await consumeMcpCredits(WS, seatCaller)).periodStart).toBe(
      "2026-07-21T09:30:00.000Z"
    );
  });
});

describe("the settings meter resolves the SAME window and wallet as enforcement", () => {
  it("summarizeCredits and consumeMcpCredits agree for a canceled workspace's seat", async () => {
    const row = billing({ plan: "team", status: "canceled" });
    setup({ billing: row, members: 3 });
    mockWallets.getMemberCreditsUsed.mockResolvedValue(12);

    const charged = await consumeMcpCredits(WS, seatCaller);
    const metered = await summarizeCredits(
      seatTarget({ workspaceId: WS, payerUserId: CALLER }),
      row,
      3
    );

    expect(metered.periodStart).toBe(charged.periodStart);
    expect(metered.periodEnd).toBe(charged.periodEnd);
    expect(metered.limit).toBe(charged.limit);
    expect(metered.wallet).toBe("seat");
    expect(mockWallets.getMemberCreditsUsed).toHaveBeenCalledWith(
      WS,
      CALLER,
      charged.periodStart
    );
  });

  it("and for a live paid workspace", async () => {
    const row = billing();
    setup({ billing: row, members: 3 });
    mockWallets.getMemberCreditsUsed.mockResolvedValue(40);

    const charged = await consumeMcpCredits(WS, seatCaller);
    const metered = await summarizeCredits(
      seatTarget({ workspaceId: WS, payerUserId: CALLER }),
      row,
      3
    );

    expect(metered.periodStart).toBe(charged.periodStart);
    expect(metered.limit).toBe(charged.limit);
  });

  it("and for a PERSONAL wallet — the meter reads the owner's counter, not a workspace's", async () => {
    setup({ billing: billing(), members: 3 });
    mockWallets.getUserCreditsUsed.mockResolvedValue(9);

    const charged = await consumeMcpCredits(CONTAINER, linkCaller);
    const metered = await summarizeCredits(
      personalTarget({ workspaceId: CONTAINER, payerUserId: OWNER }),
      null,
      1
    );

    expect(metered).toMatchObject({
      wallet: "personal",
      used: 9,
      limit: 500,
      remaining: 491,
      periodStart: charged.periodStart,
    });
    expect(mockWallets.getUserCreditsUsed).toHaveBeenCalledWith(
      OWNER,
      charged.periodStart
    );
    expect(mockWallets.getMemberCreditsUsed).not.toHaveBeenCalled();
  });

  it("and for a PRO personal wallet — same 5,000 and same subscription window", async () => {
    // The meter must be fed the payer's personal row, not the addressed
    // container's: a link container has no billing row, so a meter handed `null`
    // reports 500 on the calendar month while enforcement charges 5,000 on the
    // Stripe anchor. `status-service.ts › callerCredits` resolves it through
    // `personal-wallet.ts`.
    const pro = billing({
      workspaceId: PERSONAL,
      plan: "pro",
      status: "active",
      seatCount: null,
    });
    setup({ billing: null, members: 1, personalBilling: pro });
    mockWallets.getUserCreditsUsed.mockResolvedValue(120);

    const charged = await consumeMcpCredits(CONTAINER, linkCaller);
    const metered = await summarizeCredits(
      personalTarget({ workspaceId: CONTAINER, payerUserId: OWNER }),
      pro,
      1
    );

    expect(charged).toMatchObject({
      limit: 5_000,
      periodStart: "2026-07-21T09:30:00.000Z",
    });
    expect(metered).toMatchObject({
      wallet: "personal",
      used: 120,
      limit: 5_000,
      remaining: 4_880,
      periodStart: charged.periodStart,
      periodEnd: charged.periodEnd,
    });
  });

  it("never reports negative remaining, even if usage overshot the limit", async () => {
    mockWallets.getUserCreditsUsed.mockResolvedValue(600);
    const metered = await summarizeCredits(
      personalTarget({
        workspaceId: PERSONAL,
        payerUserId: CALLER,
        personalBillingContainerId: PERSONAL,
      }),
      null,
      1
    );
    expect(metered.remaining).toBe(0);
  });

  it("a wallet-less target meters the unmetered posture, reading no counter", async () => {
    const metered = await summarizeCredits(
      unmeteredTarget(CONTAINER),
      null,
      1
    );
    expect(metered).toMatchObject({ wallet: null, used: 0, limit: 0, degraded: true });
    expect(mockWallets.getUserCreditsUsed).not.toHaveBeenCalled();
    expect(mockWallets.getMemberCreditsUsed).not.toHaveBeenCalled();
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

/**
 * The MCP refusal renders the upgrade url literally
 * (`tools/respond.ts › creditsExhausted`), so a non-empty url on a wallet with
 * nothing to buy sends an exhausted agent to a checkout that cannot help it.
 */
describe("consumeMcpCredits — refusal and the upgrade url", () => {
  it("a SEAT on a FREE verdict is the only case that offers an upgrade", async () => {
    setup({ billing: null, members: 1, allowed: false, used: 100 });
    const res = await consumeMcpCredits(WS, seatCaller);
    expect(res.allowed).toBe(false);
    expect(res.used).toBe(100);
    expect(res.remaining).toBe(0);
    expect(res.upgradeUrl).toMatch(/\/billing\?billing=upgrade$/);
  });

  it("a SEAT on a PAID plan offers nothing — it is already on the best allowance", async () => {
    setup({ billing: billing(), members: 4, allowed: false, used: 5_000 });
    expect((await consumeMcpCredits(WS, seatCaller)).upgradeUrl).toBe("");
  });

  it("a FREE PERSONAL wallet offers PRO — and the link carries `plan=pro`", async () => {
    // `plan=pro` is load-bearing: segment-less `/billing` resolves a standard
    // workspace by default, so a bare upgrade link would land a home-space
    // upsell on a workspace the caller may not even have.
    setup({ billing: null, members: 1, allowed: false, used: 500 });
    const res = await consumeMcpCredits(PERSONAL, personalCaller);
    expect(res.allowed).toBe(false);
    expect(res.upgradeUrl).toMatch(/\/billing\?billing=upgrade&plan=pro$/);
  });

  it("a PRO personal wallet offers nothing — it is already on the best allowance", async () => {
    setup({
      billing: billing({ plan: "pro", status: "active", seatCount: null }),
      members: 1,
      allowed: false,
      used: 5_000,
    });
    expect((await consumeMcpCredits(PERSONAL, personalCaller)).upgradeUrl).toBe("");
  });

  it("🔒 the two free offers are DIFFERENT urls — a seat is never sold Pro", async () => {
    // A single shared `upgradeUrl()` passes every "non-empty" assertion above
    // and sends a workspace member to a personal checkout.
    setup({ billing: null, members: 1, allowed: false, used: 100 });
    const seat = await consumeMcpCredits(WS, seatCaller);
    setup({ billing: null, members: 1, allowed: false, used: 500 });
    const personal = await consumeMcpCredits(PERSONAL, personalCaller);
    expect(seat.upgradeUrl).not.toBe(personal.upgradeUrl);
    expect(seat.upgradeUrl).not.toContain("plan=");
  });
});

describe("the unmetered posture", () => {
  it("is allowed, stamped, wallet-less, and offers nothing", () => {
    expect(unmetered()).toMatchObject({
      wallet: null,
      allowed: true,
      used: 0,
      limit: 0,
      remaining: 0,
      upgradeUrl: "",
      degraded: true,
    });
  });

  it("a container with no active owner charges NOTHING and SAYS SO", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockOwner.mockResolvedValue(null);

    const res = await consumeMcpCredits(CONTAINER, linkCaller);

    expect(res.allowed).toBe(true);
    expect(res.degraded).toBe(true);
    expect(mockWallets.consumeUserCredits).not.toHaveBeenCalled();
    expect(mockWallets.consumeMemberCredits).not.toHaveBeenCalled();
    // Assert the CONTENT, not that something was logged: silence here is
    // indistinguishable from the 403-and-swallow this path replaced (F-325).
    const line = warn.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(line).toContain("container-has-no-active-owner");
    expect(line).toContain(CONTAINER);
    expect(line).toContain(CALLER);
    warn.mockRestore();
  });

  it("a real reading carries NO degraded stamp and logs nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setup({ billing: billing(), members: 3 });
    const res = await consumeMcpCredits(WS, seatCaller);
    expect(res.degraded).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

/**
 * F-693 (2026-09-13): one ledger row per spend, in the counter's own transaction —
 * the histogram must equal the wallet. The write is not a second round trip, so
 * these cases pin the RPC's arguments rather than a writer's calls.
 *
 * "A refused consume writes nothing" and "a failed insert rolls the counter back"
 * are properties of the SQL function body now
 * (`credit-consume-with-ledger-schema.test.ts`); TypeScript still proves the
 * dimensions reach the RPC and that nothing writes the ledger twice.
 */
describe("credit usage ledger", () => {
  it("hands the RPC the attribution, stamped with the period the counter used", async () => {
    setup({ billing: billing({ plan: "free", status: "free" }), members: 1, used: 7 });

    await consumeMcpCredits(WS, seatCaller);

    expect(mockWallets.consumeMemberCredits).toHaveBeenCalledTimes(1);
    const call = mockWallets.consumeMemberCredits.mock.calls[0];
    // Charged container, payer, then period. The period passed to the RPC is the
    // one stamped on the row — one statement, so it cannot be re-derived from a
    // clock half a request later.
    expect(call?.[0]).toBe(WS);
    expect(call?.[1]).toBe(CALLER);
    expect(call?.[2]).toBe(CALENDAR_START);
    expect(call?.[5]).toEqual({
      originWorkspaceId: WS,
      callerUserId: CALLER,
      channelId: null,
    });
  });

  /**
   * A peer's burn in somebody's link container spends the owner's personal wallet,
   * so the row must carry both: payer is the counter's key, caller rides the
   * attribution. Collapsing them makes "who spent my credits" name the wrong person.
   */
  it("separates the caller from the payer across the two arguments", async () => {
    setup({ billing: null, members: 1 });

    await consumeMcpCredits(CONTAINER, linkCaller);

    const call = mockWallets.consumeUserCredits.mock.calls[0];
    expect(call?.[0]).toBe(OWNER);
    expect(call?.[4]).toEqual({
      originWorkspaceId: CONTAINER,
      callerUserId: CALLER,
      channelId: null,
    });
  });

  /** Revert detector: a reintroduced post-spend ledger write reopens the gap, and
   *  the cheapest proof none exists is that the module exports nothing callable. */
  it("🔒 `credit-ledger.ts` exports NO writer to fire after the spend", async () => {
    const ledger = await import("./credit-ledger");
    expect(Object.values(ledger).filter((v) => typeof v === "function")).toEqual(
      []
    );
  });
});
