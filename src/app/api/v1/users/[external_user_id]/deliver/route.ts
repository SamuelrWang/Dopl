import { withDeveloperKey } from "@/features/device-sdk/server/with-developer-key";
import { deliver } from "@/features/device-sdk/server/delivery-service";
import { deliveryDeps, headerKeyMismatch, parseBody, prefersRespondAsync, refuseBody, respond } from "@/features/device-sdk/server/delivery-routes";
import { DeliverRequestSchema } from "@/features/device-sdk/types";

export const dynamic = "force-dynamic";
/** An `ask` intent holds up to 200s (ASK_HOLD_MAX_S) for the answer, unless `Prefer: respond-async`. */
export const maxDuration = 300;

/**
 * `POST /v1/users/{external_user_id}/deliver` (C4 intent level) — Dopl routes (C5), applies policy
 * (C7) and enforces the profile's limits (D3: never a rewrite). 202 `{ delivery_id, routed_to, status }`.
 */
export const POST = withDeveloperKey(
  async (request, ctx, { params }) => {
    const { external_user_id } = await params;
    const userId = external_user_id ?? "";
    const body = await parseBody(request, DeliverRequestSchema);
    if (!body.ok) return refuseBody(ctx, "auto", body.message, { external_user_id: userId });
    if (headerKeyMismatch(request, body.data.idempotency_key)) {
      return refuseBody(ctx, body.data.target ?? "auto", "The Idempotency-Key header and body idempotency_key differ.", {
        external_user_id: userId,
      });
    }
    const result = await deliver(deliveryDeps(), { projectId: ctx.projectId, env: ctx.env }, userId, body.data, { hold: !prefersRespondAsync(request) });
    return respond(ctx, result);
  },
  { scopes: ["actions:write"] }
);
