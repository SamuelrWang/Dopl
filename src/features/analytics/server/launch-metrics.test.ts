/**
 * MRR, which is the one number on this dashboard that can be quietly wrong.
 *
 * The property with teeth (2026-09-08): `$8.99` did not replace `$7.99`, it was
 * ADDED beside it — new Team subscriptions bill the new price and one live one
 * still bills the old. A single seat constant cannot say that, so the price is
 * chosen per row from `stripe_price_id`. And `pro` had to join the plan filter
 * in the same edit: a paid plan missing from `.in("plan", …)` is revenue the
 * dashboard reports as zero, with no error anywhere.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const db = vi.hoisted(() => ({
  billingRows: [] as unknown[],
  planFilter: null as unknown,
  selectedCols: null as string | null,
}));

vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => ({
      select: (cols: string, opts?: { head?: boolean }) => {
        if (table === "profiles" && opts?.head) {
          return Promise.resolve({ count: 7, data: null });
        }
        if (table === "workspace_billing") db.selectedCols = cols;
        const builder = {
          in: (col: string, values: unknown) => {
            if (col === "plan") db.planFilter = values;
            return builder;
          },
          eq: () => Promise.resolve({ data: [] }),
          then: (
            onFulfilled: (v: { data: unknown[] }) => unknown,
            onRejected?: (e: unknown) => unknown
          ) =>
            Promise.resolve({
              data: table === "workspace_billing" ? db.billingRows : [],
            }).then(onFulfilled, onRejected),
        };
        return builder;
      },
    }),
  }),
}));

import { getLaunchMetrics } from "./launch-metrics";

function row(over: Record<string, unknown> = {}) {
  return { plan: "team", seat_count: 1, stripe_price_id: "price_seat", ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.billingRows = [];
  db.planFilter = null;
  db.selectedCols = null;
  vi.stubEnv("STRIPE_LEGACY_SEAT_PRICE_ID", "price_legacy_seat");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("MRR", () => {
  it("reads the price PER ROW — a legacy seat sub still bills $7.99", async () => {
    db.billingRows = [
      row({ seat_count: 2 }),
      row({ seat_count: 2, stripe_price_id: "price_legacy_seat" }),
    ];
    // 2 × 8.99 + 2 × 7.99
    expect((await getLaunchMetrics()).mrr_usd).toBe(33.96);
    expect(db.selectedCols).toContain("stripe_price_id");
  });

  it("counts a personal Pro row at its flat price, seat count ignored", async () => {
    db.billingRows = [row({ plan: "pro", seat_count: null })];
    expect((await getLaunchMetrics()).mrr_usd).toBe(8.99);
  });

  it("includes `pro` in the plan filter — a missing plan is silent lost revenue", async () => {
    await getLaunchMetrics();
    expect(db.planFilter).toEqual(["solo", "team", "pro"]);
  });

  it("still counts a legacy Solo row at $5.99", async () => {
    db.billingRows = [row({ plan: "solo", seat_count: null })];
    expect((await getLaunchMetrics()).mrr_usd).toBe(5.99);
  });

  it("counts every team row at the CURRENT price when no legacy env is set", async () => {
    // Dev, preview, and prod once the last legacy sub moves.
    vi.stubEnv("STRIPE_LEGACY_SEAT_PRICE_ID", "");
    db.billingRows = [row({ stripe_price_id: "price_legacy_seat" })];
    expect((await getLaunchMetrics()).mrr_usd).toBe(8.99);
  });

  it("floors a null/zero seat count at one seat", async () => {
    db.billingRows = [row({ seat_count: null }), row({ seat_count: 0 })];
    expect((await getLaunchMetrics()).mrr_usd).toBe(17.98);
  });
});
