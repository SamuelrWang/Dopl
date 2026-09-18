/**
 * Invariant suite — the client mirror of `/api/billing/status`
 * (`use-workspace-entitlements.ts`), specifically its stale-cache fallbacks.
 *
 * Why it exists (INVARIANTS §8): the query cache is IndexedDB-persisted with a
 * 24h `gcTime`, so a response stored before a field shipped is replayed after
 * it. Every new field needs a fallback here, and no type can say so — the
 * cached row is `any` on the wire.
 *
 * No React render: with `useApiQuery` mocked the hook's body calls no React hook
 * of its own, so it is invoked directly rather than dragging jsdom and a
 * QueryClientProvider in to test an `??`. The casts below are the point of the
 * suite — they build shapes the type says cannot exist and the cache produces.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({ data: undefined as unknown }));

vi.mock("@/shared/hooks/use-api-query", () => ({
  useApiQuery: () => ({
    data: state.data,
    isPending: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}) }));

import {
  PRO_PRICE,
  SOLO_PRICE,
  TEAM_SEAT_PRICE,
  formatMoney,
  useWorkspaceEntitlements,
  type WorkspaceEntitlementsStatus,
} from "./use-workspace-entitlements";
// Read from the one retune spot, not restated here — a literal in this file
// would pass while the default and the server disagreed.
import { PERSONAL_MONTHLY_CREDITS } from "../credits";

/** A full, current-shape payload. Cases below remove fields from it. */
function payload(): WorkspaceEntitlementsStatus {
  return {
    plan: "team",
    status: "active",
    containerKind: "standard",
    memberCount: 3,
    seatCount: 3,
    objectCap: null,
    objectsUsed: 12,
    canCreateObjects: true,
    chatsWindowDays: null,
    credits: {
      wallet: "seat",
      used: 40,
      limit: 5_000,
      remaining: 4_960,
      periodStart: "2026-09-01T00:00:00.000Z",
      periodEnd: "2026-10-01T00:00:00.000Z",
      ledgerDrift: 0,
      unmeteredSince: null,
    },
    cancelAtPeriodEnd: false,
    subscription_period_end: null,
    has_stripe_customer: true,
  };
}

beforeEach(() => {
  state.data = undefined;
});

describe("prices and the default meter", () => {
  it("pins the Team seat price at $8.99 (Samuel, 2026-09-08)", () => {
    // Moved from $8.00, which this case pinned the day before (2026-09-08):
    // one figure for both individual and team.
    expect(TEAM_SEAT_PRICE).toBe(8.99);
    expect(formatMoney(TEAM_SEAT_PRICE)).toBe("$8.99");
  });

  it("pins the personal Pro price at $8.99, the same figure by decision", () => {
    expect(PRO_PRICE).toBe(8.99);
    expect(formatMoney(PRO_PRICE)).toBe("$8.99");
  });

  it("keeps SOLO_PRICE for the legacy rows still on that plan", () => {
    // `solo` is not `pro`: a retired standard-workspace plan vs. the live
    // personal one, so a "cleanup" that merges them relabels live rows.
    expect(SOLO_PRICE).toBe(5.99);
    expect(SOLO_PRICE).not.toBe(PRO_PRICE);
  });

  it("🔒 re-exports the prices rather than declaring them (F-672)", async () => {
    // The numbers live in the pure `../prices.ts` so `../plans.ts`, which cannot
    // import a `"use client"` module, interpolates them instead of writing a
    // literal onto the public pricing card. Identity, not equality: two
    // constants that happen to agree today is the bug.
    const prices = await import("../prices");
    expect(TEAM_SEAT_PRICE).toBe(prices.TEAM_SEAT_PRICE);
    expect(PRO_PRICE).toBe(prices.PRO_PRICE);
    expect(SOLO_PRICE).toBe(prices.SOLO_PRICE);
    expect(formatMoney).toBe(prices.formatMoney);
  });

  it("bills flat plans flat and Team per seat", () => {
    state.data = { ...payload(), plan: "solo", seatCount: null, memberCount: 1 };
    expect(useWorkspaceEntitlements().monthlyTotal).toBe(SOLO_PRICE);
    state.data = {
      ...payload(),
      plan: "pro",
      containerKind: "personal" as const,
      seatCount: null,
      memberCount: 1,
    };
    // Flat, not `1 × PRO_PRICE` by accident: `memberCount` is 3, where a
    // seat-multiplying version would still read right at one member.
    const pro = useWorkspaceEntitlements();
    expect(pro.monthlyTotal).toBe(PRO_PRICE);
    expect(pro.isPro).toBe(true);
    expect(pro.isPaid).toBe(true);
    state.data = payload();
    const ent = useWorkspaceEntitlements();
    expect(ent.isSolo).toBe(false);
    expect(ent.isPro).toBe(false);
    expect(ent.isTeam).toBe(true);
    expect(ent.monthlyTotal).toBe(3 * TEAM_SEAT_PRICE);
  });

  it("🔒 a PRO total never multiplies by the roster", async () => {
    state.data = {
      ...payload(),
      plan: "pro",
      containerKind: "personal" as const,
      seatCount: null,
      memberCount: 4,
    };
    expect(useWorkspaceEntitlements().monthlyTotal).toBe(PRO_PRICE);
  });

  it("a CANCELED pro row is not paid", () => {
    state.data = { ...payload(), plan: "pro", status: "canceled" as const };
    const ent = useWorkspaceEntitlements();
    expect(ent.isPro).toBe(true);
    expect(ent.isPaid).toBe(false);
  });

  it("🔒 the pre-response default meter is the FREE PERSONAL allowance", () => {
    // This renders before the first response lands, most often on the caller's
    // own home space, where a seat figure would show a workspace number to
    // somebody who may not be in one.
    const ent = useWorkspaceEntitlements();
    expect(ent.credits.limit).toBe(PERSONAL_MONTHLY_CREDITS.free);
    expect(ent.credits.remaining).toBe(PERSONAL_MONTHLY_CREDITS.free);
    expect(ent.credits.wallet).toBeNull();
  });
});

/**
 * The stale-cache replays: each case is a row a real IndexedDB cache can hand
 * this hook today, and each one crashed or lied under some version of this file.
 */
describe("a cached row from before a field shipped still renders", () => {
  it("replays a row whose `credits` has NO `wallet` key", () => {
    const stale = payload();
    delete (stale.credits as Partial<WorkspaceEntitlementsStatus["credits"]>)
      .wallet;
    state.data = stale;

    const ent = useWorkspaceEntitlements();
    // `raw.credits ?? DEFAULT` cannot see this: the object is present and the
    // key is missing, so the fallback has to be field-wise inside `credits`.
    expect(ent.credits.wallet).toBeNull();
    // ...and the numbers that were cached are kept, not replaced by defaults.
    expect(ent.credits).toMatchObject({ used: 40, limit: 5_000 });
  });

  /**
   * `ledgerDrift` shipped 2026-09-13 (F-693), so it takes the same field-wise
   * fallback `wallet` does. The consumer test is `!== 0`
   * (`pages/home/overview-sections.tsx › CreditCapacityBar`), and
   * `undefined !== 0` is true — without the `?? 0` every replayed older row
   * would claim the reader's wallet does not match its own histogram.
   */
  it("replays a row whose `credits` has NO `ledgerDrift` key — 0, not undefined", () => {
    const stale = payload();
    delete (stale.credits as Partial<WorkspaceEntitlementsStatus["credits"]>)
      .ledgerDrift;
    state.data = stale;

    const ent = useWorkspaceEntitlements();
    expect(ent.credits.ledgerDrift).toBe(0);
    // ...and the rest of the cached `credits` object is kept.
    expect(ent.credits).toMatchObject({ used: 40, wallet: "seat" });
  });

  /**
   * `unmeteredSince` shipped 2026-09-14, same rule again. `undefined` is already
   * falsy so no surface would print the word, but the field-wise `?? null` is
   * what keeps the type honest (`string | null`, never `undefined`) — pinned
   * here before somebody drops the line as redundant.
   */
  it("replays a row whose `credits` has NO `unmeteredSince` key — null", () => {
    const stale = payload();
    delete (stale.credits as Partial<WorkspaceEntitlementsStatus["credits"]>)
      .unmeteredSince;
    state.data = stale;

    const ent = useWorkspaceEntitlements();
    expect(ent.credits.unmeteredSince).toBeNull();
    expect(ent.credits).toMatchObject({ used: 40, wallet: "seat" });
  });

  it("an unmetered stamp the CURRENT server sends is passed through untouched", () => {
    state.data = {
      ...payload(),
      credits: { ...payload().credits, unmeteredSince: "2026-09-14T10:00:00.000Z" },
    };
    expect(useWorkspaceEntitlements().credits.unmeteredSince).toBe(
      "2026-09-14T10:00:00.000Z"
    );
  });

  it("a non-zero drift the CURRENT server sends is passed through untouched", () => {
    // Revert detector for an over-eager fallback: `|| 0` would also swallow a
    // real negative drift, and `?? 0` is the operator that does not.
    state.data = {
      ...payload(),
      credits: { ...payload().credits, ledgerDrift: -2 },
    };
    expect(useWorkspaceEntitlements().credits.ledgerDrift).toBe(-2);
  });

  it("replays a row with NO `credits` object at all", () => {
    const stale = payload();
    delete (stale as Partial<WorkspaceEntitlementsStatus>).credits;
    state.data = stale;

    const ent = useWorkspaceEntitlements();
    expect(ent.credits.limit).toBe(PERSONAL_MONTHLY_CREDITS.free);
    expect(ent.credits.wallet).toBeNull();
    // The rest of the cached row survives — the degrade is field-wise, not
    // row-wise.
    expect(ent.plan).toBe("team");
    expect(ent.objectsUsed).toBe(12);
  });

  it("replays a row with NO `cancelAtPeriodEnd` — the older fallback still holds", () => {
    const stale = payload();
    delete (stale as Partial<WorkspaceEntitlementsStatus>).cancelAtPeriodEnd;
    state.data = stale;
    expect(useWorkspaceEntitlements().cancelAtPeriodEnd).toBe(false);
  });

  it("replays a row with NO `containerKind` — the field shipped 2026-09-08", () => {
    const stale = payload();
    delete (stale as Partial<WorkspaceEntitlementsStatus>).containerKind;
    state.data = stale;

    const ent = useWorkspaceEntitlements();
    // `standard` is the same default the server stamps for an absent workspace
    // kind, so a replayed row renders the surfaces it was captured on.
    // `undefined` would make `plansForKind` fall to the workspace list by
    // accident rather than by rule.
    expect(ent.containerKind).toBe("standard");
    expect(ent.plan).toBe("team");
  });

  it("a containerKind the CURRENT server sends is passed through untouched", () => {
    state.data = { ...payload(), containerKind: "personal" as const };
    expect(useWorkspaceEntitlements().containerKind).toBe("personal");
  });

  it("a wallet the CURRENT server sends is passed through untouched", () => {
    state.data = { ...payload() };
    expect(useWorkspaceEntitlements().credits.wallet).toBe("seat");
    state.data = {
      ...payload(),
      credits: { ...payload().credits, wallet: "personal" as const },
    };
    expect(useWorkspaceEntitlements().credits.wallet).toBe("personal");
  });
});
