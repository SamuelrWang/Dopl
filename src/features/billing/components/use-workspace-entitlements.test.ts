/**
 * INVARIANT SUITE — the CLIENT MIRROR of `/api/billing/status`
 * (`use-workspace-entitlements.ts`), and specifically its STALE-CACHE
 * FALLBACKS.
 *
 * 🔒 **WHY THIS FILE EXISTS AT ALL (INVARIANTS §8).** The query cache is
 * IndexedDB-persisted with a 24h `gcTime`, so a response stored BEFORE a field
 * shipped is replayed AFTER it. Every new field on this payload therefore needs
 * a fallback here, and "needs a fallback" is not a thing a type can say: the
 * cached row is `any` on the wire and TypeScript believes the annotation.
 *
 * ⚠ **NO REACT RENDER, AND THAT IS DELIBERATE.** With `useApiQuery` mocked the
 * hook's body calls no React hook of its own — it is pure derivation over one
 * payload — so it is invoked directly. A `renderHook` harness would add jsdom
 * and a QueryClientProvider to test an `??`.
 *
 * ⚠ Casts below are the POINT of the suite: they build the shapes the type
 * says cannot exist and the cache produces anyway.
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
  SOLO_PRICE,
  TEAM_SEAT_PRICE,
  formatMoney,
  useWorkspaceEntitlements,
  type WorkspaceEntitlementsStatus,
} from "./use-workspace-entitlements";
// ⚠ READ FROM THE ONE RETUNE SPOT, not restated here — a literal in this file
// would pass while the default and the server disagreed.
import { PERSONAL_MONTHLY_CREDITS } from "../credits";

/** A full, current-shape payload. Cases below REMOVE fields from it. */
function payload(): WorkspaceEntitlementsStatus {
  return {
    plan: "team",
    status: "active",
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
  it("pins the Team seat price at $8.00 (Samuel, 2026-09-07)", () => {
    expect(TEAM_SEAT_PRICE).toBe(8);
    expect(formatMoney(TEAM_SEAT_PRICE)).toBe("$8.00");
  });

  it("keeps SOLO_PRICE for the legacy rows still on that plan", () => {
    expect(SOLO_PRICE).toBe(5.99);
  });

  it("bills a legacy solo flat and everyone else per seat", () => {
    state.data = { ...payload(), plan: "solo", seatCount: null, memberCount: 1 };
    expect(useWorkspaceEntitlements().monthlyTotal).toBe(SOLO_PRICE);
    state.data = payload();
    const ent = useWorkspaceEntitlements();
    expect(ent.isSolo).toBe(false);
    expect(ent.isTeam).toBe(true);
    expect(ent.monthlyTotal).toBe(3 * 8);
  });

  it("🔒 the pre-response default meter is the PERSONAL allowance, not a plan's", () => {
    // ⚠ This renders before the first response lands, most often on the
    // caller's own home space. A seat figure here shows a workspace number to
    // somebody who may not be in one.
    const ent = useWorkspaceEntitlements();
    expect(ent.credits.limit).toBe(PERSONAL_MONTHLY_CREDITS);
    expect(ent.credits.remaining).toBe(PERSONAL_MONTHLY_CREDITS);
    expect(ent.credits.wallet).toBeNull();
  });
});

/**
 * 🔒 THE STALE-CACHE REPLAYS. Each case is a row that a real IndexedDB cache
 * can hand this hook today, and each one crashed or lied under some version of
 * this file.
 */
describe("a cached row from before a field shipped still renders", () => {
  it("replays a row whose `credits` has NO `wallet` key", () => {
    const stale = payload();
    delete (stale.credits as Partial<WorkspaceEntitlementsStatus["credits"]>)
      .wallet;
    state.data = stale;

    const ent = useWorkspaceEntitlements();
    // ⚠ `raw.credits ?? DEFAULT` CANNOT SEE THIS: the object is present and the
    // KEY is missing, so the fallback has to be field-wise INSIDE `credits`.
    expect(ent.credits.wallet).toBeNull();
    // ...and the numbers that WERE cached are kept, not replaced by defaults.
    expect(ent.credits).toMatchObject({ used: 40, limit: 5_000 });
  });

  it("replays a row with NO `credits` object at all", () => {
    const stale = payload();
    delete (stale as Partial<WorkspaceEntitlementsStatus>).credits;
    state.data = stale;

    const ent = useWorkspaceEntitlements();
    expect(ent.credits.limit).toBe(PERSONAL_MONTHLY_CREDITS);
    expect(ent.credits.wallet).toBeNull();
    // The rest of the cached row survives — the degrade is FIELD-WISE, not
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
