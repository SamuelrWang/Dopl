import { withUserAuth } from "@/shared/auth/with-auth";
import { createProjectKey } from "@/features/device-sdk/server/portal-admin";
import { noStore, pathId, portalErrorResponse, readJsonObject } from "@/features/device-sdk/server/portal-http";

/**
 * `POST /api/developers/projects/{projectId}/keys` — mint a key. Body `{ env, kind, name?, scopes? }`. Owner or
 * admin. The raw key comes back ONCE (never stored or logged), `no-store`.
 */
export const POST = withUserAuth(
  async (request, { userId, params }) => {
    try {
      const projectId = pathId(params?.projectId, "Project");
      const body = await readJsonObject(request);
      const minted = await createProjectKey(userId, projectId, { env: body.env, kind: body.kind, name: body.name, scopes: body.scopes });
      return noStore({ secret: minted.secret, key: minted.key }, 201);
    } catch (err) {
      return portalErrorResponse("projects/keys", err);
    }
  },
  { sessionOnly: true }
);
