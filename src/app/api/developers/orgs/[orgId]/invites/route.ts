import { withUserAuth } from "@/shared/auth/with-auth";
import { createInvite } from "@/features/device-sdk/server/portal-invites";
import { noStore, pathId, portalErrorResponse, readJsonObject } from "@/features/device-sdk/server/portal-http";

/**
 * `POST /api/developers/orgs/{orgId}/invites` — invite an email with a role. Body `{ email, role }`.
 * Answers the invite link's path ONCE (only the token's hash is stored), `no-store`.
 */
export const POST = withUserAuth(
  async (request, { userId, params }) => {
    try {
      const orgId = pathId(params?.orgId, "Org");
      const body = await readJsonObject(request);
      const { token, invite } = await createInvite(userId, orgId, { email: body.email, role: body.role });
      return noStore({ invite, path: `/developers/invite/${token}` }, 201);
    } catch (err) {
      return portalErrorResponse("orgs/invites", err);
    }
  },
  { sessionOnly: true }
);
