import { NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { PERSONAL_PAID_PLANS, PERSONAL_PLAN_NAMES } from "@/features/billing/plans";
import {
  changePersonalPlan,
  getPlanChangeState,
} from "@/features/billing/server/plan-change";

/**
 * `/api/billing/change-plan` — move a home space's LIVE subscription between its personal paid
 * tiers (Pro ⇄ Max, 2026-10-22) in place. The rules — upgrade now and prorated, downgrade at the
 * period end, choosing the current plan cancels a queued downgrade — live in
 * `features/billing/server/plan-change.ts`; this file is the HTTP edge.
 *
 *   • `GET`  → `{ plan, scheduledPlan, effectiveAt }` for the pane ("Switches to Pro on …").
 *   • `POST { plan: "pro" | "max" }` → `{ ok, outcome, plan, scheduledPlan, effectiveAt }`.
 *
 * 🔒 **HOME SPACES ONLY, REFUSED BEFORE ANY READ.** Pro and Max are sold on a `kind='home'`
 * container and nowhere else, so every other kind answers 400 `PLAN_NOT_FOR_CONTAINER` — the same
 * code checkout uses for the same mistake. Only an explicit `home` passes: a kind added later must
 * opt in, not inherit a way to rewrite somebody's subscription.
 *
 * A money mutation, so the POST carries the interactive-session gate (INVARIANTS §3; pinned in
 * `shared/auth/write-gate-coverage.test.ts`). ⚠ That pin greps this file's TEXT, so the option's
 * name is not spelled out in prose here.
 */
const ChangePlanBody = z.object({ plan: z.enum(PERSONAL_PAID_PLANS) });

function notAHomeSpace() {
  return NextResponse.json(
    {
      error: "PLAN_NOT_FOR_CONTAINER",
      message: `${PERSONAL_PLAN_NAMES.pro} and ${PERSONAL_PLAN_NAMES.max} are for your personal space; open billing from Home.`,
    },
    { status: 400 }
  );
}

export const GET = withWorkspaceAuth(
  async (_request, { workspaceId, workspaceKind }) => {
    if (workspaceKind !== "home") return notAHomeSpace();
    try {
      return NextResponse.json(await getPlanChangeState(workspaceId));
    } catch (err) {
      return toHttpErrorResponse("billing/change-plan", err);
    }
  },
  { minRole: "owner" }
);

export const POST = withWorkspaceAuth(
  async (request, { workspaceId, workspaceKind }) => {
    if (workspaceKind !== "home") return notAHomeSpace();
    try {
      const { plan } = await parseJson(request, ChangePlanBody);
      const result = await changePersonalPlan(workspaceId, plan);
      return NextResponse.json({ ok: true, ...result });
    } catch (err) {
      return toHttpErrorResponse("billing/change-plan", err);
    }
  },
  { minRole: "owner", sessionOnly: true }
);
