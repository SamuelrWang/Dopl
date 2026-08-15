import { NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { setWorkspaceCancelAtPeriodEnd } from "@/features/billing/server/billing-account-service";

/**
 * POST /api/billing/cancel — stop the subscription renewing, or resume it. ONE route for both
 * directions because they are one Stripe field: `{}` / `{resume:false}` sets
 * `cancel_at_period_end`, `{resume:true}` clears it.
 *
 * Nothing is deleted and nothing ends today — the workspace keeps every paid feature until
 * `current_period_end`, which is why the confirm dialog quotes that date.
 *
 * A money mutation, so an MCP agent holding a write token must never reach it (INVARIANTS §3;
 * pinned in `shared/auth/write-gate-coverage.test.ts`). ⚠ That pin is a REGEX over this file's
 * TEXT, so the option name may NEVER be spelled out in prose here — a docblock quoting it keeps
 * the route on the list after the real gate is gone.
 *
 * No live subscription answers 409 `NO_ACTIVE_SUBSCRIPTION`, never a silent 200.
 */
const CancelBody = z.object({ resume: z.boolean().optional() });

export const POST = withWorkspaceAuth(
  async (request, { workspaceId }) => {
    try {
      const { resume } = await parseJson(request, CancelBody);
      return NextResponse.json(
        await setWorkspaceCancelAtPeriodEnd(workspaceId, resume !== true)
      );
    } catch (err) {
      return toHttpErrorResponse("billing/cancel", err);
    }
  },
  { minRole: "admin", sessionOnly: true }
);
