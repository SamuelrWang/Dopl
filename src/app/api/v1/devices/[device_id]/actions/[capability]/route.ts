import { withDeveloperKey } from "@/features/device-sdk/server/with-developer-key";
import { deviceAction } from "@/features/device-sdk/server/action-service";
import { deliveryDeps, headerKeyMismatch, parseBody, prefersRespondAsync, refuseBody, respond } from "@/features/device-sdk/server/delivery-routes";
import { CapabilityIdSchema, DeviceActionRequestSchema } from "@/features/device-sdk/types";

export const dynamic = "force-dynamic";
/** `ask.*` holds up to 200s (ASK_HOLD_MAX_S) for the answer, unless `Prefer: respond-async`. */
export const maxDuration = 300;

/**
 * `POST /v1/devices/{device_id}/actions/{capability}` (C4 device level). 202 `{ action_id, status }`;
 * T4 → `confirmation_denied` by default, or `needs_confirmation` when the profile configures it (C7).
 * Poll with `GET /v1/actions/{id}`.
 */
export const POST = withDeveloperKey(
  async (request, ctx, { params }) => {
    const { device_id, capability } = await params;
    const deviceId = device_id || "unknown";
    const cap = CapabilityIdSchema.safeParse(capability);
    if (!cap.success) return refuseBody(ctx, deviceId, `Unknown capability "${capability}".`);
    const body = await parseBody(request, DeviceActionRequestSchema);
    if (!body.ok) return refuseBody(ctx, deviceId, body.message, { capability: cap.data });
    if (headerKeyMismatch(request, body.data.idempotency_key)) {
      return refuseBody(ctx, deviceId, "The Idempotency-Key header and body idempotency_key differ.", { capability: cap.data });
    }
    const respondAsync = prefersRespondAsync(request);
    const result = await deviceAction(deliveryDeps(), { projectId: ctx.projectId, env: ctx.env }, deviceId, cap.data, body.data, { hold: !respondAsync });
    return respond(ctx, result, { respondAsync });
  },
  { scopes: ["actions:write"] }
);
