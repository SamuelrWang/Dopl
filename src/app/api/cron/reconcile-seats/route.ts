import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/shared/auth/require-cron-secret";
import { isStripeConfigured } from "@/features/billing/server/stripe";
import { syncSeatQuantity } from "@/features/billing/server/seats";
import { listReconcilableTeamWorkspaceIds } from "@/features/billing/server/workspace-billing";
import { logSystemEvent } from "@/features/analytics/server/system-events";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

/**
 * GET /api/cron/reconcile-seats — daily seat-quantity true-up (vercel.json). Inline sync on
 * join/leave is best-effort (a Stripe hiccup is swallowed so it cannot fail the membership
 * change), so quantity drifts; this recomputes it for every live Team workspace via the shared
 * `syncSeatQuantity`.
 *
 * Idempotent: `syncSeatQuantity` re-reads billing, skips a matching count (no proration churn),
 * and only touches live Team subs — a run with no drift is a pure no-op.
 *
 * ⚠ Per-workspace isolation: one Stripe error never aborts the sweep, and the route still returns
 * 200 so the scheduler does not retry-storm the batch over one bad sub.
 *
 * Auth: CRON_SECRET bearer via requireCronSecret (fail-closed 503 when unset, 401 without it).
 */
export const dynamic = "force-dynamic";

/**
 * ⚠ Concurrency cap, small on purpose. Each unit is 2 DB reads + 2 Stripe calls + a write;
 * uncapped, every live Team workspace opens in the same tick, Stripe answers 429 (a rate-limited
 * response looks exactly like a failed true-up here, so the sweep reports mass failure with no
 * cause) and the pooler saturates first. A nightly sweep has no deadline — throughput is worth
 * nothing and staying under everyone's limits is worth a lot.
 */
const RECONCILE_CONCURRENCY = 5;

/** `Promise.allSettled` with a bounded worker pool. ⚠ Results stay index-aligned with `items`
 *  so callers can name the failures. */
async function settleWithConcurrency<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) {
      try {
        results[i] = { status: "fulfilled", value: await run(items[i]) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return results;
}

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  // No live key (test/preview): syncSeatQuantity no-ops every row, so skip the DB scan.
  if (!isStripeConfigured()) {
    return NextResponse.json({ ok: true, skipped: "stripe_not_configured" });
  }

  let workspaceIds: string[];
  try {
    workspaceIds = await listReconcilableTeamWorkspaceIds();
  } catch (err) {
    const message = err instanceof Error ? err.message : "enumeration failed";
    void logSystemEvent({
      severity: "error",
      category: "billing",
      source: "GET /api/cron/reconcile-seats",
      message: `Seat reconciliation could not enumerate workspaces: ${message}`,
      fingerprintKeys: ["cron", "reconcile-seats", "enumerate-fail"],
      userId: null,
    });
    // Cause is in the system event above; body carries the sanitized envelope (ENGINEERING §9).
    return toHttpErrorResponse("api/cron/reconcile-seats", err);
  }

  const results = await settleWithConcurrency(
    workspaceIds,
    RECONCILE_CONCURRENCY,
    (id) => syncSeatQuantity(id)
  );

  const failures: { workspaceId: string; error: string }[] = [];
  results.forEach((result, i) => {
    const workspaceId = workspaceIds[i];
    if (result.status === "rejected") {
      const error =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      failures.push({ workspaceId, error });
      console.error(
        `[reconcile-seats] syncSeatQuantity failed for workspace ${workspaceId}:`,
        error
      );
    }
  });

  const scanned = workspaceIds.length;
  const failed = failures.length;
  const succeeded = scanned - failed;

  void logSystemEvent({
    // Info on a clean sweep; error when any true-up threw, so it reaches the health dashboard.
    severity: failed > 0 ? "error" : "info",
    category: "billing",
    source: "GET /api/cron/reconcile-seats",
    message: `Seat reconciliation: ${succeeded}/${scanned} Team workspaces reconciled, ${failed} failed`,
    fingerprintKeys: [
      "cron",
      "reconcile-seats",
      failed > 0 ? "fail" : "ok",
    ],
    metadata: { scanned, succeeded, failed, failures: failures.slice(0, 50) },
    userId: null,
  });

  return NextResponse.json({ ok: true, scanned, succeeded, failed, failures });
}
