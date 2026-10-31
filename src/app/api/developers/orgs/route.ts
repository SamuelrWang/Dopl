import { withUserAuth } from "@/shared/auth/with-auth";
import { createOrgWithProject } from "@/features/device-sdk/server/portal-admin";
import { noStore, portalRoute, readJsonObject } from "@/features/device-sdk/server/portal-http";

/** `POST /api/developers/orgs`: signup's second step, a new org owned by the caller with its first project. Body `{ orgName, projectName }`. */
export const POST = withUserAuth(
  portalRoute("orgs", async (request, { userId }) => {
    const body = await readJsonObject(request);
    return noStore(await createOrgWithProject(userId, { orgName: body.orgName, projectName: body.projectName }), 201);
  }),
  { sessionOnly: true }
);
