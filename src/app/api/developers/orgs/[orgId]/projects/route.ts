import { withUserAuth } from "@/shared/auth/with-auth";
import { createProject } from "@/features/device-sdk/server/portal-admin";
import { noStore, pathId, portalRoute, readJsonObject } from "@/features/device-sdk/server/portal-http";

/** `POST /api/developers/orgs/{orgId}/projects`: another project. Body `{ name }`. Owner or admin. */
export const POST = withUserAuth(
  portalRoute("orgs/projects", async (request, { userId, params }) => {
    const orgId = pathId(params?.orgId, "Org");
    const body = await readJsonObject(request);
    return noStore(await createProject(userId, orgId, { name: body.name }), 201);
  }),
  { sessionOnly: true }
);
