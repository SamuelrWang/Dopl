import { withUserAuth } from "@/shared/auth/with-auth";
import { changeMemberRole, removeMember } from "@/features/device-sdk/server/portal-admin";
import { noStore, pathId, portalRoute, readJsonObject } from "@/features/device-sdk/server/portal-http";

/** `PATCH`: change a member's role, body `{ role }`. `DELETE`: remove a member, or leave (memberId = yourself). Rules: `portal-admin.ts`. */
export const PATCH = withUserAuth(
  portalRoute("orgs/members", async (request, { userId, params }) => {
    const orgId = pathId(params?.orgId, "Org");
    const memberId = pathId(params?.memberId, "Member");
    const body = await readJsonObject(request);
    await changeMemberRole(userId, orgId, memberId, body.role);
    return noStore({ ok: true });
  }),
  { sessionOnly: true }
);

export const DELETE = withUserAuth(
  portalRoute("orgs/members", async (_request, { userId, params }) => {
    await removeMember(userId, pathId(params?.orgId, "Org"), pathId(params?.memberId, "Member"));
    return noStore({ ok: true });
  }),
  { sessionOnly: true }
);
