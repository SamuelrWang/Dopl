import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { pathId, portalRoute, readJsonObject } from "@/features/device-sdk/server/portal-http";
import { sendWebhookAgain } from "@/features/device-sdk/server/portal-webhook-admin";

/** `POST /api/developers/webhook-deliveries/{deliveryId}`: send it again. Body `{ project, env }`. */
export const POST = withUserAuth(
  portalRoute("webhook-deliveries", async (request, { userId, params }) => {
    const deliveryId = pathId(params?.deliveryId, "Delivery");
    return NextResponse.json(await sendWebhookAgain(userId, deliveryId, await readJsonObject(request)));
  }),
  { sessionOnly: true }
);
