import { withDeveloperKey } from "@/features/device-sdk/server/with-developer-key";
import { getDevice } from "@/features/device-sdk/server/action-service";
import { deliveryDeps, respond } from "@/features/device-sdk/server/delivery-routes";

export const dynamic = "force-dynamic";

/**
 * `GET /v1/devices/{id}` (C3) — a device and its capability descriptors. Secret key, scope
 * `devices:read`; scoped to the key's project + env (anything else is `not_found`).
 */
export const GET = withDeveloperKey(
  async (_request, ctx, { params }) => {
    const { device_id } = await params;
    return respond(ctx, await getDevice(deliveryDeps(), { projectId: ctx.projectId, env: ctx.env }, device_id ?? ""));
  },
  { scopes: ["devices:read"] }
);
