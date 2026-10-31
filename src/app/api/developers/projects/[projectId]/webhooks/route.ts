import { withUserAuth } from "@/shared/auth/with-auth";
import { noStore, pathId, portalErrorResponse, readJsonObject } from "@/features/device-sdk/server/portal-http";
import { addWebhookEndpoint } from "@/features/device-sdk/server/portal-webhook-admin";

/** `POST /api/developers/projects/{projectId}/webhooks`: add an endpoint. Answers its signing secret ONCE, `no-store`. */
export const POST = withUserAuth(
  async (request, { userId, params }) => {
    try {
      const projectId = pathId(params?.projectId, "Project");
      return noStore(await addWebhookEndpoint(userId, projectId, await readJsonObject(request)), 201);
    } catch (err) {
      return portalErrorResponse("projects/webhooks", err);
    }
  },
  { sessionOnly: true }
);
