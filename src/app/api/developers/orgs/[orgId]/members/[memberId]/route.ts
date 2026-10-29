import { withUserAuth } from "@/shared/auth/with-auth";
import { changeMemberRole, removeMember } from "@/features/device-sdk/server/portal-admin";
import { noStore, pathId, portalErrorResponse, readJsonObject } from "@/features/device-sdk/server/portal-http";

/**
 * `PATCH /api/developers/orgs/{orgId}/members/{memberId}` — change a member's role, body `{ role }`.
 * `DELETE` — remove a member, or leave (memberId = yourself). Rules: `portal-admin.ts`.
 */
export const PATCH = withUserAuth(
  async (request, { userId, params }) => {
    try {
      const orgId = pathId(params?.orgId, "Org");
      const memberId = pathId(params?.memberId, "Member");
      const body = await readJsonObject(request);
      await changeMemberRole(userId, orgId, memberId, body.role);
      return noStore({ ok: true });
    } catch (err) {
      return portalErrorResponse("orgs/members", err);
    }
  },
  { sessionOnly: true }
);

export const DELETE = withUserAuth(
  async (_request, { userId, params }) => {
    try {
      const orgId = pathId(params?.orgId, "Org");
      const memberId = pathId(params?.memberId, "Member");
      await removeMember(userId, orgId, memberId);
      return noStore({ ok: true });
    } catch (err) {
      return portalErrorResponse("orgs/members", err);
    }
  },
  { sessionOnly: true }
);
