import { withDeveloperKey } from "@/features/device-sdk/server/with-developer-key";
import { getAction } from "@/features/device-sdk/server/action-service";
import { deliveryDeps, respond } from "@/features/device-sdk/server/delivery-routes";

export const dynamic = "force-dynamic";

/** `GET /v1/actions/{id}` (C4) — poll a delivery or device action; its stored routing decision rides the event row. */
export const GET = withDeveloperKey(
  async (_request, ctx, { params }) => {
    const { id } = await params;
    return respond(ctx, await getAction(deliveryDeps(), { projectId: ctx.projectId, env: ctx.env }, id ?? ""));
  },
  { scopes: ["actions:write"] }
);
