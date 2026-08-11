import { NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { setWorkspaceCancelAtPeriodEnd } from "@/features/billing/server/billing-account-service";

/**
 * POST /api/billing/cancel — stop the subscription renewing, or resume it.
 *
 * ONE ROUTE FOR BOTH DIRECTIONS, because they are one Stripe field. `{}` (or
 * `{resume:false}`) sets `cancel_at_period_end`; `{resume:true}` clears it. A
 * separate `/resume` route would be a second auth wrapper and a second error
 * mapping over `subscriptions.update` with the boolean flipped.
 *
 * NOTHING IS DELETED AND NOTHING ENDS TODAY. The workspace keeps every paid
 * feature until `current_period_end` — which is why the confirm dialog quotes
 * that date and why the service answers with it.
 *
 * SESSION-ONLY — this is a money mutation. An MCP agent holding a
 * `dopl.write` token must never be able to end its operator's subscription,
 * and there is no dialog on that surface to gate it (INVARIANTS §3; pinned in
 * `shared/auth/write-gate-coverage.test.ts`). ⚠ That pin is a REGEX over this
 * file's TEXT, so the option may never be spelled out in prose here — a
 * docblock quoting it keeps the route on the list after the real gate is gone,
 * which is exactly what a mutation check caught while this route was written.
 *
 * A workspace with no live subscription answers 409 `NO_ACTIVE_SUBSCRIPTION`
 * rather than a silent 200 — "we canceled nothing" must not read as "canceled".
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
