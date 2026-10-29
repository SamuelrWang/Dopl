import { withUserAuth } from "@/shared/auth/with-auth";
import { createOrgWithProject } from "@/features/device-sdk/server/portal-admin";
import { noStore, portalErrorResponse, readJsonObject } from "@/features/device-sdk/server/portal-http";

/**
 * `POST /api/developers/orgs` — signup's second step: a new developer org owned by the caller,
 * with its first project. Body `{ orgName, projectName }`. `sessionOnly` (portal-http.ts).
 */
export const POST = withUserAuth(
  async (request, { userId }) => {
    try {
      const body = await readJsonObject(request);
      const out = await createOrgWithProject(userId, { orgName: body.orgName, projectName: body.projectName });
      return noStore(out, 201);
    } catch (err) {
      return portalErrorResponse("orgs", err);
    }
  },
  { sessionOnly: true }
);
