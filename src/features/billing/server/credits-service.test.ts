/**
 * MCP credit consume path (runs once per tool call), part 1 of two: which wallet
 * a burn lands on, and what it costs in round trips. Pins:
 *   1. Query budget per wallet — seat = 3 round trips (billing row, member
 *      count, RPC); personal = 2 (the container's own billing row, RPC); link =
 *      3 (owner lookup, the owner's personal billing row, RPC). No `COUNT(*)`
 *      over `ontology_objects` and no second `workspace_billing` read; mock call
 *      counts are the only way to state that.
 *   2. Which wallet, and whose — the addressed container's kind decides
 *      (`credits-service.ts › resolveBillingTarget`'s table).
 *   3. The seat limit is per member and comes from the entitlement verdict.
 *
 * `credits-service-window.test.ts` holds the window half (cancellation
 * self-heal, meter/enforcement agreement, refusal + upgrade url, unmetered
 * posture, ledger). Repositories are mocked; `entitlements.ts` is real.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WorkspaceBillingRow } from "./workspace-billing";

// **NO LEDGER MOCK: `credit-ledger.ts` EXPORTS NO WRITER SINCE 2026-09-13**
// (F-693). The row is inserted by the wallet RPC, in the counter's transaction, so
// what is pinned here is the trailing `attrib(...)` argument reaching it.

vi.mock("./workspace-billing", () => ({
  getWorkspaceBilling: vi.fn(),
  // The personal wallet's own read (2026-09-08). `personal-wallet.ts` is real
  // here, so tier, window and limit are computed from the row this mock returns.
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
import { consumeMcpCredits, resolveBillingTarget } from "./credits-service";
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
  /** The OWNER's personal container row, reached only from a link container.
   *  Deliberately separate from `billing`: one fixture for both would pass
   *  against a version that meters a home burn off the addressed container. */
  personalBilling?: WorkspaceBillingRow | null;
}) {
  mockRepo.getWorkspaceBilling.mockResolvedValue(opts.billing);
  mockRepo.countActiveMembers.mockResolvedValue(opts.members);
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
 * The attribution table (`credits-service.ts`'s docblock), one case per row:
 * each wrong answer is a different bill going to a different person.
 */
/* Every arm below is rule B's fallback arm (2026-09-13): no `channelId`, so the
   resource's container pays. Channel arms and the fence:
   `credits-channel-attribution.test.ts`. Shapes: `./credits-target-fixtures.ts`. */
describe("resolveBillingTarget — with NO calling channel, the addressed kind picks the wallet", () => {
  it("standard (and a kind-less legacy row) → the CALLER's own SEAT", async () => {
    const seat = seatTarget({ workspaceId: WS, payerUserId: CALLER });
    expect(await resolveBillingTarget(WS, seatCaller)).toEqual(seat);
    expect(await resolveBillingTarget(WS, { userId: CALLER })).toEqual(seat);
    // A seat needs no owner: the caller IS the payer.
    expect(mockOwner).not.toHaveBeenCalled();
  });

  it("personal → the caller's PERSONAL wallet, WITHOUT an owner lookup", async () => {
    // The container is the billing row on this arm and on no other.
    expect(await resolveBillingTarget(PERSONAL, personalCaller)).toEqual(
      personalTarget({
        workspaceId: PERSONAL,
        payerUserId: CALLER,
        personalBillingContainerId: PERSONAL,
      })
    );
    // A personal container has exactly one member, so the caller is provably the
    // payer and the owner lookup buys an answer we already hold.
    expect(mockOwner).not.toHaveBeenCalled();
  });

  it("link → the container OWNER's PERSONAL wallet, whoever called", async () => {
    // The caller is deliberately not the owner: a same-user case would pass
    // against a version that bills the caller. `personalBillingContainerId`
    // stays null — a link container carries no billing row.
    expect(await resolveBillingTarget(CONTAINER, linkCaller)).toEqual(
      personalTarget({ workspaceId: CONTAINER, payerUserId: OWNER })
    );
    expect(mockOwner).toHaveBeenCalledWith(CONTAINER);
  });

  it("container with no active owner → unmetered, with the ONLY reason left", async () => {
    mockOwner.mockResolvedValue(null);
    expect(await resolveBillingTarget(CONTAINER, linkCaller)).toEqual(
      unmeteredTarget(CONTAINER)
    );
  });

  it("🔒 the workspaceId is the addressed container with no channel, never a rerouted one", async () => {
    // Revert detector for the old model: until 2026-09-07 this answered the
    // container owner's sole owned standard workspace. Each arm is paired with
    // the id it was asked about — a membership assertion over all three ids
    // would be green under the very reroute it claims to detect.
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

  it("LINK is three: the owner lookup, the owner's personal row, then the RPC", async () => {
    setup({ billing: billing(), members: 3 });
    await consumeMcpCredits(CONTAINER, linkCaller);
    expect(mockOwner).toHaveBeenCalledTimes(1);
    // One query, not two: `getPersonalBilling` embeds the billing row in the
    // container lookup (`workspace-billing.ts`).
    expect(mockRepo.getPersonalBilling).toHaveBeenCalledTimes(1);
    expect(mockRepo.getPersonalBilling).toHaveBeenCalledWith(OWNER);
    expect(mockWallets.consumeUserCredits).toHaveBeenCalledTimes(1);
    // Nothing seat-shaped: the addressed link container carries no plan, so its
    // billing row or member count would answer about the wrong tenant.
    expect(mockRepo.getWorkspaceBilling).toHaveBeenCalledTimes(0);
    expect(mockRepo.countActiveMembers).toHaveBeenCalledTimes(0);
  });

  it("PERSONAL is two: the container's own billing row, then the RPC", async () => {
    setup({ billing: null, members: 1 });
    await consumeMcpCredits(PERSONAL, personalCaller);
    // The container is the billing row (spec §11.1), so the owner → container
    // hop never happens.
    expect(mockRepo.getWorkspaceBilling).toHaveBeenCalledTimes(1);
    expect(mockRepo.getWorkspaceBilling).toHaveBeenCalledWith(PERSONAL);
    expect(mockRepo.getPersonalBilling).toHaveBeenCalledTimes(0);
    expect(mockWallets.consumeUserCredits).toHaveBeenCalledTimes(1);
    expect(mockOwner).toHaveBeenCalledTimes(0);
    expect(mockRepo.countActiveMembers).toHaveBeenCalledTimes(0);
  });

  it("🔒 a LINK burn never reads the ADDRESSED container's billing row", async () => {
    // Revert detector for the obvious wrong fix: `getWorkspaceBilling(addressed)`
    // always answers `null` for a link container, so every Pro operator is
    // charged 500 while tests that only check the free case stay green.
    setup({ billing: billing(), members: 3 });
    await consumeMcpCredits(CONTAINER, linkCaller);
    expect(mockRepo.getWorkspaceBilling).not.toHaveBeenCalledWith(CONTAINER);
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
    // The key carries the member: a pooled (workspace, period) counter cannot
    // express a fixed per-person allocation.
    expect(mockWallets.consumeMemberCredits).toHaveBeenCalledWith(
      WS,
      CALLER,
      "2026-07-21T09:30:00.000Z",
      1,
      5_000,
      ledgerAttribution(WS, CALLER)
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
      500,
      ledgerAttribution(CONTAINER, CALLER)
    );
    // Revert detector: a version that bills the caller passes everything else here.
    expect(mockWallets.consumeUserCredits).not.toHaveBeenCalledWith(
      CALLER,
      expect.anything(),
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
      500,
      ledgerAttribution(PERSONAL, CALLER)
    );
  });

  it("🔒 a paid WORKSPACE's anchor never reaches the personal wallet", async () => {
    // The owner is on a live Team plan with a mid-month anchor; their home spend
    // still rolls on the 1st. `billing` is the addressed container's fixture and
    // the owner's personal row is null — the separation is the assertion.
    setup({ billing: billing(), members: 3, personalBilling: null });
    expect((await consumeMcpCredits(CONTAINER, linkCaller)).periodStart).toBe(
      CALENDAR_START
    );
  });
});

/**
 * Personal Pro tier (Samuel, 2026-09-08): limit and window both come off the
 * payer's own `kind='personal'` container's billing row.
 */
describe("consumeMcpCredits — a PRO personal wallet", () => {
  const PRO = (overrides: Partial<WorkspaceBillingRow> = {}) =>
    billing({
      workspaceId: PERSONAL,
      plan: "pro",
      status: "active",
      seatCount: null,
      stripePriceId: "price_personal_pro",
      ...overrides,
    });

  it("charges the OWNER against 5,000 on their SUBSCRIPTION window, from a link container", async () => {
    setup({ billing: null, members: 1, personalBilling: PRO() });
    const res = await consumeMcpCredits(CONTAINER, linkCaller);
    expect(mockWallets.consumeUserCredits).toHaveBeenCalledWith(
      OWNER,
      "2026-07-21T09:30:00.000Z",
      1,
      5_000,
      ledgerAttribution(CONTAINER, CALLER)
    );
    expect(res).toMatchObject({
      wallet: "personal",
      limit: 5_000,
      periodStart: "2026-07-21T09:30:00.000Z",
    });
  });

  it("charges the CALLER against 5,000 in their own personal container", async () => {
    setup({ billing: PRO(), members: 1 });
    const res = await consumeMcpCredits(PERSONAL, personalCaller);
    expect(mockWallets.consumeUserCredits).toHaveBeenCalledWith(
      CALLER,
      "2026-07-21T09:30:00.000Z",
      1,
      5_000,
      ledgerAttribution(PERSONAL, CALLER)
    );
    expect(res.limit).toBe(5_000);
  });

  it("past_due keeps the Pro allowance (grace), like every other entitlement", async () => {
    setup({ billing: PRO({ status: "past_due" }), members: 1 });
    expect((await consumeMcpCredits(PERSONAL, personalCaller)).limit).toBe(5_000);
  });

  it("🔒 a CANCELED Pro row drops to 500 AND to the calendar month — no lockout", async () => {
    // Same self-heal as the seat wallet: a canceled row keeps a future-ending
    // anchor, so honouring it would lock a key already spent to 5,000 out of a
    // fresh 500 limit. The free verdict ignores the anchor.
    setup({ billing: PRO({ status: "canceled" }), members: 1 });
    const res = await consumeMcpCredits(PERSONAL, personalCaller);
    expect(res.limit).toBe(500);
    expect(res.periodStart).toBe(CALENDAR_START);
    expect(res.periodEnd).toBe(CALENDAR_END);
  });

  it("🔒 a stray `team` row on a personal container gets the FREE personal figure", async () => {
    // Cannot happen, and the answer must be the small one anyway: reading it as
    // paid would hand a free home space 5,000 credits nobody bought.
    setup({ billing: PRO({ plan: "team" }), members: 1 });
    expect((await consumeMcpCredits(PERSONAL, personalCaller)).limit).toBe(500);
  });

  it("🔒 a `pro` row NEVER routes through the SEAT map", async () => {
    // `SEAT_MONTHLY_CREDITS.pro` is 5,000 too, so a wrong route agrees on the
    // number — the counter is what separates them.
    setup({ billing: PRO(), members: 1 });
    await consumeMcpCredits(PERSONAL, personalCaller);
    expect(mockWallets.consumeMemberCredits).not.toHaveBeenCalled();
  });
});

/**
 * A payer with no personal container cannot exist after
 * `20260920120000_workspace_kind_personal.sql`, but the read can still answer
 * null and a burn has to be charged to something.
 */
describe("consumeMcpCredits — the owner has no personal container", () => {
  it("falls to the FREE tier on the calendar month, and SAYS SO", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setup({ billing: null, members: 1 });
    mockRepo.getPersonalBilling.mockResolvedValue(null);

    const res = await consumeMcpCredits(CONTAINER, linkCaller);

    expect(res).toMatchObject({
      wallet: "personal",
      allowed: true,
      limit: 500,
      periodStart: CALENDAR_START,
    });
    // Free, not unmetered: the burn lands on a real counter; only the row that
    // could have made it Pro is missing.
    expect(res.degraded).toBeUndefined();
    expect(mockWallets.consumeUserCredits).toHaveBeenCalledWith(
      OWNER,
      CALENDAR_START,
      1,
      500,
      ledgerAttribution(CONTAINER, CALLER)
    );
    // Assert the content: a silent free-tier fallback has no visible symptom
    // until the refusal lands.
    const line = warn.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(line).toContain(OWNER);
    expect(line).toContain("no kind='personal' container");
    warn.mockRestore();
  });
});
