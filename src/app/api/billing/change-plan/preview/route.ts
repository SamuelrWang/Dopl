import { NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { parseQuery } from "@/shared/api/parse-json";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { PERSONAL_PAID_PLANS } from "@/features/billing/plans";
import { previewPersonalUpgrade } from "@/features/billing/server/plan-change";

/**
 * `GET /api/billing/change-plan/preview?plan=max` → `{ amountDue, currency }` — what an in-place
 * upgrade would charge TODAY, from Stripe's own invoice preview of the exact update
 * `plan-upgrade.ts › upgradeInPlace` makes (2026-10-22 review: the confirm dialog shows it before
 * a one-click charge). Read-only, so no interactive-session gate; owner only, home spaces only,
 * like the switch itself. `amountDue` is in the currency's minor unit.
 */
const PreviewQuery = z.object({ plan: z.enum(PERSONAL_PAID_PLANS) });

export const GET = withWorkspaceAuth(
  async (request, { workspaceId, workspaceKind }) => {
    if (workspaceKind !== "home") {
      return NextResponse.json(
        { error: "PLAN_NOT_FOR_CONTAINER", message: "Only a personal space has these plans." },
        { status: 400 }
      );
    }
    try {
      const { plan } = parseQuery(new URL(request.url).searchParams, PreviewQuery, ["plan"]);
      return NextResponse.json(await previewPersonalUpgrade(workspaceId, plan));
    } catch (err) {
      return toHttpErrorResponse("billing/change-plan/preview", err);
    }
  },
  { minRole: "owner" }
);
