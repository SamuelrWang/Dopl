import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { pathId, portalRoute, readJsonObject } from "@/features/device-sdk/server/portal-http";
import { setWebhookPaused } from "@/features/device-sdk/server/portal-webhook-admin";

/** `PATCH /api/developers/webhooks/{endpointId}`: pause or resume. Body `{ project, env, paused }`. */
export const PATCH = withUserAuth(
  portalRoute("webhooks", async (request, { userId, params }) => {
    const endpointId = pathId(params?.endpointId, "Endpoint");
    return NextResponse.json(await setWebhookPaused(userId, endpointId, await readJsonObject(request)));
  }),
  { sessionOnly: true }
);
