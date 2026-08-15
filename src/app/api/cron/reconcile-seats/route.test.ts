/**
 * `GET /api/cron/reconcile-seats` — the FAN-OUT bound. Each unit is 2 DB reads + 2 Stripe calls +
 * a write; uncapped it trips Stripe's per-second limit and saturates the pooler, and a 429 is
 * indistinguishable from a genuinely failed true-up. Pins the cap plus the two properties it must
 * not cost: every workspace visited exactly once, and one failure never aborts the rest.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/auth/require-cron-secret", () => ({
  requireCronSecret: vi.fn(() => null),
}));
vi.mock("@/features/billing/server/stripe", () => ({
  isStripeConfigured: vi.fn(() => true),
}));
vi.mock("@/features/billing/server/seats", () => ({
  syncSeatQuantity: vi.fn(),
}));
vi.mock("@/features/billing/server/workspace-billing", () => ({
  listReconcilableTeamWorkspaceIds: vi.fn(),
}));
vi.mock("@/features/analytics/server/system-events", () => ({
  logSystemEvent: vi.fn(),
}));

import { NextRequest } from "next/server";
import { requireCronSecret } from "@/shared/auth/require-cron-secret";
import { isStripeConfigured } from "@/features/billing/server/stripe";
import { syncSeatQuantity } from "@/features/billing/server/seats";
import { listReconcilableTeamWorkspaceIds } from "@/features/billing/server/workspace-billing";
import { GET } from "./route";

/** The cap the route must hold to. */
const CONCURRENCY = 5;

const request = () =>
  new NextRequest("https://dopl.test/api/cron/reconcile-seats");

function workspaces(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `ws-${i}`);
}

/** A `syncSeatQuantity` recording the high-water mark of overlapping calls. */
function peakTracker() {
  let active = 0;
  let peak = 0;
  vi.mocked(syncSeatQuantity).mockImplementation(async () => {
    active += 1;
    peak = Math.max(peak, active);
    // Yield across microtask turns so an unbounded fan-out would overlap every call.
    for (let i = 0; i < 3; i++) await Promise.resolve();
    active -= 1;
  });
  return { peak: () => peak };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireCronSecret).mockReturnValue(null);
  vi.mocked(isStripeConfigured).mockReturnValue(true);
  vi.mocked(syncSeatQuantity).mockResolvedValue(undefined);
});

describe("reconcile-seats — bounded fan-out", () => {
  it("never has more than the cap in flight at once", async () => {
    vi.mocked(listReconcilableTeamWorkspaceIds).mockResolvedValue(workspaces(50));
    const tracker = peakTracker();

    const body = await (await GET(request())).json();

    expect(tracker.peak()).toBe(CONCURRENCY);
    expect(body).toMatchObject({ scanned: 50, succeeded: 50, failed: 0 });
  });

  it("uses fewer workers than the cap when there is less work", async () => {
    vi.mocked(listReconcilableTeamWorkspaceIds).mockResolvedValue(workspaces(2));
    const tracker = peakTracker();

    await GET(request());

    expect(tracker.peak()).toBe(2);
  });

  it("still visits every workspace exactly once", async () => {
    const ids = workspaces(23);
    vi.mocked(listReconcilableTeamWorkspaceIds).mockResolvedValue(ids);

    const res = await GET(request());
    const body = await res.json();

    expect(vi.mocked(syncSeatQuantity).mock.calls.map((c) => c[0]).sort()).toEqual(
      [...ids].sort()
    );
    expect(body).toMatchObject({ ok: true, scanned: 23, succeeded: 23, failed: 0 });
  });

  it("does not open a worker when there is nothing to sweep", async () => {
    vi.mocked(listReconcilableTeamWorkspaceIds).mockResolvedValue([]);

    const res = await GET(request());

    expect(syncSeatQuantity).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ scanned: 0, succeeded: 0, failed: 0 });
  });
});

describe("reconcile-seats — isolation survives the cap", () => {
  it("keeps going after a failure and names the workspace that failed", async () => {
    vi.mocked(listReconcilableTeamWorkspaceIds).mockResolvedValue(workspaces(12));
    vi.mocked(syncSeatQuantity).mockImplementation(async (id: string) => {
      if (id === "ws-7") throw new Error("stripe 429");
    });

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ scanned: 12, succeeded: 11, failed: 1 });
    // ⚠ Index alignment: a mis-aligned result set blames the wrong workspace.
    expect(body.failures).toEqual([
      { workspaceId: "ws-7", error: "stripe 429" },
    ]);
    expect(syncSeatQuantity).toHaveBeenCalledTimes(12);
  });

  it("skips the DB scan entirely when Stripe is not configured", async () => {
    vi.mocked(isStripeConfigured).mockReturnValue(false);

    const res = await GET(request());

    expect(listReconcilableTeamWorkspaceIds).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ ok: true, skipped: "stripe_not_configured" });
  });

  it("fails closed before any work when the cron secret gate denies", async () => {
    vi.mocked(requireCronSecret).mockReturnValue(
      new Response(null, { status: 503 }) as never
    );

    const res = await GET(request());

    expect(res.status).toBe(503);
    expect(isStripeConfigured).not.toHaveBeenCalled();
    expect(syncSeatQuantity).not.toHaveBeenCalled();
  });
});
