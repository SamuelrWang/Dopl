import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/shared/auth/require-cron-secret";
import { isStripeConfigured } from "@/features/billing/server/stripe";
import { syncSeatQuantity } from "@/features/billing/server/seats";
import { listReconcilableTeamWorkspaceIds } from "@/features/billing/server/workspace-billing";
import { logSystemEvent } from "@/features/analytics/server/system-events";

/**
 * GET /api/cron/reconcile-seats
 *
 * Daily seat-quantity true-up (vercel.json). Per-seat Team subscriptions are
 * normally kept in sync inline when a member joins/leaves, but that call is
 * best-effort (a Stripe hiccup during add/remove is swallowed so it can't
 * fail the membership change), so quantity can drift. This sweep recomputes
 * the active-member count for every live Team workspace and true-ups the
 * Stripe seat quantity via the shared `syncSeatQuantity` reconciler.
 *
 * Idempotent + safe to run repeatedly: `syncSeatQuantity` re-reads billing,
 * skips when the seat count already matches (no proration churn), and only
 * ever touches live Team subs — so a run with no drift is a pure no-op.
 *
 * Per-workspace isolation: `Promise.allSettled` means one workspace's Stripe
 * error never aborts the sweep; failures are collected and surfaced in a
 * single system event, and the route still returns 200 so the scheduler
 * doesn't retry-storm the whole batch over one bad sub.
 *
 * Auth: CRON_SECRET bearer via requireCronSecret (fail-closed 503 when unset,
 * 401 without the secret), same as the other /api/cron/* routes.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  // No live key (test/preview) — syncSeatQuantity would no-op every row, so
  // skip the DB scan entirely and report the skip.
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
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const results = await Promise.allSettled(
    workspaceIds.map((id) => syncSeatQuantity(id))
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
    // Info on a clean sweep (healthy heartbeat); error when any workspace's
    // true-up threw so it shows up in the health dashboard.
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
