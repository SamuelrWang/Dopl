import { withDeveloperKey } from "@/features/device-sdk/server/with-developer-key";
import { getContext } from "@/features/device-sdk/server/delivery-service";
import { deliveryDeps, respond } from "@/features/device-sdk/server/delivery-routes";

export const dynamic = "force-dynamic";

/** `GET /v1/users/{external_user_id}/context` (C5) — active device, posture, available devices, matched profile. */
export const GET = withDeveloperKey(
  async (_request, ctx, { params }) => {
    const { external_user_id } = await params;
    return respond(ctx, await getContext(deliveryDeps(), { projectId: ctx.projectId, env: ctx.env }, external_user_id ?? ""));
  },
  { scopes: ["devices:read"] }
);
